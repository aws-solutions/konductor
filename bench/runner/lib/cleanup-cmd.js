// SPDX-License-Identifier: Apache-2.0
'use strict';

// The `gc` command of bench.js. It is a dry run until --apply is given.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gc = require('./gc.js');
const { KINDS } = require('./owned.js');

const MIN_APPLY_AGE_MS = 3600 * 1000;

const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
const when = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '-');

function fail(msg) {
  console.error(`bench: ${msg}`);
  process.exitCode = 2;
}

function rootsOf(opts) {
  const given = opts.root === undefined ? [] : [].concat(opts.root).filter((r) => typeof r === 'string');
  if (opts.root === true || (Array.isArray(opts.root) && opts.root.includes(true))) throw new Error('--root needs a directory');
  if (given.length) return given.map((r) => path.resolve(r));
  return [...new Set(['/var/tmp', os.tmpdir()])].filter((d) => fs.existsSync(d));
}

function kindsOf(opts) {
  if (opts.kind === undefined) return gc.DEFAULT_KINDS;
  const list = String(opts.kind).split(',').map((k) => k.trim()).filter(Boolean);
  const bad = list.filter((k) => !KINDS.includes(k));
  if (!list.length || bad.length) throw new Error(`--kind takes ${KINDS.join(', ')}${bad.length ? `; not a kind: ${bad.join(', ')}` : ''}`);
  return list;
}

function entryView(e) {
  return {
    path: e.dir, realpath: e.real, root: e.root, kind: e.kind, sizeBytes: e.sizeBytes, ageMs: e.ageMs,
    lastModified: e.lastActivityMs ? new Date(e.lastActivityMs).toISOString() : null, eligible: e.eligible, reasons: e.reasons,
    marker: e.marker ? { id: e.marker.id, createdAt: e.marker.createdAt, protect: e.marker.protect, adopted: Boolean(e.marker.adopted) } : null,
  };
}

function formatPlan(plan, { apply }) {
  const L = [];
  L.push(apply ? 'bench gc: applying the plan below' : 'bench gc: dry run, nothing is deleted');
  L.push(`roots:         ${plan.roots.join(', ') || '(none)'}`);
  L.push(`older than:    ${gc.formatAge(plan.olderThanMs)}      kinds: ${plan.kinds.join(', ')}      keep-last: ${plan.keepLast || 'off'}`);
  L.push(`protect file:  ${plan.protectFile || '(none)'} (${plan.protectEntries.length} entries)`);
  L.push(`processes:     ${plan.processesChecked ? `checked${plan.processesUnreadable ? `, ${plan.processesUnreadable} could not be inspected` : ''}` : 'NOT checked, so nothing can be deleted'}`);
  for (const w of plan.warnings) L.push(`warning: ${w}`);
  L.push('');
  if (!plan.entries.length) {
    L.push('No directory with a .bench-owner.json marker found under the roots. Nothing to do.');
    L.push('Directories made before markers existed stay untouched. To opt one in: bench.js gc --adopt DIR --kind KIND');
    return L.join('\n');
  }
  const order = [...plan.entries].sort((a, b) => Number(b.eligible) - Number(a.eligible) || String(a.kind).localeCompare(String(b.kind)) || (a.ageMs ?? 0) - (b.ageMs ?? 0));
  for (const e of order) {
    L.push(`${e.eligible ? 'DELETE' : 'keep  '}  ${(e.kind || '?').padEnd(16)} ${gc.formatBytes(e.sizeBytes).padStart(9)}  age ${e.ageMs === null ? '-' : gc.formatAge(e.ageMs)}  modified ${when(e.lastActivityMs)}  ${e.dir}`);
    L.push(`        ${e.eligible ? `eligible: marked ${e.kind}, older than ${gc.formatAge(plan.olderThanMs)}, not protected, not in use` : `kept: ${e.reasons.join('; ')}`}`);
  }
  const del = plan.entries.filter((e) => e.eligible);
  L.push('');
  L.push(`${plan.entries.length} marked directories, ${del.length} eligible (${gc.formatBytes(plan.reclaimableBytes)}), ${plan.entries.length - del.length} kept.`);
  if (!apply && del.length) L.push('Nothing was deleted. Run again with --apply to delete the DELETE lines above.');
  return L.join('\n');
}

