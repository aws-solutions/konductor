// SPDX-License-Identifier: Apache-2.0
'use strict';

// The isolation gates: a hash of the real ~/.konductor/installs taken before and after, and the empty rules file
// in a scratch CLAUDE_CONFIG_DIR. Fake kiro-cli, scratch directories only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { runAll } = require('../lib/orchestrate.js');
const { loadTasks } = require('../lib/tasks.js');
const gates = require('../lib/isolation-gates.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };

test('hashDir tells absent, unchanged, changed, added, removed and renamed apart', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'installs');
    assert.deepEqual(gates.hashDir(dir), { state: 'absent', hash: 'absent', files: 0 });
    write(path.join(dir, 'a.json'), '{"a":1}');
    write(path.join(dir, 'sub/b.json'), '{"b":1}');
    const h0 = gates.hashDir(dir);
    assert.equal(h0.state, 'present');
    assert.equal(h0.files, 2);
    assert.equal(gates.hashDir(dir).hash, h0.hash, 'a second read of an unchanged tree gives the same hash');
    write(path.join(dir, 'a.json'), '{"a":2}');
    const h1 = gates.hashDir(dir);
    assert.notEqual(h1.hash, h0.hash, 'a content change');
    fs.renameSync(path.join(dir, 'a.json'), path.join(dir, 'c.json'));
    assert.notEqual(gates.hashDir(dir).hash, h1.hash, 'a rename');
    fs.rmSync(path.join(dir, 'sub'), { recursive: true });
    assert.equal(gates.hashDir(dir).files, 1, 'a removal');
    write(path.join(dir, 'new'), '');
    assert.equal(gates.hashDir(dir).files, 2, 'a 0-byte file counts');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('hashDir does not follow a symlink out of the tree', () => {
  const root = tmp();
  try {
    const dir = path.join(root, 'installs');
    const outside = path.join(root, 'outside');
    write(path.join(outside, 'x'), '1');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(outside, path.join(dir, 'link'));
    const before = gates.hashDir(dir).hash;
    write(path.join(outside, 'x'), '2');
    assert.equal(gates.hashDir(dir).hash, before);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the gate passes when nothing changes and names the file when a write lands', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    write(path.join(home, '.konductor/installs/one.json'), '{}');
    const gate = gates.createInstallsGate({ homes: [home] });
    const quiet = gate.begin();
    assert.deepEqual(quiet.end(), { ok: true, changed: [], unreadable: [] });
    const planted = gate.begin();
    write(path.join(home, '.konductor/installs/probe.json'), '{"leak":true}');
    const r = planted.end();
    assert.equal(r.ok, false);
    assert.equal(r.changed.length, 1);
    assert.equal(r.changed[0].dir, path.join(fs.realpathSync(home), '.konductor/installs'));
    assert.deepEqual(r.changed[0].added, ['probe.json']);
    assert.match(gates.describeChange(r), /\.konductor\/installs/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a directory that appears or vanishes during the window is a change', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    const gate = gates.createInstallsGate({ homes: [home] });
    const w = gate.begin();
    write(path.join(home, '.konductor/installs/first.json'), '{}');
    assert.equal(w.end().ok, false, 'created');
    const w2 = gate.begin();
    fs.rmSync(path.join(home, '.konductor'), { recursive: true });
    assert.equal(w2.end().ok, false, 'removed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('two names for one home are gated once', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    fs.symlinkSync(home, path.join(root, 'alias'));
    assert.deepEqual(gates.installsDirs([home, path.join(root, 'alias')]), [path.join(fs.realpathSync(home), '.konductor/installs')]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ensureEmptyClaudeRules leaves one 0-byte rules file and nothing else in the scratch config dir', () => {
  const root = tmp();
  try {
    const cfg = path.join(root, 'claude-config');
    write(path.join(cfg, 'rules/leaked.md'), 'host rule text');
    const file = gates.ensureEmptyClaudeRules(cfg);
    assert.equal(file, path.join(cfg, 'rules', gates.EMPTY_RULES_NAME));
    assert.equal(fs.statSync(file).size, 0);
    assert.deepEqual(fs.readdirSync(path.join(cfg, 'rules')), [gates.EMPTY_RULES_NAME]);
    gates.ensureEmptyClaudeRules(cfg);
    assert.equal(fs.statSync(file).size, 0, 'idempotent');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ensureEmptyClaudeRules refuses the real config dir', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    assert.throws(() => gates.ensureEmptyClaudeRules(path.join(home, '.claude'), { homes: [home] }), /real/);
    assert.deepEqual(fs.readdirSync(path.join(home, '.claude')), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function setup(cfg = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const fakeHome = path.join(root, 'fake-real-home');
  write(path.join(fakeHome, '.konductor/installs/existing.json'), '{}');
  makeFakeKiro(bin, { dir: probe, ...cfg(fakeHome) });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const outDir = path.join(root, 'out');
  const ctx = {
    config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outDir] },
    installsGate: gates.createInstallsGate({ homes: [fakeHome] }),
  };
  const task = loadTasks(bench).get('t1');
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const cleanup = () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); };
  return { root, ctx, task, outDir, fakeHome, cleanup };
}

const PLANT = (home) => ({ plantFile: path.join(home, '.konductor/installs/probe.json'), plantText: '{"probe":true}' });

test('a run whose agent writes into the real installs fails loudly and keeps its credits', async () => {
  const s = setup(PLANT);
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: path.join(s.outDir, 't1'), inFlightAtStart: 0 });
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('installsChanged'));
    assert.match(r.infraError, /real ~\/\.konductor\/installs changed/);
    assert.match(r.infraError, /probe\.json/);
    assert.equal(r.credits, 0.5, 'the spend of the failed run is still recorded');
  } finally { s.cleanup(); }
});

test('a clean run is not flagged', async () => {
  const s = setup(() => ({}));
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: path.join(s.outDir, 't1'), inFlightAtStart: 0 });
    assert.equal(r.status, 'success');
    assert.equal(r.flags.includes('installsChanged'), false);
    assert.equal(r.infraError, null);
  } finally { s.cleanup(); }
});

