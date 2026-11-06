// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js archive`: compress the workspace snapshot of each finished run into one verified archive and keep the evidence
// files readable as they are. The workspaces are deleted only after the archive is re-read and its checksum matches, and only
// with --remove-originals. `restore` extracts them again so that `recheck` works.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn, execFileSync } = require('node:child_process');
const { pipeline, Transform } = require('node:stream');
const { promisify } = require('node:util');
const { markOwned, inspectMarker } = require('./owned.js');

const pipe = promisify(pipeline);
const MANIFEST = 'archive-manifest.json';
const NOTE = 'ARCHIVE.md';
const ARCHIVE_NAMES = { gzip: 'workspace.tar.gz', zstd: 'workspace.tar.zst' };
const EVIDENCE_NAMES = new Set(['result.json', 'stream.jsonl', 'installed-agent.json', 'run-config.json', 'summary.json', 'credit-ledger.jsonl']);
const isEvidenceFile = (name) => EVIDENCE_NAMES.has(name) || /^judgments.*\.json$/.test(name);
const isEvidenceDir = (name) => name === 'session';
const MAX_DEPTH = 8;
const SKIP = new Set(['node_modules', '.git']);

function haveZstd() {
  try { execFileSync('zstd', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** 'gzip' or 'zstd'. `auto` picks zstd when the binary exists. */
function chooseCompression(want = 'auto') {
  if (want === 'gzip') return 'gzip';
  if (want === 'zstd') { if (!haveZstd()) throw new Error('--compress zstd was asked for, but zstd is not installed'); return 'zstd'; }
  if (want !== 'auto') throw new Error('--compress takes auto, gzip or zstd');
  return haveZstd() ? 'zstd' : 'gzip';
}

let gnuTar;
function isGnuTar() {
  if (gnuTar === undefined) {
    try { gnuTar = /GNU tar/.test(execFileSync('tar', ['--version'], { encoding: 'utf8' })); } catch { gnuTar = false; }
  }
  return gnuTar;
}

const literal = () => (isGnuTar() ? ['--quoting-style=literal'] : []);

// ---------------------------------------------------------------- discovery

const isDir = (p) => { try { return fs.lstatSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.lstatSync(p).isFile(); } catch { return false; } };

/** Run directories under `root`: a directory with a workspace/ directory and a result.json, or an archive of one. */
function findRunDirs(root, { archived = false } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const names = new Set(ents.map((e) => e.name));
    const hasWs = names.has('workspace') && isDir(path.join(dir, 'workspace'));
    const arch = Object.values(ARCHIVE_NAMES).find((n) => names.has(n) && isFile(path.join(dir, n)));
    if (archived ? Boolean(arch) : hasWs && names.has('result.json')) out.push(dir);
    if (depth >= MAX_DEPTH) return;
    for (const e of ents) if (e.isDirectory() && e.name !== 'workspace' && !SKIP.has(e.name)) walk(path.join(dir, e.name), depth + 1);
  };
  walk(root, 0);
  return out.sort();
}

/** Entry names (relative, `workspace/...`) and total bytes of a workspace directory, without following symlinks. */
function listWorkspace(runDir) {
  const names = ['workspace'];
  let bytes = 0;
  const walk = (rel) => {
    const abs = path.join(runDir, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      names.push(r);
      let st;
      try { st = fs.lstatSync(path.join(runDir, r)); } catch { continue; }
      bytes += st.size;
      if (st.isDirectory()) walk(r);
    }
  };
  walk('workspace');
  return { names: names.sort(), bytes };
}

// ---------------------------------------------------------------- streams

function hashing() {
  const h = crypto.createHash('sha256');
  let bytes = 0;
  const t = new Transform({ transform(chunk, _enc, cb) { h.update(chunk); bytes += chunk.length; cb(null, chunk); } });
  t.digest = () => ({ sha256: h.digest('hex'), bytes });
  return t;
}

const exited = (child, label) => new Promise((resolve, reject) => {
  let err = '';
  child.stderr?.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label} failed (${code}): ${err.trim().slice(0, 300)}`))));
});

async function sha256File(file) {
  const h = hashing();
  await pipe(fs.createReadStream(file), h, new Transform({ transform(_c, _e, cb) { cb(); } }));
  return h.digest();
}

/** Writes `runDir/workspace` as a compressed tar to `dest`; returns { sha256, bytes } of the file written. */
async function writeArchive(runDir, dest, algo) {
  const tmp = `${dest}.${process.pid}.tmp`;
  const tar = spawn('tar', ['-cf', '-', '-C', runDir, 'workspace'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const tarDone = exited(tar, 'tar');
  const hash = hashing();
  const out = fs.createWriteStream(tmp, { mode: 0o644 });
  try {
    if (algo === 'zstd') {
      const z = spawn('zstd', ['-q', '-T1', '-c'], { stdio: ['pipe', 'pipe', 'pipe'] });
      await Promise.all([pipe(tar.stdout, z.stdin), pipe(z.stdout, hash, out), exited(z, 'zstd'), tarDone]);
    } else {
      await Promise.all([pipe(tar.stdout, zlib.createGzip({ level: 6 }), hash, out), tarDone]);
    }
    fs.renameSync(tmp, dest);
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw e;
  }
  return hash.digest();
}

/** Streams the decompressed archive into `tar` with the given arguments; resolves to its stdout. */
async function throughTar(file, algo, tarArgs) {
  const tar = spawn('tar', tarArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  tar.stdout.setEncoding('utf8');
  tar.stdout.on('data', (d) => { stdout += d; });
  const done = exited(tar, 'tar');
  tar.stdin.on('error', () => { /* tar closed early; its exit status says why */ });
  if (algo === 'zstd') {
    const z = spawn('zstd', ['-dcq', '--', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    await Promise.all([pipe(z.stdout, tar.stdin), exited(z, 'zstd'), done]);
  } else {
    await Promise.all([pipe(fs.createReadStream(file), zlib.createGunzip(), tar.stdin), done]);
  }
  return stdout;
}

const algoOf = (file) => (file.endsWith('.zst') ? 'zstd' : 'gzip');

/** Entry names stored in the archive. Reading them decompresses the whole file, so a damaged archive fails here. */
async function listArchive(file) {
  const text = await throughTar(file, algoOf(file), ['-tf', '-', ...literal()]);
  return text.split('\n').filter(Boolean).map((n) => n.replace(/\/+$/, '')).sort();
}

const safeName = (n) => (n === 'workspace' || n.startsWith('workspace/')) && !n.split('/').includes('..') && !path.isAbsolute(n);

// ---------------------------------------------------------------- archive

function relUnder(root, p) { return path.relative(root, p) || '.'; }

function copyEvidence(runDir, destDir) {
  const copied = [];
  fs.mkdirSync(destDir, { recursive: true });
  for (const e of fs.readdirSync(runDir, { withFileTypes: true })) {
    const from = path.join(runDir, e.name);
    const to = path.join(destDir, e.name);
    if (e.isFile() && isEvidenceFile(e.name)) { fs.copyFileSync(from, to); copied.push({ path: e.name, bytes: fs.statSync(to).size }); }
    else if (e.isDirectory() && isEvidenceDir(e.name)) { fs.cpSync(from, to, { recursive: true, dereference: false }); copied.push({ path: `${e.name}/`, bytes: null }); }
  }
  return copied;
}

function evidenceOf(runDir) {
  const out = [];
  for (const e of fs.readdirSync(runDir, { withFileTypes: true })) {
    if (e.isFile() && isEvidenceFile(e.name)) out.push({ path: e.name, bytes: fs.statSync(path.join(runDir, e.name)).size });
    else if (e.isDirectory() && isEvidenceDir(e.name)) out.push({ path: `${e.name}/`, bytes: null });
  }
  return out;
}

/** Top-level files of the run root that are evidence (judgments, ledger, summary) plus what was left behind. `covered` names the directories that hold runs. */
function topLevelEvidence(root, destRoot, covered) {
  const copied = [];
  const left = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isFile() && isEvidenceFile(e.name)) {
      if (destRoot) fs.copyFileSync(path.join(root, e.name), path.join(destRoot, e.name));
      copied.push({ path: e.name, bytes: fs.statSync(path.join(root, e.name)).size });
    } else if (!(e.isDirectory() && (isEvidenceDir(e.name) || covered.has(e.name)))) left.push(e.name + (e.isDirectory() ? '/' : ''));
  }
  return { copied, left };
}

/**
 * Plans (apply false) or performs an archive of every run under `run`.
 * out: null archives in place (workspace.tar.* beside each workspace); a directory copies the evidence and the archives there.
 */
async function archiveRuns({ run, out = null, compress = 'auto', apply = false, removeOriginals = false, benchCommit = null, log = () => {} }) {
  const root = fs.realpathSync(run);
  const algo = chooseCompression(compress);
  const runs = findRunDirs(root);
  const plan = { root, out: out ? path.resolve(out) : null, algo, apply, removeOriginals, runs: [], refused: null };
  if (!runs.length) {
    plan.refused = findRunDirs(root, { archived: true }).length
      ? 'no run directory with a workspace/ found; the workspaces here are already archived'
      : 'no run directories found (a run directory holds result.json and workspace/)';
    return plan;
  }
  if (plan.out) {
    const o = plan.out;
    const rootWithSep = root + path.sep;
    if (o === root || o.startsWith(rootWithSep) || rootWithSep.startsWith(o + path.sep)) { plan.refused = '--out must be a directory of its own, outside --run and not containing it'; return plan; }
    if (fs.existsSync(o)) {
      const entries = fs.readdirSync(o).filter((n) => n !== '.bench-owner.json');
      const marker = inspectMarker(o);
      if (entries.length && !(marker.state === 'valid' && marker.marker.kind === 'archive')) { plan.refused = `--out ${o} exists, is not empty and is not an archive directory`; return plan; }
    }
  }
  for (const dir of runs) {
    const { names, bytes } = listWorkspace(dir);
    const rel = relUnder(root, dir);
    const archiveDir = plan.out ? path.join(plan.out, rel) : dir;
    plan.runs.push({ dir, rel, archive: path.join(archiveDir, ARCHIVE_NAMES[algo]), archiveDir, entries: names.length, workspaceBytes: bytes, names });
  }
  if (!apply) return plan;

  const manifest = {
    schemaVersion: 1, createdAt: new Date().toISOString(), benchCommit, compression: algo, mode: plan.out ? 'copy' : 'in-place',
    sourceName: path.basename(root), runs: [], notCopied: [],
  };
  const archiveRoot = plan.out || root;
  if (plan.out) fs.mkdirSync(plan.out, { recursive: true });
  const top = topLevelEvidence(root, plan.out, new Set(plan.runs.map((r) => r.rel.split(path.sep)[0])));
  manifest.topLevelEvidence = top.copied;
  manifest.notCopied = plan.out ? top.left : [];
  for (const r of plan.runs) {
    log(`archiving ${r.rel}`);
    const evidence = plan.out ? copyEvidence(r.dir, r.archiveDir) : evidenceOf(r.dir);
    const existing = isFile(r.archive) ? await sha256File(r.archive).catch(() => null) : null;
    let stat = null;
    if (existing) {
      const listed = await listArchive(r.archive).catch(() => null);
      if (listed && JSON.stringify(listed) === JSON.stringify(r.names)) stat = existing;
    }
    if (!stat) stat = await writeArchive(r.dir, r.archive, algo);
    const again = await sha256File(r.archive);
    const listed = await listArchive(r.archive);
    const verified = again.sha256 === stat.sha256 && again.bytes === stat.bytes && JSON.stringify(listed) === JSON.stringify(r.names);
    manifest.runs.push({
      path: r.rel, archive: relUnder(archiveRoot, r.archive), archiveBytes: again.bytes, sha256: again.sha256,
      workspaceBytes: r.workspaceBytes, entries: r.entries, verified, originalRemoved: false, evidence,
    });
    r.verified = verified;
    if (!verified) throw new Error(`verification failed for ${r.rel}: the archive does not match the workspace; nothing was removed`);
  }
  writeManifest(archiveRoot, manifest);
  markOwned(archiveRoot, 'archive', { protect: true, pid: null, id: path.basename(archiveRoot) });
  plan.manifest = manifest;
  if (removeOriginals) {
    for (const r of plan.runs) {
      const ws = path.join(r.dir, 'workspace');
      if (!r.verified || fs.lstatSync(ws).isSymbolicLink()) continue;
      const m = manifest.runs.find((x) => x.path === r.rel);
      const recheck = await sha256File(r.archive);
      if (recheck.sha256 !== m.sha256) throw new Error(`the archive of ${r.rel} changed after verification; originals kept`);
      fs.rmSync(ws, { recursive: true, force: false });
      m.originalRemoved = true;
    }
    writeManifest(archiveRoot, manifest);
  }
  return plan;
}

function human(n) {
  if (n === null || n === undefined) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(1) : v} ${u[i]}`;
}

function writeManifest(dir, manifest) {
  const totals = manifest.runs.reduce((t, r) => ({ workspaceBytes: t.workspaceBytes + r.workspaceBytes, archiveBytes: t.archiveBytes + r.archiveBytes }), { workspaceBytes: 0, archiveBytes: 0 });
  manifest.totals = { runs: manifest.runs.length, ...totals };
  fs.writeFileSync(path.join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  const removed = manifest.runs.filter((r) => r.originalRemoved).length;
  const lines = [
    '# Archive of finished runs', '',
    `Made ${manifest.createdAt} by bench.js archive (${manifest.compression}, ${manifest.mode}).`, '',
    `${manifest.runs.length} runs. Workspaces: ${human(totals.workspaceBytes)}. Archives: ${human(totals.archiveBytes)}. Uncompressed workspaces removed: ${removed} of ${manifest.runs.length}.`, '',
    'Evidence files stay uncompressed next to each archive: result.json, stream.jsonl, installed-agent.json, run-config.json, judgments*.json, summary.json, credit-ledger.jsonl and session/.', '',
    'To get the workspaces back, for example before `recheck`:', '', '    node bench/runner/bench.js archive --restore <this directory>', '',
    `${MANIFEST} lists every archive with its size and sha256. Restore checks each checksum first. gc never deletes this directory (its .bench-owner.json says kind archive, protect true).`, '',
    '| Run | Archive | Archive size | Workspace size | sha256 | Workspace removed |', '| --- | --- | --- | --- | --- | --- |',
    ...manifest.runs.map((r) => `| ${r.path} | ${r.archive} | ${human(r.archiveBytes)} | ${human(r.workspaceBytes)} | ${r.sha256.slice(0, 16)} | ${r.originalRemoved ? 'yes' : 'no'} |`), '',
  ];
  if (manifest.notCopied?.length) lines.push(`Not copied from the source run directory: ${manifest.notCopied.join(', ')}.`, '');
  fs.writeFileSync(path.join(dir, NOTE), lines.join('\n'));
}

// ---------------------------------------------------------------- restore

/** Extracts every workspace archive under `dir`. A workspace/ that already exists is never overwritten. */
async function restoreArchives({ dir, apply = true, log = () => {} }) {
  const root = fs.realpathSync(dir);
  let manifest = null;
  for (let a = root, i = 0; i <= MAX_DEPTH + 1; i++, a = path.dirname(a)) {
    const f = path.join(a, MANIFEST);
    if (isFile(f)) { try { manifest = { dir: a, data: JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch { /* unreadable manifest: nothing to verify against */ } break; }
    if (a === path.dirname(a)) break;
  }
  const results = [];
  for (const runDir of findRunDirs(root, { archived: true })) {
    const rel = path.relative(root, runDir) || '.';
    const file = Object.values(ARCHIVE_NAMES).map((n) => path.join(runDir, n)).find(isFile);
    const res = { dir: runDir, rel, archive: file, status: 'pending', note: null };
    results.push(res);
    if (isDir(path.join(runDir, 'workspace'))) { res.status = 'skipped'; res.note = 'workspace/ already exists'; continue; }
    const entry = manifest?.data.runs.find((r) => path.resolve(manifest.dir, r.archive) === file);
    if (!entry) { res.status = 'refused'; res.note = `no entry for this archive in ${MANIFEST}; keep the manifest next to the archives so the checksum can be verified`; continue; }
    const got = await sha256File(file);
    if (got.sha256 !== entry.sha256) { res.status = 'refused'; res.note = 'checksum does not match the manifest'; continue; }
    let names;
    try { names = await listArchive(file); } catch (e) { res.status = 'refused'; res.note = `unreadable archive: ${e.message}`; continue; }
    const bad = names.find((n) => !safeName(n));
    if (bad) { res.status = 'refused'; res.note = `unsafe entry name in the archive: ${bad}`; continue; }
    if (!apply) { res.status = 'would-restore'; continue; }
    const tmp = fs.mkdtempSync(path.join(runDir, '.restore-'));
    try {
      log(`restoring ${rel}`);
      await throughTar(file, algoOf(file), ['-xf', '-', '-C', tmp, '--no-same-owner']);
      fs.renameSync(path.join(tmp, 'workspace'), path.join(runDir, 'workspace'));
      res.status = 'restored';
    } catch (e) {
      res.status = 'failed';
      res.note = e.message;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { root, results, manifest: Boolean(manifest) };
}

/** The archive file beside a run directory, if its workspace was archived (used by recheck for its hint). */
function archivedWorkspace(runDir) {
  return Object.values(ARCHIVE_NAMES).map((n) => path.join(runDir, n)).find(isFile) || null;
}

module.exports = {
  MANIFEST, NOTE, ARCHIVE_NAMES, haveZstd, chooseCompression, findRunDirs, listWorkspace, writeArchive, listArchive, sha256File,
  archiveRuns, restoreArchives, archivedWorkspace, isEvidenceFile,
};
