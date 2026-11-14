// SPDX-License-Identifier: Apache-2.0
'use strict';

// An agent that swaps its live output file for a symlink to a host file gets nothing copied: the run is
// flagged stdioTampered, carries infraError, and is not judged. The canary is a made-up value.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun, spawnWithTimeout } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { notJudgedReason } = require('../../judge/run.js');

const CANARY = 'canary-host-secret-0123456789';
const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

test('spawnWithTimeout reports a swapped stderr file, leaves an empty stand-in and never copies the target', async () => {
  const root = tmp();
  try {
    const out = path.join(root, 'out'); const scratch = path.join(root, 'stdio');
    fs.mkdirSync(out); fs.mkdirSync(scratch);
    const canary = path.join(root, 'canary.txt');
    fs.writeFileSync(canary, CANARY);
    const r = await spawnWithTimeout('sh', ['-c', `echo hello; rm -f ${scratch}/stderr.txt; ln -s ${canary} ${scratch}/stderr.txt`], {
      cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 20000,
      stdoutPath: path.join(out, 'stream.jsonl'), stderrPath: path.join(out, 'stderr.txt'), stdioDir: scratch,
    });
    assert.deepEqual(r.tamperedFiles, ['stderr.txt']);
    assert.equal(fs.readFileSync(path.join(out, 'stream.jsonl'), 'utf8'), 'hello\n');
    assert.equal(fs.readFileSync(path.join(out, 'stderr.txt'), 'utf8'), '');
    assert.equal(fs.readFileSync(canary, 'utf8'), CANARY);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a normal move reports no tampered files', async () => {
  const root = tmp();
  try {
    const out = path.join(root, 'out'); const scratch = path.join(root, 'stdio');
    fs.mkdirSync(out); fs.mkdirSync(scratch);
    const r = await spawnWithTimeout('sh', ['-c', 'echo hello'], {
      cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 20000,
      stdoutPath: path.join(out, 'stream.jsonl'), stderrPath: path.join(out, 'stderr.txt'), stdioDir: scratch,
    });
    assert.deepEqual(r.tamperedFiles, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executeRun (sandbox-exec path) sets stdioTampered and infraError, lists the file name only, and the run is not judged', async () => {
  const root = tmp();
  const prevPath = process.env.PATH;
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const bin = path.join(root, 'bin');
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    const real = makeFakeKiro(bin, { dir: probe });
    const canary = path.join(root, 'canary.txt');
    fs.writeFileSync(canary, CANARY);
    // Only the sandbox-exec path keeps a live stdio directory. A stand-in sandbox-exec drops the profile and runs the
    // command, so the macOS wiring runs here. The agent runs in <run root>/work; the live files sit in the sibling
    // <run root>-stdio.
    fs.writeFileSync(path.join(bin, 'sandbox-exec'), '#!/bin/sh\nshift 2\nexec "$@"\n', { mode: 0o755 });
    fs.renameSync(real, path.join(bin, 'kiro-real'));
    fs.writeFileSync(real, `#!/bin/sh\nd="../../$(basename "$(cd .. && pwd)")-stdio"\nif [ -d "$d" ]; then rm -f "$d/stderr.txt"; ln -s '${canary}' "$d/stderr.txt"; fi\nexec "$(dirname "$0")/kiro-real" "$@"\n`, { mode: 0o755 });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch'); const watch = path.join(root, 'watch');
    fs.mkdirSync(scratchDir); fs.mkdirSync(watch);
    const outDir = path.join(root, 'out', 't1');
    const ctx = {
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'sandbox-exec' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
    };
    process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
    const r = await executeRun({ arm: ARM, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 });
    const saved = JSON.parse(fs.readFileSync(path.join(outDir, 'result.json'), 'utf8'));
    assert.ok(r.flags.includes('stdioTampered'));
    assert.deepEqual(saved.tamperedFiles, ['stderr.txt']);
    assert.match(saved.infraError, /stderr\.txt/);
    assert.equal(saved.status, 'error');
    assert.equal(fs.readFileSync(path.join(outDir, 'stderr.txt'), 'utf8'), '');
    assert.ok(!JSON.stringify(saved).includes(CANARY));
    assert.ok(!/schema:/.test(saved.error ?? ''), saved.error);
    assert.equal(notJudgedReason({ result: saved, dir: outDir }), 'stdioTampered');
  } finally {
    process.env.PATH = prevPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('notJudgedReason names stdioTampered ahead of infraError, and credsUnscrubbed ahead of both', () => {
  assert.equal(notJudgedReason({ result: { flags: ['stdioTampered'], infraError: 'x' }, dir: '/nope' }), 'stdioTampered');
  assert.equal(notJudgedReason({ result: { flags: ['stdioTampered', 'credsUnscrubbed'], infraError: 'x' }, dir: '/nope' }), 'credsUnscrubbed');
});
