// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios ready [DIR] [--batch tN] [--ids] [--late] [--json]`: which pack tasks may enter a paid pilot wave.
// A task is ready only when its batch folder loads in the runner (one bad file stops a whole `--extra-tasks` folder)
// and its `pilot.dryRun` records reference >= 95, stub <= 20, lazy <= 40 and alternative >= 80 (plan 4.6).
// Not-ready tasks go to wave W9 late. Lock blockers that do not stop a pilot run (a hand-edited task with no non-Claude
// re-check, plan 4) are listed apart. Free: reads the task files only.

const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../runner/lib/schema.js');
const { v3Errors } = require('../runner/lib/task-v3.js');
const contentLock = require('./content-lock.js');

const PACK_DIR = __dirname;
const GATES = [
  ['reference', (v) => v >= 95, '>= 95'],
  ['stub', (v) => v <= 20, '<= 20'],
  ['lazy', (v) => v <= 40, '<= 40'],
  ['alt', (v) => v >= 80, '>= 80'],
];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The reasons a task is not ready, from its own file; [] when the dry run passes every gate. */
function dryRunReasons(task) {
  const elsewhere = !task.pilot?.dryRun && task.pilot?.scores?.dryRun;
  const d = task.pilot?.dryRun ?? elsewhere;
  if (!d) return ['no pilot.dryRun recorded'];
  const out = elsewhere ? ['dry run kept in pilot.scores.dryRun, not pilot.dryRun'] : [];
  for (const [k, ok, rule] of GATES) {
    if (!finite(d[k])) out.push(`dry run has no ${k} score`);
    else if (!ok(d[k])) out.push(`dry run ${k} ${d[k]}, needs ${rule}`);
  }
  return out;
}

const HAND_EDIT_FLAG = 'hand-edited, recheck missing';
const VERSION_FLAG = 'version ahead of its recheck';

/** Why a task is marked fix (owner rule): a recorded lazy score over 40, or pilot.decision "fix" or "drop". [] when none. */
function fixReasons(task) {
  const out = [];
  // The same record dryRunReasons reads, so a lazy score kept in pilot.scores.dryRun is not dropped from the count.
  const lazy = (task.pilot?.dryRun ?? task.pilot?.scores?.dryRun)?.lazy;
  if (finite(lazy) && lazy > 40) out.push(`lazy ${lazy} over 40`);
  if (task.pilot?.decision === 'fix') out.push('pilot.decision is fix');
  // A dropped task stays in the pack (removing it is the owner's call) but must never count as ready.
  if (task.pilot?.decision === 'drop') out.push('pilot.decision is drop');
  return out;
}

const CONTENT_FLAG = 'content changed, version not bumped';

/**
 * What blocks a lock but not a pilot run (plan section 4). `content` is the task's content-lock row (content-lock.js
 * compare), when there is one.
 * - The content changed while the version stayed (DEBT D-150): the change would ship under the version a recheck read.
 * - A hand-edited task needs a `review.recheck` of its current version: one that records `version` must record this one
 *   or a later one; one with no `version` (older rechecks) covers only up to the content lock's `legacyRecheckVersion`,
 *   or, with no content lock entry, only a hand edit that records no version.
 * - A task with no `handEdited` whose version is past the version its own `review.recheck` or `review` records: the
 *   version was bumped without the hand-edit record, so nothing else would ask for a recheck (the version-without-
 *   recheck class, D-150 and D-156).
 */
function lockBlockers(task, content = null) {
  const out = content?.problem === 'same-version change' ? [CONTENT_FLAG] : [];
  const h = task.handEdited;
  if (!h) {
    const seen = [task.review?.recheck?.version, task.review?.version].filter(Number.isInteger);
    return Number.isInteger(task.version) && seen.length && Math.max(...seen) < task.version ? [...out, VERSION_FLAG] : out;
  }
  const r = task.review?.recheck;
  const v = Number.isInteger(task.version) ? task.version : Number.isInteger(h.version) ? h.version : null;
  let covered;
  if (!r) covered = false;
  else if (Number.isInteger(r.version)) covered = v === null || r.version >= v;
  else if (content?.entry) covered = Number.isInteger(content.entry.legacyRecheckVersion) && v !== null && v <= content.entry.legacyRecheckVersion;
  else covered = !Number.isInteger(h.version);
  return covered ? out : [...out, HAND_EDIT_FLAG];
}

