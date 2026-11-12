// SPDX-License-Identifier: Apache-2.0
'use strict';

// Command handlers for judge, report, compare and calibrate. bench.js dispatches here.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTasks, loadSuite, suiteExtraDirs, mergeExtraDirs, realDir, BENCH_DIR } = require('./lib/tasks.js');
const sandbox = require('./lib/sandbox.js');
const { DEFAULTS, MIN_PANEL_FAMILIES, checkPanel, checkJudgeModel, families, modelFamily } = require('../judge/config.js');
const { resolveIsolation } = require('./lib/isolate.js');
const procs = require('./lib/procs.js');
const { loadRedactions } = require('../judge/redact.js');
const { makeKiroCaller, makeCmdCaller } = require('../judge/model.js');
const { makeOpencodeCaller } = require('../judge/opencode.js');
const { BACKENDS, DEFAULT_BACKEND, checkOpencodeJudges } = require('../judge/backends.js');
const oc = require('./lib/harness/opencode.js');
const { readProfile } = require('./lib/harness/opencode-creds.js');
const { runJudging, planJudging } = require('../judge/run.js');
const { rescoreQuotes, formatRescore } = require('../judge/rescore.js');
const { checkRule } = require('../judge/views.js');
const { DEFAULT_QUOTE_RULE, RULE_TEXT } = require('../judge/quote.js');
const { loadPack } = require('../judge/pack/index.js');
const { runPackJudging, describePackPlan, FILE } = require('../judge/packrun.js');
const { exportSheet, scoreLabels, scorePackLabels, formatCalibration, formatPackCalibration } = require('../judge/calibrate.js');
const { loadRun, loadRuns } = require('../report/load.js');
const { generateRunReport, generateContrast, useScoringQuoteRule } = require('../report/generate.js');
const { generateVerdict, KINDS } = require('../report/verdictgen.js');
const { buildReport, defaultBaseline } = require('../report/aggregate.js');
const { loadScoring } = require('../report/scores.js');
const { renderMarkdown } = require('../report/render.js');
const { explainRuns } = require('../report/explain.js');
const { buildTrace, renderMarkdown: renderTrace, locateRun } = require('./lib/trace.js');
const { recheckAll } = require('./lib/recheck.js');
const { backfillAll } = require('./lib/backfill.js');
const { backfillSkills, summarizeSkillsBackfill, renderSkillsBackfill } = require('./lib/backfill-skills.js');
const { collectRows, summarizeSkills, renderSkillsMarkdown } = require('../report/skills.js');
const { compareRuns, formatCompare } = require('../report/compare.js');
const { contrastRun, renderContrast } = require('../report/contrast.js');
const { optionalProfile, profileCheck, writeCalibrationSample } = require('./lib/profiles.js');
const { buildFactorial, renderFactorial, factorialCharts, SPECS: FACTORIAL_CELLS } = require('../report/factorial.js');
const { toMarkdown } = require('../report/doc.js');
const { MODES: JUDGE_MODES } = require('../judge/config.js');

// One judge per model family: gpt, deepseek, glm. Override with --judges (qwen3-coder-next, minimax-m2.5 also work).
const DEFAULT_JUDGES = ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'];

function need(opts, name) {
  if (!opts[name] || opts[name] === true) throw new Error(`--${name} is required`);
  return opts[name];
}

function numOpt(opts, name, fallback, { int = false, min = 0 } = {}) {
  if (opts[name] === undefined) return fallback;
  const n = Number(opts[name]);
  if (!Number.isFinite(n) || n <= min || (int && !Number.isInteger(n))) throw new Error(`--${name} must be a${int ? ' positive integer' : ' positive number'}`);
  return n;
}

function seedOf(opts) {
  const n = opts.seed === undefined ? 1 : Number(opts.seed);
  if (!Number.isInteger(n)) throw new Error('--seed must be an integer');
  return n;
}

const benchDirOf = (opts) => (opts['bench-dir'] ? path.resolve(opts['bench-dir']) : BENCH_DIR);
// Extra task directories (--extra-tasks), resolved; empty when the flag is absent.
const extraDirsOf = (opts) => (opts['extra-tasks'] && opts['extra-tasks'] !== true ? String(opts['extra-tasks']).split(',').filter(Boolean).map(realDir) : []);

function limitsOf(opts) {
  return {
    maxFileChars: numOpt(opts, 'max-file-chars', DEFAULTS.limits.maxFileChars, { int: true }),
    maxBundleChars: numOpt(opts, 'max-bundle-chars', DEFAULTS.limits.maxBundleChars, { int: true }),
  };
}

// Which limits the user set on the command line; those beat a task's own bundleLimits.
function explicitLimitsOf(opts) {
  return { maxFileChars: opts['max-file-chars'] !== undefined, maxBundleChars: opts['max-bundle-chars'] !== undefined };
}

// Taken in this order to replace a judge dropped for sharing the subject's family.
const SUBSTITUTE_JUDGES = ['deepseek-3.2', 'glm-5', 'qwen3-coder-next', 'minimax-m2.5'];

// A default or suite panel never keeps a judge from the subject's own family: it is dropped and replaced from SUBSTITUTE_JUDGES
// (one per family, never Claude), so a panel for a GPT subject becomes deepseek, glm and qwen. Judges named with --judges are not changed.
function adaptPanel(judges, subjectModel) {
  if (!subjectModel) return { judges };
  const subject = modelFamily(subjectModel);
  const kept = judges.filter((j) => modelFamily(j) !== subject);
  const dropped = judges.filter((j) => modelFamily(j) === subject);
  if (!dropped.length) return { judges };
  const added = [];
  for (const cand of SUBSTITUTE_JUDGES) {
    if (kept.length + added.length >= judges.length) break;
    const fam = modelFamily(cand);
    if (fam === subject || fam === 'claude' || [...kept, ...added].some((j) => modelFamily(j) === fam)) continue;
    added.push(cand);
  }
  return { judges: [...kept, ...added], substituted: { dropped, added } };
}

