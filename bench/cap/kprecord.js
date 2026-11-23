// SPDX-License-Identifier: Apache-2.0
'use strict';

// The keep-or-prune record (bench/schema/keep-prune-record.schema.json): one JSON file per scope (a skill, or a
// section or rule of one). A skill record holds a `quick` and a `deep` block side by side, each with its own label,
// verdict, coverage, judges and every panel score. The two are never averaged: `agree` is false when their verdicts
// differ and a person decides in `signoff`. A verdict is a suggestion; `signoff` starts empty.
//
// Each block measures the conditional effect after load (`claim`): the with arm was made to load the skill. Whether
// users' requests select the skill is a separate selection result (`selection`: trigger precision and recall, observed
// use), and `wholeSkill` is NO DATA without it, so a whole-skill keep or prune call never rests on forced loading alone.
//
// The record names the whole loaded unit (`unit`: subject manifest hash, paths, Git source), the baseline's recorded
// unit, and any rename or fold (`identity`). Readers refuse an unknown major version (NFR-10). A record made under other
// rules or from another loaded unit is stale, listed and never read as current.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../runner/lib/schema.js');
const { LABEL_RULES, LABEL_RULES_DATE, VERDICT_RULES, VERDICT_RULES_DATE, LABELS, verdictFor } = require('./labels.js');
const { PASS_RULES, PASS_RULES_DATE } = require('./passrules.js');
const { DEEP_RULES, DEEP_RULES_DATE, PANEL_RULES, PANEL_RULES_DATE, DEPTHS, CLAIM } = require('./keepprune.js');
const { familyOf } = require('../judge/family.js');
const { readJsonFile } = require('./checkedjson.js');
const { subjectManifest } = require('./subjectunit.js');

const SCHEMA_NAME = 'keep-prune-record';
const MAJOR = 2;
const SCHEMA_ID = `${SCHEMA_NAME}/${MAJOR}`;
const WHOLE = Object.freeze({ noData: 'NO DATA', ready: 'ready for review' });
const NO_SELECTION = `no selection result (trigger precision and recall, observed use): the blocks give the ${CLAIM} only, so no whole-skill keep or prune call is made`;

const { sha256 } = require('../runner/lib/util.js');
/** The rule set every record names: the dates and one hash over all five rule texts. */
const RULES = Object.freeze({
  labelRulesDate: LABEL_RULES_DATE, verdictRulesDate: VERDICT_RULES_DATE, passRulesDate: PASS_RULES_DATE, deepRulesDate: DEEP_RULES_DATE, panelRulesDate: PANEL_RULES_DATE,
  sha256: sha256([LABEL_RULES, VERDICT_RULES, PASS_RULES, DEEP_RULES, PANEL_RULES].join('\n\u0000\n')),
});

// The inputs a verdict also rests on besides the rule texts (DEBT K-4): the judge prompts, the judge family map, the
// control files and the selection scorer. Each is hashed into a new record's `rules.inputs`; a record whose input hash
// differs from today's is stale and names the input. Records made before this field have none and are not judged on it.
const INPUT_FILES = Object.freeze({
  judgePrompts: [path.join(__dirname, '..', 'judge', 'prompts.js')],
  familyMap: [path.join(__dirname, '..', 'judge', 'family.js')],
  controls: [path.join(__dirname, 'controls')],
  selectionPolicy: [path.join(__dirname, 'selection.js'), path.join(__dirname, 'selectrun.js')],
});
function filesOf(p) {
  if (!fs.existsSync(p)) return [];
  if (!fs.statSync(p).isDirectory()) return [p];
  return fs.readdirSync(p).sort().flatMap((n) => filesOf(path.join(p, n)));
}
/** { judgePrompts, familyMap, controls, selectionPolicy }: the sha256 of each input's files, path and bytes. */
function inputHashes(files = INPUT_FILES) {
  const root = path.join(__dirname, '..');
  return Object.fromEntries(Object.entries(files).map(([k, ps]) => [k, sha256(ps.flatMap(filesOf).map((f) => `${path.relative(root, f)}\u0000${fs.readFileSync(f, 'utf8')}`).join('\n\u0000\n'))]));
}

