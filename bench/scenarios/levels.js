// SPDX-License-Identifier: Apache-2.0
'use strict';

// Run levels (plan section 7a): which tasks LITE, STANDARD and FULL run, computed from task metadata and the SR-32 hashes.
//   lite      about 16 stratified DEV tasks: for each of the 14 phases the DEV task with the lowest SR-32 hash among real
//             tasks whose soft limit is 900 s or less; a role still missing is swapped in (its lowest-hash DEV task, from a
//             phase with two or more such tasks); plus the lowest-hash DEV negative control and DEV twin; plus, as smoke only,
//             every task added or changed since the last LITE.
//   standard  every DEV task, controls and twins included.
//   full      every task (the verdict comes from HELD-OUT only; a FULL run needs --prereg).
// The list is a pure function of the tasks, so it is fixed for a pack version; the record is kept in run-config.json and
// shown in the report header.

const crypto = require('node:crypto');
const fs = require('node:fs');
const { taskFilesOf } = require('./files.js');
const { hashOf, splitOf } = require('./split.js');
const { CORE_PHASES, ROLES } = require('./coverage.js');

const LEVELS = ['lite', 'standard', 'full'];
const LITE_SOFT_SEC_MAX = 900;
// The 14 phases of the LITE rule: the plan's taxonomy without the long multi-phase row. Phases added later (ADDED_PHASES)
// stay out, so the locked LITE and STANDARD picks do not move when a new type of work gets tasks.
const LITE_PHASES = CORE_PHASES.filter((p) => p !== 'multi-phase');

const softSecOf = (t) => t.limits?.softSec ?? t.timeoutSec ?? Infinity;
const byHash = (a, b) => hashOf(a.id) - hashOf(b.id) || (a.id < b.id ? -1 : 1);
const listHashOf = (ids) => crypto.createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex');

/** The LITE picks: { picks: [{ id, why }], unfilled: [roles] } over task objects. */
function liteSelection(tasks) {
  const real = tasks.filter((t) => (t.controlKind ?? 'none') === 'none' && splitOf(t.id) === 'DEV' && softSecOf(t) <= LITE_SOFT_SEC_MAX).sort(byHash);
  const picks = new Map();
  for (const phase of LITE_PHASES) {
    const first = real.find((t) => t.phase === phase);
    if (first) picks.set(phase, { task: first, why: `phase ${phase}` });
  }
  const unfilled = [];
  for (const role of ROLES) {
    const has = (r) => [...picks.values()].some((p) => p.task.role === r);
    if (has(role)) continue;
    // Swap in the role's lowest-hash task from a phase with two or more eligible tasks, and only for a pick whose role stays covered.
    const candidates = real.filter((t) => t.role === role && LITE_PHASES.includes(t.phase) && real.filter((u) => u.phase === t.phase).length >= 2);
    const swap = candidates.find((t) => {
      const old = picks.get(t.phase);
      return old && old.task.id !== t.id && [...picks.values()].some((p) => p !== old && p.task.role === old.task.role);
    });
    if (swap) picks.set(swap.phase, { task: swap, why: `phase ${swap.phase}, swapped in for role ${role}` });
    else unfilled.push(role);
  }
  const out = [...picks.values()].map((p) => ({ id: p.task.id, why: p.why }));
  for (const [kind, label] of [['negative', 'negative control'], ['twin', 'twin']]) {
    const c = tasks.filter((t) => t.controlKind === kind && splitOf(t.id) === 'DEV').sort(byHash)[0];
    if (c) out.push({ id: c.id, why: label });
  }
  return { picks: out, unfilled };
}

/**
 * The tasks of a level. `tasks` are task objects; `hashes` maps task id to the sha256 of its file; `since` is the `tasks`
 * list of an earlier LITE record ([{ id, sha256 }]), whose added or changed tasks join as smoke-only runs.
 * Returns { level, ids, picks, smoke, unfilled, listHash }.
 */
function selectLevel({ level, tasks, hashes = new Map(), since = null }) {
  if (!LEVELS.includes(level)) throw new Error(`--level takes ${LEVELS.join(', ')}`);
  if (since && level !== 'lite') throw new Error('--level-since applies to --level lite only');
  if (level === 'full') return record(level, tasks.map((t) => t.id).sort(), tasks.map((t) => ({ id: t.id, why: 'full' })), [], []);
  if (level === 'standard') {
    const dev = tasks.filter((t) => splitOf(t.id) === 'DEV').map((t) => t.id).sort();
    return record(level, dev, dev.map((id) => ({ id, why: 'DEV' })), [], []);
  }
  const { picks, unfilled } = liteSelection(tasks);
  const had = new Map((since ?? []).map((t) => [t.id, t.sha256]));
  const picked = new Set(picks.map((p) => p.id));
  const smoke = since ? tasks.filter((t) => !picked.has(t.id) && (!had.has(t.id) || !hashes.get(t.id) || had.get(t.id) !== hashes.get(t.id))).map((t) => t.id).sort() : [];
  return record(level, [...new Set([...picks.map((p) => p.id), ...smoke])].sort(), picks, smoke, unfilled);
}

