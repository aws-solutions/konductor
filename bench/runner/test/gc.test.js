// SPDX-License-Identifier: Apache-2.0
'use strict';

// gc on synthetic trees: only marked, old, unprotected, unused directories are removed, and everything is checked again before each deletion.
// In-process: nothing here starts bench.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const gc = require('../lib/gc.js');
const owned = require('../lib/owned.js');
const cleanup = require('../lib/cleanup-cmd.js');

const DAY = 86400000;
const NO_PROTECT = { entries: [], problems: [] };
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const children = [];

test.after(() => { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } });

const scratchRoot = () => fs.realpathSync(mkScratch('gc-'));

function touchAll(dir, t) {
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      if (e.isSymbolicLink()) fs.lutimesSync(p, t, t); else fs.utimesSync(p, t, t);
    }
  };
  walk(dir);
  fs.utimesSync(dir, t, t);
}

/** Writes a marker of the given age into an existing directory and backdates everything in it. */
function writeMarker(dir, name, o = {}) {
  const t = new Date(Date.now() - (o.ageDays ?? 10) * DAY);
  const marker = {
    schemaVersion: 1, kind: o.kind ?? 'cache', createdAt: t.toISOString(), lastUsedAt: t.toISOString(), benchCommit: null, command: 'test',
    pid: o.pid ?? null, pidStart: o.pidStart ?? null, id: name, protect: Boolean(o.protect),
  };
  fs.writeFileSync(path.join(dir, owned.MARKER_FILE), JSON.stringify(marker));
  touchAll(dir, t);
  return dir;
}

/** A marked directory of the given age in days (default 10). pid, protect and kind are set in the marker. */
function mk(root, name, o = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'data.bin'), 'x'.repeat(o.bytes ?? 5000));
  return writeMarker(dir, name, o);
}

const plan = (root, o = {}) => gc.planGc({ roots: [root], protect: NO_PROTECT, olderThanMs: 7 * DAY, ...o });
const byName = (p, name) => p.entries.find((e) => path.basename(e.dir) === name);
const eligibleNames = (p) => p.entries.filter((e) => e.eligible).map((e) => path.basename(e.dir)).sort();

function holdCwd(dir) {
  const c = spawn('sleep', ['60'], { cwd: dir, stdio: 'ignore' });
  children.push(c);
  return c;
}

function heldNow(dir, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) if (gc.holdersOf([dir], gc.snapshotProcesses()).length) return;
  throw new Error(`no process holds ${dir}`);
}