// --judges wins, then the suite file, then the default three-family panel. Fewer than three
// distinct families is refused unless --allow-small-panel is passed.
function resolveJudges({ cliJudges, suiteJudges, subjectModel = null, allowSmallPanel = false }) {
  let judges = cliJudges ? String(cliJudges).split(',').filter(Boolean) : null;
  let substituted;
  if (!judges) {
    const adapted = adaptPanel(suiteJudges && suiteJudges.length ? suiteJudges : DEFAULT_JUDGES, subjectModel);
    judges = adapted.judges;
    substituted = adapted.substituted;
  }
  judges.forEach((j) => checkJudgeModel(j, subjectModel));
  checkPanel(judges, { minFamilies: allowSmallPanel ? 1 : MIN_PANEL_FAMILIES });
  return { judges, small: families(judges).length < MIN_PANEL_FAMILIES, ...(substituted ? { substituted } : {}) };
}

const flagValue = (opts, name) => (opts[name] !== undefined && opts[name] !== true ? String(opts[name]) : null);

// The opencode backend: one `opencode run` per judge call on Bedrock, tools off, credentials from a shared-credentials file.
function makeOpencodeJudgeCaller(opts, { timeoutMs, rawDir }) {
  const credsFile = path.resolve(need(opts, 'aws-creds-file'));
  const awsProfile = flagValue(opts, 'aws-profile') ?? 'bench';
  const region = flagValue(opts, 'aws-region') ?? oc.REGION;
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error(`--aws-region "${region}" is not an AWS region name`);
  readProfile(credsFile, awsProfile);
  const cacheDir = path.resolve(flagValue(opts, 'cache') ?? path.join(os.tmpdir(), 'b-cache'));
  const resolved = oc.resolveOpencode({ cacheDir, binOverride: flagValue(opts, 'opencode-bin') });
  return makeOpencodeCaller({ bin: resolved.bin, version: resolved.version, sha256: resolved.sha256, credsFile, awsProfile, region, timeoutMs, rawDir });
}

// The run and the judge panel for a judge command (rubric pass or quality pack).
function judgePanelFor(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const benchDir = benchDirOf(opts);
  const run = loadRun(runDir);
  let suiteJudges = [];
  try { suiteJudges = loadSuite(run.config.suite, loadTasks(benchDir, { extraDirs: mergeExtraDirs(suiteExtraDirs(run.config.suite, benchDir), extraDirsOf(opts)) }), benchDir).judges; } catch { /* run without a known suite */ }
  const { judges, small, substituted } = resolveJudges({ cliJudges: opts.judges, suiteJudges, subjectModel: run.config.model ?? null, allowSmallPanel: Boolean(opts['allow-small-panel']) });
  if (substituted) console.log(`subject ${run.config.model}: judge panel dropped ${substituted.dropped.join(', ')}, added ${substituted.added.join(', ') || 'nothing'} (a judge from the subject's own family is not used)`);
  return { runDir, benchDir, run, judges, small };
}

// The backend a judge command uses, after checking the flags that go with it. Builds no caller and reads no credentials.
function judgeBackendOf(opts, judges) {
  const backend = opts['judge-backend'] === undefined ? DEFAULT_BACKEND : opts['judge-backend'];
  if (!BACKENDS.includes(backend)) throw new Error(`--judge-backend takes ${BACKENDS.join(' or ')}`);
  const viaOpencode = backend === 'opencode';
  if (viaOpencode && opts['judge-cmd']) throw new Error('--judge-cmd and --judge-backend opencode cannot be used together');
  if (viaOpencode && opts['budget-credits'] !== undefined) throw new Error('--budget-credits does not apply to the opencode backend; use --budget-usd');
  if (!viaOpencode && opts['budget-usd'] !== undefined) throw new Error('--budget-usd applies to the opencode backend only; use --budget-credits');
  if (viaOpencode) checkOpencodeJudges(judges);
  return { backend, viaOpencode };
}

// One line naming where the calls go and who answers them, printed before any call (and in a plan).
function backendLine(opts, { backend, viaOpencode }, judges) {
  const how = viaOpencode ? 'opencode on Bedrock, spend in USD' : (opts['judge-cmd'] || process.env.BENCH_JUDGE_CMD) ? 'a --judge-cmd command, spend as the command reports it' : 'kiro-cli, spend in credits';
  return `backend: ${backend} (${how}); panel: ${judges.join(', ')} (${families(judges).length} model families)`;
}