/** A block's controls as one cell: each control with its own PASS, FAIL or NOT RUN, then each failed check and its numbers. */
function controlsCell(b) {
  const results = b.controls.results ?? [];
  if (!results.length) return `${b.controls.status} (none ran)`;
  const each = results.map((r) => `${r.control} ${r.status}`).join(', ');
  const failed = results.filter((r) => r.status === 'FAIL').map((r) => `${r.control} FAIL: ${(r.checks ?? []).filter((c) => !c.ok).map((c) => `${c.name}: no: ${c.detail}`).join('; ')}`);
  return [each, ...failed].join('. ');
}

const gapOf = (reading) => (reading && reading.tasks ? { mean: reading.mean_gap, tInterval: reading.t_interval, bootstrapInterval: reading.bootstrap_interval } : null);

/** The panel scores of a check as record rows: one per judged answer, its median and each judge's score and family. */
const scoreRows = (scores = []) => scores.map((x) => ({
  task: x.task, batch: x.batch, reading: x.reading, arm: x.arm, replicate: x.replicate, median: x.median,
  judges: x.seats.map((s) => ({ model: s.model, family: familyOf(s.model), score: s.score })),
}));

/**
 * One depth block from checkDepth's result.
 * @param {object} check checkDepth's result
 * @param {object} [meta] what the check does not know: { commit, runId, provider, replicates, bWaiting }
 * Hidden checks are a separate hard score (null until a deep run has them), never folded in.
 */
