// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap unit-stage`: the skeleton of keep-or-prune stages 2 to 4 (agent files, SOPs, always-loaded context), and
// their dry-run cost estimate. A stage runs one unit through the stage 1 pipeline (checkDepth: the same arms, controls,
// judge panel of three families none the agent's, and copied rules), with the unit's text in place of a skill's: the
// with arm has the agent prompt, SOP or context file, the without arm does not. The drop arm a real run would install
// is `cap variant --drop <id>` (units.js). Phase A has only the stub provider, so a run needs a stub- run id, and no
// unit has a frozen baseline yet, so every real unit is NO DATA until a person writes and reviews one.
// The record is checked against bench/schema/keep-prune-unit-stage.schema.json on write (unitrecord.js).

const fs = require('node:fs');
const path = require('node:path');
const { BENCH_DIR } = require('../runner/lib/tasks.js');
const { textFlag: val, repoRootOf } = require('../runner/lib/flag-values.js');
const { loadConvention, loadDoseLadder } = require('./frozen.js');
const { buildPairs } = require('./doseladder.js');
const { checkDepth, judgePanel, judgmentStore, DEFAULT_REPLICATES, JUDGE_FAMILIES, CLAIM } = require('./keepprune.js');
const { blockFromCheck } = require('./kprecord.js');
const { createStubProvider, assertStubRun } = require('./stubprovider.js');
const { STUB_SUBJECT_MODEL, STUB_JUDGES } = require('./kprun.js');
const { STAGE_OF_KIND, KIND_LABEL, UNIT_BASELINES_DIR, listUnits, unitManifest, renderUnitMap } = require('./units.js');
const { readJsonFile } = require('./checkedjson.js');
const { UNIT_SCHEMA_ID, writeUnitRecord, renderUnitRecord } = require('./unitrecord.js');

const BATCHES = 2;
const TASKS_PER_BATCH = 8;
const READINGS = 2;
const DEEP_ARMS = 3;
const QUICK_ARMS = 2;

/**
 * Per-call prices for the dry-run estimate, checked 2026-11-22 against the LITE run (2026-11-21, 205 agent runs and
 * 720 judge calls) and the forced-skills run (2026-11-22, 48 agent runs). Measured values say so; the rest are
 * assumptions, and each says where it comes from. No run recorded token counts for the agent (D-163).
 *   credits.typical.answer, .checklist  ASSUMED 0.9: one model call with no tools, as a draft call (0.7 to 0.9 in
 *                    docs/cap-playbook.md, Credit guide). No single-call answer has been measured
 *   credits.typical.judge  ASSUMED 0.5 on the Kiro CLI judge backend (playbook); the LITE judges ran on the
 *                    opencode backend in USD, so no credit figure was measured
 *   credits.agentRunAnswer  MEASURED 4.64: the LITE median credits of one whole Kiro CLI agent run (vanilla 3.48,
 *                    konductor 5.92; forced-skills median 5.77). It prices an answer made as a full agent run
 *   credits.worstPerCall  the owner's spend rule, 15 credits per paid call. A rule, not a ceiling: 5 of 205 LITE runs
 *                    passed 15 (the largest 56.5)
 *   usd.judge        MEASURED 0.005: the LITE median per judge call on Bedrock (mean 0.0056; deepseek 0.0063, qwen
 *                    0.0052, gpt luna 0.0037), about 9.5k tokens in and 0.4k out
 *   usd.checklist    ASSUMED as a judge-sized call, 0.005
 *   usd.answer       ASSUMED 0.035: about 4k tokens in and 1.5k out on Claude Sonnet at $3 and $15 per million; no Claude
 *                    run on Bedrock has been made
 */
const COSTS = Object.freeze({
  credits: Object.freeze({ typical: Object.freeze({ answer: 0.9, checklist: 0.9, judge: 0.5 }), agentRunAnswer: 4.64, worstPerCall: 15 }),
  usd: Object.freeze({ answer: 0.035, checklist: 0.005, judge: 0.005 }),
});

