// SPDX-License-Identifier: Apache-2.0
'use strict';

// The keep-or-prune record (bench/schema/keep-prune-record.schema.json): one JSON file per scope (skill, section, rule
// or context file). A skill record holds a `quick` and a `deep` block side by side, each with its own label, verdict,
// coverage and judges. The two are never averaged: `agree` is false when their verdicts differ and a person decides in
// `signoff`. A verdict is a suggestion; `signoff` starts empty. Readers refuse an unknown major version (NFR-10), and a
// record made under other rules or from another SKILL.md is stale, listed and never read as current.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../runner/lib/schema.js');
const { LABEL_RULES, LABEL_RULES_DATE, VERDICT_RULES, VERDICT_RULES_DATE, LABELS, verdictFor } = require('./labels.js');
const { PASS_RULES, PASS_RULES_DATE } = require('./passrules.js');
const { DEEP_RULES, DEEP_RULES_DATE, DEPTHS } = require('./keepprune.js');
const { familyOf } = require('../judge/family.js');

const SCHEMA_NAME = 'keep-prune-record';
const MAJOR = 1;
const SCHEMA_ID = `${SCHEMA_NAME}/${MAJOR}`;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** The rule set every record names: the dates and one hash over all four rule texts. */
const RULES = Object.freeze({
  labelRulesDate: LABEL_RULES_DATE, verdictRulesDate: VERDICT_RULES_DATE, passRulesDate: PASS_RULES_DATE, deepRulesDate: DEEP_RULES_DATE,
  sha256: sha256([LABEL_RULES, VERDICT_RULES, PASS_RULES, DEEP_RULES].join('\n\u0000\n')),
});

const gapOf = (reading) => (reading && reading.tasks ? { mean: reading.mean_gap, tInterval: reading.t_interval, bootstrapInterval: reading.bootstrap_interval } : null);

/**
 * One depth block from checkDepth's result. `meta` gives what the check does not know: { commit, runId, provider,
 * replicates, bWaiting }. Hidden checks are a separate hard score (null until a deep run has them), never folded in.
 */
function blockFromCheck(check, meta = {}) {
  const { depth, entry, summary, seats, controls } = check;
  const block = {
    commit: meta.commit ?? null, runId: meta.runId ?? null, provider: meta.provider ?? null,
    subject: { harness: DEPTHS[depth].harness, model: seats.subject.model, family: seats.subject.family },
    judges: seats.seats.filter((s) => s.seated).map((s) => ({ model: s.model, family: s.family })),
    judgesRefused: seats.seats.filter((s) => !s.seated).map((s) => ({ model: s.model, family: s.family, why: s.why ?? 'the run is unjudged' })),
    unjudged: seats.judged ? null : seats.why,
    coverage: {
      tasksCounted: summary.A.tasks_counted, tasksTotal: summary.tasks, bTasksCounted: summary.B.tasks_counted,
      notLoaded: summary.status.not_loaded, setupFault: summary.status.setup_fault,
      staleJudgments: summary.A.judgments.stale + summary.B.judgments.stale,
      ...(depth === 'deep' ? { runsPerSide: meta.replicates ?? null } : {}),
    },
    gapA: gapOf(summary.A), gapB: gapOf(summary.B), bWaiting: [...(meta.bWaiting ?? [])],
    controls: { passed: controls.trusted, status: controls.status, ran: controls.ran, results: controls.evaluations.map((e) => ({ control: e.control, status: e.status, missing: e.missing })) },
    cost: depth === 'deep' ? { credits: 0, usd: 0 } : { usd: 0 },
    label: entry.label, labelWhy: entry.why ?? null, verdict: entry.verdict, verdictWhy: entry.verdict_why ?? null, action: entry.verdict_action, noData: [...entry.no_data],
  };
  if (depth === 'deep') {
    block.noise = { aaSpread: summary.aa && typeof summary.aa.mean_gap === 'number' ? Math.abs(summary.aa.mean_gap) : null, aaInterval: summary.aa?.t_interval ?? null, replicates: meta.replicates ?? null };
    block.hiddenChecks = null;
  }
  return block;
}

/**
 * The deep block `cap decide` writes beside a call. The study's runs are scored 0 to 1 by checks and rubric and carry
 * no A or B reading, and the copied rules read 1 to 5 readings, so the block is NO DATA until phase B wires the
 * readings in. The call itself is kept as `capCall`, for a person to read, and is not a verdict. `meta` is { commit,
 * runId, model, controlsTrusted, replicates }.
 */
