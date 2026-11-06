// SPDX-License-Identifier: Apache-2.0
'use strict';

// archive and restore on synthetic run trees: verified archives, evidence left readable, originals removed only after
// verification, and a restore that refuses a damaged or unsafe archive. In-process: nothing here starts bench.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const archive = require('../lib/archive.js');
const owned = require('../lib/owned.js');
const cleanup = require('../lib/cleanup-cmd.js');
const { recheckRun } = require('../lib/recheck.js');

const scratch = () => fs.realpathSync(mkScratch('arch-'));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const write = (f, text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

/** root/<arm>/<task>/<rep>/ with evidence and a workspace; plus run-level files. */
function makeRun(root, { reps = 2, odd = false } = {}) {
  for (const arm of ['vanilla', 'main']) {
    for (let rep = 1; rep <= reps; rep++) {
      const d = path.join(root, arm, 't1', String(rep));
      write(path.join(d, 'result.json'), JSON.stringify({ armId: arm, taskId: 't1', replicate: rep, checks: [] }));
      write(path.join(d, 'stream.jsonl'), '{"type":"x"}\n');
      write(path.join(d, 'installed-agent.json'), '{}');
      write(path.join(d, 'run-config.json'), '{}');
      write(path.join(d, 'session', 's.json'), '{}');
      write(path.join(d, 'workspace', 'a.txt'), `alpha ${arm} ${rep}\n`);
      write(path.join(d, 'workspace', 'sub', 'b.txt'), 'bravo\n');
      write(path.join(d, 'workspace', 'sub', 'deep', 'c.bin'), crypto.randomBytes(2048).toString('latin1'));
      fs.mkdirSync(path.join(d, 'workspace', 'empty-dir'));
      fs.symlinkSync('a.txt', path.join(d, 'workspace', 'link-to-a'));
      if (odd) write(path.join(d, 'workspace', 'odd name; $(touch pwned) `x` \'q\' é.txt'), 'odd\n');
    }
  }
  write(path.join(root, 'judgments.json'), '{}');
  write(path.join(root, 'judgments-quality.json'), '{}');
  write(path.join(root, 'credit-ledger.jsonl'), '{}\n');
  write(path.join(root, 'summary.json'), '{}');
  write(path.join(root, 'variants', 'big', 'x'), 'not evidence');
  return root;
}

function tree(dir) {
  const out = {};
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) out[r] = `-> ${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) { out[r] = 'dir'; walk(p, r); } else out[r] = sha(p);
    }
  };
  walk(dir, '');
  return out;
}

const capture = async (fn) => {
  const lines = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  const prior = process.exitCode;
  try { await fn(); return { out: lines.join('\n'), exit: process.exitCode }; } finally { console.log = log; console.error = err; process.exitCode = prior; }
};

const runDirs = (root) => archive.findRunDirs(root).map((d) => path.relative(root, d));

test('a dry run plans every run and writes nothing', async () => {
  const root = makeRun(scratch());
  const before = tree(root);
  const plan = await archive.archiveRuns({ run: root, compress: 'gzip' });
  assert.equal(plan.runs.length, 4);
  assert.equal(plan.apply, false);
  assert.deepEqual(tree(root), before);
  assert.ok(plan.runs.every((r) => r.entries > 5 && r.workspaceBytes > 0));
  const r = await capture(() => cleanup.cmdArchive({ _: [], run: root, compress: 'gzip' }));
  assert.match(r.out, /dry run, nothing is written or removed/);
  assert.deepEqual(tree(root), before);
});

test('archive in place: one verified archive per run, manifest with sha256, ARCHIVE.md, evidence untouched, directory marked archive', async () => {
  const root = makeRun(scratch());
  const evidence = { ...tree(root) };
  const plan = await archive.archiveRuns({ run: root, compress: 'gzip', apply: true, benchCommit: 'abc123' });
  assert.equal(plan.manifest.runs.length, 4);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, archive.MANIFEST), 'utf8'));
  assert.equal(manifest.compression, 'gzip');
  assert.equal(manifest.mode, 'in-place');
  assert.equal(manifest.benchCommit, 'abc123');
  for (const r of manifest.runs) {
    const file = path.join(root, r.archive);
    assert.ok(file.endsWith('workspace.tar.gz'));
    assert.equal(sha(file), r.sha256);
    assert.equal(fs.statSync(file).size, r.archiveBytes);
    assert.equal(r.verified, true);
    assert.equal(r.originalRemoved, false);
    assert.deepEqual(r.evidence.map((e) => e.path).sort(), ['installed-agent.json', 'result.json', 'run-config.json', 'session/', 'stream.jsonl']);
    assert.ok(fs.existsSync(path.join(root, path.dirname(r.archive), 'workspace', 'a.txt')), 'workspace kept without --remove-originals');
  }
  assert.deepEqual(manifest.topLevelEvidence.map((e) => e.path).sort(), ['credit-ledger.jsonl', 'judgments-quality.json', 'judgments.json', 'summary.json']);
  assert.match(fs.readFileSync(path.join(root, archive.NOTE), 'utf8'), /archive --restore/);
  const marker = owned.readMarker(root);
  assert.equal(marker.kind, 'archive');
  assert.equal(marker.protect, true);
  for (const [k, v] of Object.entries(evidence)) assert.equal(tree(root)[k], v, `${k} changed`);
});

test('--remove-originals deletes workspaces only after verification, keeps the evidence, and recheck points at restore', async () => {
  const root = makeRun(scratch());
  const plan = await archive.archiveRuns({ run: root, compress: 'gzip', apply: true, removeOriginals: true });
  assert.ok(plan.manifest.runs.every((r) => r.originalRemoved));
  assert.deepEqual(runDirs(root), []);
  for (const arm of ['vanilla', 'main']) {
    const d = path.join(root, arm, 't1', '1');
    assert.equal(fs.existsSync(path.join(d, 'workspace')), false);
    for (const f of ['result.json', 'stream.jsonl', 'installed-agent.json', 'run-config.json', 'session/s.json', 'workspace.tar.gz']) assert.ok(fs.existsSync(path.join(d, f)), f);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, archive.MANIFEST), 'utf8')).runs.every((r) => r.originalRemoved), true);
  const d = path.join(root, 'vanilla', 't1', '1');
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ armId: 'vanilla', taskId: 't1', checks: [{ type: 'file_exists', passed: true }] }));
  const r = recheckRun({ dir: d, task: { id: 't1', checks: [{ type: 'file_exists', path: 'a.txt' }] }, dryRun: true });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /workspace is archived \(run: node bench\/runner\/bench\.js archive --restore /);
  const again = await archive.archiveRuns({ run: root, compress: 'gzip', apply: true });
  assert.match(again.refused, /already archived/);
});

test('--remove-originals without --apply is refused by the command and removes nothing', async () => {
  const root = makeRun(scratch());
  const before = tree(root);
  const r = await capture(() => cleanup.cmdArchive({ _: [], run: root, 'remove-originals': true }));
  assert.equal(r.exit, 2);
  assert.match(r.out, /only works with --apply/);
  assert.deepEqual(tree(root), before);
});

test('restore brings every workspace back byte for byte, links and empty directories included, and never overwrites one', async () => {
  const root = makeRun(scratch());
  const original = {};
  for (const d of archive.findRunDirs(root)) original[path.relative(root, d)] = tree(path.join(d, 'workspace'));
  await archive.archiveRuns({ run: root, compress: 'gzip', apply: true, removeOriginals: true });
  const res = await archive.restoreArchives({ dir: root });
  assert.deepEqual(res.results.map((r) => r.status), ['restored', 'restored', 'restored', 'restored']);
  for (const [rel, t] of Object.entries(original)) assert.deepEqual(tree(path.join(root, rel, 'workspace')), t, rel);
  fs.writeFileSync(path.join(root, 'main', 't1', '1', 'workspace', 'a.txt'), 'edited');
  const second = await archive.restoreArchives({ dir: root });
  assert.ok(second.results.every((r) => r.status === 'skipped' && /already exists/.test(r.note)));
  assert.equal(fs.readFileSync(path.join(root, 'main', 't1', '1', 'workspace', 'a.txt'), 'utf8'), 'edited');
  assert.deepEqual(fs.readdirSync(path.join(root, 'main', 't1', '1')).filter((n) => n.startsWith('.restore-')), []);
});

test('restore refuses an archive whose checksum differs from the manifest, or that has no manifest entry', async () => {
  const root = makeRun(scratch(), { reps: 1 });
  await archive.archiveRuns({ run: root, compress: 'gzip', apply: true, removeOriginals: true });
  const victim = path.join(root, 'vanilla', 't1', '1', 'workspace.tar.gz');
  const bytes = fs.readFileSync(victim);
  bytes[bytes.length - 12] ^= 0xff;
  fs.writeFileSync(victim, bytes);
  const res = await archive.restoreArchives({ dir: root });
  const by = Object.fromEntries(res.results.map((r) => [r.rel, r]));
  assert.equal(by[path.join('vanilla', 't1', '1')].status, 'refused');
  assert.match(by[path.join('vanilla', 't1', '1')].note, /checksum/);
  assert.equal(by[path.join('main', 't1', '1')].status, 'restored');
  assert.equal(fs.existsSync(path.join(root, 'vanilla', 't1', '1', 'workspace')), false);
  fs.rmSync(path.join(root, archive.MANIFEST));
  fs.rmSync(path.join(root, 'main', 't1', '1', 'workspace'), { recursive: true });
  const none = await archive.restoreArchives({ dir: root });
  assert.ok(none.results.every((r) => r.status === 'refused' && /manifest/.test(r.note)));
});

test('restore refuses an archive with an entry outside workspace/, even when its checksum is in the manifest', async () => {
  const root = scratch();
  const run = path.join(root, 'run');
  write(path.join(run, 'result.json'), '{}');
  const evil = path.join(root, 'evil-src');
  write(path.join(evil, 'escape.txt'), 'x');
  const tarball = path.join(run, 'workspace.tar.gz');
  const t = spawnSync('tar', ['-czf', tarball, '-C', evil, '--transform', 's,^,../,', 'escape.txt']);
  assert.equal(t.status, 0, String(t.stderr));
  write(path.join(root, archive.MANIFEST), JSON.stringify({ runs: [{ path: 'run', archive: 'run/workspace.tar.gz', sha256: sha(tarball) }] }));
  const res = await archive.restoreArchives({ dir: root });
  assert.equal(res.results[0].status, 'refused');
  assert.match(res.results[0].note, /unsafe entry name/);
  assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
  assert.equal(fs.existsSync(path.join(run, 'escape.txt')), false);
});

test('names with spaces, quotes, $() and unicode are archived and restored without being interpreted', async () => {
  const base = scratch();
  const root = makeRun(path.join(base, 'run with spaces; $(touch injected)'), { odd: true });
  await archive.archiveRuns({ run: root, compress: 'gzip', apply: true, removeOriginals: true });
  const res = await archive.restoreArchives({ dir: root });
  assert.ok(res.results.every((r) => r.status === 'restored'), JSON.stringify(res.results));
  assert.ok(fs.existsSync(path.join(root, 'vanilla', 't1', '1', 'workspace', 'odd name; $(touch pwned) `x` \'q\' é.txt')));
  for (const where of [base, root, process.cwd()]) assert.equal(fs.existsSync(path.join(where, 'injected')) || fs.existsSync(path.join(where, 'pwned')), false);
});

test('a stale archive left beside the workspace is rebuilt, not trusted', async () => {
  const root = makeRun(scratch(), { reps: 1 });
  const stale = path.join(root, 'vanilla', 't1', '1', 'workspace.tar.gz');
  fs.writeFileSync(stale, 'this is not an archive');
  const plan = await archive.archiveRuns({ run: root, compress: 'gzip', apply: true });
  assert.ok(plan.runs.every((r) => r.verified));
  assert.notEqual(fs.readFileSync(stale, 'utf8'), 'this is not an archive');
  const names = await archive.listArchive(stale);
  assert.ok(names.includes('workspace/sub/b.txt'));
});

test('--out copies the evidence and the archives to a directory of its own and leaves the source alone', async () => {
  const base = scratch();
  const root = makeRun(path.join(base, 'run'));
  const out = path.join(base, 'archived');
  const before = tree(root);
  const plan = await archive.archiveRuns({ run: root, out, compress: 'gzip', apply: true });
  assert.deepEqual(tree(root), before);
  assert.equal(plan.manifest.mode, 'copy');
  for (const f of ['result.json', 'stream.jsonl', 'session/s.json', 'workspace.tar.gz']) assert.ok(fs.existsSync(path.join(out, 'vanilla', 't1', '1', f)), f);
  for (const f of ['judgments.json', 'credit-ledger.jsonl', 'summary.json', archive.MANIFEST, archive.NOTE]) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.equal(fs.existsSync(path.join(out, 'variants')), false);
  assert.deepEqual(plan.manifest.notCopied, ['variants/']);
  assert.equal(owned.readMarker(out).kind, 'archive');
  assert.equal(owned.readMarker(out).protect, true);
  assert.equal(owned.readMarker(root), null, 'the source directory is not marked');
  const restored = await archive.restoreArchives({ dir: out });
  assert.ok(restored.results.every((r) => r.status === 'restored'));
  assert.deepEqual(tree(path.join(out, 'main', 't1', '2', 'workspace')), tree(path.join(root, 'main', 't1', '2', 'workspace')));
  const again = await archive.archiveRuns({ run: root, out, compress: 'gzip', apply: true, removeOriginals: true });
  assert.ok(again.manifest.runs.every((r) => r.originalRemoved));
  assert.equal(fs.existsSync(path.join(root, 'main', 't1', '2', 'workspace')), false);
});

test('--out is refused when it is inside the run, contains it, or is a non-empty directory that is not an archive', async () => {
  const base = scratch();
  const root = makeRun(path.join(base, 'run'));
  assert.match((await archive.archiveRuns({ run: root, out: path.join(root, 'inner') })).refused, /outside --run/);
  assert.match((await archive.archiveRuns({ run: root, out: base })).refused, /outside --run/);
  assert.match((await archive.archiveRuns({ run: root, out: root })).refused, /outside --run/);
  const busy = path.join(base, 'busy');
  write(path.join(busy, 'file'), 'x');
  assert.match((await archive.archiveRuns({ run: root, out: busy })).refused, /not empty/);
  assert.equal(fs.existsSync(path.join(busy, 'vanilla')), false);
  assert.match((await archive.archiveRuns({ run: path.join(base, 'busy') })).refused, /no run directories/);
});

test('zstd is used when it is installed, and the archive restores', { skip: !archive.haveZstd() && 'zstd is not installed' }, async () => {
  const root = makeRun(scratch(), { reps: 1 });
  const plan = await archive.archiveRuns({ run: root, compress: 'auto', apply: true, removeOriginals: true });
  assert.equal(plan.algo, 'zstd');
  assert.ok(fs.existsSync(path.join(root, 'vanilla', 't1', '1', 'workspace.tar.zst')));
  const res = await archive.restoreArchives({ dir: root });
  assert.ok(res.results.every((r) => r.status === 'restored'));
  assert.throws(() => archive.chooseCompression('lzma'), /takes auto, gzip or zstd/);
});

test('cmdArchive --restore --dry-run lists what it would extract and extracts nothing', async () => {
  const root = makeRun(scratch(), { reps: 1 });
  await archive.archiveRuns({ run: root, compress: 'gzip', apply: true, removeOriginals: true });
  const r = await capture(() => cleanup.cmdArchive({ _: [], restore: root, 'dry-run': true }));
  assert.match(r.out, /would-restore/);
  assert.equal(fs.existsSync(path.join(root, 'vanilla', 't1', '1', 'workspace')), false);
  const real = await capture(() => cleanup.cmdArchive({ _: [], restore: root }));
  assert.match(real.out, /restored 2 of 2/);
  assert.ok(fs.existsSync(path.join(root, 'vanilla', 't1', '1', 'workspace', 'a.txt')));
});
