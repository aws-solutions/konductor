// SPDX-License-Identifier: Apache-2.0
'use strict';

// The keep-or-prune stage record of stages 2 to 4 (bench/schema/keep-prune-unit-stage.schema.json): one JSON file per
// agent file, SOP or always-loaded context file, written by `cap unit-stage`. It is checked on write and on read. The
// quick and deep blocks are the same blocks a skill record holds (kprecord.js blockFromCheck), so they are checked
// against the skill record schema's own block schema, never a copy of it. A reader refuses an unknown major and marks
// a record stale when the unit's bytes changed after it was made.

const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../runner/lib/schema.js');
const { readJsonFile } = require('./checkedjson.js');
const { STAGE_OF_KIND, unitManifest } = require('./units.js');
const { delegationProblems } = require('./delegation.js');
const { controlsCell } = require('./kprecord.js');

const SCHEMA_NAME = 'keep-prune-unit-stage';
const MAJOR = 1;
const UNIT_SCHEMA_ID = `${SCHEMA_NAME}/${MAJOR}`;

/** Problems the schema cannot state: the stage of the kind, `agree` against the two verdicts, and the delegation result. */
function ruleProblems(r) {
  const p = [];
  if (STAGE_OF_KIND[r.kind] !== undefined && r.stage !== STAGE_OF_KIND[r.kind]) p.push(`$.stage: stage ${r.stage} is not the stage of a ${r.kind} unit (${STAGE_OF_KIND[r.kind]})`);
  const agree = r.quick && r.deep ? r.quick.verdict === r.deep.verdict : null;
  if (r.agree !== agree) p.push(`$.agree: ${JSON.stringify(r.agree)} does not follow from the two verdicts (expected ${JSON.stringify(agree)})`);
  if (r.delegation) {
    if (r.kind !== 'agent') p.push('$.delegation: only an agent unit has a delegation result');
    else p.push(...delegationProblems(r.delegation).map((x) => `$.delegation: ${x}`));
  }
  return p;
}

/** Schema problems of `record` (an empty list when it is valid). An unknown major is the only problem then. */
function unitRecordProblems(record) {
  const m = /^keep-prune-unit-stage\/(\d+)$/.exec(record?.schema ?? '');
  if (!m) return [`$.schema: ${JSON.stringify(record?.schema)} is not a keep-prune-unit-stage version`];
  if (Number(m[1]) !== MAJOR) return [`$.schema: major version ${m[1]} is unknown; this reader reads ${MAJOR}`];
  const shape = validate(loadSchema(SCHEMA_NAME), record);
  if (shape.length) return shape;
  const blocks = loadSchema('keep-prune-record').properties;
  return [...validate(blocks.quick, record.quick, '$.quick'), ...validate(blocks.deep, record.deep, '$.deep'), ...ruleProblems(record)];
}