// The model caller for a judge command: opencode on Bedrock, a --judge-cmd, or kiro-cli. Checks the backend flags first.
function judgeCallerFor(opts, { runDir, judges }) {
  const timeoutMs = numOpt(opts, 'judge-timeout-sec', DEFAULTS.timeoutSec) * 1000;
  const { backend, viaOpencode } = judgeBackendOf(opts, judges);
  const judgeCmd = opts['judge-cmd'] || (viaOpencode ? undefined : process.env.BENCH_JUDGE_CMD);
  if (opts.plan) throw new Error('--plan was given but this judge path would make model calls; nothing was run (this is a bench bug, please report it)');
  const log = (m) => console.error(`[judge ${new Date().toISOString().slice(11, 19)}] ${m}`);
  log(backendLine(opts, { backend, viaOpencode }, judges));
  let caller;
  if (viaOpencode) {
    caller = makeOpencodeJudgeCaller(opts, { timeoutMs, rawDir: path.join(runDir, 'judge', 'raw') });
    log(`backend: opencode ${caller.info.opencodeVersion}, ${caller.info.region}, system prompt sha256 ${caller.info.systemPromptSha256.slice(0, 12)}`);
  } else if (judgeCmd) {
    caller = makeCmdCaller(String(judgeCmd), { timeoutMs });
  } else {
    const authDb = opts['auth-db'] ? path.resolve(opts['auth-db']) : sandbox.defaultAuthDb();
    if (!fs.existsSync(authDb)) throw new Error(`kiro-cli auth database not found: ${authDb} (log in with kiro-cli first)`);
    const isolation = resolveIsolation(opts.isolate || 'auto');
    log(`isolation: ${isolation.mode} (${isolation.reason})`);
    const hide = [...String(opts.hide || '').split(',').filter(Boolean), ...String(process.env.BENCH_HIDE_EXTRA || '').split(',').filter(Boolean)];
    caller = makeKiroCaller({
      authDb, timeoutMs, isolation: { mode: isolation.mode, hide }, rawDir: path.join(runDir, 'judge', 'raw'),
      ...(opts['kiro-bin'] ? { kiroBin: path.resolve(opts['kiro-bin']) } : {}),
    });
  }
  return { caller, backend, viaOpencode, log };
}

// The pack named by --criteria-pack, or null when the flag is absent.
const packOf = (opts) => (opts['criteria-pack'] === undefined ? null : loadPack(opts['criteria-pack']));

async function cmdJudge(opts) {
  if (opts['rescore-quotes']) return cmdRescoreQuotes(opts);
  const quoteRule = checkRule(flagValue(opts, 'quote-match') ?? DEFAULT_QUOTE_RULE);
  const { runDir, benchDir, run, judges, small } = judgePanelFor(opts);
  const packName = opts['criteria-pack'];
  if (packName !== undefined) {
    if (opts['quote-match'] !== undefined) throw new Error('--quote-match does not apply with --criteria-pack: the pack pass always matches quotes strictly');
    return cmdJudgePack(opts, { runDir, benchDir, run, judges, small });
  }
  const profile = optionalProfile(opts.profile);
  const modes = String(opts.mode || (profile ? profile.judging.modes.join(',') : 'rubric,pairwise')).split(',');
  if (modes.some((m) => !JUDGE_MODES.includes(m))) throw new Error(`--mode takes ${JUDGE_MODES.join(', ')}`);
  const baseline = opts.baseline && opts.baseline !== true ? opts.baseline : defaultBaseline(run);
  const arms = [...new Set(run.runs.map((r) => r.armId))];
  if ((modes.includes('pairwise') || modes.includes('graded')) && !arms.includes(baseline)) throw new Error(`baseline arm "${baseline}" has no runs in ${runDir} (arms present: ${arms.join(', ')}); pass --baseline ARM or --mode rubric`);
  if (opts.plan) return printJudgePlan(opts, { runDir, benchDir, judges, modes, baseline });
  const { caller, backend, viaOpencode, log } = judgeCallerFor(opts, { runDir, judges });
  // Calls that finished are cached on disk, so an interrupted judge phase loses only the calls in flight.
  const removeHandlers = procs.installSignalHandlers({ flush: () => {}, log });
  let j;
  try {
    j = await runJudging({
      runDir, benchDir, extraDirs: extraDirsOf(opts), judges, modes, baseline, caller, smallPanel: small,
      concurrency: numOpt(opts, 'concurrency', DEFAULTS.concurrency, { int: true }),
      budgetCredits: opts['budget-credits'] === undefined ? null : numOpt(opts, 'budget-credits', null),
      budgetUsd: opts['budget-usd'] === undefined ? null : numOpt(opts, 'budget-usd', null),
      backend, quoteRule, ...(viaOpencode ? { backendInfo: { ...caller.info, models: caller.info.models(judges) }, cacheSalt: caller.cacheSalt } : {}),
      limits: limitsOf(opts), explicitLimits: explicitLimitsOf(opts), redactions: loadRedactions(opts['redact-file']), log,
    });
  } finally {
    removeHandlers();
    procs.removeAllScratch();
  }
  const recs = [...j.rubric, ...j.pairwise];
  const errors = recs.filter((r) => r.judgeError);
  const last = j.invocations[j.invocations.length - 1];
  const spend = viaOpencode ? `live spend $${last.spentUsd.toFixed(4)} USD (all invocations: $${j.spentUsd.toFixed(4)}), 0 credits` : `live spend ${last.spentCredits.toFixed(3)} credits (all invocations: ${j.spentCredits.toFixed(3)})`;
  console.log(`judged ${j.rubric.length} rubric, ${j.pairwise.length} pairwise and ${j.graded.length} graded record(s); ${errors.length + j.graded.filter((r) => r.judgeError).length} with judgeError; ${spend}; ${j.notJudged.length} run(s) not judged`);
  if (small) console.log(`warning: panel has fewer than ${MIN_PANEL_FAMILIES} model families (--allow-small-panel)`);
  console.log(j.ledgerLine);
  if (j.guardState === 'hard') {
    console.error(viaOpencode
      ? 'usd guard: HARD STOP, this command spent past 100% of --budget-usd; calls in flight were counted, and no further call started'
      : 'credit guard: HARD STOP, this command spent past 100% of --budget-credits; calls in flight were counted, and no further call started');
    process.exitCode = 3;
  }
  console.log(`evidence-quote rule recorded as the default: ${RULE_TEXT[quoteRule]}; the other rule's verdicts are recorded beside it`);
  console.log(`wrote ${path.join(runDir, 'judgments.json')}`);
}

