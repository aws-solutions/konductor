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

/** The record as a short markdown page: both depths side by side, never averaged. */
function renderUnitRecord(r) {
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
    row('controls', (b) => `${b.controls.status} (${b.controls.ran.join(', ') || 'none'})`),
    row('judges', (b) => b.judges.map((j) => `${j.model} (${j.family})`).join(', ') || 'none'), '',
    `Unit: ${r.unit.sha256.slice(0, 12)} over ${r.unit.files.join(', ')}. Stale: ${r.stale.value ? `YES: ${r.stale.why}` : 'no'}. Sign-off: ${r.signoff.by ?? 'none yet'}.`, '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

module.exports = { UNIT_SCHEMA_ID, MAJOR, unitRecordProblems, writeUnitRecord, readUnitRecord, renderUnitRecord };