/** Writes a valid record to `file` (and nothing when it is not valid); returns the file. */
function writeUnitRecord(file, record) {
  const problems = unitRecordProblems(record);
  if (problems.length) throw new Error(`keep-prune stage record for ${record?.kind}:${record?.name}: ${problems.join('; ')}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/**
 * Reads a record, refusing a repeated key, an unknown major or a schema problem. With `repo`, the unit is hashed again
 * and a record made from other bytes is returned with `stale` set.
 */
function readUnitRecord(file, { repo = null } = {}) {
  const record = readJsonFile(file);
  const problems = unitRecordProblems(record);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  if (repo) {
    const now = unitManifest({ repo, kind: record.kind, name: record.name }).sha256;
    if (now !== record.unit.sha256) record.stale = { value: true, why: `the unit changed after the record was made (${record.unit.sha256.slice(0, 12)}, now ${now.slice(0, 12)})` };
  }
  return record;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * The gap of each task in a depth block, from its score rows: per reading, the mean panel median of the with arm minus
 * that of the without arm (keepprune.js taskGap), or null when an answer of either arm has no median or was not judged.
 * Returns [{ task, A, B }] in the order the tasks first appear.
 */
function taskGaps(block) {
  const byTask = new Map();
  for (const s of block?.scores ?? []) {
    if (!byTask.has(s.task)) byTask.set(s.task, []);
    byTask.get(s.task).push(s);
  }
  const gap = (rows, reading) => {
    const arm = (a) => rows.filter((s) => s.reading === reading && s.arm === a).map((s) => s.median);
    const [w, wo] = [arm('with'), arm('without')];
    return w.length && wo.length && [...w, ...wo].every((m) => m !== null) ? mean(w) - mean(wo) : null;
  };
  return [...byTask].map(([task, rows]) => ({ task, A: gap(rows, 'A'), B: gap(rows, 'B') }));
}

const GRADES = new Set(['KEEP', 'WEAK', 'BAD']);

/**
 * The reviewers' grades of a baseline's tasks, from `file` (a review.json beside baseline.json), or null when there is
 * none: { reviewers, rule, grades: { taskId: 'KEEP' | 'WEAK' | 'BAD' } }. `taskIds` are the baseline's own task ids;
 * a grade for any other id, or any other grade, is refused. Grades only label the rendered record: they never change
 * a reading, and the record JSON does not hold them.
 */
function readTaskGrades(file, taskIds) {
  if (!fs.existsSync(file)) return null;
  const j = readJsonFile(file);
  const ids = new Set(taskIds);
  const p = [];
  if (j.format_version !== 1) p.push(`format_version ${JSON.stringify(j.format_version)} is not 1`);
  if (!Array.isArray(j.reviewers) || !j.reviewers.length) p.push('reviewers must name at least one reviewer');
  for (const [id, g] of Object.entries(j.grades ?? {})) {
    if (!ids.has(id)) p.push(`${id} is not a task of the baseline`);
    else if (!GRADES.has(g)) p.push(`${id}: grade ${JSON.stringify(g)} is not KEEP, WEAK or BAD`);
  }
  if (p.length) throw new Error(`${file}: ${p.join('; ')}`);
  return { reviewers: [...j.reviewers], rule: j.rule ?? null, grades: { ...j.grades } };
}

/** The per-task table of a record: each task's gaps at both depths, with its review grade (`-` when ungraded). */
function taskTable(r, review) {
  const gaps = Object.fromEntries(['quick', 'deep'].map((d) => [d, new Map(taskGaps(r[d]).map((g) => [g.task, g]))]));
  const tasks = [...new Set([...gaps.quick.keys(), ...gaps.deep.keys()])];
  if (!tasks.length) return [];
  const cell = (d, t, reading) => {
    if (!r[d]) return 'not run';
    const v = gaps[d].get(t)?.[reading];
    return typeof v === 'number' ? v.toFixed(2) : 'n/a';
  };
  const who = review ? `Task grades by ${review.reviewers.join(' and ')}${review.rule ? ` (${review.rule})` : ''}: read a BAD task's gap as noise, a WEAK one with care.` : 'No review grades for these tasks.';
  return [
    'Per task (gap = with minus without, panel median):', '', who, '',
    '| task | grade | quick gap A | quick gap B | deep gap A | deep gap B |', '|---|---|---|---|---|---|',
    ...tasks.map((t) => `| ${t} | ${review?.grades[t] ?? '-'} | ${cell('quick', t, 'A')} | ${cell('quick', t, 'B')} | ${cell('deep', t, 'A')} | ${cell('deep', t, 'B')} |`), '',
  ];
}

/**
 * The record as a short markdown page: both depths side by side, never averaged, then each task's gaps. `review`
 * (readTaskGrades) puts each task's review grade beside its gaps.
 */
function renderUnitRecord(r, review = null) {
  const row = (name, pick) => `| ${name} | ${['quick', 'deep'].map((d) => (r[d] ? pick(r[d]) : 'not run')).join(' | ')} |`;
  const d = r.delegation;
  return [
    `# Keep or prune, stage ${r.stage}: ${r.kind}:${r.name}`, '',
    `Measures: ${r.claim}.`, '',
    `Drop arm: ${r.ablation ? `\`${r.ablation.command}\` (${r.ablation.how})` : 'none'}. Selection: ${r.selection.test} (${r.selection.note}).`, '',
    d ? `Delegation: precision ${d.precision ?? 'n/a (never delegated)'}, recall ${d.recall}, over ${d.runs} runs of ${d.requests.delegate + d.requests.none} requests; ${d.frozen ? 'frozen' : 'draft'} requests (${d.source}).` : '',
    r.noData.length ? `NO DATA: ${r.noData.join('; ')}.` : '', '',
    '| | quick | deep |', '|---|---|---|',
    row('label', (b) => b.label), row('suggested verdict', (b) => b.verdict), row('why', (b) => (b.noData.length ? b.noData.join('; ') : b.labelWhy)),
    row('tasks counted', (b) => `${b.coverage.tasksCounted} of ${b.coverage.tasksTotal}`),
    row('controls', controlsCell),
    row('judges', (b) => b.judges.map((j) => `${j.model} (${j.family})`).join(', ') || 'none'), '',
    `Unit: ${r.unit.sha256.slice(0, 12)} over ${r.unit.files.join(', ')}. Stale: ${r.stale.value ? `YES: ${r.stale.why}` : 'no'}. Sign-off: ${r.signoff.by ?? 'none yet'}.`, '',
    ...taskTable(r, review),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

module.exports = { UNIT_SCHEMA_ID, MAJOR, unitRecordProblems, writeUnitRecord, readUnitRecord, renderUnitRecord, taskGaps, readTaskGrades };
