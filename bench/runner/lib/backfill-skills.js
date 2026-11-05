// SPDX-License-Identifier: Apache-2.0
'use strict';

// Rewrites the skill-load fields of finished runs from stream.jsonl. A run saved by a runner that could not read the
// engine's skill calls has empty skill fields, and the orchestrator pass rule reads those. The values come from the same
// functions the runner calls (report/skills.js collectRows, which calls extractSkills and resultFields).
// A killed or timed-out run is included: its skill calls are in the stream even though its turn never ended. Its
// credits stay censored; nothing here touches a credit field.

const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { loadRun } = require('../../report/load.js');
const { collectRows } = require('../../report/skills.js');
const { aggregateRunDir } = require('./harness/kiro.js');
const { runtimeOf } = require('./harness/runtime.js');
const { SKILL_FIELDS, capInvocationOf } = require('./skills.js');
const { validateResult } = require('./result.js');
const { writeAtomic, keepCopy } = require('./backfill.js');

const PRE_SKILLS_BACKFILL = '.pre-skills-backfill';
const FIELDS = [...SKILL_FIELDS, 'capInvocation'];

const keyOf = (armId, taskId, replicate) => `${armId}\u0000${taskId}\u0000${replicate}`;
const pick = (o) => Object.fromEntries(FIELDS.map((k) => [k, o[k] ?? null]));
const isKilled = (result) => result.status === 'timeout' || Boolean(result.creditsCensored);

// A result saved before skillCallsFailedByTool existed that recorded no failed skill calls already implies all zeros.
// Treating that as equal keeps such runs "unchanged", so a rerun does not rewrite every old result.json for a field
// that would only say 0, 0, 0.
const NO_FAILURES = { get_skill: 0, load_resource: 0, find_skills: 0 };
const withImpliedSplit = (f) => (f.skillCallsFailedByTool == null && f.skillCallsFailed === 0 ? { ...f, skillCallsFailedByTool: NO_FAILURES } : f);

function assess({ result, row, dir, tasks, now }) {
  if (runtimeOf(result) !== 'kiro-cli') return { status: 'skipped', reason: 'not a kiro-cli run' };
  if (result.status === 'budget_skipped') return { status: 'skipped', reason: 'budget-skipped run' };
  if (!row) return { status: 'skipped', reason: 'no stream.jsonl' };
  if (!tasks.has(result.taskId)) return { status: 'skipped', reason: `task ${result.taskId} is not in the bench dir, so its target cannot be read` };
  let agg;
  try { agg = aggregateRunDir(dir); } catch { return { status: 'skipped', reason: 'no stream.jsonl' }; }
  const after = pick({ ...row.fields, capInvocation: capInvocationOf({ agg, extraction: row.extraction, sops: row.sops }) });
  const before = pick(result);
  if (isDeepStrictEqual(withImpliedSplit(before), after)) return { status: 'unchanged', before, after };
  const next = { ...result, ...after, skillsBackfill: { at: now(), source: 'stream.jsonl' } };
  const errors = validateResult(next);
  if (errors.length) return { status: 'unrecoverable', reason: `the rewritten result.json would not validate: ${errors[0]}` };
  return { status: 'changed', before, after, next };
}

function applyOne(entry) {
  const file = path.join(entry.dir, 'result.json');
  const kept = keepCopy(file, PRE_SKILLS_BACKFILL);
  if (kept) return { status: 'unrecoverable', reason: kept };
  writeAtomic(file, `${JSON.stringify(entry.next, null, 2)}\n`);
  return { status: 'changed' };
}

/**
 * runDir: one results cell. tasks: the bench task map (a run's target comes from it). repoRoot: checkout whose skills/ and
 * agent-sops/ list the names, or null. Returns one entry per result.json:
 * { armId, taskId, replicate, dir, status: changed|unchanged|skipped|unrecoverable, reason?, killed, before?, after? }.
 * `before` and `after` hold the skill fields and capInvocation. Nothing is written unless write is true.
 */