/** Checks a unit baseline object; returns the problems (empty when valid). */
function baselineProblems(b) {
  const p = [];
  if (b?.format_version !== 1) p.push(`format_version ${JSON.stringify(b?.format_version)} is not 1`);
  if (!STAGE_OF_KIND[b?.kind]) p.push(`kind ${JSON.stringify(b?.kind)} is not agent, sop or context`);
  if (!/^[0-9a-f]{64}$/.test(b?.unit_sha256 ?? '')) p.push('unit_sha256 is not a SHA-256');
  if (!Array.isArray(b?.batches) || b.batches.length !== BATCHES) p.push(`a unit baseline has ${BATCHES} batches of ${TASKS_PER_BATCH} tasks`);
  for (const batch of b?.batches ?? []) {
    if ((batch.tasks ?? []).length !== TASKS_PER_BATCH) p.push(`batch ${batch.batch} has ${(batch.tasks ?? []).length} tasks; a unit baseline has ${BATCHES} batches of ${TASKS_PER_BATCH}`);
    for (const t of batch.tasks ?? []) if (typeof t.prompt !== 'string' || !t.prompt || !Array.isArray(t.rubric) || !t.rubric.length) p.push(`task ${t.id} needs a prompt and a rubric`);
  }
  return p;
}

/** Reads and checks a unit baseline file (`<kind>-<name>/baseline.json`); throws with its problems. */
function loadUnitBaseline(file) {
  const b = readJsonFile(file);
  const problems = baselineProblems(b);
  if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
  return b;
}

/**
 * The reasons a unit cannot be read at all, before any judging: an entry agent, an unreachable unit, no frozen baseline,
 * or a baseline frozen on another version of the unit. Returns `{ why: [...], baseline }`.
 */
function blockers({ unit, row, baselinesDir }) {
  const why = [];
  if (row.entry || /^unreachable/.test(row.status)) why.push(row.status);
  const file = path.join(baselinesDir, `${unit.kind}-${unit.name}`, 'baseline.json');
  if (!fs.existsSync(file)) return { why: [...why, `no frozen baseline for ${unit.id}: a person writes 2 batches of 8 tasks with rubrics, and a second person reviews them (${path.relative(BENCH_DIR, file)})`], baseline: null };
  const baseline = loadUnitBaseline(file);
  if (baseline.unit_sha256 !== unit.sha256) why.push(`the unit changed after its baseline was frozen (baseline ${baseline.unit_sha256.slice(0, 12)}, now ${unit.sha256.slice(0, 12)}); a person reviews the tasks against the new text`);
  return { why, baseline };
}

/**
 * Runs one unit's stage on the stub provider and writes `<outDir>/<runId>/stage-<n>/<kind>-<name>.json` and its .md.
 * @param {object} o
 * @param {string} o.kind agent, sop or context
 * @param {string} o.name the unit name
 * @param {string} o.repo the tree under test
 * @param {string} o.runId stub or stub-<name>
 * @param {string} o.outDir where run folders go
 * @param {string} [o.provider] only 'stub'
 * @param {string} [o.baselinesDir] the unit baselines folder
 * @param {string} [o.subjectModel] the agent's model id; [o.judges] judge model ids (three families other than the agent's)
 * @param {number} [o.replicates] runs per arm and task in the deep check
 * @param {object|null} [o.delegation] a stage 2 delegation result (delegation.js), kept beside the effect, never combined
 * @returns {{ record, file, markdown }}
 */
