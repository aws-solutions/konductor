// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js cap unit-stage`: the skeleton of keep-or-prune stages 2 to 4 (agent files, SOPs, always-loaded context), and
// their dry-run cost estimate. A stage runs one unit through the stage 1 pipeline (checkDepth: the same arms, controls,
// judge panel of three families none the agent's, and copied rules), with the unit's text in place of a skill's: the
// with arm has the agent prompt, SOP or context file, the without arm does not. The drop arm a real run would install
// is `cap variant --drop <id>` (units.js). The stub provider needs a stub- run id. The paid kiro provider
// (kiroprovider.js) runs quick depth only, under a credit cap checked before every call, and refuses to start a run
// that could only read NO DATA. A unit is NO DATA until a person writes and reviews its frozen baseline.
// The record is checked against bench/schema/keep-prune-unit-stage.schema.json on write (unitrecord.js).

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { BENCH_DIR } = require('../runner/lib/tasks.js');
const { textFlag: val, repoRootOf } = require('../runner/lib/flag-values.js');
const { loadConvention, loadDoseLadder } = require('./frozen.js');
const { buildPairs } = require('./doseladder.js');
const { checkDepth, judgePanel, judgmentStore, DEFAULT_REPLICATES, JUDGE_FAMILIES, CLAIM } = require('./keepprune.js');
const { blockFromCheck } = require('./kprecord.js');
const { createStubProvider, assertStubRun, isStubRun } = require('./stubprovider.js');
const { STUB_SUBJECT_MODEL, STUB_JUDGES } = require('./kprun.js');
const { STAGE_OF_KIND, KIND_LABEL, UNIT_BASELINES_DIR, PAID_FRAME, listUnits, unitManifest, renderUnitMap } = require('./units.js');
const { readJsonFile } = require('./checkedjson.js');
const { UNIT_SCHEMA_ID, writeUnitRecord, renderUnitRecord } = require('./unitrecord.js');
const { WORST_PER_CALL, ledgerSpent } = require('./paidcall.js');
const { createKiroProvider } = require('./kiroprovider.js');
const { MIN_COUNTED } = require('./labels.js');

const PROVIDERS = ['stub', 'kiro'];
/** The first pilot's models: the agent under test is Claude, so the checklist writer and the judges are not. */
const PILOT_SUBJECT = 'claude-sonnet-5.5';
const PILOT_JUDGES = Object.freeze(['qwen3-coder-next', 'gpt-5.6-luna', 'grok-4.7']);
const PILOT_WRITER = 'glm-5';
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
  credits: Object.freeze({ typical: Object.freeze({ answer: 0.9, checklist: 0.9, judge: 0.5 }), agentRunAnswer: 4.64, worstPerCall: WORST_PER_CALL }),
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
 * Runs one unit's stage and writes `<outDir>/<runId>/stage-<n>/<kind>-<name>.json` and its .md. Judgments and paid
 * replies are saved under `<outDir>/<runId>`, so a rerun of the same run id resumes where it stopped.
 * @param {object} o
 * @param {string} o.kind agent, sop or context
 * @param {string} o.name the unit name
 * @param {string} o.repo the tree under test
 * @param {string} o.runId stub or stub-<name> on the stub; any other id on the paid provider
 * @param {string} o.outDir where run folders go
 * @param {string} [o.provider] 'stub' (default) or 'kiro' (paid, quick depth only)
 * @param {object} [o.paid] the paid provider's spend options { cap, ledger, workDir, bin, authDb } (paidcall.js)
 * @param {string} [o.writerModel] the paid provider's checklist writer
 * @param {string[]} [o.depths] the depths to run, quick and deep by default
 * @param {string} [o.baselinesDir] the unit baselines folder
 * @param {string} [o.subjectModel] the agent's model id; [o.judges] judge model ids (three families other than the agent's)
 * @param {number} [o.replicates] runs per arm and task in the deep check
 * @param {object|null} [o.delegation] a stage 2 delegation result (delegation.js), kept beside the effect, never combined
 * @returns {{ record, file, markdown }}
 */