// `judge --criteria-pack NAME`: the quality-dimensions pass. It reads the run and writes judgments-quality.json only.
const money = (e, v) => (e.unit === 'usd' ? `$${v.toFixed(4)} USD` : `${v.toFixed(2)} credits`);

// The last lines of every plan: cache hits, the estimate and the statement that nothing ran.
function planTail(d) {
  const lines = [];
  lines.push(`already cached: ${d.cached} of ${d.calls} (free); live calls: ${d.live}${d.tooLarge ? `; ${d.tooLarge} prompt(s) too large to send (they would be recorded as errors)` : ''}`);
  const e = d.estimate;
  if (e.total === null) lines.push(`estimated spend: ${e.basis}`);
  else if (d.live === 0) lines.push('estimated spend: none, there are no live calls to pay for');
  else if (e.high === null || e.high <= e.low) lines.push(`estimated spend: about ${money(e, e.low)} for ${d.live} live call(s) at ${money(e, e.perCall)} each, from ${e.basis}; no spread is known; a reply that fails validation is asked once more`);
  else lines.push(`estimated spend: low ${money(e, e.low)} (mean), high ${money(e, e.high)} (every call at its p90, an upper bound) for ${d.live} live call(s), from ${e.basis}; a reply that fails validation is asked once more, and observed figures include those asks`);
  lines.push('nothing was called and nothing was written');
  return lines.join('\n');
}

// judge --rescore-quotes: the evidence check of stored rubric verdicts, matched again with no model call.
async function cmdRescoreQuotes(opts) {
  const mode = flagValue(opts, 'quote-match') ?? 'lenient';
  for (const f of ['plan', 'judges', 'mode', 'baseline', 'profile', 'criteria-pack', 'judge-backend', 'judge-cmd', 'budget-credits', 'budget-usd']) {
    if (opts[f] !== undefined) throw new Error(`--${f} does not apply with --rescore-quotes: it calls no model and writes judgments-lenient.json only`);
  }
  const runDir = path.resolve(need(opts, 'run'));
  const r = rescoreQuotes({ runDir, benchDir: benchDirOf(opts), extraDirs: extraDirsOf(opts), redactions: loadRedactions(opts['redact-file']), mode });
  console.log(formatRescore(r));
  console.log('');
  console.log(`${r.changed} rubric record(s) changed under ${mode} matching${r.skipped.length ? `; ${r.skipped.length} record(s) kept as stored (run or task not found)` : ''}`);
  console.log(r.file ? `wrote ${r.file}; judgments.json was not changed. Report with a scoring file that sets "quotes": "lenient" (profiles/scoring-lenient-quotes.json)` : 'strict check only: nothing written');
}

// judge --plan for the rubric, pairwise and graded modes: the same preparation as the pass, no caller.
function printJudgePlan(opts, { runDir, benchDir, judges, modes, baseline }) {
  const chosen = judgeBackendOf(opts, judges);
  const d = planJudging({
    runDir, benchDir, extraDirs: extraDirsOf(opts), judges, modes, baseline, backend: chosen.backend,
    limits: limitsOf(opts), explicitLimits: explicitLimitsOf(opts), redactions: loadRedactions(opts['redact-file']),
    budgetCredits: opts['budget-credits'] === undefined ? null : numOpt(opts, 'budget-credits', null),
    budgetUsd: opts['budget-usd'] === undefined ? null : numOpt(opts, 'budget-usd', null),
  });
  console.log(`judge plan for ${runDir}`);
  console.log(backendLine(opts, chosen, judges));
  console.log(`modes: ${modes.join(', ')}${modes.some((m) => m !== 'rubric') ? `; baseline arm: ${baseline}` : ''}`);
  console.log(`runs: ${d.runs} to judge, ${d.notJudged.length} not judged${d.notJudged.length ? ` (${d.notJudged.map((n) => `${n.armId}|${n.taskId}|${n.replicate}: ${n.reason}`).join('; ')})` : ''}`);
  if (d.unpaired) console.log(`${d.unpaired} comparison(s) have no baseline run and would be recorded as errors`);
  console.log(`calls: ${d.calls} (rubric ${d.byMode.rubric}, pairwise ${d.byMode.pairwise}, graded ${d.byMode.graded}) = ${judges.length} judge(s) x the runs and modes above`);
  console.log(planTail(d));
}