function backfillSkills({ runDir, tasks, repoRoot = null, write = false, now = () => new Date().toISOString() }) {
  const run = loadRun(runDir);
  const rows = new Map(collectRows(run.dir, { tasks, repoRoot }).rows.map((r) => [keyOf(r.armId, r.taskId, r.replicate), r]));
  return run.runs.map((r) => {
    const entry = { armId: r.armId, taskId: r.taskId, replicate: r.replicate, dir: r.dir, killed: isKilled(r.result) };
    const plan = assess({ result: r.result, row: rows.get(keyOf(r.armId, r.taskId, r.replicate)), dir: r.dir, tasks, now });
    if (plan.status !== 'changed') return { ...entry, ...plan };
    const { next, ...rest } = plan;
    if (!write) return { ...entry, ...rest };
    const applied = applyOne({ ...entry, next });
    return applied.status === 'changed' ? { ...entry, ...rest } : { ...entry, ...applied };
  });
}

const sum = (list, f) => list.reduce((n, e) => n + f(e), 0);
const loadsOf = (fields) => (fields.skillsLoaded ?? []).reduce((n, s) => n + s.count, 0);
const targetOf = (list, side) => {
  const known = list.filter((e) => e[side].targetLoaded !== null);
  return { n: known.filter((e) => e[side].targetLoaded).length, of: known.length };
};

/** Per-arm totals of the skill fields before and after, over the runs that have both (changed and unchanged). */
function summarizeSkillsBackfill(entries) {
  const withBoth = entries.filter((e) => e.before && e.after);
  const armIds = [...new Set(withBoth.map((e) => e.armId))];
  const arms = armIds.map((armId) => {
    const mine = withBoth.filter((e) => e.armId === armId);
    const count = (side) => (e, name) => sum(e[side].skillsLoaded ?? [], (s) => (s.name === name ? s.count : 0));
    const names = [...new Set(mine.flatMap((e) => ['before', 'after'].flatMap((side) => (e[side].skillsLoaded ?? []).map((s) => s.name))))];
    const skills = names.map((name) => ({ name, before: sum(mine, (e) => count('before')(e, name)), after: sum(mine, (e) => count('after')(e, name)) }))
      .filter((s) => s.before !== s.after)
      .sort((a, b) => b.after - a.after || a.name.localeCompare(b.name));
    const pair = (f) => ({ before: sum(mine, (e) => f(e.before)), after: sum(mine, (e) => f(e.after)) });
    return {
      armId, runs: mine.length, changed: mine.filter((e) => e.status === 'changed').length,
      withSkill: pair((x) => ((x.skillsLoaded ?? []).length ? 1 : 0)), loads: pair(loadsOf), failedCalls: pair((x) => x.skillCallsFailed ?? 0),
      targetLoaded: { before: targetOf(mine, 'before'), after: targetOf(mine, 'after') }, skills,
    };
  });
  return { arms, killed: entries.filter((e) => e.status === 'changed' && e.killed).length };
}

/** The per-arm table and, under it, the skills whose load count changed. */
function renderSkillsBackfill(summary) {
  const to = (p) => `${p.before} -> ${p.after}`;
  const target = (t) => `${t.before.n}/${t.before.of} -> ${t.after.n}/${t.after.of}`;
  const head = ['arm', 'runs', 'changed', 'runs with a skill', 'skill loads', 'failed skill calls', 'target loaded'];
  const lines = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const a of summary.arms) lines.push(`| ${[a.armId, a.runs, a.changed, to(a.withSkill), to(a.loads), to(a.failedCalls), target(a.targetLoaded)].join(' | ')} |`);
  const changed = summary.arms.filter((a) => a.skills.length);
  if (changed.length) lines.push('', 'Loads per skill that changed (before -> after):', ...changed.map((a) => `  ${a.armId}: ${a.skills.map((s) => `${s.name} ${s.before} -> ${s.after}`).join(', ')}`));
  return lines.join('\n');
}

module.exports = { backfillSkills, summarizeSkillsBackfill, renderSkillsBackfill, PRE_SKILLS_BACKFILL };