async function untilHeld(dir, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (gc.holdersOf([dir], gc.snapshotProcesses()).length) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no process holds ${dir}`);
}

function capture(fn) {
  const lines = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  const prior = process.exitCode;
  return Promise.resolve(fn()).then(() => ({ out: lines.join('\n'), exit: process.exitCode }), (e) => { throw e; }).finally(() => { console.log = log; console.error = err; process.exitCode = prior; });
}

// ---------------------------------------------------------------- listing and the dry run

test('the plan lists marked directories only, with kind, size, age and the reason, and removes nothing', () => {
  const root = scratchRoot();
  mk(root, 'old-cache', { ageDays: 10 });
  mk(root, 'young-scratch', { ageDays: 0.01, kind: 'scratch' });
  fs.mkdirSync(path.join(root, 'plain'));
  fs.writeFileSync(path.join(root, 'plain', 'f'), 'x');
  const p = plan(root);
  assert.deepEqual(p.entries.map((e) => path.basename(e.dir)).sort(), ['old-cache', 'young-scratch']);
  const old = byName(p, 'old-cache');
  assert.equal(old.eligible, true);
  assert.equal(old.kind, 'cache');
  assert.ok(old.sizeBytes > 0 && old.ageMs > 9 * DAY);
  const young = byName(p, 'young-scratch');
  assert.equal(young.eligible, false);
  assert.match(young.reasons.join(), /younger than 7d/);
  for (const n of ['old-cache', 'young-scratch', 'plain']) assert.ok(fs.existsSync(path.join(root, n)));
  assert.equal(p.reclaimableBytes, old.sizeBytes);
});

test('cmdGc without --apply prints the plan and deletes nothing', async () => {
  const root = scratchRoot();
  const pf = path.join(root, 'protect.txt');
  const old = mk(root, 'old-cache');
  const r = await capture(() => cleanup.cmdGc({ _: [], root, 'protect-file': pf }));
  assert.match(r.out, /dry run, nothing is deleted/);
  assert.match(r.out, /DELETE\s+cache/);
  assert.ok(r.out.includes(old));
  assert.match(r.out, /Nothing was deleted\. Run again with --apply/);
  assert.ok(fs.existsSync(old));
  const j = await capture(() => cleanup.cmdGc({ _: [], root, json: true, 'protect-file': pf }));
  const parsed = JSON.parse(j.out);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.entries[0].eligible, true);
  assert.ok(fs.existsSync(old));
});

test('the scan reaches depth 3 and no further', () => {
  const root = scratchRoot();
  mk(path.join(root, 'a', 'b'), 'depth3');
  mk(path.join(root, 'a', 'b', 'c'), 'depth4');
  const p = plan(root);
  assert.deepEqual(p.entries.map((e) => path.basename(e.dir)), ['depth3']);
});

test('an invalid marker is listed as kept and never deleted', () => {
  const root = scratchRoot();
  const d = path.join(root, 'broken');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, owned.MARKER_FILE), '{"schemaVersion":1,"kind":"nope"}');
  touchAll(d, new Date(Date.now() - 30 * DAY));
  const p = plan(root);
  assert.equal(p.entries.length, 1);
  assert.equal(p.entries[0].eligible, false);
  assert.match(p.entries[0].reasons[0], /marker is not valid/);
  assert.deepEqual(gc.applyGc(p), []);
  assert.ok(fs.existsSync(d));
});

// ---------------------------------------------------------------- apply

test('--apply deletes only eligible marked directories, appends a log, and leaves unmarked and young ones', () => {
  const root = scratchRoot();
  const doomed = mk(root, 'old-cache');
  const doomed2 = mk(root, 'old-scratch', { kind: 'scratch', ageDays: 20 });
  const young = mk(root, 'young', { ageDays: 1 });
  const flagged = mk(root, 'flagged', { protect: true });
  const unmarked = path.join(root, 'unmarked-old');
  fs.mkdirSync(unmarked);
  fs.writeFileSync(path.join(unmarked, 'f'), 'x');
  touchAll(unmarked, new Date(Date.now() - 90 * DAY));
  const p = plan(root);
  assert.deepEqual(eligibleNames(p), ['old-cache', 'old-scratch']);
  const results = gc.applyGc(p);
  assert.deepEqual(results.map((r) => r.status), ['deleted', 'deleted']);
  assert.ok(!fs.existsSync(doomed) && !fs.existsSync(doomed2));
  for (const d of [young, flagged, unmarked]) assert.ok(fs.existsSync(d), d);
  const log = fs.readFileSync(path.join(root, gc.GC_LOG), 'utf8').trim().split('\n');
  assert.equal(log.length, 2);
  assert.match(log[0], /\tdeleted\t(cache|scratch)\t/);
  assert.ok(log.some((l) => l.includes(doomed)));
});

test('cmdGc --apply prints the plan first, deletes, and summarises', async () => {
  const root = scratchRoot();
  const pf = path.join(root, 'protect.txt');
  const doomed = mk(root, 'old-cache');
  const r = await capture(() => cleanup.cmdGc({ _: [], root, apply: true, 'protect-file': pf }));
  assert.ok(r.out.indexOf('applying the plan below') < r.out.indexOf('deleted '));
  assert.match(r.out, /DELETE\s+cache/);
  assert.match(r.out, /deleted 1, freed .*skipped 0, failed 0/);
  assert.ok(!fs.existsSync(doomed));
});

test('--apply with an --older-than under one hour is refused before anything is scanned', async () => {
  const root = scratchRoot();
  const d = mk(root, 'old-cache');
  const r = await capture(() => cleanup.cmdGc({ _: [], root, apply: true, 'older-than': '10m', 'protect-file': path.join(root, 'p') }));
  assert.equal(r.exit, 2);
  assert.match(r.out, /at least 1h/);
  assert.ok(fs.existsSync(d));
});

test('default kinds are scratch, cache and cargo-target; run-out and study-driver-dir need --kind; archive is never deleted', () => {
  const root = scratchRoot();
  for (const k of ['scratch', 'cache', 'cargo-target', 'run-out', 'study-driver-dir', 'archive']) mk(root, `k-${k}`, { kind: k });
  assert.deepEqual(eligibleNames(plan(root)), ['k-cache', 'k-cargo-target', 'k-scratch']);
  const all = plan(root, { kinds: gc.DEFAULT_KINDS.concat(['run-out', 'study-driver-dir', 'archive']) });
  assert.deepEqual(eligibleNames(all), ['k-cache', 'k-cargo-target', 'k-run-out', 'k-scratch', 'k-study-driver-dir']);
  assert.match(byName(all, 'k-archive').reasons.join(), /never deleted by gc/);
  assert.match(byName(plan(root), 'k-run-out').reasons.join(), /pass --kind run-out/);
});

test('--keep-last spares the newest N of each kind', () => {
  const root = scratchRoot();
  for (const [i, d] of [10, 11, 12, 13].entries()) mk(root, `cache-${i}`, { ageDays: d });
  mk(root, 'scratch-0', { kind: 'scratch', ageDays: 30 });
  const p = plan(root, { keepLast: 2 });
  assert.deepEqual(eligibleNames(p), ['cache-2', 'cache-3']);
  assert.match(byName(p, 'cache-0').reasons.join(), /newest 2 of kind cache/);
  assert.match(byName(p, 'scratch-0').reasons.join(), /newest 2 of kind scratch/);
});

test('recent activity inside an old marked directory keeps it', () => {
  const root = scratchRoot();
  const d = mk(root, 'busy');
  fs.writeFileSync(path.join(d, 'sub', 'fresh.log'), 'now');
  const p = plan(root);
  assert.equal(byName(p, 'busy').eligible, false);
  assert.match(byName(p, 'busy').reasons.join(), /younger/);
});

test('nested marked directories are both removed without error', () => {
  const root = scratchRoot();
  const parent = mk(root, 'study');
  const child = mk(parent, 'cargo-target', { kind: 'cargo-target' });
  touchAll(parent, new Date(Date.now() - 10 * DAY));
  const p = plan(root);
  assert.deepEqual(eligibleNames(p), ['cargo-target', 'study']);
  const r = gc.applyGc(p);
  assert.deepEqual(r.map((x) => [path.basename(x.dir), x.status]), [['study', 'deleted'], ['cargo-target', 'deleted']]);
  assert.match(r[1].reason, /removed with/);
  assert.equal(r[1].bytes, 0);
  assert.ok(!fs.existsSync(parent) && !fs.existsSync(child));
});

// ---------------------------------------------------------------- protections

test('the protect file wins over a marker: exact path, glob, a parent, and a protected path inside', () => {
  const root = scratchRoot();
  const exact = mk(root, 'exact');
  mk(root, 'handoff-notes');
  mk(path.join(root, 'family-1'), 'inner');
  const holder = mk(root, 'holder');
  fs.writeFileSync(path.join(holder, 'keep.md'), 'precious');
  touchAll(holder, new Date(Date.now() - 10 * DAY));
  mk(root, 'free');
  const protect = { entries: [exact, path.join(root, '*handoff*'), path.join(root, 'family-*'), path.join(holder, 'keep.md')], problems: [] };
  const p = plan(root, { protect });
  assert.deepEqual(eligibleNames(p), ['free']);
  assert.match(byName(p, 'exact').reasons.join(), /protected by/);
  assert.match(byName(p, 'handoff-notes').reasons.join(), /protected by/);
  assert.match(byName(p, 'inner').reasons.join(), /protected by/);
  assert.match(byName(p, 'holder').reasons.join(), /protected by/);
  gc.applyGc(p);
  for (const n of ['exact', 'handoff-notes', 'holder']) assert.ok(fs.existsSync(path.join(root, n)), n);
  assert.ok(!fs.existsSync(path.join(root, 'free')));
});

test('a protect file that cannot be read stops every deletion', () => {
  const root = scratchRoot();
  mk(root, 'old-cache');
  const dirAsFile = path.join(root, 'protect-dir');
  fs.mkdirSync(dirAsFile);
  const p = gc.planGc({ roots: [root], protectFile: dirAsFile, olderThanMs: 7 * DAY });
  assert.deepEqual(eligibleNames(p), []);
  assert.match(byName(p, 'old-cache').reasons.join(), /protect file could not be read/);
});

test('git: a worktree, a directory holding one, and a directory inside a checkout are all kept', () => {
  const root = scratchRoot();
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (args, cwd = repo) => { const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); };
  git(['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(repo, 'f'), 'x');
  git(['add', 'f']);
  git(['commit', '-q', '-m', 'init']);
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  const wt = path.join(work, 'wt');
  git(['worktree', 'add', '-q', '-b', 'side', wt]);
  const holderWt = path.join(work, 'holder', 'nested-wt');
  fs.mkdirSync(path.dirname(holderWt));
  git(['worktree', 'add', '-q', '-b', 'side2', holderWt]);
  const isWorktree = path.join(work, 'plain-wt');
  git(['worktree', 'add', '-q', '-b', 'side3', isWorktree]);
  for (const d of [wt, isWorktree]) { fs.writeFileSync(path.join(d, owned.MARKER_FILE), JSON.stringify({ schemaVersion: 1, kind: 'cache', createdAt: new Date(0).toISOString(), lastUsedAt: new Date(0).toISOString(), pid: null, protect: false })); touchAll(d, new Date(Date.now() - 30 * DAY)); }
  const holder = path.join(work, 'holder');
  fs.writeFileSync(path.join(holder, owned.MARKER_FILE), JSON.stringify({ schemaVersion: 1, kind: 'cache', createdAt: new Date(0).toISOString(), lastUsedAt: new Date(0).toISOString(), pid: null, protect: false }));
  touchAll(holder, new Date(Date.now() - 30 * DAY));
  const inside = mk(path.join(repo, 'sub'), 'inside-checkout');
  const p = plan(root, { repoRoots: [repo] });
  assert.deepEqual(eligibleNames(p), []);
  assert.match(byName(p, 'wt').reasons.join(), /\.git entry|worktree/);
  assert.match(byName(p, 'plain-wt').reasons.join(), /\.git entry|worktree/);
  assert.match(byName(p, 'holder').reasons.join(), /worktree/);
  assert.match(byName(p, 'inside-checkout').reasons.join(), /inside the git checkout/);
  assert.deepEqual(gc.applyGc(p), []);
  for (const d of [wt, holderWt, isWorktree, inside]) assert.ok(fs.existsSync(d), d);
});

test('a directory that holds a .git entry is kept', () => {
  const root = scratchRoot();
  const d = mk(root, 'has-git');
  fs.mkdirSync(path.join(d, '.git'));
  touchAll(d, new Date(Date.now() - 10 * DAY));
  assert.match(byName(plan(root), 'has-git').reasons.join(), /\.git entry/);
});

test('a process with the directory as its working directory keeps it', async () => {
  const root = scratchRoot();
  const d = mk(root, 'in-use');
  holdCwd(path.join(d, 'sub'));
  await untilHeld(d);
  const p = plan(root);
  assert.equal(byName(p, 'in-use').eligible, false);
  assert.match(byName(p, 'in-use').reasons.join(), /working directory/);
  assert.deepEqual(gc.applyGc(p), []);
  assert.ok(fs.existsSync(d));
});

test('an open file or a command-line path keeps the directory', async () => {
  const root = scratchRoot();
  const fdDir = mk(root, 'fd-held');
  const argDir = mk(root, 'arg-held');
  const near = mk(root, 'arg-held-twin');
  const a = spawn('sh', ['-c', 'exec 3<"$F"; exec sleep 60'], { env: { ...process.env, F: path.join(fdDir, 'sub', 'data.bin') }, stdio: 'ignore' });
  const b = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', path.join(argDir, 'sub', 'data.bin')], { stdio: 'ignore' });
  children.push(a, b);
  await untilHeld(fdDir);
  await untilHeld(argDir);
  const p = plan(root);
  assert.match(byName(p, 'fd-held').reasons.join(), /file open/);
  assert.match(byName(p, 'arg-held').reasons.join(), /command line/);
  assert.equal(byName(p, 'arg-held-twin').eligible, true, 'a sibling whose name only shares a prefix is not held');
  assert.ok(fs.existsSync(near));
});

test('a marker whose study pid is alive keeps the directory; a dead or recycled pid does not', () => {
  const root = scratchRoot();
  const live = holdCwd(root);
  const start = owned.pidStartTicks(live.pid);
  mk(root, 'running', { pid: live.pid, pidStart: start });
  mk(root, 'recycled', { pid: live.pid, pidStart: '1' });
  const dead = spawnSync('true');
  mk(root, 'finished', { pid: dead.pid ?? 999999 });
  const p = plan(root);
  assert.match(byName(p, 'running').reasons.join(), /study is still running/);
  assert.equal(byName(p, 'recycled').eligible, true);
  assert.equal(byName(p, 'finished').eligible, true);
});

test('symlinks: one pointing outward is not followed, and one pointing in from a retained path keeps the target', () => {
  const root = scratchRoot();
  const outside = scratchRoot();
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'keep me');
  const d = mk(root, 'has-outward-link');
  fs.symlinkSync(outside, path.join(d, 'sub', 'out'));
  fs.symlinkSync(path.join(outside, 'precious.txt'), path.join(d, 'sub', 'file-link'));
  touchAll(d, new Date(Date.now() - 10 * DAY));
  const target = mk(root, 'run-1');
  fs.symlinkSync(target, path.join(root, 'latest'));
  const linkedDir = mk(outside, 'elsewhere');
  fs.symlinkSync(linkedDir, path.join(root, 'to-elsewhere'));
  const p = plan(root);
  assert.deepEqual(eligibleNames(p), ['has-outward-link']);
  assert.match(byName(p, 'run-1').reasons.join(), /symlink that points into it/);
  assert.equal(p.entries.some((e) => e.dir === linkedDir || e.real === linkedDir), false, 'a symlinked directory is not scanned');
  gc.applyGc(p);
  assert.ok(!fs.existsSync(d));
  assert.equal(fs.readFileSync(path.join(outside, 'precious.txt'), 'utf8'), 'keep me');
  assert.ok(fs.existsSync(linkedDir) && fs.existsSync(target));
});

test('a marker that is itself a symlink is not valid', () => {
  const root = scratchRoot();
  const real = mk(root, 'real');
  const d = path.join(root, 'sneaky');
  fs.mkdirSync(d);
  fs.symlinkSync(path.join(real, owned.MARKER_FILE), path.join(d, owned.MARKER_FILE));
  touchAll(d, new Date(Date.now() - 10 * DAY));
  const e = byName(plan(root), 'sneaky');
  assert.equal(e.eligible, false);
  assert.match(e.reasons[0], /not a regular file/);
});

test('roots, the home directory, temp dirs, repository roots and parents of them are never deletable', () => {
  const root = scratchRoot();
  const ctx = gc.makeContext({ scan: { found: [], symlinks: [], warnings: [], roots: [root] }, snapshot: { ok: true, procs: [] } });
  const danger = (p) => gc.dangerousLocation(p, ctx);
  assert.match(danger('/'), /filesystem root/);
  assert.match(danger('/tmp'), /protected location/);
  assert.match(danger('/var/tmp'), /protected location/);
  assert.match(danger('/var'), /contains/);
  const home = fs.realpathSync(os.homedir());
  assert.match(danger(home), /home directory/);
  assert.match(danger(path.dirname(home)), /contains/);
  assert.match(danger(root), /protected location/);
  assert.match(danger(path.resolve(__dirname, '..', '..', '..')), /protected location|contains/);
  assert.equal(danger(path.join(root, 'child')), null);
});

test('a marker in the scan root itself, or in the home directory, is kept', () => {
  const root = scratchRoot();
  const rootMarked = writeMarker(scratchRoot(), 'self');
  const p1 = plan(rootMarked);
  assert.equal(p1.entries[0].eligible, false);
  assert.match(p1.entries[0].reasons.join(), /scan root/);
  const prior = process.env.HOME;
  const fakeHome = mk(root, 'fake-home');
  process.env.HOME = fakeHome;
  try {
    const p2 = plan(root);
    assert.match(byName(p2, 'fake-home').reasons.join(), /home directory/);
  } finally {
    if (prior === undefined) delete process.env.HOME; else process.env.HOME = prior;
  }
});

test('a directory owned by someone else is kept', () => {
  const root = scratchRoot();
  mk(root, 'old-cache');
  const p = plan(root, { uid: process.getuid() + 1 });
  assert.match(byName(p, 'old-cache').reasons.join(), /owned by another user/);
});

test('without a readable /proc nothing is eligible', () => {
  const root = scratchRoot();
  mk(root, 'old-cache');
  const p = plan(root, { procRoot: path.join(root, 'no-proc') });
  assert.equal(p.processesChecked, false);
  assert.match(byName(p, 'old-cache').reasons.join(), /cannot check running processes/);
});

// ---------------------------------------------------------------- re-verification at apply time

test('a directory that becomes busy, protected, young, marker-protected or replaced after the plan is skipped', () => {
  const root = scratchRoot();
  const pf = path.join(root, 'protect.txt');
  const busy = mk(root, 'busy');
  const protectedLater = mk(root, 'protected-later');
  const touched = mk(root, 'touched');
  const flagged = mk(root, 'flagged-later');
  const swapped = mk(root, 'swapped');
  const survivor = mk(root, 'survivor');
  const p = gc.planGc({ roots: [root], protectFile: pf, olderThanMs: 7 * DAY });
  assert.equal(p.entries.filter((e) => e.eligible).length, 6);
  const hooks = {
    beforeEach(planned) {
      if (planned.dir === busy) { holdCwd(busy); heldNow(busy); }
      if (planned.dir === protectedLater) fs.writeFileSync(pf, `${protectedLater}\n`);
      if (planned.dir === touched) fs.writeFileSync(path.join(touched, 'new.log'), 'x');
      if (planned.dir === flagged) fs.writeFileSync(path.join(flagged, owned.MARKER_FILE), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(flagged, owned.MARKER_FILE), 'utf8')), protect: true }));
      if (planned.dir === swapped) { fs.rmSync(swapped, { recursive: true }); fs.mkdirSync(swapped); }
    },
  };
  const results = gc.applyGc(p, hooks);
  const status = Object.fromEntries(results.map((r) => [path.basename(r.dir), r.status]));
  assert.equal(status.survivor, 'deleted');
  for (const n of ['busy', 'protected-later', 'touched', 'flagged-later', 'swapped']) assert.equal(status[n], 'skipped', `${n}: ${JSON.stringify(results)}`);
  for (const d of [busy, protectedLater, touched, flagged]) assert.ok(fs.existsSync(d), d);
  assert.ok(!fs.existsSync(survivor));
});

// ---------------------------------------------------------------- protect file and glob helpers

test('protect file: comments and blanks are ignored, ~ expands, relative entries are reported, add dedupes, list prints', async () => {
  const root = scratchRoot();
  const f = path.join(root, 'sub', 'protect.txt');
  assert.deepEqual(gc.readProtectFile(f).entries, []);
  assert.equal(gc.addProtectEntry(f, '/var/tmp/keep-me'), true);
  assert.equal(gc.addProtectEntry(f, '/var/tmp/keep-me'), false);
  fs.appendFileSync(f, '# a comment\n\n~/notes\nrelative/path\n/var/tmp/*glob*\n');
  const r = gc.readProtectFile(f);
  assert.deepEqual(r.entries, ['/var/tmp/keep-me', path.join(os.homedir(), 'notes'), '/var/tmp/*glob*']);
  assert.match(r.problems.join(), /relative\/path/);
  assert.throws(() => gc.addProtectEntry(f, 'relative'), /absolute/);
  const listed = await capture(() => cleanup.cmdGc({ _: [], protect: 'list', 'protect-file': f }));
  assert.match(listed.out, /\/var\/tmp\/keep-me/);
  const added = await capture(() => cleanup.cmdGc({ _: ['/var/tmp/other'], protect: 'add', 'protect-file': f }));
  assert.match(added.out, /added \/var\/tmp\/other/);
  assert.ok(fs.readFileSync(f, 'utf8').endsWith('/var/tmp/other\n'));
});

test('glob matching: * and ? stay inside a segment, ** crosses segments, and below-checks work', () => {
  assert.equal(gc.globMatches('/var/tmp/*handoff*', '/var/tmp/old-handoff-2'), true);
  assert.equal(gc.globMatches('/var/tmp/*handoff*', '/var/tmp/a/handoff'), false);
  assert.equal(gc.globMatches('/a/**/z', '/a/b/c/z'), true);
  assert.equal(gc.globMatches('/a/?x', '/a/bx'), true);
  assert.equal(gc.globMatches('/a/?x', '/a/bbx'), false);
  assert.equal(gc.globMatches('/a/b.c', '/a/bxc'), false);
  assert.equal(gc.patternReachesBelow('/var/tmp/x/keep/*', '/var/tmp/x'), true);
  assert.equal(gc.patternReachesBelow('/var/tmp/x/keep/*', '/var/tmp/y'), false);
  assert.equal(gc.patternReachesBelow('/var/tmp/*handoff*', '/var/tmp/x'), false);
});

test('parseDuration', () => {
  assert.equal(gc.parseDuration('7d'), 7 * DAY);
  assert.equal(gc.parseDuration('12h'), 12 * 3600000);
  assert.equal(gc.parseDuration('2w'), 14 * DAY);
  assert.throws(() => gc.parseDuration('7'), /not a duration/);
  assert.throws(() => gc.parseDuration('soon'), /not a duration/);
});

// ---------------------------------------------------------------- adoption

test('adopt: a dry run writes nothing, --apply writes an adopted marker with the directory age, and gc then treats it like any marked directory', async () => {
  const root = scratchRoot();
  const pf = path.join(root, 'protect.txt');
  const old = path.join(root, 'legacy');
  fs.mkdirSync(path.join(old, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(old, 'sub', 'f'), 'x');
  touchAll(old, new Date(Date.now() - 20 * DAY));
  const dry = await capture(() => cleanup.cmdGc({ _: [], adopt: old, kind: 'cache', 'protect-file': pf }));
  assert.match(dry.out, /dry run: would adopt/);
  assert.equal(fs.existsSync(path.join(old, owned.MARKER_FILE)), false);
  const wet = await capture(() => cleanup.cmdGc({ _: [], adopt: old, kind: 'cache', apply: true, 'protect-file': pf }));
  assert.match(wet.out, /marker written/);
  const m = owned.readMarker(old);
  assert.equal(m.kind, 'cache');
  assert.equal(m.adopted, true);
  assert.equal(m.pid, null);
  assert.equal(m.protect, false);
  const p = gc.planGc({ roots: [root], protectFile: pf, olderThanMs: 7 * DAY });
  assert.equal(byName(p, 'legacy').eligible, true);
});

test('adopt refuses a symlink, a missing directory, a protected path, a checkout, a marked directory, home and a bad kind', () => {
  const root = scratchRoot();
  const real = path.join(root, 'real');
  fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(root, 'link'));
  const checkout = path.join(root, 'checkout');
  fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
  const marked = mk(root, 'already');
  const prot = path.join(root, 'prot');
  fs.mkdirSync(prot);
  const reasons = (dir, kind = 'cache', protect = NO_PROTECT) => gc.planAdopt({ dir, kind, protect }).reasons.join(' | ');
  assert.match(reasons(path.join(root, 'link')), /symlink/);
  assert.match(reasons(path.join(root, 'missing')), /does not exist/);
  assert.match(reasons(prot, 'cache', { entries: [prot], problems: [] }), /protected by/);
  assert.match(reasons(checkout), /\.git/);
  assert.match(reasons(marked), /already has a marker/);
  assert.match(reasons(fs.realpathSync(os.homedir())), /home directory/);
  assert.match(reasons(real, 'results'), /--kind takes/);
  assert.equal(gc.planAdopt({ dir: real, kind: 'cache', protect: NO_PROTECT }).ok, true);
  assert.equal(gc.planAdopt({ dir: real, kind: 'archive', protect: NO_PROTECT }).protect, true);
});