function runUnitStage({ kind, name, repo, runId, outDir, provider = 'stub', baselinesDir = UNIT_BASELINES_DIR, subjectModel = STUB_SUBJECT_MODEL, judges = STUB_JUDGES, replicates = DEFAULT_REPLICATES, delegation = null, createdAt = new Date().toISOString() }) {
  if (kind === 'skill') throw new Error('skills are stage 1: use cap keep-prune');
  if (!STAGE_OF_KIND[kind]) throw new Error(`--kind takes agent, sop or context (got ${JSON.stringify(kind)})`);
  if (provider !== 'stub') throw new Error(`provider ${JSON.stringify(provider)} is not available: stages 2 to 4 have only the stub provider until the owner approves a spend cap`);
  assertStubRun(runId);
  const unit = unitManifest({ repo, kind, name });
  const row = listUnits({ repo, kind, baselinesDir }).find((u) => u.id === unit.id);
  const { why, baseline } = blockers({ unit, row, baselinesDir });
  const blocks = { quick: null, deep: null };
  if (!why.length) {
    const ladder = loadDoseLadder();
    const stub = createStubProvider({ ladder });
    const store = judgmentStore(path.join(outDir, runId, 'judgments'));
    const subject = { name: unit.id, skill: { name: unit.name, text: unit.text }, batches: baseline.batches };
    for (const depth of ['quick', 'deep']) {
      const check = checkDepth({ depth, subject, convention: loadConvention(), ladder, provider: stub, subjectModel, judges, store, replicates });
      blocks[depth] = blockFromCheck(check, { commit: null, runId, provider: stub.name, replicates: depth === 'deep' ? replicates : null });
    }
  }
  const panel = judgePanel({ subjectModel, judges });
  const record = {
    schema: UNIT_SCHEMA_ID, createdAt, stage: STAGE_OF_KIND[kind], kind, name,
    claim: `${CLAIM}, with the ${kind === 'agent' ? 'agent prompt' : kind === 'sop' ? 'SOP' : 'context file'} in place of a skill (stub data: never a measurement)`,
    unit: { files: unit.files, sha256: unit.sha256, estTokens: row.estTokens }, ablation: row.ablation, selection: row.selection,
    listedBy: row.listedBy, panel: { families: JUDGE_FAMILIES, seated: panel.seats, why: panel.why },
    baseline: baseline ? { unitSha256: baseline.unit_sha256, source: baseline.source ?? null } : null, delegation,
    noData: why, quick: blocks.quick, deep: blocks.deep, agree: blocks.quick && blocks.deep ? blocks.quick.verdict === blocks.deep.verdict : null,
    stale: { value: false, why: null }, signoff: { by: null, date: null, decision: null, note: null },
  };
  const file = writeUnitRecord(path.join(outDir, runId, `stage-${record.stage}`, `${kind}-${name}.json`), record);
  const markdown = renderUnitRecord(record);
  fs.writeFileSync(file.replace(/\.json$/, '.md'), markdown);
  return { record, file, markdown };
}

/** Calls of one depth over a subject of `tasks` tasks: { answers, checklists, judgeCalls }. */
function depthCalls(depth, tasks, { replicates, seats }) {
  const answers = depth === 'deep' ? DEEP_ARMS * replicates * tasks : QUICK_ARMS * tasks;
  return { answers, checklists: tasks, judgeCalls: READINGS * seats * answers };
}

const add = (...xs) => xs.reduce((s, x) => ({ answers: s.answers + x.answers, checklists: s.checklists + x.checklists, judgeCalls: s.judgeCalls + x.judgeCalls }), { answers: 0, checklists: 0, judgeCalls: 0 });
const withTotal = (c) => ({ ...c, calls: c.answers + c.checklists + c.judgeCalls });

/**
 * The dry-run estimate of one stage: every model call a run of the stage would make, priced at COSTS. Units that are
 * entry agents or unreachable are not run. The controls (convention control and dose ladder, at each depth) run once
 * per stage. `depths` limits the depths (a pilot is quick only) and `maxUnits` the number of units run. Returns { stage, kind, unitsRun, perUnit, controls, calls, credits: { typical, asAgentRuns, worst }, usd: { typical } }.
 */
function estimateStage({ kind, units, tasks = BATCHES * TASKS_PER_BATCH, replicates = DEFAULT_REPLICATES, seats = JUDGE_FAMILIES, costs = COSTS, depths = ['quick', 'deep'], maxUnits = Infinity }) {
  const run = units.filter((u) => !u.entry && !/^(unreachable|entry agent)/.test(u.status)).slice(0, maxUnits);
  const o = { replicates, seats };
  const perUnit = withTotal(add(...depths.map((d) => depthCalls(d, tasks, o))));
  const convention = loadConvention().batches.reduce((n, b) => n + b.tasks.length, 0);
  const pairs = buildPairs(loadDoseLadder()).length;
  const ladderDepth = { answers: 0, checklists: pairs, judgeCalls: pairs * QUICK_ARMS * seats };
  const controls = withTotal(add(...depths.flatMap((d) => [depthCalls(d, convention, o), ladderDepth])));
  const total = add(...run.map(() => perUnit), controls);
  const t = costs.credits.typical;
  const rest = total.checklists * t.checklist + total.judgeCalls * t.judge;
  const typical = total.answers * t.answer + rest;
  const asAgentRuns = total.answers * costs.credits.agentRunAnswer + rest;
  const usd = total.answers * costs.usd.answer + total.checklists * costs.usd.checklist + total.judgeCalls * costs.usd.judge;
  const calls = total.answers + total.checklists + total.judgeCalls;
  return {
    stage: STAGE_OF_KIND[kind], kind, unitsRun: run.length, perUnit, controls, calls,
    credits: { typical: Math.round(typical), asAgentRuns: Math.round(asAgentRuns), worst: calls * costs.credits.worstPerCall }, usd: { typical: Math.round(usd * 100) / 100 },
  };
}

