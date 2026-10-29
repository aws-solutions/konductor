// SPDX-License-Identifier: Apache-2.0
'use strict';

// Hidden tests through a whole run (fake kiro-cli) and through the namespace mask.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks, benchMask } = require('../lib/tasks.js');
const { makeIsolation, probeUnshare } = require('../lib/isolate.js');
const { makeScratchRoot } = require('../lib/sandbox.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };
const SECRET = 'SECRET_HIDDEN_CASE_NAME';

function hardBench(root) {
  const bench = makeBench(path.join(root, 'bench'));
  const file = path.join(bench, 'tasks/t1.json');
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  write(file, JSON.stringify({
    ...t, class: 'hard', tiers: ['hard'], hidden: 't1',
    checks: [{ type: 'tests', cmd: 'node --test hidden/*.test.js', min: 2 }],
  }));
  // out.txt is written by the fake agent; the second case needs a file it never writes.
  write(path.join(bench, 'tasks/hidden/t1/hidden/a.test.js'), `
const t = require('node:test'); const fs = require('node:fs');
t.test('first', () => { if (!fs.existsSync('out.txt')) throw new Error('missing'); });
t.test('${SECRET}', () => { if (!fs.existsSync('never-written.txt')) throw new Error('missing'); });
`);
  return bench;
}

test('a run scores hidden tests from a scratch copy: partial score recorded, workspace and snapshot stay clean', async () => {
  const root = tmp();
  const prevPath = process.env.PATH;
  try {
    const bench = hardBench(root);
    const bin = path.join(root, 'bin');
    const probeDir = path.join(root, 'probe');
    fs.mkdirSync(probeDir);
    makeFakeKiro(bin, { dir: probeDir });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    fs.mkdirSync(scratchDir);
    const watch = path.join(root, 'watch');
    fs.mkdirSync(watch);
    const ctx = {
      config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'none' },
      tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    };
    process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
    const outDir = path.join(root, 'out', 't1');
    const r = await executeRun({ arm: ARM, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir });
    assert.deepEqual(r.hiddenTests, { passed: 1, total: 2, unparsed: false });
    assert.equal(r.checks[0].passed, false);
    assert.equal(fs.existsSync(path.join(outDir, 'workspace/hidden')), false, 'snapshot has no hidden files');
    assert.doesNotMatch(JSON.stringify(r), new RegExp(SECRET), 'the result carries no hidden test name');
    assert.deepEqual(fs.readdirSync(scratchDir), [], 'the check scratch is removed with the run root');
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;

test('the namespace hides hidden tests and partials but leaves the task file readable', { skip }, () => {
  const scratch = makeScratchRoot();
  const bench = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  try {
    write(path.join(bench, 'tasks/hidden/t1/hidden/a.test.js'), 'HIDDEN');
    write(path.join(bench, 'tasks/partials/t1/p/src/x.js'), 'PARTIAL');
    write(path.join(bench, 'tasks/t1.json'), '{}');
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, mask: benchMask(bench), keyRoots: [bench] });
    const w = iso.wrap('sh', ['-c', [
      `[ -z "$(ls -A ${bench}/tasks/hidden)" ] || exit 60`,
      `[ -z "$(ls -A ${bench}/tasks/partials)" ] || exit 61`,
      `[ -f ${bench}/tasks/t1.json ] || exit 62`,
    ].join('; ')]);
    const r = spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.rmSync(bench, { recursive: true, force: true });
  }
});

test('tests checks run inside the namespace with the scratch under the run root', { skip }, () => {
  const { runChecks } = require('../lib/checks.js');
  const { buildCheckEnv } = require('../lib/env.js');
  const scratch = makeScratchRoot();
  try {
    const ws = path.join(scratch, 'work');
    const hidden = path.join(scratch, 'hidden-src');
    write(path.join(ws, 'a.txt'), 'x');
    write(path.join(hidden, 'hidden/a.test.js'), "require('node:test').test('ok', () => { require('node:assert').ok(require('fs').existsSync('a.txt')); });");
    const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch });
    const home = path.join(scratch, 'check-home');
    fs.mkdirSync(path.join(home, 'tmp'), { recursive: true });
    const { env } = buildCheckEnv(process.env, { home, konductor: false });
    const [r] = runChecks(ws, [{ type: 'tests', cmd: 'node --test hidden/*.test.js', min: 1 }], {
      env, wrapCmd: (cmd) => iso.wrap('sh', ['-c', cmd]), hiddenDir: hidden, scratchDir: path.join(scratch, 'check-scratch'),
    });
    assert.deepEqual(r.tests, { passed: 1, total: 1, unparsed: false }, r.detail);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