test('runAll fails the batch when the real installs changed and does not drop the failed runs', async () => {
  const s = setup(PLANT);
  try {
    const tasks = [...loadTasks(path.join(s.root, 'bench')).values()];
    const out = await runAll({ tasks, arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates: 2, parallel: 1, budgetCredits: null, censoredFloor: 1, seed: 1, outDir: s.outDir, ctx: s.ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {} });
    assert.equal(out.results.length, 2, 'both runs are kept');
    assert.equal(out.results.filter((r) => r.status === 'error').length, 1, 'the run that made the change fails; the rewrite of the same bytes by the next one changes nothing');
    assert.equal(out.installsGate.ok, false);
    assert.deepEqual(out.installsGate.changed[0].added, ['probe.json']);
    const written = JSON.parse(fs.readFileSync(path.join(s.outDir, gates.GATE_FILE), 'utf8'));
    assert.equal(written.ok, false);
  } finally { s.cleanup(); }
});

test('runAll with no leak writes an ok gate record', async () => {
  const s = setup(() => ({}));
  try {
    const tasks = [...loadTasks(path.join(s.root, 'bench')).values()];
    const out = await runAll({ tasks, arms: [ARM], prepared: new Map(), prepErrors: new Map(), replicates: 1, parallel: 1, budgetCredits: null, censoredFloor: 1, seed: 1, outDir: s.outDir, ctx: s.ctx, state: { results: [], spent: 0, charged: 0 }, log: () => {} });
    assert.equal(out.installsGate.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(s.outDir, gates.GATE_FILE), 'utf8')).ok, true);
  } finally { s.cleanup(); }
});

// Fail closed: a gate that cannot read the installs directory must not report "nothing changed".
const readable = (p) => { try { fs.readdirSync(p); return true; } catch { return false; } };