async function cmdJudgePack(opts, { runDir, benchDir, run, judges, small }) {
  for (const f of ['mode', 'baseline', 'profile']) if (opts[f] !== undefined) throw new Error(`--${f} does not apply with --criteria-pack: the pack pass has its own prompt and no pairwise or graded mode`);
  const thePack = loadPack(opts['criteria-pack']);
  const limits = limitsOf(opts);
  const explicitLimits = explicitLimitsOf(opts);
  const redactions = loadRedactions(opts['redact-file']);
  if (opts.plan) {
    const chosen = judgeBackendOf(opts, judges);
    const d = describePackPlan({ run, tasks: loadTasks(benchDir, { extraDirs: extraDirsOf(opts) }), benchDir, limits, explicitLimits, redactions, thePack, judges, backend: chosen.backend });
    console.log(`judge plan for ${runDir}: quality pack ${thePack.id}, revision ${thePack.revision}`);
    console.log(backendLine(opts, chosen, judges));
    for (const p of d.plan) console.log(`${p.run.armId}|${p.run.taskId}|${p.run.replicate}: ${p.judged} judged, ${p.auto} counted by program, ${p.absent} scored fail (artifact not produced), ${p.na} n/a`);
    for (const n of d.notJudged) console.log(`${n.armId}|${n.taskId}|${n.replicate}: not judged (${n.reason})`);
    console.log(`pack ${thePack.id} revision ${thePack.revision}: ${d.calls} judge call(s) for ${d.plan.filter((p) => p.calls).length} run(s) x ${judges.length} judge(s) (${judges.join(', ')})`);
    console.log(planTail(d));
    return;
  }
  const { caller, backend, viaOpencode, log } = judgeCallerFor(opts, { runDir, judges });
  const removeHandlers = procs.installSignalHandlers({ flush: () => {}, log });
  let j;
  try {
    j = await runPackJudging({
      runDir, benchDir, extraDirs: extraDirsOf(opts), judges, caller, pack: thePack,
      concurrency: numOpt(opts, 'concurrency', DEFAULTS.concurrency, { int: true }),
      budgetCredits: opts['budget-credits'] === undefined ? null : numOpt(opts, 'budget-credits', null),
      budgetUsd: opts['budget-usd'] === undefined ? null : numOpt(opts, 'budget-usd', null),
      backend, ...(viaOpencode ? { backendInfo: { ...caller.info, models: caller.info.models(judges) }, cacheSalt: caller.cacheSalt } : {}),
      limits, explicitLimits, redactions, log,
    });
  } finally {
    removeHandlers();
    procs.removeAllScratch();
  }
  const last = j.invocations[j.invocations.length - 1];
  const spend = viaOpencode ? `live spend $${last.spentUsd.toFixed(4)} USD (all invocations: $${j.spentUsd.toFixed(4)}), 0 credits` : `live spend ${last.spentCredits.toFixed(3)} credits (all invocations: ${j.spentCredits.toFixed(3)})`;
  console.log(`quality pack ${thePack.id}: ${j.records.length} record(s), ${j.records.filter((r) => r.judgeError).length} with judgeError; ${spend}; ${j.notJudged.length} run(s) not judged`);
  if (small) console.log(`warning: panel has fewer than ${MIN_PANEL_FAMILIES} model families (--allow-small-panel)`);
  console.log(j.ledgerLine);
  if (j.guardState === 'hard') {
    console.error(viaOpencode ? 'usd guard: HARD STOP, this command spent past 100% of --budget-usd; no further call started' : 'credit guard: HARD STOP, this command spent past 100% of --budget-credits; no further call started');
    process.exitCode = 3;
  }
  console.log(`wrote ${path.join(runDir, FILE)}`);
}

function cmdRecheck(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const dryRun = Boolean(opts['dry-run']);
  const out = recheckAll({ runDir, benchDir: benchDirOf(opts), extraDirs: extraDirsOf(opts), dryRun });
  const tally = (checks) => (checks ? `${checks.filter((c) => c.passed).length}/${checks.length}` : '-');
  for (const r of out) {
    const note = r.status === 'skipped' ? ` (${r.reason})` : '';
    console.log(`${r.armId}/${r.taskId}/${r.replicate}: ${r.status}${note}; checks ${tally(r.before)} -> ${tally(r.after)}`);
  }
  const n = (s) => out.filter((r) => r.status === s).length;
  console.log(`${dryRun ? 'would recheck' : 'rechecked'} ${n('rechecked')}, unchanged ${n('unchanged')}, skipped ${n('skipped')}`);
}

function backfillCredits(runDir, write) {
  const out = backfillAll({ runDir, write });
  for (const r of out) {
    const label = `${r.armId}/${r.taskId}/${r.replicate}`;
    if (r.status === 'recovered') console.log(`${label}: recovered; credits ${r.before == null ? 'n/a' : r.before} -> ${r.credits.toFixed(4)}`);
    else if (r.status === 'unrecoverable') console.log(`${label}: unrecoverable (${r.reason})${r.note ? `; ${r.note}` : ''}`);
    else if (r.status === 'skipped') console.log(`${label}: skipped (${r.reason})`);
  }
  const of = (status) => out.filter((r) => r.status === status);
  const total = of('recovered').reduce((n, r) => n + r.credits, 0).toFixed(4);
  const tail = `already complete ${of('complete').length}, unrecoverable ${of('unrecoverable').length}, skipped ${of('skipped').length}`;
  if (write) console.log(`recovered ${of('recovered').length} (${total} credits), ${tail}`);
  else console.log(`dry run, nothing written: would recover ${of('recovered').length} (${total} credits), ${tail}. Pass --write to apply.`);
}