/**
 * [{ batch, id, file, ready, fix, reasons, lockBlockers }] for every task of every t* folder under `packDir`.
 * `fix` lists why the task is marked fix; such a task is not ready.
 */
function readiness(packDir = PACK_DIR) {
  const schema = loadSchema('task');
  const out = [];
  const content = new Map(contentLock.compare(packDir, contentLock.readLock(path.join(packDir, 'content-lock.json'))).map((c) => [c.id, c]));
  for (const batch of fs.readdirSync(packDir).filter((d) => /^t\d+$/.test(d)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const dir = path.join(packDir, batch);
    const rows = [];
    const badFiles = [];
    for (const f of fs.readdirSync(dir).filter((x) => /^t\d+-.*\.json$/.test(x)).sort()) {
      const task = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const loadErrors = [...validate(schema, task), ...v3Errors(task)];
      if (loadErrors.length) badFiles.push(f);
      const reasons = loadErrors.length ? [`fails the run loader (${loadErrors.length} error(s), first: ${loadErrors[0]})`] : [];
      const fix = fixReasons(task);
      rows.push({ batch, id: task.id, file: path.join(batch, f), fix, reasons: [...reasons, ...dryRunReasons(task).filter((x) => !/^dry run lazy /.test(x)), ...fix.map((x) => `fix: ${x}`)], lockBlockers: lockBlockers(task, content.get(task.id) ?? null) });
    }
    for (const r of rows) {
      if (badFiles.length && !badFiles.includes(path.basename(r.file))) r.reasons.unshift(`batch folder fails the run loader (${badFiles.length} file(s), first ${badFiles[0]})`);
      out.push({ ...r, ready: r.reasons.length === 0 });
    }
  }
  return out;
}

function render(rows) {
  const L = [];
  const batches = [...new Set(rows.map((r) => r.batch))];
  L.push('| batch | tasks | ready | fix | not ready (W9 late) |', '| --- | --- | --- | --- | --- |');
  const line = (name, in_) => `| ${name} | ${in_.length} | ${in_.filter((r) => r.ready).length} | ${in_.filter((r) => r.fix.length).length} | ${in_.filter((r) => !r.ready).length} |`;
  for (const b of batches) L.push(line(b, rows.filter((r) => r.batch === b)));
  if (batches.length > 1) L.push(line('all', rows));
  L.push('', 'ready + not ready = tasks; fix is the part of not ready marked fix (lazy over 40 or pilot.decision fix or drop).');
  L.push('', 'Ready:', ...rows.filter((r) => r.ready).map((r) => `- ${r.id}`));
  if (!rows.some((r) => r.ready)) L.push('- none');
  const fixes = rows.filter((r) => r.fix.length);
  L.push('', 'Fix (not ready):', ...(fixes.length ? fixes.map((r) => `- ${r.id}: ${r.fix.join('; ')}`) : ['- none']));
  L.push('', 'Not ready (W9 late):', ...rows.filter((r) => !r.ready).map((r) => `- ${r.id}: ${r.reasons.join('; ')}`));
  const blocked = rows.filter((r) => r.lockBlockers.length);
  L.push('', 'Lock blocked (may still run in the pilot):', ...(blocked.length ? blocked.map((r) => `- ${r.id}: ${r.lockBlockers.join('; ')}`) : ['- none']));
  return `${L.join('\n')}\n`;
}

function cmdReady(opts) {
  const dir = opts._[1] ? path.resolve(opts._[1]) : PACK_DIR;
  let rows = readiness(dir);
  if (typeof opts.batch === 'string') {
    rows = rows.filter((r) => r.batch === opts.batch);
    if (!rows.length) throw new Error(`no batch ${opts.batch} under ${dir}`);
  }
  if (opts.ids) {
    // Comma list for `run --tasks`: the ready tasks, or with --late the not-ready ones. Empty output when there are none.
    process.stdout.write(`${rows.filter((r) => (opts.late ? !r.ready : r.ready)).map((r) => r.id).join(',')}\n`);
    return;
  }
  process.stdout.write(opts.json ? `${JSON.stringify(rows, null, 2)}\n` : render(rows));
}

module.exports = { readiness, dryRunReasons, fixReasons, lockBlockers, render, cmdReady, GATES, HAND_EDIT_FLAG, CONTENT_FLAG, VERSION_FLAG };