const fmt = (n) => n.toLocaleString('en-US');

/** The command: `--estimate` prints the free estimate of one stage (or all with no --kind); else runs one unit on the stub. */
function cmdUnitStage(opts) {
  const repo = repoRootOf(opts);
  const kinds = val(opts.kind) ? [val(opts.kind)] : Object.keys(STAGE_OF_KIND);
  if (opts.estimate) {
    const depth = val(opts.depth) ?? 'both';
    const depths = { quick: ['quick'], deep: ['deep'], both: ['quick', 'deep'] }[depth];
    if (!depths) throw new Error(`--depth takes quick, deep or both (got ${JSON.stringify(depth)})`);
    const maxUnits = val(opts['max-units']) === undefined ? Infinity : Number(val(opts['max-units']));
    if (!(maxUnits >= 1)) throw new Error('--max-units takes a whole number of 1 or more');
    for (const kind of kinds) {
      const e = estimateStage({ kind, units: listUnits({ repo, kind }), depths, maxUnits });
      console.log(`stage ${e.stage} (${KIND_LABEL[kind]}): ${e.unitsRun} unit(s) to run, ${fmt(e.calls)} model calls (${fmt(e.perUnit.calls)} per unit, ${fmt(e.controls.calls)} for the controls); about ${fmt(e.credits.typical)} credits typical (${fmt(e.credits.asAgentRuns)} if each answer is a whole agent run), worst case ${fmt(e.credits.worst)} credits at 15 per call; about $${e.usd.typical} USD on Bedrock`);
    }
    return;
  }
  const name = val(opts.unit);
  if (!name || kinds.length !== 1) throw new Error('--kind agent|sop|context and --unit NAME are required (or pass --estimate)');
  const delegation = val(opts.delegation) ? readJsonFile(path.resolve(val(opts.delegation))) : null;
  const r = runUnitStage({ kind: kinds[0], name, repo, runId: val(opts.run) ?? '', outDir: path.resolve(val(opts.out) ?? path.join(BENCH_DIR, 'out', 'unit-stage')), provider: val(opts.provider) ?? 'stub', delegation });
  console.log(`${r.markdown}\nwrote ${r.file} and its .md (stub data: never a measurement)`);
}

/**
 * `cap units`: the unit map of one stage's kind (or all three), as markdown or --json, printed or written to --out.
 * `--coverage FILE` (from `bench.js scenarios coverage`) adds each unit's targeted tasks.
 */
function cmdUnits(opts) {
  const repo = repoRootOf(opts);
  const kinds = val(opts.kind) ? [val(opts.kind)] : Object.keys(STAGE_OF_KIND);
  const coverage = val(opts.coverage) ? readJsonFile(path.resolve(val(opts.coverage))) : null;
  const maps = kinds.map((kind) => ({ kind, units: listUnits({ repo, kind, coverage }) }));
  const text = opts.json ? `${JSON.stringify(maps, null, 2)}\n` : maps.map(renderUnitMap).join('\n');
  if (val(opts.out)) { fs.writeFileSync(path.resolve(val(opts.out)), text); console.log(`wrote ${path.resolve(val(opts.out))}`); } else process.stdout.write(text);
}

module.exports = { COSTS, baselineProblems, loadUnitBaseline, runUnitStage, estimateStage, cmdUnitStage, cmdUnits };
