// SPDX-License-Identifier: Apache-2.0
'use strict';

// A real-repository task through a whole run with a fake kiro-cli.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeRealBench, tmp, FIXED_MOD, PYTEST_SKIP } = require('./real-helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { probeUnshare } = require('../lib/isolate.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
// The fake agent writes no transcripts, so other flags (transcriptPartial) appear; only these three concern the audit.
const audit = (r) => r.flags.filter((f) => ['externalFetch', 'fixRecall', 'contaminationUnchecked'].includes(f));
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };

async function runWith(agent, { isolation = { mode: 'none' }, fetched = true, tweak } = {}) {
  const b = makeRealBench({ useEnv: true, fetched });
  const root = tmp('rr-');
  const prevPath = process.env.PATH;
  try {
    const bin = path.join(root, 'bin');
    const probeDir = path.join(root, 'probe');
    fs.mkdirSync(probeDir);
    makeFakeKiro(bin, { dir: probeDir, ...agent });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    fs.mkdirSync(scratchDir);
    const watch = path.join(root, 'watch');
    fs.mkdirSync(watch);
    const ctx = {
      config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation, realCache: b.cache, hide: [], mask: [], keyRoots: [],
      tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    };
    if (tweak) tweak(b, ctx);
    process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
    const outDir = path.join(root, 'out', 'r');
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    const result = await executeRun({ arm: ARM, task, replicate: 1, ctx, prepared: null, outDir });
    const started = fs.existsSync(path.join(probeDir, 'started.json')) ? JSON.parse(fs.readFileSync(path.join(probeDir, 'started.json'), 'utf8')) : null;
    const snap = path.join(outDir, 'workspace');
    const files = fs.existsSync(snap) ? fs.readdirSync(snap, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(snap, path.join(e.parentPath, e.name))).sort() : [];
    const modSource = fs.existsSync(path.join(snap, 'pkg/mod.py')) ? fs.readFileSync(path.join(snap, 'pkg/mod.py'), 'utf8') : null;
    const command = fs.existsSync(path.join(outDir, 'command.txt')) ? fs.readFileSync(path.join(outDir, 'command.txt'), 'utf8') : '';
    return { result, started, files, modSource, command };
  } finally {
    process.env.PATH = prevPath;
    b.done();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('an agent that fixes the bug scores FAIL_TO_PASS and regression separately, with no contamination flag', { skip: PYTEST_SKIP }, async () => {
  const { result: r, started } = await runWith({ files: { 'pkg/mod.py': 'def add(a, b):\n    return a + b\n' } });
  assert.equal(r.error, null);
  assert.equal(r.infraError, null);
  assert.deepEqual(r.hiddenTests, { passed: 1, total: 1, unparsed: false });
  assert.deepEqual(r.regressionTests, { passed: 1, total: 1 });
  const tests = r.checks.find((c) => c.type === 'tests');
  assert.equal(tests.passed, true);
  assert.equal(r.checks.find((c) => c.type === 'fixture_unchanged').passed, true);
  assert.deepEqual(audit(r), []);
  assert.deepEqual(r.contamination, { externalFetch: [], fixRecallChars: 0 });
  assert.ok(started, 'the agent started');
});

test('the agent works on the base tree copied from the cache: no .git, no PR test file, the bug still there', async () => {
  const { files, modSource, command, started } = await runWith({});
  assert.ok(files.includes('tests/test_ident.py'));
  assert.equal(files.includes('tests/test_add.py'), false, 'the PR test file stays out of the workspace');
  assert.equal(files.some((f) => f.split('/').includes('.git')), false);
  assert.match(modSource, /a - b/);
  assert.match(command, /real task demo-1-add/);
  assert.ok(started.cwd.includes('/work'));
});

test('an unfixed tree fails FAIL_TO_PASS but keeps the regression figure full', { skip: PYTEST_SKIP }, async () => {
  const { result: r } = await runWith({});
  assert.equal(r.hiddenTests.passed, 0);
  assert.deepEqual(r.regressionTests, { passed: 1, total: 1 });
  assert.equal(r.checks.find((c) => c.type === 'tests').passed, false);
});

test('fetching from the network raises externalFetch and keeps the evidence', { skip: PYTEST_SKIP }, async () => {
  const { result: r } = await runWith({
    files: { 'pkg/mod.py': 'def add(a, b):\n    return a + b\n' },
    toolCalls: [{ toolName: 'shell', rawInput: { command: 'git clone https://github.com/example/demo /tmp/x', working_dir: '/w' } }],
  });
  assert.deepEqual(audit(r), ['externalFetch']);
  assert.equal(r.contamination.externalFetch.length, 1);
  assert.match(r.contamination.externalFetch[0], /^shell: git clone /);
  assert.equal(r.checks.find((c) => c.type === 'tests').passed, true, 'the flag does not change the check result');
});

test('repeating the upstream fix verbatim raises fixRecall with the matched length', async () => {
  const { result: r } = await runWith({ files: { 'pkg/mod.py': FIXED_MOD } });
  assert.deepEqual(audit(r), ['fixRecall']);
  assert.ok(r.contamination.fixRecallChars >= 80);
  assert.deepEqual(r.contamination.externalFetch, []);
});

test('a missing cache stops the run before the agent starts and tells the user how to fill it', async () => {
  const { result: r, started } = await runWith({}, { fetched: false });
  assert.equal(started, null);
  assert.equal(r.status, 'error');
  assert.match(r.infraError, /node bench\/real\/fetch\.js/);
});

test('editing an existing test file fails fixture_unchanged and the regression figure', async () => {
  const { result: r } = await runWith({ files: { 'pkg/mod.py': 'def add(a, b):\n    return a + b\n', 'tests/test_ident.py': 'def test_ident():\n    assert 1 == 2\n' } });
  assert.equal(r.checks.find((c) => c.type === 'fixture_unchanged').passed, false);
  assert.deepEqual(r.regressionTests, { passed: 0, total: 1 });
});

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;

test('inside the namespace the run still scores correctly with the offline check', { skip }, async () => {
  const { result: r } = await runWith({ files: { 'pkg/mod.py': 'def add(a, b):\n    return a + b\n' } }, { isolation: { mode: 'unshare', reason: 'test' } });
  assert.equal(r.infraError, null, r.error);
  assert.deepEqual(r.hiddenTests, { passed: 1, total: 1, unparsed: false });
  assert.deepEqual(r.regressionTests, { passed: 1, total: 1 });
});