function blockFromDecision(decision, meta = {}) {
  const why = "this study's runs carry no A and B readings yet: the copied rules read readings on the 1 to 5 scale, and cap decide's own 0 to 1 calls are no longer used for verdicts";
  const v = verdictFor(LABELS.noData, null, null, { noDataWhy: why });
  const del = decision.evidence?.del ?? null;
  return {
    commit: meta.commit ?? null, runId: meta.runId ?? null, provider: 'kiro-cli',
    subject: { harness: 'kiro-cli', model: meta.model ?? null, family: familyOf(meta.model) },
    judges: [], judgesRefused: [], unjudged: null,
    coverage: { tasksCounted: 0, tasksTotal: 0, bTasksCounted: 0, notLoaded: 0, setupFault: 0, staleJudgments: 0, runsPerSide: del ? Math.min(del.nHead, del.nBase) : null },
    gapA: null, gapB: null, bWaiting: [],
    controls: { passed: meta.controlsTrusted === true, status: meta.controlsTrusted === true ? 'PASS' : meta.controlsTrusted === false ? 'FAIL' : 'NONE', ran: meta.controlsTrusted === null || meta.controlsTrusted === undefined ? [] : ['fact', 'decoy'], results: [] },
    cost: { credits: null, usd: null },
    label: LABELS.noData, labelWhy: why, verdict: v.verdict, verdictWhy: v.why, action: v.action, noData: [why],
    noise: { aaSpread: decision.aaSpread ?? null, aaInterval: null, replicates: meta.replicates ?? null },
    hiddenChecks: null,
    capCall: { decision: decision.decision, confidence: decision.confidence, reasons: [...(decision.reasons ?? [])] },
  };
}

/**
 * A skill record. `skill` is { name, sha256 } (the SKILL.md hash), `quick` and `deep` blocks (either may be null when
 * that depth has not run), `baseline` { manifestSha256 } or null. `agree` is null unless both blocks exist.
 */
function buildRecord({ skill, quick = null, deep = null, baseline = null, scope = { kind: 'skill', id: 'whole', lines: null }, createdAt = new Date().toISOString() }) {
  return {
    schema: SCHEMA_ID, createdAt,
    skill: { name: skill.name, sha256: skill.sha256 ?? null },
    scope, rules: { ...RULES }, baseline: { manifestSha256: baseline?.manifestSha256 ?? null },
    quick, deep,
    agree: quick && deep ? quick.verdict === deep.verdict : null,
    tokens: null,
    stale: { value: false, why: null },
    signoff: { by: null, date: null, decision: null, note: null },
  };
}

/** Schema problems of `record` (an empty list when it is valid). An unknown major is the first problem. */
function recordProblems(record) {
  const m = /^keep-prune-record\/(\d+)$/.exec(record?.schema ?? '');
  if (!m) return [`$.schema: ${JSON.stringify(record?.schema)} is not a keep-prune-record version`];
  if (Number(m[1]) !== MAJOR) return [`$.schema: major version ${m[1]} is unknown; this reader reads ${MAJOR}`];
  return validate(loadSchema(SCHEMA_NAME), record);
}

/** Writes a valid record to `file` and returns the file; throws with the schema problems otherwise. */
function writeRecord(file, record) {
  const problems = recordProblems(record);
  if (problems.length) throw new Error(`keep-prune record for ${record?.skill?.name}: ${problems.join('; ')}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/**
 * Reads a record and says whether it is current. Throws on an unknown major or a schema problem. Returns the record
 * with `stale` set when it was made under other rules or from another SKILL.md than `skillSha256` (when given).
 */
function readRecord(file, { skillSha256 = null } = {}) {
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const problems = recordProblems(record);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  const why = [];
  if (record.rules.sha256 !== RULES.sha256) why.push(`made under other rules (labels ${record.rules.labelRulesDate}, verdicts ${record.rules.verdictRulesDate}); never read again under the current ones`);
  if (skillSha256 && record.skill.sha256 !== skillSha256) why.push('SKILL.md changed after the record was made');
  if (why.length) record.stale = { value: true, why: why.join('; ') };
  return record;
}

/** The record as a short markdown table: both depths side by side, never averaged. */
function renderRecord(record) {
  const row = (name, pick) => `| ${name} | ${['quick', 'deep'].map((d) => (record[d] ? pick(record[d]) : 'not run')).join(' | ')} |`;
  const gap = (g) => (g ? `${g.mean} ${JSON.stringify(g.tInterval)}` : 'n/a');
  return [
    `# Keep or prune: ${record.skill.name}`, '',
    '| | quick | deep |', '|---|---|---|',
    row('label', (b) => b.label), row('suggested verdict', (b) => b.verdict), row('action', (b) => b.action),
    row('why', (b) => (b.noData.length ? b.noData.join('; ') : b.labelWhy)),
    row('gap A', (b) => gap(b.gapA)), row('gap B', (b) => gap(b.gapB)),
    row('tasks counted', (b) => `${b.coverage.tasksCounted} of ${b.coverage.tasksTotal}`),
    row('controls', (b) => `${b.controls.status} (${b.controls.ran.join(', ') || 'none'})`),
    row('judges', (b) => b.judges.map((j) => j.model).join(', ') || 'none'), '',
    `Agree: ${record.agree === null ? 'one depth only' : record.agree ? 'yes' : 'NO: the verdicts differ, a person decides'}. Sign-off: ${record.signoff.by ?? 'none yet'}.`, '',
  ].join('\n');
}

module.exports = { SCHEMA_ID, MAJOR, RULES, blockFromCheck, blockFromDecision, buildRecord, recordProblems, writeRecord, readRecord, renderRecord };