function record(level, ids, picks, smoke, unfilled) {
  return { level, ids, picks, smoke, unfilled, listHash: listHashOf(ids) };
}

/** What a level may and may not support (plan 7a), for the report header. */
const LEVEL_NOTE = {
  lite: 'LITE is a smoke test and a trend: no verdict, no per-phase claim, no comparison with vanilla beyond a stored baseline; tasks listed as smoke only show whether they run.',
  standard: 'STANDARD is a broader look at DEV tasks: direction only, "DEV, not a verdict"; no margin claim and no keep-or-prune call.',
  full: 'FULL is the pre-registered run: verdicts come from HELD-OUT tasks only.',
};

/** The record kept in run-config.json for a selection; `hashes` maps task id to the sha256 of its file. */
function levelRecord(sel, hashes = new Map()) {
  return {
    name: sel.level, taskCount: sel.ids.length, listHash: sel.listHash, unfilledRoles: sel.unfilled, smokeOnly: sel.smoke,
    picks: sel.picks, tasks: sel.ids.map((id) => ({ id, sha256: hashes.get(id) ?? null })),
  };
}

/** Task id to the sha256 of its file, over the task directories of a run (`--extra-tasks`). Tasks read from bench/tasks have none. */
function taskHashes(extraDirs) {
  const out = new Map();
  for (const dir of extraDirs) {
    for (const file of taskFilesOf(dir)) out.set(JSON.parse(fs.readFileSync(file, 'utf8')).id, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  }
  return out;
}

/**
 * The `--level` flag of `run`: the selection and its record, or null when the flag is absent. Refuses --tasks beside it, and
 * FULL without --prereg (only the pre-registered run may be FULL). `candidates` are the loaded task objects of the suite.
 */
function planLevel(opts, { candidates, extraDirs }) {
  if (opts.level === undefined) return null;
  if (opts.level === true) throw new Error(`--level takes ${LEVELS.join(', ')}`);
  if (opts.tasks !== undefined) throw new Error('--level and --tasks both select tasks; give one of them');
  if (opts.level === 'full' && opts.prereg === undefined) throw new Error('--level full is the pre-registered run: give --prereg FILE (scenarios prereg freeze)');
  let since = null;
  if (opts['level-since'] !== undefined) {
    if (opts['level-since'] === true) throw new Error('--level-since takes the path of a JSON file with a "tasks" list of { id, sha256 }');
    try { since = JSON.parse(fs.readFileSync(opts['level-since'], 'utf8')).tasks; } catch (e) { throw new Error(`cannot read --level-since ${opts['level-since']}: ${e.code || e.message}`); }
    if (!Array.isArray(since)) throw new Error('--level-since: the file has no "tasks" list');
  }
  const hashes = taskHashes(extraDirs);
  const sel = selectLevel({ level: opts.level, tasks: candidates, hashes, since });
  if (!sel.ids.length) throw new Error(`--level ${opts.level} selects no task from this suite`);
  return { sel, record: levelRecord(sel, hashes) };
}

/** One line for the report header from the level records of the cells ([{ cell, level }]); null when none recorded one. */
function levelHeader(items) {
  const have = items.filter((i) => i.level);
  if (!have.length) return null;
  const same = have.length === items.length && have.every((i) => i.level.listHash === have[0].level.listHash && i.level.name === have[0].level.name);
  const text = (l) => `${l.name.toUpperCase()}, ${l.taskCount} tasks (list ${l.listHash.slice(0, 12)}${l.smokeOnly?.length ? `, ${l.smokeOnly.length} smoke only` : ''}${l.unfilledRoles?.length ? `, no task for role ${l.unfilledRoles.join(', ')}` : ''})`;
  if (same) return `Run level: ${text(have[0].level)}. ${LEVEL_NOTE[have[0].level.name]}`;
  return `Run level differs between cells: ${items.map((i) => `${i.cell}: ${i.level ? text(i.level) : 'not recorded'}`).join('; ')}.`;
}

module.exports = { planLevel, taskHashes, selectLevel, liteSelection, levelRecord, levelHeader, LEVELS, LITE_PHASES, LITE_SOFT_SEC_MAX, LEVEL_NOTE, listHashOf };
