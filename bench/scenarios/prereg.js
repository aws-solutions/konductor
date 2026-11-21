// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pre-registration lock (plan section 7). `freeze` writes PREREG.json: every task's id, version and file hash, the SR-32
// split recomputed from the ids, and the protocol (protocol.js). `check` recomputes all of it and lists every mismatch.
// `checkRun` is what `run` and `report-2x2` call (--prereg FILE): a task they use must be in the lock, with the same version and bytes.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { loadTaskFiles, taskFilesOf } = require('./files.js');
const { SALT, splitOf } = require('./split.js');
const { PROTOCOL } = require('./protocol.js');

const FILE = 'PREREG.json';
const SCHEMA_VERSION = 1;

const { sha256 } = require('../runner/lib/util.js');

/** JSON with sorted object keys, so a hash does not depend on key order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const lockHashOf = (record) => { const { lockHash, ...rest } = record; return sha256(canonical(rest)); };

/** The split section recomputed from task ids: the rule, and the DEV and HELD-OUT lists. */
function splitSection(ids) {
  const sorted = [...ids].sort();
  return { rule: `DEV when the first 8 hex digits of sha256("${SALT}" + id), as a number, are divisible by 3; otherwise HELD-OUT`, salt: SALT, dev: sorted.filter((id) => splitOf(id) === 'DEV'), heldOut: sorted.filter((id) => splitOf(id) === 'HELD-OUT') };
}

/** The task list of a pack directory: [{ id, version, sha256, file }] sorted by id. A task without an integer version is refused. */
function taskEntries(dir) {
  const root = path.resolve(dir);
  const items = loadTaskFiles(root);
  const noVersion = items.filter(({ task }) => !Number.isInteger(task.version) || task.version < 1).map(({ task }) => task.id);
  if (noVersion.length) throw new Error(`a locked task needs an integer version of 1 or more; missing on: ${noVersion.join(', ')}`);
  return items.map(({ file, task }) => ({ id: task.id, version: task.version, sha256: sha256(fs.readFileSync(file)), file: path.relative(root, file).split(path.sep).join('/') })).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The lock record for the tasks under `dir`. `date` is the day of the freeze (YYYY-MM-DD). */
function buildPrereg(dir, { date }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('the freeze date must be YYYY-MM-DD');
  const tasks = taskEntries(dir);
  if (!tasks.length) throw new Error(`no task files under ${dir}`);
  const record = { schemaVersion: SCHEMA_VERSION, frozenAt: date, tasks, split: splitSection(tasks.map((t) => t.id)), protocol: PROTOCOL };
  return { ...record, lockHash: lockHashOf(record) };
}

/** Writes DIR/PREREG.json. An existing lock is never overwritten: a changed pack is a new study. Returns the record. */
function freezePrereg(dir, { date }) {
  const file = path.join(path.resolve(dir), FILE);
  if (fs.existsSync(file)) throw new Error(`${file} already exists; a locked pack is read only, and a change is a new study (move the old lock aside first)`);
  const record = buildPrereg(dir, { date });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function readPrereg(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read the lock ${file}: ${e.code || e.message}`); }
  if (!j || j.schemaVersion !== SCHEMA_VERSION || !Array.isArray(j.tasks)) throw new Error(`${file} is not a pre-registration lock (schemaVersion ${SCHEMA_VERSION})`);
  return j;
}

/** Problems in the lock itself, without the task files: its own hash, the split lists against the rule, the protocol against the code. */
function verifyRecord(p) {
  const problems = [];
  if (p.lockHash !== lockHashOf(p)) problems.push('the lock hash does not match its content: PREREG.json was edited');
  const want = splitSection(p.tasks.map((t) => t.id));
  if (canonical(p.split) !== canonical(want)) problems.push('the DEV and HELD-OUT lists do not match the SR-32 hash rule');
  if (canonical(p.protocol) !== canonical(PROTOCOL)) problems.push('the protocol in the lock differs from the protocol in bench/scenarios/protocol.js');
  return problems;
}

/** Every mismatch between the lock and the task files under `dir`. Empty when the pack is exactly what was frozen. */
function checkPrereg(file, dir) {
  const p = readPrereg(file);
  const problems = verifyRecord(p);
  const now = new Map(taskEntries(dir).map((t) => [t.id, t]));
  const locked = new Map(p.tasks.map((t) => [t.id, t]));
  for (const [id, t] of locked) {
    const n = now.get(id);
    if (!n) problems.push(`${id}: locked but no task file now`);
    else if (n.sha256 !== t.sha256) problems.push(`${id}: the task file changed since the lock${n.version === t.version ? ' (same version)' : ` (version ${t.version} to ${n.version})`}`);
  }
  for (const id of now.keys()) if (!locked.has(id)) problems.push(`${id}: a task file that is not in the lock`);
  return problems;
}

/**
 * What a run or a report may use. `taskIds` are the tasks it uses, `extraDirs` the directories it reads them from (the
 * `--extra-tasks` batches). Every task must be in the lock with the same version and file bytes. Throws with all problems.
 */
function checkRun(file, { taskIds, extraDirs }) {
  const p = readPrereg(file);
  const problems = verifyRecord(p);
  const locked = new Map(p.tasks.map((t) => [t.id, t]));
  const found = new Map();
  for (const dir of extraDirs) {
    for (const f of taskFilesOf(dir)) {
      const task = JSON.parse(fs.readFileSync(f, 'utf8'));
      found.set(task.id, { sha256: sha256(fs.readFileSync(f)) });
    }
  }
  for (const id of [...new Set(taskIds)].sort()) {
    const t = locked.get(id);
    const n = found.get(id);
    if (!t) problems.push(`${id}: not in the pre-registration lock`);
    else if (!n) problems.push(`${id}: its task file is not in the --extra-tasks directories, so it cannot be compared with the lock`);
    else if (n.sha256 !== t.sha256) problems.push(`${id}: the task file differs from the locked one`);
  }
  if (problems.length) throw new Error(`the run does not match the pre-registration lock ${file}:\n  ${problems.join('\n  ')}`);
  return p;
}

/** The `--prereg FILE` flag of `run` and `report-2x2`: refuses (throws) when the tasks they use do not match the lock. */
function requirePrereg(opts, { taskIds, extraDirs }) {
  if (opts.prereg === true || !opts.prereg) throw new Error('--prereg takes the path of a PREREG.json');
  return checkRun(path.resolve(opts.prereg), { taskIds, extraDirs });
}

module.exports = { requirePrereg, FILE, buildPrereg, freezePrereg, checkPrereg, checkRun, readPrereg, verifyRecord, splitSection, canonical, lockHashOf };