test('an installs path that is a dangling symlink is a gate failure, not an empty tree', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.konductor'), { recursive: true });
    fs.symlinkSync(path.join(root, 'nowhere'), path.join(home, '.konductor/installs'));
    const h = gates.hashDir(path.join(home, '.konductor/installs'));
    assert.equal(h.state, 'unreadable');
    const r = gates.createInstallsGate({ homes: [home] }).begin().end();
    assert.equal(r.ok, false, 'identical before and after hashes must still fail');
    assert.equal(r.unreadable.length, 1);
    assert.match(gates.describeChange(r), /could not be read/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an installs path that is a regular file is hashed as itself, so a change to it fails the gate', () => {
  const root = tmp();
  try {
    const home = path.join(root, 'home');
    const file = path.join(home, '.konductor/installs');
    write(file, '{"a":1}');
    const h = gates.hashDir(file);
    assert.equal(h.state, 'present');
    assert.equal(h.files, 1);
    const gate = gates.createInstallsGate({ homes: [home] });
    assert.deepEqual(gate.begin().end(), { ok: true, changed: [], unreadable: [] });
    const w = gate.begin();
    write(file, '{"a":2}');
    const r = w.end();
    assert.equal(r.ok, false, 'the old gate read this file as an empty directory and never saw the change');
    assert.deepEqual(r.changed[0].modified, ['.']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a directory with no permission to list is a gate failure', () => {
  const root = tmp();
  const dir = path.join(root, 'home/.konductor/installs');
  try {
    write(path.join(dir, 'a.json'), '{}');
    fs.chmodSync(dir, 0o000);
    if (readable(dir)) return; // running with privileges that ignore modes
    const r = gates.createInstallsGate({ homes: [path.join(root, 'home')] }).begin().end();
    assert.equal(r.ok, false);
    assert.equal(r.unreadable.length, 1);
    assert.equal(gates.hashDir(dir).state, 'unreadable');
  } finally { try { fs.chmodSync(dir, 0o755); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); }
});

test('a file that cannot be hashed is a gate failure even when the rest is unchanged', () => {
  const root = tmp();
  const file = path.join(root, 'home/.konductor/installs/secret.json');
  try {
    write(file, '{}');
    write(path.join(root, 'home/.konductor/installs/ok.json'), '{}');
    fs.chmodSync(file, 0o000);
    if (readable(file) || (() => { try { fs.readFileSync(file); return true; } catch { return false; } })()) return;
    const h = gates.hashDir(path.dirname(file));
    assert.deepEqual(h.errors.map((e) => e.path), ['secret.json']);
    const r = gates.createInstallsGate({ homes: [path.join(root, 'home')] }).begin().end();
    assert.equal(r.ok, false);
    assert.equal(r.unreadable.length, 1);
  } finally { try { fs.chmodSync(file, 0o644); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unreadable installs dir that becomes readable (or the reverse) mid-window still fails', () => {
  const root = tmp();
  const dir = path.join(root, 'home/.konductor/installs');
  try {
    write(path.join(dir, 'a.json'), '{}');
    const gate = gates.createInstallsGate({ homes: [path.join(root, 'home')] });
    fs.chmodSync(dir, 0o000);
    if (readable(dir)) return;
    const w = gate.begin();
    fs.chmodSync(dir, 0o755);
    assert.equal(w.end().ok, false, 'unreadable at begin');
  } finally { try { fs.chmodSync(dir, 0o755); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); }
});

// BENCH_GATE_HOMES is a test seam. Without the marker it is ignored, so a stray variable cannot point the gate away
// from the real installs.
function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  const warn = process.stderr.write;
  const seen = [];
  process.stderr.write = (c, ...rest) => { seen.push(String(c)); return true; };
  try { return fn(seen); } finally {
    process.stderr.write = warn;
    for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

test('BENCH_GATE_HOMES is ignored with a warning unless BENCH_TEST_MODE=1', () => {
  const root = tmp();
  try {
    const decoy = path.join(root, 'decoy');
    fs.mkdirSync(decoy);
    withEnv({ BENCH_GATE_HOMES: decoy, BENCH_TEST_MODE: undefined }, (seen) => {
      const gate = gates.createInstallsGate();
      assert.ok(!gate.dirs.some((d) => d.startsWith(fs.realpathSync(decoy))), 'the decoy home is not watched');
      assert.ok(gate.dirs.length >= 1, 'the real homes are watched');
      assert.match(seen.join(''), /BENCH_GATE_HOMES.*ignored/);
    });
    withEnv({ BENCH_GATE_HOMES: decoy, BENCH_TEST_MODE: '0' }, () => {
      assert.ok(!gates.createInstallsGate().dirs.some((d) => d.startsWith(fs.realpathSync(decoy))), 'only the value 1 enables it');
    });
    withEnv({ BENCH_GATE_HOMES: decoy, BENCH_TEST_MODE: '1' }, (seen) => {
      assert.deepEqual(gates.createInstallsGate().dirs, [path.join(fs.realpathSync(decoy), '.konductor/installs')]);
      assert.equal(seen.join(''), '', 'no warning when the marker is set');
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