function protectCommand(opts, protectFile) {
  const verb = opts.protect;
  if (verb === 'list') {
    const p = gc.readProtectFile(protectFile);
    console.log(`${p.file}\n${p.entries.length ? p.entries.map((e) => `  ${e}`).join('\n') : '  (no entries)'}`);
    for (const w of p.problems) console.log(`warning: ${w}`);
    console.log('Always protected as well: unmarked directories, git worktrees and checkouts, anything holding .git, markers with protect true, archives.');
    return;
  }
  if (verb === 'add') {
    const entry = opts._[0];
    if (!entry) return fail('gc --protect add needs a path or glob: bench.js gc --protect add PATH');
    const added = gc.addProtectEntry(protectFile, entry);
    console.log(added ? `added ${entry} to ${protectFile}` : `${entry} is already in ${protectFile}`);
    return;
  }
  fail('--protect takes add PATH or list');
}

function adoptCommand(opts, protectFile) {
  const dir = str(opts.adopt);
  if (!dir) return fail('--adopt needs a directory: bench.js gc --adopt DIR --kind KIND [--apply]');
  const kind = str(opts.kind);
  if (!kind) return fail(`--adopt needs --kind (${KINDS.join(', ')})`);
  const protect = gc.readProtectFile(protectFile);
  const plan = gc.planAdopt({ dir, kind, protect });
  if (!plan.ok) {
    console.error(`bench: gc --adopt refuses ${path.resolve(dir)}:\n  ${plan.reasons.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${opts.apply ? 'adopting' : 'dry run: would adopt'} ${plan.real}`);
  console.log(`  writes ${path.join(plan.real, '.bench-owner.json')}: kind ${kind}, createdAt ${plan.createdAt} (the directory's own age), protect ${plan.protect}`);
  if (!opts.apply) { console.log('Nothing was written. Add --apply to write the marker. gc still checks age, protection and use before it deletes anything.'); return; }
  gc.applyAdopt(plan);
  console.log('marker written');
}

function cmdGc(opts) {
  try {
    const protectFile = str(opts['protect-file']) ? path.resolve(opts['protect-file']) : gc.DEFAULT_PROTECT_FILE;
    if (opts.protect !== undefined) return protectCommand(opts, protectFile);
    if (opts.adopt !== undefined) return adoptCommand(opts, protectFile);
    if (opts._.length) return fail(`unexpected argument "${opts._[0]}"`);
    const apply = Boolean(opts.apply);
    const olderThanMs = opts['older-than'] === undefined ? gc.DEFAULT_OLDER_THAN_MS : gc.parseDuration(opts['older-than']);
    if (apply && olderThanMs < MIN_APPLY_AGE_MS) return fail('--apply needs --older-than of at least 1h');
    let keepLast = 0;
    if (opts['keep-last'] !== undefined) {
      if (!/^\d+$/.test(String(opts['keep-last']))) return fail('--keep-last takes a whole number');
      keepLast = Number(opts['keep-last']);
    }
    const kinds = kindsOf(opts);
    const roots = rootsOf(opts);
    const plan = gc.planGc({ roots, olderThanMs, kinds, keepLast, protectFile });
    if (opts.json && !apply) {
      console.log(JSON.stringify({ dryRun: true, roots: plan.roots, olderThanMs, kinds, keepLast, protectFile, warnings: plan.warnings, processesChecked: plan.processesChecked, reclaimableBytes: plan.reclaimableBytes, entries: plan.entries.map(entryView) }, null, 2));
      return;
    }
    if (!opts.json) console.log(formatPlan(plan, { apply }));
    if (!apply) return;
    const results = gc.applyGc(plan);
    if (opts.json) {
      console.log(JSON.stringify({ dryRun: false, plan: plan.entries.map(entryView), results }, null, 2));
    } else {
      console.log('');
      for (const r of results) console.log(`${r.status.padEnd(8)} ${r.dir}${r.reason ? `  (${r.reason})` : ''}${r.bytes !== undefined ? `  ${gc.formatBytes(r.bytes)}` : ''}`);
      for (const r of results) if (r.logWarning) console.log(`warning: ${r.logWarning}`);
      const deleted = results.filter((r) => r.status === 'deleted');
      console.log(`deleted ${deleted.length}, freed ${gc.formatBytes(deleted.reduce((n, r) => n + r.bytes, 0))}, skipped ${results.filter((r) => r.status === 'skipped').length}, failed ${results.filter((r) => r.status === 'failed').length}. Log: <root>/${gc.GC_LOG}`);
    }
    if (results.some((r) => r.status === 'failed')) process.exitCode = 1;
  } catch (e) {
    fail(e.message);
  }
}

module.exports = { cmdGc, formatPlan, entryView };