function backfillSkillFields(opts, runDir, write) {
  const benchDir = benchDirOf(opts);
  const guess = path.resolve(benchDir, '..');
  const repoRoot = opts['repo-root'] && opts['repo-root'] !== true ? path.resolve(opts['repo-root']) : fs.existsSync(path.join(guess, 'agent-sops')) ? guess : null;
  const out = backfillSkills({ runDir, write, tasks: loadTasks(benchDir, { extraDirs: extraDirsOf(opts) }), repoRoot });
  for (const r of out) {
    const label = `${r.armId}/${r.taskId}/${r.replicate}`;
    if (r.status === 'changed') console.log(`${label}: ${write ? 'changed' : 'would change'} skill fields${r.killed ? ' (killed or timed out; credits untouched)' : ''}`);
    else if (r.status === 'unrecoverable') console.log(`${label}: unrecoverable (${r.reason})`);
    else if (r.status === 'skipped') console.log(`${label}: skipped (${r.reason})`);
  }
  const of = (status) => out.filter((r) => r.status === status);
  const summary = summarizeSkillsBackfill(out);
  console.log(`\nSkill loads per arm, before -> after (listing for SOP and skill names: ${repoRoot ?? 'none, naming convention'})\n${renderSkillsBackfill(summary)}\n`);
  const killed = summary.killed ? ` (${summary.killed} of them killed or timed out)` : '';
  const tail = `unchanged ${of('unchanged').length}, unrecoverable ${of('unrecoverable').length}, skipped ${of('skipped').length}`;
  if (write) console.log(`changed ${of('changed').length}${killed}, ${tail}`);
  else console.log(`dry run, nothing written: would change ${of('changed').length} runs${killed}, ${tail}. Pass --write to apply.`);
}

// No mode flag means --credits, as before --skills existed.
function cmdBackfill(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const write = Boolean(opts.write);
  const skillsMode = Boolean(opts.skills);
  if (opts.credits || !skillsMode) backfillCredits(runDir, write);
  if (skillsMode) backfillSkillFields(opts, runDir, write);
}

// --run takes one directory, or several separated by commas that are merged into one run.
const runDirsOf = (opts) => String(need(opts, 'run')).split(',').filter(Boolean).map((d) => path.resolve(d));
// --phases takes phase ids, comma separated, or "all"; absent means the phase-document rows are left out.
function phasesOf(opts) {
  if (opts.phases === undefined) return null;
  if (opts.phases === true) throw new Error('--phases takes phase ids separated by commas, or all');
  return opts.phases === 'all' ? 'all' : String(opts.phases).split(',').filter(Boolean);
}
const scoringOf = (opts) => (opts.scoring && opts.scoring !== true ? path.resolve(opts.scoring) : undefined);

function printWritten(written) {
  const charts = written.filter((w) => w.endsWith('.svg'));
  for (const w of written.filter((x) => !x.endsWith('.svg'))) console.log(`wrote ${w}`);
  if (charts.length) console.log(`wrote ${charts.length} chart(s) in ${path.dirname(charts[0])}`);
}

// One page per verdict kind. platform: a keep, discard or not-enough-evidence call per arm. orchestrator-pass: a pass, fail or
// not-enough-evidence call per arm and (harness, model) cell. Each run directory keeps its own refs and its own A/A pairs, so
// directories are pooled by exact ref, never merged into one run.
function cmdVerdict(opts) {
  if (!KINDS.includes(opts.verdict)) throw new Error(`--verdict takes ${KINDS.join(' or ')}`);
  const dirs = runDirsOf(opts);
  const given = opts.out && opts.out !== true;
  if (dirs.length > 1 && !given) throw new Error('several run directories feed one verdict; pass --out to say where the page goes');
  const baseline = opts.baseline && opts.baseline !== true ? opts.baseline : 'vanilla';
  const list = (v) => (v === undefined ? null : String(v === true ? '' : v).split(',').filter(Boolean));
  const res = generateVerdict({
    kind: opts.verdict, dirs, benchDir: benchDirOf(opts), extraDirs: extraDirsOf(opts), baseline, out: opts.out, format: opts.format, scoringFile: scoringOf(opts),
    profile: optionalProfile(opts.profile), testArms: list(opts['test-arms']), changedSkills: list(opts['changed-skills']), phases: phasesOf(opts), qualityPack: packOf(opts),
  });
  if (opts.verdict === 'orchestrator-pass') {
    console.log(`Orchestrator pass rule against ${baseline} (cost at most 2.0x, paired quality interval within vanilla's spread on one task):`);
    for (const c of res.v.cells) {
      console.log(`  ${c.key}`);
      const w = Math.max(...c.arms.map((a) => a.label.length));
      for (const a of c.arms) {
        const nums = a.aaRepeatOf ? `repeat of ${a.aaRepeatOf}` : `cost ${a.cost.ratioPerRun === null ? 'n/a' : `${a.cost.ratioPerRun.toFixed(2)}x`} per run, quality ${a.quality.delta === null ? 'n/a' : `${a.quality.delta > 0 ? '+' : ''}${a.quality.delta.toFixed(1)}`} points; ${a.reasons.join('; ')}`;
        console.log(`    ${a.label.padEnd(w)}  ${(a.call ?? 'A/A repeat').padEnd(20)}  ${nums}`);
      }
      for (const r of c.ratioComparison ?? []) console.log(`    ${r.armId}: ${c.model} ratio ${r.gpt.perRun === null ? 'n/a' : `${r.gpt.perRun.toFixed(2)}x`} vs Claude ratio ${r.claude.perRun === null ? 'n/a' : `${r.claude.perRun.toFixed(2)}x`} (per run)`);
    }
    for (const n of res.v.notes) console.log(`  note: ${n}`);
    printWritten(res.written);
    return;
  }
  const w = Math.max(...res.v.arms.map((a) => a.label.length));
  console.log(`Platform verdict against ${res.v.baselineLabel}:`);
  for (const a of res.v.arms) console.log(`  ${a.label.padEnd(w)}  ${(a.verdict ?? 'A/A repeat').padEnd(20)}  ${a.aaRepeatOf ? `repeat of ${a.aaRepeatOf}` : a.reason}`);
  printWritten(res.written);
}

