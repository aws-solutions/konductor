// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { tmp, makeBench, waitFor } = require('./helpers.js');
const { makeFakeKiro, writeFakeAuth } = require('./fake-kiro.js');
const { makeFakeClaude } = require('./fake-claude.js');
const { makeFakeOpencode } = require('./fake-opencode.js');
const { spawnWithTimeout } = require('../lib/run-one.js');
const procs = require('../lib/procs.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const findAll = (dir, name) => fs.readdirSync(dir, { recursive: true }).filter((f) => path.basename(String(f)) === name);

for (const signal of ['SIGTERM', 'SIGHUP']) test(`${signal} to the runner kills the agent group, removes scratch and auth copies, and writes partial results`, async () => {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(path.join(root, 'bin'), { dir: probe, sleepSec: 60 });
  const home = path.join(root, 'home');
  writeFakeAuth(home);
  const tmpdir = path.join(root, 'tmp');
  fs.mkdirSync(tmpdir);
  const out = path.join(root, 'out');
  const env = { PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`, HOME: home, TMPDIR: tmpdir };
  const runner = spawn(process.execPath, [
    BENCH_JS, 'run', '--budget-credits', '1000', '--suite', 'lite', '--arms', 'vanilla', '--tasks', 't1', '--isolate', 'none', '--allow-unisolated',
    '--bench-dir', bench, '--out', out, '--cache', path.join(root, 'cache'),
  ], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  runner.stderr.on('data', (d) => { stderr += d; });
  const exited = new Promise((resolve) => runner.on('close', (code, signal) => resolve({ code, signal })));
  try {
    const started = await waitFor(() => fs.existsSync(path.join(probe, 'started.json')) && JSON.parse(fs.readFileSync(path.join(probe, 'started.json'), 'utf8')));
    assert.ok(alive(started.pid));
    assert.equal(findAll(tmpdir, 'data.sqlite3').length > 0, true, 'auth copy exists while the agent runs');
    runner.kill(signal);
    const { code } = await exited;
    assert.notEqual(code, 0, stderr);
    await waitFor(() => !alive(started.pid), 5000);
    assert.deepEqual(findAll(tmpdir, 'data.sqlite3'), []);
    assert.deepEqual(fs.readdirSync(tmpdir).filter((n) => n.startsWith('w-')), []);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.interrupted, signal);
  } finally {
    if (runner.exitCode === null) runner.kill('SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// D-16: the test above parses started.json as soon as it exists. An in-place write would expose a half-written
// file; a rename gives the path a new inode, so this fails if the fake goes back to writing in place.
test('the fake agent replaces started.json by a rename, so a poller never reads it half written', () => {
  const root = tmp();
  try {
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    const bin = makeFakeKiro(path.join(root, 'bin'), { dir: probe });
    const file = path.join(probe, 'started.json');
    fs.writeFileSync(file, 'old');
    const before = fs.statSync(file).ino;
    const r = spawnSync(process.execPath, [bin, 'chat'], { cwd: root, env: { PATH: process.env.PATH, HOME: path.join(root, 'home') } });
    assert.equal(r.status, 0, String(r.stderr));
    assert.notEqual(fs.statSync(file).ino, before, 'started.json was rewritten in place');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid > 0, true);
    assert.deepEqual(fs.readdirSync(probe).filter((n) => n.includes('.tmp')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the fake claude and opencode agents also write their started files by a rename', () => {
  const root = tmp();
  try {
    makeFakeClaude(path.join(root, 'claude'), { dir: root });
    makeFakeOpencode(path.join(root, 'oc'), { dir: root });
    const scripts = [path.join(root, 'claude', '9.9.9', 'fake-claude.js'), path.join(root, 'oc', 'opencode')].map((f) => fs.readFileSync(f, 'utf8'));
    for (const text of scripts) {
      assert.match(text, /writeAtomic\(path\.join\(cfg\.dir, 'started/);
      assert.doesNotMatch(text, /writeFileSync\(path\.join\(cfg\.dir, 'started/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a timeout kills the whole process group and unregisters it', async () => {
  const root = tmp();
  try {
    const pidFile = path.join(root, 'child.pid');
    const r = await spawnWithTimeout('sh', ['-c', `sleep 30 & echo $! > ${pidFile}; wait`], {
      cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 300,
      stdoutPath: path.join(root, 'o'), stderrPath: path.join(root, 'e'),
    });
    assert.equal(r.timedOut, true);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await waitFor(() => !alive(pid), 3000);
    assert.deepEqual(procs.liveGroups(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('killAllGroups stops a registered group', async () => {
  const root = tmp();
  try {
    const p = spawnWithTimeout('sh', ['-c', 'sleep 30'], {
      cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 60000,
      stdoutPath: path.join(root, 'o'), stderrPath: path.join(root, 'e'),
    });
    await waitFor(() => procs.liveGroups().length === 1, 2000);
    const [pgid] = procs.liveGroups();
    procs.killAllGroups('SIGKILL');
    const r = await p;
    assert.equal(r.exitCode, null);
    assert.equal(alive(pgid), false);
    assert.deepEqual(procs.liveGroups(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('with stdioDir the child writes under the scratch root and the files move to their final paths on exit', async () => {
  const root = tmp();
  try {
    const out = path.join(root, 'out'); const scratch = path.join(root, 'stdio');
    fs.mkdirSync(out); fs.mkdirSync(scratch);
    const marker = path.join(root, 'go');
    const p = spawnWithTimeout('sh', ['-c', `echo hello; echo oops >&2; while [ ! -e ${marker} ]; do sleep 0.05; done`], {
      cwd: root, env: { PATH: process.env.PATH }, timeoutMs: 20000,
      stdoutPath: path.join(out, 'stream.jsonl'), stderrPath: path.join(out, 'stderr.txt'), stdioDir: scratch,
    });
    await waitFor(() => fs.existsSync(path.join(scratch, 'stream.jsonl')) && fs.readFileSync(path.join(scratch, 'stream.jsonl'), 'utf8').includes('hello'));
    assert.equal(fs.existsSync(path.join(out, 'stream.jsonl')), false, 'nothing is written to the out dir while the child runs');
    fs.writeFileSync(marker, '');
    const r = await p;
    assert.equal(r.exitCode, 0);
    assert.equal(fs.readFileSync(path.join(out, 'stream.jsonl'), 'utf8'), 'hello\n');
    assert.equal(fs.readFileSync(path.join(out, 'stderr.txt'), 'utf8'), 'oops\n');
    assert.deepEqual(fs.readdirSync(scratch), [], 'the live files are moved, not copied');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removeAllScratch also removes a tracked dir that holds a read-only release copy (a killed plant run, D-93)', () => {
  const root = tmp();
  const priv = path.join(root, 'kplant-x');
  const rel = path.join(priv, 'release-y', 'policy');
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, 'rules.cedar'), 'permit;');
  fs.chmodSync(path.join(rel, 'rules.cedar'), 0o400);
  fs.chmodSync(rel, 0o500);
  fs.chmodSync(path.dirname(rel), 0o500);
  procs.trackScratch(priv);
  procs.removeAllScratch();
  assert.equal(fs.existsSync(priv), false);
});
