// SPDX-License-Identifier: Apache-2.0
'use strict';

// Command handlers for judge, report, compare and calibrate. bench.js dispatches here.

const fs = require('node:fs');
const path = require('node:path');
const { loadTasks, loadSuite, BENCH_DIR } = require('./lib/tasks.js');
const sandbox = require('./lib/sandbox.js');
const { DEFAULTS, MIN_PANEL_FAMILIES, checkPanel, checkJudgeModel, families } = require('../judge/config.js');
const { resolveIsolation } = require('./lib/isolate.js');
const procs = require('./lib/procs.js');
const { loadRedactions } = require('../judge/redact.js');
const { makeKiroCaller, makeCmdCaller } = require('../judge/model.js');
const { runJudging } = require('../judge/run.js');
const { exportSheet, scoreLabels, formatCalibration } = require('../judge/calibrate.js');
const { loadRun } = require('../report/load.js');
const { buildReport, defaultBaseline } = require('../report/aggregate.js');
const { renderMarkdown } = require('../report/render.js');
const { recheckAll } = require('./lib/recheck.js');
const { collectRows, summarizeSkills, renderSkillsMarkdown } = require('../report/skills.js');
const { compareRuns, formatCompare } = require('../report/compare.js');
const { contrastRun, renderContrast } = require('../report/contrast.js');

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

function limitsOf(opts) {
  return {
    maxFileChars: numOpt(opts, 'max-file-chars', DEFAULTS.limits.maxFileChars, { int: true }),
    maxBundleChars: numOpt(opts, 'max-bundle-chars', DEFAULTS.limits.maxBundleChars, { int: true }),
  };
}

// --judges wins, then the suite file, then the default three-family panel. Fewer than three
// distinct families is refused unless --allow-small-panel is passed.
function resolveJudges({ cliJudges, suiteJudges, subjectModel = null, allowSmallPanel = false }) {
  let judges = cliJudges ? String(cliJudges).split(',').filter(Boolean) : null;
  if (!judges) judges = suiteJudges && suiteJudges.length ? suiteJudges : DEFAULT_JUDGES;
  judges.forEach((j) => checkJudgeModel(j, subjectModel));
  checkPanel(judges, { minFamilies: allowSmallPanel ? 1 : MIN_PANEL_FAMILIES });
  return { judges, small: families(judges).length < MIN_PANEL_FAMILIES };
}