function cmdReport(opts) {
  if (opts.verdict !== undefined) {
    if (opts['allow-stale-pack']) throw new Error('--allow-stale-pack applies to the plain report only; the verdict pages stay strict about stale pack judgments');
    if (opts['criteria-pack'] !== undefined && !(loadScoring(scoringOf(opts), { allowPack: true }).pack > 0)) {
      throw new Error('--criteria-pack with --verdict needs a scoring file that gives the pack a weight (--scoring profiles/scoring-quality-fractional.json): the verdict page has no pack table of its own, so the pack counts only through the quality score');
    }
    return cmdVerdict(opts);
  }
  const dirs = runDirsOf(opts);
  const given = opts.out && opts.out !== true;
  if (dirs.length > 1 && !given) throw new Error('several run directories are merged read-only; pass --out to say where the report goes');
  const run = loadRuns(dirs);
  const baseline = opts.baseline && opts.baseline !== true ? opts.baseline : defaultBaseline(run);
  if (!run.runs.some((r) => r.armId === baseline)) console.error(`warning: baseline arm "${baseline}" has no runs; pairwise columns will be empty`);
  const profile = optionalProfile(opts.profile);
  const res = generateRunReport({
    run, tasks: loadTasks(benchDirOf(opts), { extraDirs: extraDirsOf(opts) }), baseline, out: opts.out, detail: opts.detail ?? profile?.report.detail, format: opts.format, scoringFile: scoringOf(opts), defaultDir: dirs[0], profile, phases: phasesOf(opts), qualityPack: packOf(opts), allowStalePack: Boolean(opts['allow-stale-pack']),
  });
  printWritten(res.written);
  if (profile?.calibrationSample) {
    if (run.merged) console.log('calibration sample: not written for merged run directories; run report --profile detailed on one directory');
    else {
      const sample = writeCalibrationSample({ run, n: profile.calibrationSample, seed: 1 });
      console.log(`wrote ${sample.json}\nwrote ${sample.md}`);
    }
  }
  console.log(`diligence rating: ${res.card.rating} (${res.card.counts.PASS} PASS, ${res.card.counts.WARN} WARN, ${res.card.counts.FAIL} FAIL)`);
}

// Recomputes the skill table from stream.jsonl; reads the run directory and writes nothing.
function cmdSkills(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const benchDir = benchDirOf(opts);
  const guess = path.resolve(benchDir, '..');
  const repoRoot = opts['repo-root'] && opts['repo-root'] !== true ? path.resolve(opts['repo-root']) : fs.existsSync(path.join(guess, 'agent-sops')) ? guess : null;
  const { rows, startup, armOrder } = collectRows(runDir, { tasks: loadTasks(benchDir, { extraDirs: extraDirsOf(opts) }), repoRoot });
  const done = rows.filter((r) => r.complete);
  const open = rows.length - done.length;
  const sum = summarizeSkills(done, { armOrder, startup });
  if (opts.json) { console.log(JSON.stringify({ runDir, repoRoot, inProgress: open, ...sum }, null, 2)); return; }
  console.log([`Run: ${runDir} (recomputed from stream.jsonl; nothing is written)`, `Repo listing for SOP and skill names: ${repoRoot ?? 'none, using naming convention'}`, `${done.length} finished run(s)${open ? `, ${open} without result.json (in progress) left out` : ''}`, '', renderSkillsMarkdown(sum, { title: '## Skills actually used' })].join('\n'));
}

function cmdCompare(opts) {
  try {
    const rule = opts.rule || 'both';
    if (!['both', 'any'].includes(rule)) throw new Error('--rule takes both or any');
    const r = compareRuns({
      baseDir: need(opts, 'base'), headDir: need(opts, 'head'), benchDir: benchDirOf(opts),
      minRel: numOpt(opts, 'min-rel', 0.15), rule, force: Boolean(opts.force),
    });
    (r.exitCode === 2 ? console.error : console.log)(formatCompare(r));
    process.exitCode = r.exitCode;
  } catch (e) {
    console.error(`compare: ${e.message}`);
    process.exitCode = 2;
  }
}

// One base arm against one or more head arms of a single run. Writes contrast.md, contrast.json, contrast.html and charts/ beside the results (or in --out).
function cmdContrast(opts) {
  const dirs = runDirsOf(opts);
  const given = opts.out && opts.out !== true;
  if (dirs.length > 1 && !given) throw new Error('several run directories are merged read-only; pass --out to say where the contrast goes');
  const rule = opts.rule || 'both';
  if (!['both', 'any'].includes(rule)) throw new Error('--rule takes both or any');
  const heads = opts.head === undefined ? null : String(opts.head === true ? '' : opts.head).split(',').filter(Boolean);
  if (heads && !heads.length) throw new Error('--head needs one or more arm names, comma separated');
  if (opts.base !== undefined && opts.base === true) throw new Error('--base needs an arm name');
  const run = loadRuns(dirs);
  const tasks = loadTasks(benchDirOf(opts), { extraDirs: extraDirsOf(opts) });
  useScoringQuoteRule(run, tasks, scoringOf(opts));
  const c = contrastRun({
    run, tasks, base: opts.base, heads,
    minRel: numOpt(opts, 'min-rel', 0.15), rule, by: opts.by === undefined ? 'class' : String(opts.by), phases: phasesOf(opts),
  });
  const res = generateContrast({ run, tasks, c, out: opts.out, detail: opts.detail, format: opts.format, scoringFile: scoringOf(opts), defaultDir: dirs[0] });
  const mdFile = res.written.find((w) => w.endsWith('contrast.md'));
  console.log(mdFile ? fs.readFileSync(mdFile, 'utf8') : renderContrast(c));
  printWritten(res.written);
  console.log(`diligence rating: ${res.card.rating}`);
}