function runUnitStage({ kind, name, repo, runId, outDir, provider = 'stub', paid = null, writerModel = PILOT_WRITER, depths = ['quick', 'deep'], baselinesDir = UNIT_BASELINES_DIR, subjectModel = STUB_SUBJECT_MODEL, judges = STUB_JUDGES, replicates = DEFAULT_REPLICATES, delegation = null, createdAt = new Date().toISOString() }) {
  if (kind === 'skill') throw new Error('skills are stage 1: use cap keep-prune');
  if (!STAGE_OF_KIND[kind]) throw new Error(`--kind takes agent, sop or context (got ${JSON.stringify(kind)})`);
  if (!PROVIDERS.includes(provider)) throw new Error(`provider ${JSON.stringify(provider)} is not available: stages 2 to 4 have the stub provider and the paid kiro provider`);
  const isPaid = provider === 'kiro';
  if (isPaid) assertPaidRun({ runId, paid, depths, subjectModel, judges }); else assertStubRun(runId);
  const unit = unitManifest({ repo, kind, name });
  const row = listUnits({ repo, kind, baselinesDir }).find((u) => u.id === unit.id);
  const { why, baseline } = blockers({ unit, row, baselinesDir });
  // A paid run that could only read NO DATA spends nothing: it stops before the first call.
  // A paid run also needs the person's sign-off of the baseline (the owner's rule: a person signs off every verdict's tasks).
  const stops = isPaid ? [...why, ...unsignedWhy(unit, baseline)] : [];
  if (stops.length) throw new Error(`no paid call made: ${unit.id} cannot be read (${stops.join('; ')})`);
  const blocks = { quick: null, deep: null };
  // A paid record names the bench commit that made it, so a reader knows which code spent the credits.
  const commit = isPaid ? commitOf(BENCH_DIR) : null;
  if (!why.length) {
    const ladder = loadDoseLadder();
    const model = isPaid ? createKiroProvider({ paid, callsDir: path.join(outDir, runId, 'calls'), writerModel, frame: PAID_FRAME[kind].answer }) : createStubProvider({ ladder });
    const store = judgmentStore(path.join(outDir, runId, 'judgments'));
    const subject = { name: unit.id, skill: { name: unit.name, text: unit.text }, batches: baseline.batches };
    for (const depth of depths) {
      const before = isPaid ? ledgerSpent(paid.ledger) : 0;
      const check = checkDepth({ depth, subject, convention: loadConvention(), ladder, provider: model, subjectModel, judges, store, replicates, stopOnControlFail: isPaid });
      blocks[depth] = blockFromCheck(check, { commit, runId, provider: model.name, replicates: depth === 'deep' ? replicates : null });
      if (isPaid) {
        // Credits as the ledger counts them (each call at the larger of 15 and its real credits); kiro-cli bills no USD.
        blocks[depth].cost = { usd: null, credits: ledgerSpent(paid.ledger) - before };
        const lost = lostJudgmentsWhy(blocks[depth], model.stats);
        if (lost) blocks[depth].noData = [lost, ...blocks[depth].noData];
      }
    }
  }
  const panel = judgePanel({ subjectModel, judges });
  const record = {
    schema: UNIT_SCHEMA_ID, createdAt, stage: STAGE_OF_KIND[kind], kind, name,
    claim: `${CLAIM}, with the ${kind === 'agent' ? 'agent prompt' : kind === 'sop' ? 'SOP' : 'context file'} in place of a skill${isPaid ? ` (paid run ${runId}, ${depths.join(' and ')} depth)` : ' (stub data: never a measurement)'}`,
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

/**
 * The flag for a paid block whose reading A counted fewer than MIN_COUNTED tasks while judge replies were lost
 * (unreadable after their one re-ask), or null. Without it such a block reads only "NO DATA" and hides the cause.
 */
function lostJudgmentsWhy(block, stats) {
  if (!stats?.lost || block.coverage.tasksCounted >= MIN_COUNTED) return null;
  return `FLAG: only ${block.coverage.tasksCounted} of ${block.coverage.tasksTotal} tasks counted, under the floor of ${MIN_COUNTED}, and ${stats.lost} judge repl${stats.lost === 1 ? 'y' : 'ies'} could not be read after one re-ask (${stats.reasked} re-asked in all); this is a judge problem, not a reading of the unit`;
}

/** The commit of the checkout `repo`, or null outside git. */
function commitOf(repo) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/**
 * Throws unless a paid run can start: a run id that is not a stub id, a spend cap, ledger and work dir, quick depth
 * only (the paid provider makes one-turn answers), and a full judge panel (three families, none the agent's), so no
 * call is spent on a run that could only read NO DATA.
 */
function assertPaidRun({ runId, paid, depths, subjectModel, judges }) {
  if (!/^[A-Za-z0-9._-]+$/.test(String(runId)) || isStubRun(runId)) throw new Error(`a paid run needs its own run id, not a stub one (got ${JSON.stringify(runId)})`);
  if (!paid || !(paid.cap > 0) || !paid.ledger || !paid.workDir) throw new Error('a paid run needs --cap N (credits), --ledger FILE and --work DIR');
  if (depths.length !== 1 || depths[0] !== 'quick') throw new Error('the paid provider runs quick depth only (--depth quick)');
  const panel = judgePanel({ subjectModel, judges });
  if (panel.why) throw new Error(`no paid call made: ${panel.why}`);
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
  // The ladder pairs carry their own rubric, so writeChecklist makes no call for them (checklists 0).
  const ladderDepth = { answers: 0, checklists: 0, judgeCalls: pairs * QUICK_ARMS * seats };
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
  const provider = val(opts.provider) ?? 'stub';
  const depthFlag = val(opts.depth) ?? (provider === 'kiro' ? 'quick' : 'both');
  const depths = { quick: ['quick'], deep: ['deep'], both: ['quick', 'deep'] }[depthFlag];
  if (!depths) throw new Error(`--depth takes quick, deep or both (got ${JSON.stringify(depthFlag)})`);
  const judges = val(opts.judges) ? val(opts.judges).split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const paid = provider === 'kiro' ? {
    cap: Number(val(opts.cap)), ledger: val(opts.ledger) && path.resolve(val(opts.ledger)), workDir: val(opts.work) && path.resolve(val(opts.work)),
    ...(val(opts['kiro-bin']) ? { bin: val(opts['kiro-bin']) } : {}), ...(val(opts['auth-db']) ? { authDb: path.resolve(val(opts['auth-db'])) } : {}),
  } : null;
  const models = provider === 'kiro' ? { subjectModel: val(opts.model) ?? PILOT_SUBJECT, judges: judges ?? [...PILOT_JUDGES] } : {};
  const baselinesDir = val(opts.baselines) ? path.resolve(val(opts.baselines)) : UNIT_BASELINES_DIR;
  if (opts['dry-run']) return printUnitPlan({ kind: kinds[0], name, repo, depths, paid, baselinesDir, ...models });
  const delegation = val(opts.delegation) ? readJsonFile(path.resolve(val(opts.delegation))) : null;
  const r = runUnitStage({ kind: kinds[0], name, repo, runId: val(opts.run) ?? '', outDir: path.resolve(val(opts.out) ?? path.join(BENCH_DIR, 'out', 'unit-stage')), provider, paid, depths, baselinesDir, delegation, ...models });
  console.log(`${r.markdown}\nwrote ${r.file} and its .md${provider === 'stub' ? ' (stub data: never a measurement)' : ''}`);
  for (const [depth, b] of Object.entries({ quick: r.record.quick, deep: r.record.deep })) {
    for (const w of (b?.noData ?? []).filter((x) => /^FLAG: |the unit was not run/.test(x))) console.error(`${depth}: ${w}`);
  }
}

/**
 * The free plan of one unit's run (`--dry-run`): the calls by kind, the worst case at 15 per call, the ledger's spend
 * against the cap, the judge panel, and anything that would stop the run before its first call. Makes no call.
 */
function printUnitPlan({ kind, name, repo, depths, paid, baselinesDir = UNIT_BASELINES_DIR, subjectModel = STUB_SUBJECT_MODEL, judges = STUB_JUDGES }) {
  const unit = unitManifest({ repo, kind, name });
  const row = listUnits({ repo, kind, baselinesDir }).find((u) => u.id === unit.id);
  const e = estimateStage({ kind, units: [row], depths });
  const { why, baseline } = blockers({ unit, row, baselinesDir });
  const panel = judgePanel({ subjectModel, judges });
  const spent = paid?.ledger ? ledgerSpent(paid.ledger) : 0;
  const convention = loadConvention().batches.reduce((n, b) => n + b.tasks.length, 0);
  const pairs = buildPairs(loadDoseLadder()).length;
  const lines = [
    `dry run, no call made: ${unit.id} at ${depths.join(' and ')} depth, agent ${subjectModel}, judges ${panel.seats.join(', ') || 'none seated'}`,
    `calls: ${fmt(e.calls)} (${fmt(e.perUnit.calls)} for the unit, ${fmt(e.controls.calls)} for the controls); worst case ${fmt(e.credits.worst)} credits at ${WORST_PER_CALL} per call; about ${fmt(e.credits.typical)} credits typical`,
    `controls loaded: convention control (${convention} tasks) and dose ladder (${pairs} pairs)`,
  ];
  if (paid) lines.push(`ledger ${paid.ledger ?? '(none given)'}: spent ${spent}; cap ${Number.isFinite(paid.cap) ? paid.cap : '(none given)'}; ${spent + e.credits.worst <= paid.cap ? 'the worst case fits' : 'the worst case does not fit: the run stops at the cap and a rerun with a larger cap resumes it'}`);
  if (baseline) lines.push(`baseline ${baseline.unit_sha256 === unit.sha256 ? 'fresh' : 'stale'}, signed off by ${signedOffBy(baseline) ?? 'nobody yet'}`);
  for (const w of [panel.why, ...why, ...(paid ? unsignedWhy(unit, baseline) : [])].filter(Boolean)) lines.push(`would stop before the first call: ${w}`);
  console.log(lines.join('\n'));
}

/** Who signed off baseline `b` (its `source.signedOffBy`, a name), or null. */
const signedOffBy = (b) => (typeof b?.source?.signedOffBy === 'string' && b.source.signedOffBy.trim() ? b.source.signedOffBy.trim() : null);

/** The reason a paid run of `unit` may not use `baseline` yet: a frozen baseline no person has signed off. */
const unsignedWhy = (unit, baseline) => (baseline && !signedOffBy(baseline) ? [`the baseline of ${unit.id} is not signed off: a person who did not write its tasks reads them and sets source.signedOffBy`] : []);

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

module.exports = { COSTS, commitOf, PILOT_SUBJECT, PILOT_JUDGES, PILOT_WRITER, baselineProblems, loadUnitBaseline, runUnitStage, estimateStage, cmdUnitStage, cmdUnits };