async function cmdJudge(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const benchDir = benchDirOf(opts);
  const run = loadRun(runDir);
  let suiteJudges = [];
  try { suiteJudges = loadSuite(run.config.suite, loadTasks(benchDir), benchDir).judges; } catch { /* run without a known suite */ }
  const { judges, small } = resolveJudges({ cliJudges: opts.judges, suiteJudges, subjectModel: run.config.model ?? null, allowSmallPanel: Boolean(opts['allow-small-panel']) });
  const modes = String(opts.mode || 'rubric,pairwise').split(',');
  if (modes.some((m) => !['rubric', 'pairwise'].includes(m))) throw new Error('--mode takes rubric, pairwise or both');
  const baseline = opts.baseline && opts.baseline !== true ? opts.baseline : defaultBaseline(run);
  const arms = [...new Set(run.runs.map((r) => r.armId))];
  if (modes.includes('pairwise') && !arms.includes(baseline)) throw new Error(`baseline arm "${baseline}" has no runs in ${runDir} (arms present: ${arms.join(', ')}); pass --baseline ARM or --mode rubric`);
  const timeoutMs = numOpt(opts, 'judge-timeout-sec', DEFAULTS.timeoutSec) * 1000;
  const judgeCmd = opts['judge-cmd'] || process.env.BENCH_JUDGE_CMD;
  const log = (m) => console.error(`[judge ${new Date().toISOString().slice(11, 19)}] ${m}`);
  let caller;
  if (judgeCmd) {
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
  // Calls that finished are cached on disk, so an interrupted judge phase loses only the calls in flight.
  const removeHandlers = procs.installSignalHandlers({ flush: () => {}, log });
  let j;
  try {
    j = await runJudging({
      runDir, benchDir, judges, modes, baseline, caller, smallPanel: small,
      concurrency: numOpt(opts, 'concurrency', DEFAULTS.concurrency, { int: true }),
      budgetCredits: opts['budget-credits'] === undefined ? null : numOpt(opts, 'budget-credits', null),
      limits: limitsOf(opts), redactions: loadRedactions(opts['redact-file']), log,
    });
  } finally {
    removeHandlers();
    procs.removeAllScratch();
  }
  const recs = [...j.rubric, ...j.pairwise];
  const errors = recs.filter((r) => r.judgeError);
  const last = j.invocations[j.invocations.length - 1];
  console.log(`judged ${j.rubric.length} rubric and ${j.pairwise.length} pairwise record(s); ${errors.length} with judgeError; live spend ${last.spentCredits.toFixed(3)} credits (all invocations: ${j.spentCredits.toFixed(3)}); ${j.notJudged.length} run(s) not judged`);
  if (small) console.log(`warning: panel has fewer than ${MIN_PANEL_FAMILIES} model families (--allow-small-panel)`);
  console.log(`wrote ${path.join(runDir, 'judgments.json')}`);
}

function cmdRecheck(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const dryRun = Boolean(opts['dry-run']);
  const out = recheckAll({ runDir, benchDir: benchDirOf(opts), dryRun });
  const tally = (checks) => (checks ? `${checks.filter((c) => c.passed).length}/${checks.length}` : '-');
  for (const r of out) {
    const note = r.status === 'skipped' ? ` (${r.reason})` : '';
    console.log(`${r.armId}/${r.taskId}/${r.replicate}: ${r.status}${note}; checks ${tally(r.before)} -> ${tally(r.after)}`);
  }
  const n = (s) => out.filter((r) => r.status === s).length;
  console.log(`${dryRun ? 'would recheck' : 'rechecked'} ${n('rechecked')}, unchanged ${n('unchanged')}, skipped ${n('skipped')}`);
}

function cmdReport(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const run = loadRun(runDir);
  const baseline = opts.baseline && opts.baseline !== true ? opts.baseline : defaultBaseline(run);
  if (!run.runs.some((r) => r.armId === baseline)) console.error(`warning: baseline arm "${baseline}" has no runs; pairwise columns will be empty`);
  const { report } = buildReport({ run, tasks: loadTasks(benchDirOf(opts)), baseline });
  const mdPath = path.resolve(opts.out && opts.out !== true ? opts.out : path.join(runDir, 'report.md'));
  const jsonPath = mdPath.endsWith('.md') ? `${mdPath.slice(0, -3)}.json` : `${mdPath}.json`;
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log(`wrote ${mdPath}\nwrote ${jsonPath}`);
}

// Recomputes the skill table from stream.jsonl; reads the run directory and writes nothing.
function cmdSkills(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const benchDir = benchDirOf(opts);
  const guess = path.resolve(benchDir, '..');
  const repoRoot = opts['repo-root'] && opts['repo-root'] !== true ? path.resolve(opts['repo-root']) : fs.existsSync(path.join(guess, 'agent-sops')) ? guess : null;
  const { rows, startup, armOrder } = collectRows(runDir, { tasks: loadTasks(benchDir), repoRoot });
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

// One base arm against one or more head arms of a single run. Writes contrast.md and contrast.json beside the results.
function cmdContrast(opts) {
  const runDir = path.resolve(need(opts, 'run'));
  const rule = opts.rule || 'both';
  if (!['both', 'any'].includes(rule)) throw new Error('--rule takes both or any');
  const heads = opts.head === undefined ? null : String(opts.head === true ? '' : opts.head).split(',').filter(Boolean);
  if (heads && !heads.length) throw new Error('--head needs one or more arm names, comma separated');
  if (opts.base !== undefined && opts.base === true) throw new Error('--base needs an arm name');
  const c = contrastRun({
    run: loadRun(runDir), tasks: loadTasks(benchDirOf(opts)), base: opts.base, heads,
    minRel: numOpt(opts, 'min-rel', 0.15), rule,
  });
  const md = renderContrast(c);
  fs.writeFileSync(path.join(runDir, 'contrast.md'), md);
  fs.writeFileSync(path.join(runDir, 'contrast.json'), JSON.stringify(c, null, 2) + '\n');
  console.log(md);
  console.log(`wrote ${path.join(runDir, 'contrast.md')}\nwrote ${path.join(runDir, 'contrast.json')}`);
}

function cmdCalibrate(opts) {
  const sub = opts._[0];
  if (sub === 'export') {
    const r = exportSheet({
      runDir: path.resolve(need(opts, 'run')), benchDir: benchDirOf(opts),
      n: numOpt(opts, 'n', 25, { int: true }), seed: seedOf(opts),
      limits: limitsOf(opts), redactions: loadRedactions(opts['redact-file']), outDir: opts.out,
    });
    console.log(`wrote ${r.n} item(s) to ${r.dir} (sheet.json, sheet.md, key.json). Label sheet.json, then run: calibrate score --labels ${r.sheetPath}`);
  } else if (sub === 'score') {
    const t = DEFAULTS.thresholds;
    const res = scoreLabels({
      labelsFile: path.resolve(need(opts, 'labels')), keyFile: opts.key && path.resolve(opts.key),
      thresholds: {
        kappaMin: numOpt(opts, 'kappa-min', t.kappaMin), agreementMin: numOpt(opts, 'agreement-min', t.agreementMin),
        spearmanMin: numOpt(opts, 'spearman-min', t.spearmanMin),
      },
    });
    console.log(formatCalibration(res));
  } else {
    throw new Error('calibrate takes export or score');
  }
}

module.exports = { cmdJudge, cmdRecheck, cmdReport, cmdCompare, cmdContrast, cmdCalibrate, cmdSkills, resolveJudges, DEFAULT_JUDGES };