function cmdCalibrate(opts) {
  const sub = opts._[0];
  if (sub === 'export') {
    const r = exportSheet({
      runDir: path.resolve(need(opts, 'run')), benchDir: benchDirOf(opts),
      n: numOpt(opts, 'n', 25, { int: true }), seed: seedOf(opts),
      limits: limitsOf(opts), explicitLimits: explicitLimitsOf(opts), redactions: loadRedactions(opts['redact-file']), outDir: opts.out, criteriaPack: packOf(opts),
    });
    console.log(`wrote ${r.n} item(s) to ${r.dir} (sheet.json, sheet.md, key.json). Label sheet.json, then run: calibrate score --labels ${r.sheetPath}`);
  } else if (sub === 'score') {
    const t = DEFAULTS.thresholds;
    const score = opts['criteria-pack'] === undefined ? scoreLabels : scorePackLabels;
    const res = score({
      labelsFile: path.resolve(need(opts, 'labels')), keyFile: opts.key && path.resolve(opts.key),
      thresholds: {
        kappaMin: numOpt(opts, 'kappa-min', t.kappaMin), agreementMin: numOpt(opts, 'agreement-min', t.agreementMin),
        spearmanMin: numOpt(opts, 'spearman-min', t.spearmanMin),
      },
    });
    console.log(opts['criteria-pack'] === undefined ? formatCalibration(res) : formatPackCalibration(res));
    if (opts.save && opts.save !== true) {
      fs.mkdirSync(path.dirname(path.resolve(opts.save)), { recursive: true });
      fs.writeFileSync(path.resolve(opts.save), `${JSON.stringify(res, null, 2)}\n`);
      console.log(`wrote ${path.resolve(opts.save)}`);
    }
  } else {
    throw new Error('calibrate takes export or score');
  }
}

// The 2x2 pilot table from four judged run directories. Reads only; --out writes factorial-2x2.md and .json.
function cmdReport2x2(opts) {
  try {
    const dirs = {};
    for (const c of FACTORIAL_CELLS) {
      const v = opts[c.flag];
      if (!v || v === true) throw new Error(`--${c.flag} is required (one or more judged run directories, comma separated)`);
      dirs[c.id] = String(v).split(',').filter(Boolean);
    }
    const res = buildFactorial({ dirs, benchDir: benchDirOf(opts), extraDirs: extraDirsOf(opts), scoringFile: scoringOf(opts), qualityPack: packOf(opts) });
    const writing = Boolean(opts.out && opts.out !== true);
    const charts = writing ? factorialCharts(res) : null;
    const md = toMarkdown(renderFactorial(res, { charts }));
    if (opts.json) console.log(JSON.stringify(res, null, 2));
    else console.log(md);
    if (writing) {
      const dir = path.resolve(opts.out);
      fs.mkdirSync(path.join(dir, 'charts'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'factorial-2x2.md'), md);
      fs.writeFileSync(path.join(dir, 'factorial-2x2.json'), `${JSON.stringify(res, null, 2)}\n`);
      for (const [name, svg] of charts) fs.writeFileSync(path.join(dir, 'charts', `${name}.svg`), `${svg}\n`);
      console.error(`wrote ${path.join(dir, 'factorial-2x2.md')}\nwrote ${path.join(dir, 'factorial-2x2.json')}\nwrote ${charts.size} chart(s) in ${path.join(dir, 'charts')}`);
    }
  } catch (e) {
    console.error(`report-2x2: ${e.message}`);
    process.exitCode = 2;
  }
}

// explain: the arithmetic behind the quality number of saved runs. Reads files only.
async function cmdExplain(opts) {
  const dir = need(opts, 'run');
  const benchDir = benchDirOf(opts);
  const tasks = loadTasks(benchDir, { extraDirs: extraDirsOf(opts) });
  const rep = opts.rep === undefined ? undefined : numOpt(opts, 'rep', null, { int: true });
  console.log(explainRuns({
    dir, tasks, brief: Boolean(opts.brief), scoringFile: opts.scoring && opts.scoring !== true ? path.resolve(opts.scoring) : undefined,
    filter: { arm: flagValue(opts, 'arm') ?? undefined, task: flagValue(opts, 'task') ?? undefined, rep },
  }));
}

// trace: the ordered timeline of one saved run. Reads files only.
async function cmdTrace(opts) {
  const dir = need(opts, 'run');
  const format = flagValue(opts, 'format') ?? 'md';
  if (!['md', 'json'].includes(format)) throw new Error('--format takes md or json');
  for (const f of ['arm', 'task', 'rep']) if (opts[f] === undefined) throw new Error(`trace needs --${f} (one run: --arm A --task T --rep N)`);
  const runDir = locateRun(dir, { arm: flagValue(opts, 'arm'), task: flagValue(opts, 'task'), rep: numOpt(opts, 'rep', null, { int: true }) });
  const trace = buildTrace(runDir, { instructions: Boolean(opts.instructions), repoRoot: opts['repo-root'] ? path.resolve(opts['repo-root']) : path.resolve(__dirname, '..', '..') });
  console.log(format === 'json' ? JSON.stringify(trace, null, 2) : renderTrace(trace, { full: Boolean(opts.full) }).trimEnd());
}

module.exports = { cmdExplain, cmdTrace, cmdReport2x2, cmdJudge, cmdRecheck, cmdBackfill, cmdReport, cmdCompare, cmdContrast, cmdCalibrate, cmdSkills, resolveJudges, DEFAULT_JUDGES };