function blockFromCheck(check, meta = {}) {
  const { depth, entry, summary, seats, controls } = check;
  const block = {
    claim: CLAIM,
    commit: meta.commit ?? null, runId: meta.runId ?? null, provider: meta.provider ?? null,
    subject: { harness: DEPTHS[depth].harness, model: seats.subject.model, family: seats.subject.family },
    judges: seats.seats.filter((s) => s.seated).map((s) => ({ model: s.model, family: s.family })),
    judgesRefused: seats.seats.filter((s) => !s.seated).map((s) => ({ model: s.model, family: s.family, why: s.why ?? 'the run is unjudged' })),
    unjudged: check.unjudged ?? (seats.judged ? null : seats.why),
    coverage: {
      tasksCounted: summary.A.tasks_counted, tasksTotal: summary.tasks, bTasksCounted: summary.B.tasks_counted,
      notLoaded: summary.status.not_loaded, setupFault: summary.status.setup_fault,
      staleJudgments: summary.A.judgments.stale + summary.B.judgments.stale,
      ...(depth === 'deep' ? { runsPerSide: meta.replicates ?? null } : {}),
    },
    gapA: gapOf(summary.A), gapB: gapOf(summary.B), bWaiting: [...(meta.bWaiting ?? [])],
    scores: scoreRows(summary.scores),
    controls: { passed: controls.trusted, status: controls.status, ran: controls.ran, results: controls.evaluations.map((e) => ({ control: e.control, status: e.status, missing: e.missing, checks: (e.checks ?? []).map((c) => ({ name: c.name, ok: Boolean(c.ok), detail: String(c.detail ?? '') })) })) },
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
 * readings in. The call itself is kept as `capCall`, for a person to read, and is not a verdict.
 * @param {object} decision one cap decide call
 * @param {object} [meta] { commit, runId, model, controlsTrusted, replicates }
 */
function blockFromDecision(decision, meta = {}) {
  const why = "this study's runs carry no A and B readings yet: the copied rules read readings on the 1 to 5 scale, and cap decide's own 0 to 1 calls are no longer used for verdicts";
  const v = verdictFor(LABELS.noData, null, null, { noDataWhy: why });
  const del = decision.evidence?.del ?? null;
  return {
    claim: CLAIM,
    commit: meta.commit ?? null, runId: meta.runId ?? null, provider: 'kiro-cli',
    subject: { harness: 'kiro-cli', model: meta.model ?? null, family: familyOf(meta.model) },
    judges: [], judgesRefused: [], unjudged: null,
    coverage: { tasksCounted: 0, tasksTotal: 0, bTasksCounted: 0, notLoaded: 0, setupFault: 0, staleJudgments: 0, runsPerSide: del ? Math.min(del.nHead, del.nBase) : null },
    gapA: null, gapB: null, bWaiting: [], scores: [],
    controls: { passed: meta.controlsTrusted === true, status: meta.controlsTrusted === true ? 'PASS' : meta.controlsTrusted === false ? 'FAIL' : 'NONE', ran: meta.controlsTrusted === null || meta.controlsTrusted === undefined ? [] : ['fact', 'decoy'], results: [] },
    cost: { credits: null, usd: null },
    label: LABELS.noData, labelWhy: why, verdict: v.verdict, verdictWhy: v.why, action: v.action, noData: [why],
    noise: { aaSpread: decision.aaSpread ?? null, aaInterval: null, replicates: meta.replicates ?? null },
    hiddenChecks: null,
    capCall: { decision: decision.decision, confidence: decision.confidence, reasons: [...(decision.reasons ?? [])] },
  };
}

/** The fields of a selection result (selection.js selectionResult), in record order. */
const SELECTION_FIELDS = Object.freeze(['triggerPrecision', 'triggerRecall', 'observedUseRate', 'requests', 'runs', 'failedLoads', 'frozen', 'requestsSha256', 'unitSha256', 'source', 'measuredAt', 'sessionUse']);
const HEX64 = /^[0-9a-f]{64}$/;
const isRate = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const isCount = (v) => Number.isInteger(v) && v >= 0;

/**
 * Problems of a selection result (an empty list when it is usable). It is measured apart from the forced-load check
 * by `cap select` (selection.js): trigger precision (null when no request loaded the skill), trigger recall and the
 * observed use rate in [0, 1]; request and run counts; whether the requests are the frozen ones; the hashes of the
 * requests file and of the loaded unit it ran on; its source and date.
 * @param {object} s the selection result
 */
function selectionProblems(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['the selection result must be an object'];
  const problems = [];
  if (!(s.triggerPrecision === null || isRate(s.triggerPrecision))) problems.push('triggerPrecision must be a number from 0 to 1, or null');
  for (const k of ['triggerRecall', 'observedUseRate']) if (!isRate(s[k])) problems.push(`${k} must be a number from 0 to 1`);
  if (!s.requests || !isCount(s.requests.load) || !isCount(s.requests.none)) problems.push('requests must be { load, none } counts');
  for (const k of ['runs', 'failedLoads']) if (!isCount(s[k])) problems.push(`${k} must be a whole number`);
  if (typeof s.frozen !== 'boolean') problems.push('frozen must be true or false');
  for (const k of ['requestsSha256', 'unitSha256']) if (!HEX64.test(String(s[k]))) problems.push(`${k} must be a SHA-256`);
  for (const k of ['source', 'measuredAt']) if (typeof s[k] !== 'string' || !s[k].trim()) problems.push(`${k} must be a non-empty string`);
  const u = s.sessionUse;
  if (u !== undefined && u !== null && !(isRate(u.rate) && isCount(u.runs) && u.runs > 0 && isCount(u.loaded) && typeof u.source === 'string')) problems.push('sessionUse must be null or { rate, runs, loaded, source } from past real runs');
  const extra = Object.keys(s).filter((k) => !SELECTION_FIELDS.includes(k));
  if (extra.length) problems.push(`unknown field(s): ${extra.join(', ')}`);
  return problems;
}

/**
 * The whole-skill gate: NO DATA, with every reason, unless a selection result is present, ran on the frozen requests
 * and on today's loaded unit, and the unit is current and mapped. Even then it is only ready for a person to read
 * beside the conditional verdicts; no rule combines them (a skill that helps only when forced is a selection fix).
 * @param {object} o { selection, unitSha256 (today's unit), staleWhy, identityWhy }
 */
function wholeSkillGate({ selection, unitSha256 = null, staleWhy, identityWhy }) {
  const why = [
    selection ? null : NO_SELECTION,
    selection && !selection.frozen ? 'the selection requests are a draft, not the ones frozen in the baselines manifest' : null,
    selection && unitSha256 && selection.unitSha256 !== unitSha256 ? `the selection result was measured on another loaded unit (${selection.unitSha256.slice(0, 12)}, now ${unitSha256.slice(0, 12)})` : null,
    staleWhy, identityWhy,
  ].filter(Boolean);
  if (why.length) return { status: WHOLE.noData, why };
  return { status: WHOLE.ready, why: [`a person reads the selection result beside the ${CLAIM}; no rule combines them`] };
}

/**
 * A record for one scope of one skill.
 * @param {object} o
 * @param {object} o.skill { name, sha256 } (the SKILL.md hash)
 * @param {object|null} [o.unit] today's subject manifest with its Git source: { manifestSha256, paths, unresolved, source }
 * @param {object|null} [o.baseline] { manifestSha256, legacy, unitSha256, source, staleWhy } from the frozen baseline
 * @param {object|null} [o.identity] { name, replacedBy, how, approvedBy, why } for a renamed or folded skill
 * @param {object|null} [o.selection] the separate selection result, or null when none was measured
 * @param {object|null} [o.quick] the quick block; [o.deep] the deep block (either may be null when not run)
 * @param {object} [o.scope] { kind: skill | section | rule, id, lines }
 * @param {string} [o.createdAt] ISO time
 */
function buildRecord({ skill, unit = null, baseline = null, identity = null, selection = null, quick = null, deep = null, scope = { kind: 'skill', id: 'whole', lines: null }, createdAt = new Date().toISOString() }) {
  if (!['skill', 'section', 'rule'].includes(scope.kind)) throw new Error(`a keep-prune record is for a skill, a section or a rule, not ${JSON.stringify(scope.kind)}: always-loaded context is not ablatable by this design`);
  if (selection) { const p = selectionProblems(selection); if (p.length) throw new Error(`selection result: ${p.join('; ')}`); }
  const staleWhy = baseline?.staleWhy ?? null;
  return {
    schema: SCHEMA_ID, createdAt,
    skill: { name: skill.name, sha256: skill.sha256 ?? null },
    unit: unit ? { manifestSha256: unit.manifestSha256, paths: [...unit.paths], unresolved: [...unit.unresolved], source: unit.source ?? null } : null,
    scope, rules: { ...RULES, inputs: inputHashes() },
    baseline: { manifestSha256: baseline?.manifestSha256 ?? null, legacy: baseline?.legacy ?? null, unitSha256: baseline?.unitSha256 ?? null, source: baseline?.source ?? null },
    identity,
    selection,
    wholeSkill: scope.id === 'whole' ? wholeSkillGate({ selection, unitSha256: unit?.manifestSha256 ?? null, staleWhy, identityWhy: identity?.why ?? null }) : null,
    quick, deep,
    agree: quick && deep ? quick.verdict === deep.verdict : null,
    tokens: null,
    stale: { value: Boolean(staleWhy), why: staleWhy },
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
 * Reads a record and says whether it is current. Throws on a repeated key, an unknown major or a schema problem.
 * @param {string} file the record file
 * @param {object} [o]
 * @param {string} [o.skillSha256] today's SKILL.md hash
 * @param {string} [o.skillsDir] today's skills/ folder: the loaded unit is hashed again and compared
 * @returns {object} the record, with `stale` set when it was made under other rules or from another unit
 */
function readRecord(file, { skillSha256 = null, skillsDir = null } = {}) {
  const record = readJsonFile(file);
  const problems = recordProblems(record);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  const why = record.stale.value ? [record.stale.why] : [];
  if (record.rules.sha256 !== RULES.sha256) why.push(`made under other rules (labels ${record.rules.labelRulesDate}, verdicts ${record.rules.verdictRulesDate}); never read again under the current ones`);
  if (record.rules.inputs) {
    const now = inputHashes();
    const moved = Object.keys(now).filter((k) => record.rules.inputs[k] !== now[k]);
    if (moved.length) why.push(`made with other inputs (${moved.join(', ')} changed); never read again as current`);
  }
  if (skillSha256 && record.skill.sha256 !== skillSha256) why.push('SKILL.md changed after the record was made');
  if (skillsDir) {
    const now = subjectManifest({ skillsDir, name: record.identity?.replacedBy ?? record.skill.name }).sha256;
    if (!record.unit) why.push('the record names no loaded unit, so it cannot be shown current');
    else if (record.unit.manifestSha256 !== now) why.push(`the loaded unit changed after the record was made (subject ${record.unit.manifestSha256.slice(0, 12)}, now ${now.slice(0, 12)})`);
  }
  if (why.length) record.stale = { value: true, why: why.join('; ') };
  return record;
}

/** The record as a short markdown table: both depths side by side, never averaged. */
function renderRecord(record) {
  const row = (name, pick) => `| ${name} | ${['quick', 'deep'].map((d) => (record[d] ? pick(record[d]) : 'not run')).join(' | ')} |`;
  const gap = (g) => (g ? `${g.mean} ${JSON.stringify(g.tInterval)}` : 'n/a');
  const src = record.unit?.source;
  const sel = record.selection;
  return [
    `# Keep or prune: ${record.skill.name}`, '',
    `Measures: ${CLAIM} (the with arm was made to load the skill).`, '',
    '| | quick | deep |', '|---|---|---|',
    row('label', (b) => b.label), row('suggested verdict', (b) => b.verdict), row('action', (b) => b.action),
    row('why', (b) => (b.noData.length ? b.noData.join('; ') : b.labelWhy)),
    row('gap A', (b) => gap(b.gapA)), row('gap B', (b) => gap(b.gapB)),
    row('tasks counted', (b) => `${b.coverage.tasksCounted} of ${b.coverage.tasksTotal}`),
    row('controls', controlsCell),
    row('judges', (b) => b.judges.map((j) => `${j.model} (${j.family})`).join(', ') || 'none'), '',
    `Loaded unit: ${record.unit ? `${record.unit.manifestSha256.slice(0, 12)} over ${record.unit.paths.join(', ')}` : 'not recorded'}. Source: ${src?.commit ?? 'unknown'}${src?.dirty ? ' (with uncommitted changes)' : ''}.`,
    `Stale: ${record.stale.value ? `YES: ${record.stale.why}` : 'no'}.`,
    `Selection: ${sel ? `precision ${sel.triggerPrecision ?? 'n/a (never loaded)'}, recall ${sel.triggerRecall}, observed use ${sel.observedUseRate} over ${sel.runs} selection runs, use in real sessions ${sel.sessionUse ? `${sel.sessionUse.rate} over ${sel.sessionUse.runs} runs` : 'not read'}, ${sel.frozen ? 'frozen' : 'draft'} requests (${sel.source})` : 'not measured'}.`,
    record.wholeSkill ? `Whole-skill call: ${record.wholeSkill.status}: ${record.wholeSkill.why.join('; ')}.` : '',
    `Agree: ${record.agree === null ? 'one depth only' : record.agree ? 'yes' : 'NO: the verdicts differ, a person decides'}. Sign-off: ${record.signoff.by ?? 'none yet'}.`, '',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}

module.exports = {
  controlsCell, SCHEMA_ID, MAJOR, RULES, INPUT_FILES, inputHashes, WHOLE, NO_SELECTION, blockFromCheck, blockFromDecision, selectionProblems, wholeSkillGate, buildRecord, recordProblems, writeRecord, readRecord, renderRecord };
