// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js run`: resolve and build all arms, record the run configuration, run, summarize.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveArm } = require('./arms.js');
const { applyArmOptions, attachVariant } = require('./arm-opts.js');
const { applyOracle } = require('./oracle.js');
const { STOP_ON } = require('./stop-watch.js');
const { harnessFor, opencode: oc, claudeCode: cc, strands: st } = require('./harness/index.js');
const { AGENT_ENGINES, DEFAULT_ENGINE, isUsdRuntime, descriptorOf, supporting, notSupporting, joinNames } = require('./harness/runtime.js');
const { DESCRIPTORS } = require('./harness/descriptors.js');
const { readProfile } = require('./harness/opencode-creds.js');
const { isSuiteName, loadTasks, loadSuite, suiteExtraDirs, suiteDirs, suiteFile, mergeExtraDirs, benchMask, SUITE_NAMES, BENCH_DIR } = require('./tasks.js');
const { repoRootOf } = require('./flag-values.js');
const real = require('./real.js');
const reallib = require('../../real/lib.js');
const { runAll, prepareAll, preflightTable, describePlan, budgetNote, DEFAULT_CENSORED_FLOOR, CREDITS, USD } = require('./orchestrate.js');
const { buildChildEnv, describeEnv } = require('./env.js');
const { resolveIsolation, describeHide, ISOLATE_MODES, isComparableMode } = require('./isolate.js');
const { DEFAULT_EXCLUDES, REPO_EXCLUDES } = require('./tripwire.js');
const procs = require('./procs.js');
const sandbox = require('./sandbox.js');
const rc = require('./runconfig.js');
const { optionalProfile, replicatesFor, aaArmFor, writeCalibrationSample } = require('./profiles.js');
const { loadRun } = require('../../report/load.js');
const { createInstallsGate, describeChange, judgeBatch } = require('./isolation-gates.js');
const toolchain = require('./toolchain.js');
const { pinPython } = require('./python-pin.js');
// A string flag value, or null when the flag is absent or given bare.
const strOpt = (v) => (v !== undefined && v !== true && v !== '' ? String(v) : null);
const { ensureOwnedDir, writeAtomic } = require('./owned.js');
const { studyInfraCheck } = require('./infra-check.js');
const { maxAuthFailuresOf, AUTH_EXIT_CODE } = require('./auth-failure.js');
const { makeLoginCheck } = require('./login-check.js');
const { preparePlantSuite, checkSuiteShape } = require('./plant/intake.js');
const { preflightWalls, trialGatewayRows, checklistWithTrials } = require('./plant/walls.js');
const { preflightStrands } = require('./plant/strands-census.js');
const { makeIso } = require('./run-one.js');
const { pinConflicts, describeConflicts } = require('./study-pins.js');
const { profileCredentials } = require('./aws-creds.js');
const { writeRunConfig, readRunConfigs } = require('./run-configs.js');
const { preloadSchemas } = require('./schema.js');
const { snapshotTaskInputs } = require('./task-inputs.js');
const { requirePrereg } = require('../../scenarios/prereg.js');
const { planLevel } = require('../../scenarios/levels.js');
const { creditNotes, creditNoteLines } = require('./credit-notes.js');
const { runConfigRecord: introspectRunConfig } = require('./introspect/index.js');

const DEFAULT_MODEL = 'claude-sonnet-5.5';
const DEFAULT_EFFORT = 'high';
// Censored opencode runs are charged this many USD when the arm has no completed run yet.
const DEFAULT_CENSORED_FLOOR_USD = 0.5;

function intOpt(v, name, min = 1) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}`);
  return n;
}

// A bare flag parses as `true`, which Number() would read as 1.
function replicateOffsetOpt(opts) {
  const v = opts['replicate-offset'];
  if (v === undefined) return 0;
  if (v === true || !/^\d+$/.test(String(v))) throw new Error('--replicate-offset must be a non-negative integer');
  return Number(v);
}

// --agent-engine picks the kiro-cli engine and the matching install (v2: kiro-cli-v2, v3: kiro-v3). Runtimes without supports.agentEngine have no engine.
function engineOpt(opts, runtimes) {
  const v = opts['agent-engine'];
  if (v === undefined) return DEFAULT_ENGINE;
  const other = runtimes.find((r) => !descriptorOf(r).supports.agentEngine);
  if (other) throw new Error(`--agent-engine applies to ${joinNames(supporting('agentEngine').map((d) => d.proseName))} arms only; ${other} arms have no agent engine`);
  if (!AGENT_ENGINES.includes(v)) throw new Error(`--agent-engine must be ${AGENT_ENGINES.join(' or ')}`);
  return v;
}

// A bare flag parses as `true`, which Number() would read as 1.
function timeoutSecOpt(opts) {
  const v = opts['timeout-sec'];
  if (v === undefined) return null;
  if (v === true || !/^[1-9]\d*$/.test(String(v))) throw new Error('--timeout-sec must be a positive integer');
  return Number(v);
}

const list = (v) => (v ? String(v).split(',').filter(Boolean) : []);

// Paths the agent must not read: the bench answer material, any extra tasks directory, the run output and the credentials file.
function maskPaths({ benchDir, extraDirs = [], outDir, awsCredsFile = null }) {
  return [...benchMask(benchDir, extraDirs), outDir, ...(awsCredsFile ? [awsCredsFile] : [])];
}

function need(opts, name) {
  if (!opts[name] || opts[name] === true) throw new Error(`--${name} is required for opencode arms`);
  return opts[name];
}

function listModels(kiroBin, authDb, scratchDir, envKeep, agentEngine) {
  const dir = fs.mkdtempSync(path.join(scratchDir, 'm-'));
  try {
    sandbox.copyAuthDb(authDb, dir);
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    const { env } = buildChildEnv(process.env, { home: dir, agentEngine, keep: envKeep });
    return execFileSync(kiroBin, ['chat', '--list-models', '-f', 'json'], { env, encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function summarize(runConfig, state, extra) {
  const usd = isUsdRuntime(runConfig.harness);
  return {
    ...runConfig,
    finishedAt: new Date().toISOString(),
    comparable: runConfig.comparable ?? false,
    ...(usd ? { totalCostUsd: state.spent, totalCostUsdCharged: state.charged } : { totalCredits: state.spent, totalCreditsCharged: state.charged }),
    counts: state.results.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {}),
    results: state.results,
    ...creditNotes(state.results),
    ...extra,
  };
}

// Builds and trial-installs every arm exactly as `run` does before it launches an agent, prints the preflight table
// and stops. It needs no kiro-cli login, creates no run directory and starts no agent, so it spends no credits.
function prepareOnlyRun({ opts, arms, runtimes, repo, agentEngine, log, tasks = [], benchDir }) {
  if (runtimes.some((r) => !descriptorOf(r).supports.prepareOnly)) throw new Error(`--prepare-only covers ${joinNames(supporting('prepareOnly').map((d) => d.proseName))} arms; ${joinNames(notSupporting('prepareOnly').map((d) => d.proseName))} arms need their binary and AWS credentials, so check them with a normal run`);
  // Claude Code arms are built and trial-installed with their model pin check; claude itself is never started.
  const isCc = runtimes.includes('claude-code');
  if (isCc && runtimes.length > 1) throw new Error(`--prepare-only checks Claude Code arms against a Bedrock model id; prepare them apart from ${runtimes.filter((r) => r !== 'claude-code').join(', ')} arms`);
  const ccModel = isCc ? opts.model || cc.DEFAULT_MODEL : null;
  if (isCc && !cc.canonicalModel(ccModel)) throw new Error('--model needs a Bedrock model id, for example us.anthropic.claude-sonnet-5-5');
  const cacheDir = path.resolve(opts.cache || path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(opts['cargo-target'] || process.env.CARGO_TARGET_DIR || path.join(cacheDir, 'cargo-target'));
  ensureOwnedDir(cacheDir, 'cache');
  // Claude Code loads every .claude/skills above a run's cwd as project skills. Runs, trial installs and listing probes
  // all make their dirs under os.tmpdir(), so it must sit outside HOME with no .claude above it.
  if (isCc) cc.checkScratchRoot(os.tmpdir());
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);
  for (const a of arms) for (const w of a.warnings) log(`warning: arm ${a.id}: ${w}`);
  const window = createInstallsGate().begin();
  try {
    const py = pinPython({ tasks, scratchDir, benchDir, flag: strOpt(opts.python), plantPython: strOpt(opts['plant-python']) });
    if (py) log(`python: ${py.version} (${py.executable}, from ${py.source}); python3 in the sandbox is ${py.sandboxVersion}`);
    const ctx = {
      repo, cacheDir, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb: null,
      config: isCc ? { model: ccModel, canonicalModel: cc.canonicalModel(ccModel), effort: cc.effortOf(opts.effort || DEFAULT_EFFORT) } : { model: opts.model || DEFAULT_MODEL, effort: opts.effort || DEFAULT_EFFORT, agentEngine }, envKeep: list(opts['env-keep']),
    };
    const { prepared, errors } = prepareAll({ arms, ctx, log, allowPartial: Boolean(opts['allow-partial']) });
    console.log(preflightTable(arms, prepared, errors));
    console.log(`prepare-only: ${prepared.size} arm(s) built and trial-installed, ${errors.size} failed; no agent was started`);
    if (errors.size) process.exitCode = 1;
    const gate = window.end();
    if (!gate.ok) {
      console.error(`ISOLATION FAILURE: ${describeChange(gate)}`);
      process.exitCode = 4;
    }
  } finally {
    procs.removeAllScratch();
  }
}

/**
 * The flag and arm checks of `run` that need no credentials, binary or network, so `--prepare-only` makes them too and
 * fails where the real run would. `opts` are the run flags; `tasks` the selected tasks; `runtime` the arms' harness id.
 * Throws on the first refusal.
 * Returns the parsed values the run uses: `{budgetFlag, budgetCredits, censoredFloor, runCreditLimit, stopOn}`.
 */
function checkHarnessFlags({ opts, tasks, runtime }) {
  const desc = descriptorOf(runtime);
  const isUsd = desc.costUnit === 'usd';
  const unitName = isUsd ? 'USD' : 'credits';
  const budgetFlag = isUsd ? 'budget-usd' : 'budget-credits';
  const otherBudgetFlag = isUsd ? 'budget-credits' : 'budget-usd';
  if (opts[otherBudgetFlag] !== undefined) throw new Error(`--${otherBudgetFlag} does not apply here: ${runtime} runs are costed in ${unitName}, use --${budgetFlag}`);
  for (const [flag, why] of Object.entries(desc.flags.refused)) {
    if (opts[flag] !== undefined) throw new Error(`--${flag} does not apply to ${desc.proseName} arms (${why})`);
  }
  if (runtime === 'claude-code') cc.effortOf(opts.effort || DEFAULT_EFFORT);
  if (!desc.supports.multiTurn) {
    const multiTurn = tasks.filter((t) => t.autonomy).map((t) => t.id);
    if (multiTurn.length) throw new Error(`multi-turn (autonomy) tasks are not supported on the ${desc.proseName} harness yet: ${multiTurn.join(', ')}; ${desc.multiTurnNote}. Choose other tasks with --tasks`);
  }
  const fresh = desc.supports.freshSessions ? [] : tasks.filter((t) => t.freshSessions).map((t) => t.id);
  if (fresh.length) throw new Error(`fresh-session tasks are not supported on the ${desc.proseName} harness: ${fresh.join(', ')} (only Kiro CLI and Claude Code sum their cost over the sessions). Choose other tasks with --tasks`);
  const budgetCredits = opts[budgetFlag] ? Number(opts[budgetFlag]) : null;
  if (budgetCredits !== null && !(budgetCredits > 0)) throw new Error(`--${budgetFlag} must be a positive number`);
  const censoredFloor = opts['censored-floor'] ? Number(opts['censored-floor']) : isUsd ? DEFAULT_CENSORED_FLOOR_USD : DEFAULT_CENSORED_FLOOR;
  if (!(censoredFloor >= 0)) throw new Error('--censored-floor must be a non-negative number');
  let runCreditLimit = null;
  if (opts['run-credit-limit'] !== undefined) {
    runCreditLimit = Number(opts['run-credit-limit']);
    if (opts['run-credit-limit'] === true || !(runCreditLimit > 0)) throw new Error('--run-credit-limit must be a positive number');
    if (!desc.supports.runCreditLimit) throw new Error(`--run-credit-limit applies to ${joinNames(supporting('runCreditLimit').map((d) => d.proseName))} arms only; ${runtime} runs are costed in ${unitName}${desc.flags.perRunCapFlag ? ` (use --${desc.flags.perRunCapFlag} for a per-run cap)` : ''}`);
  }
  let stopOn = null;
  if (opts['stop-on'] !== undefined) {
    stopOn = opts['stop-on'];
    if (!STOP_ON.includes(stopOn)) throw new Error(`--stop-on takes ${STOP_ON.slice(0, -1).join(', ')} or ${STOP_ON.at(-1)}`);
  }
  return { budgetFlag, budgetCredits, censoredFloor, runCreditLimit, stopOn };
}

async function cmdRun(opts, deps = {}) {
  // Everything the runner reads from its own checkout later is read or hashed now, so a branch switch mid-study fails fast.
  preloadSchemas();
  const benchDir = opts['bench-dir'] ? path.resolve(opts['bench-dir']) : BENCH_DIR;
  const suitesDir = opts['suites-dir'] && opts['suites-dir'] !== true ? path.resolve(opts['suites-dir']) : null;
  if (opts['suites-dir'] !== undefined && (!suitesDir || !fs.existsSync(suitesDir) || !fs.statSync(suitesDir).isDirectory())) throw new Error(`--suites-dir directory not found: ${suitesDir ?? '(no value)'}`);
  if (!isSuiteName(opts.suite, benchDir, suitesDir)) {
    throw new Error(`--suite ${SUITE_NAMES.join('|')}|skilleval-SKILL is required${opts.suite ? `; no suite "${opts.suite}" (searched ${suiteDirs(benchDir, suitesDir).join(', ')})` : ''}`);
  }
  const extraDirs = mergeExtraDirs(suiteExtraDirs(opts.suite, benchDir, suitesDir), list(opts['extra-tasks']));
  const tasksAll = loadTasks(benchDir, { extraDirs });
  const suite = loadSuite(opts.suite, tasksAll, benchDir, suitesDir);
  const levelPlan = planLevel(opts, { candidates: suite.taskIds.map((id) => tasksAll.get(id)).filter(Boolean), extraDirs });
  const taskIds = levelPlan ? levelPlan.sel.ids : opts.tasks ? list(opts.tasks) : suite.taskIds;
  const timeoutOverride = timeoutSecOpt(opts);
  const tasks = taskIds.map((id) => {
    const t = tasksAll.get(id);
    if (!t) throw new Error(`unknown task "${id}" (known: ${[...tasksAll.keys()].join(', ') || 'none'})`);
    return timeoutOverride === null ? t : { ...t, timeoutSec: timeoutOverride };
  });
  if (!tasks.length) throw new Error('no tasks selected');
  if (opts.prereg !== undefined) requirePrereg(opts, { taskIds: tasks.map((t) => t.id), extraDirs });
  // Real tasks read their base tree from a local cache filled beforehand; stop here, not after the arms are built.
  const prepareOnly = Boolean(opts['prepare-only']);
  const realTasks = prepareOnly ? [] : tasks.filter((t) => t.real);
  const realCache = realTasks.length ? reallib.resolveCache(opts['real-cache'] && opts['real-cache'] !== true ? opts['real-cache'] : undefined) : null;
  if (realCache) process.env.BENCH_REAL_CACHE = realCache;
  const realPins = realCache ? real.preflight(realTasks, { cache: realCache }) : null;
  const profile = optionalProfile(opts.profile);
  const armIds = [...(opts.arms ? list(opts.arms) : suite.arms)];
  const replicates = profile ? replicatesFor(profile, opts.replicates) : opts.replicates ? intOpt(opts.replicates, 'replicates') : suite.replicates;
  const replicateOffset = replicateOffsetOpt(opts);
  const parallel = opts.parallel ? intOpt(opts.parallel, 'parallel') : suite.parallel;
  const REPO = repoRootOf(opts);
  const arms = armIds.map((id) => resolveArm(id, REPO));
  const armOpts = applyArmOptions(arms, opts);
  armOpts.oracle = applyOracle(arms, opts, { tasks, repo: REPO, benchDir });
  const aa = profile?.aaArm ? aaArmFor(arms) : null;
  if (aa?.spec) {
    // The repeat runs under the same conditions as the arm it repeats, so it takes that arm's prefix, entry agent and config.
    const twin = arms.find((a) => a.id === aa.twin);
    const copy = resolveArm(aa.spec, REPO);
    for (const k of ['prefixText', 'prefixInfo', 'agent', 'agentOverride', 'armConfig', 'oracle']) if (twin[k] !== undefined) copy[k] = twin[k];
    arms.push(copy);
    armIds.push(copy.id);
  }
  const variants = arms.map(attachVariant).filter(Boolean);
  const runtimes = [...new Set(arms.map((a) => harnessFor(a).id))];
  const agentEngine = engineOpt(opts, runtimes);
  for (const d of DESCRIPTORS) {
    if (runtimes.includes(d.id)) continue;
    for (const flag of d.flags.own) if (opts[flag] !== undefined) throw new Error(`--${flag} applies to ${d.proseName}${d.armPrefix ? ` (${d.armPrefix})` : ''} arms only`);
  }
  if (prepareOnly) {
    // The checks a real run makes before it needs credentials or a binary; a plant suite's shape is checked at intake.
    for (const runtime of runtimes) checkHarnessFlags({ opts, tasks, runtime });
    if (arms.some((a) => a.plant)) checkSuiteShape({ arms, tasks, parallel });
    return prepareOnlyRun({ opts, arms, runtimes, repo: REPO, agentEngine, tasks, benchDir, log: (m) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}] ${m}`) });
  }
  if (runtimes.length > 1) throw new Error(`arms from different harnesses cannot share one run (${arms.map((a) => `${a.id}: ${harnessFor(a).id}`).join(', ')}); run them separately with different --out`);
  const isOc = runtimes[0] === 'opencode';
  const isCc = runtimes[0] === 'claude-code';
  const isSt = runtimes[0] === 'strands';
  const desc = descriptorOf(runtimes[0]);
  const unit = desc.costUnit;
  const isUsd = unit === 'usd';
  const { budgetFlag, budgetCredits, censoredFloor, runCreditLimit, stopOn } = checkHarnessFlags({ opts, tasks, runtime: runtimes[0] });
  // Claude Code takes exported keys: from the environment, or with --aws-profile read from that profile before each run that needs fresh ones.
  const ccCreds = isCc && opts['aws-profile'] !== undefined ? profileCredentials(opts['aws-profile'] === true ? '' : String(opts['aws-profile']), deps.readAwsProfile ? { read: deps.readAwsProfile } : {}) : null;
  if (isCc) cc.checkCredentials(ccCreds ? { ...process.env, ...ccCreds.current() } : process.env);
  const maxAuthFailures = maxAuthFailuresOf(opts['max-auth-failures'], process.env.BENCH_MAX_AUTH_FAILURES);
  const maxToolCalls = opts['max-tool-calls'] === undefined ? null : intOpt(opts['max-tool-calls'], 'max-tool-calls');
  const seed = opts.seed === undefined ? Date.now() % 2147483647 : intOpt(opts.seed, 'seed', 0);
  const isolate = opts.isolate || 'auto';
  if (!ISOLATE_MODES.includes(isolate)) throw new Error(`--isolate must be one of ${ISOLATE_MODES.join(', ')}`);
  if (isolate === 'none' && !opts['allow-unisolated']) {
    throw new Error('--isolate none runs the agent with no containment, and its results are recorded as not comparable and are never counted by a verdict. Pass --allow-unisolated as well to run anyway.');
  }
  const envKeep = list(opts['env-keep']);

  const log = (m) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}] ${m}`);
  if (profile) log(`profile ${profile.name}: ${replicates} replicate(s) per cell${opts.replicates === undefined ? ' (the profile default)' : ''}`);
  if (aa) log(aa.note);
  const plan = describePlan({ tasks, arms, replicates, parallel, budgetCredits, unit, timeoutSecOverride: timeoutOverride });
  log(plan.text);
  const note = budgetNote(plan.planned, budgetCredits, budgetFlag);
  if (note) log(note);
  if (opts['no-default-hide']) { process.env.BENCH_NO_DEFAULT_HIDE = '1'; log('--no-default-hide: the credential paths added to the default hide set stay readable'); }
  const isolation = resolveIsolation(isolate);
  log(`isolation: ${isolation.mode} (${isolation.reason})`);
  if (opts.introspect) log('--introspect: every run records its model requests, tool calls and hooks under <run>/introspect (mode 0700); these runs are diagnostic, not comparable');
  if (!isComparableMode(isolation.mode)) log('warning: no OS isolation. These runs are recorded as not comparable and no verdict will count them.');
  if (parallel > 1) log(`warning: --parallel ${parallel} shares one account; wall-clock comparisons need --parallel 1`);

  for (const a of arms) for (const w of a.warnings) log(`warning: arm ${a.id}: ${w}`);

  const outDir = path.resolve(opts.out || path.join(REPO, 'bench', 'results', new Date().toISOString().replace(/[:.]/g, '-')));
  const resume = opts.resume ? { errors: Boolean(opts['resume-errors']) } : null;
  if (opts['resume-errors'] && !resume) throw new Error('--resume-errors needs --resume');
  if (resume && (!opts.out || !fs.existsSync(path.join(outDir, 'run-config.json')))) throw new Error(`--resume needs --out DIR of an earlier run (no run-config.json in ${outDir})`);
  const armDrift = pinConflicts(outDir, arms);
  if (armDrift.length && !opts['allow-arm-drift']) throw new Error(describeConflicts(armDrift, outDir));
  for (const c of armDrift) log(`warning: --allow-arm-drift: arm ${c.armId} was ${c.recorded.slice(0, 12)} in earlier results of this --out and is ${c.now.slice(0, 12)} now`);
  const cacheDir = path.resolve(opts.cache || path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(opts['cargo-target'] || process.env.CARGO_TARGET_DIR || path.join(cacheDir, 'cargo-target'));
  const authDb = isUsd ? null : opts['auth-db'] && opts['auth-db'] !== true ? path.resolve(opts['auth-db']) : sandbox.defaultAuthDb();
  if (authDb && !fs.existsSync(authDb)) throw new Error(`kiro-cli auth database not found: ${authDb} (log in with kiro-cli first)`);
  const awsCredsFile = isOc ? path.resolve(need(opts, 'aws-creds-file')) : null;
  const awsProfile = isOc ? (opts['aws-profile'] && opts['aws-profile'] !== true ? opts['aws-profile'] : 'bench') : null;
  if (isOc) readProfile(awsCredsFile, awsProfile);

  ensureOwnedDir(outDir, 'run-out');
  ensureOwnedDir(cacheDir, 'cache');
  if (opts['cargo-target'] || !process.env.CARGO_TARGET_DIR) for (const t of [cargoTarget, `${cargoTarget}-mcp`]) ensureOwnedDir(t, 'cargo-target');
  // Claude Code loads every .claude/skills above a run's cwd as project skills. Runs, trial installs and listing probes
  // all make their dirs under os.tmpdir(), so it must sit outside HOME with no .claude above it.
  if (isCc) cc.checkScratchRoot(os.tmpdir());
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);
  // Pins python3 for the agent, the checks and the gateway (S6); refuses when tasks run Python and 3.12 is not found.
  const pythonPin = pinPython({ tasks, scratchDir, benchDir, flag: strOpt(opts.python), plantPython: strOpt(opts['plant-python']) });

  let runBudgetUsd = null;
  let ccRegion = null;
  if (isCc) {
    if (opts['run-budget-usd'] !== undefined) {
      runBudgetUsd = Number(opts['run-budget-usd']);
      if (opts['run-budget-usd'] === true || !(runBudgetUsd > 0)) throw new Error('--run-budget-usd must be a positive number');
    }
    ccRegion = opts['aws-region'] && opts['aws-region'] !== true ? opts['aws-region'] : cc.REGION;
  } else if (opts['aws-region'] !== undefined) {
    throw new Error('--aws-region applies to Claude Code (cc-) arms only; judge commands take it separately');
  }
  const ccModel = isCc ? opts.model || cc.DEFAULT_MODEL : null;
  if (isCc && !cc.canonicalModel(ccModel)) throw new Error('--model needs a Bedrock model id, for example us.anthropic.claude-sonnet-5-5');
  // A Strands run on Bedrock spends money. It needs --budget-usd (what is left of it is each run's hard cap, enforced
  // in the launcher before every model call) and --aws-profile (only that profile's exported keys reach the agent).
  // Strands arms are plant arms, and a plant suite runs at --parallel 1 (intake.js), so no two runs share what is left.
  const stModel = isSt ? st.bedrockModelOf(opts.model ?? '') : null;
  let stCreds = null;
  if (stModel) {
    if (budgetCredits === null) throw new Error('a Strands run on Bedrock needs --budget-usd X: what is left of X is each run\'s hard spend cap');
    if (opts['aws-profile'] === undefined || opts['aws-profile'] === true) throw new Error('a Strands run on Bedrock needs --aws-profile NAME: the keys of that profile only are exported to the agent');
    stCreds = profileCredentials(String(opts['aws-profile']), deps.readAwsProfile ? { read: deps.readAwsProfile } : {});
    stCreds.current();
  } else if (isSt && opts['aws-profile'] !== undefined) {
    throw new Error('--aws-profile applies to a Strands run only with a bedrock: model; the fake model takes no credentials');
  }
  const config = isSt
    ? { model: opts.model, effort: 'default' }
    : isCc
    ? { model: ccModel, canonicalModel: cc.canonicalModel(ccModel), effort: cc.effortOf(opts.effort || DEFAULT_EFFORT) }
    : isOc
    ? { model: opts.model || oc.DEFAULT_MODEL, effort: oc.variantOf(opts.effort || DEFAULT_EFFORT) }
    : { model: opts.model || DEFAULT_MODEL, effort: opts.effort || DEFAULT_EFFORT, agentEngine };
  const state = { results: [], spent: 0, charged: 0 };
  let runConfig = { suite: suite.name, armIds, startedAt: new Date().toISOString(), seed };
  const flush = (signal) => {
    writeAtomic(path.join(outDir, 'summary.json'), JSON.stringify(summarize(runConfig, state, { interrupted: signal }), null, 2) + '\n');
  };
  const removeHandlers = procs.installSignalHandlers({ flush, log });
  let plantSuite = null;

  try {
    const kiro = isUsd ? null : opts['kiro-bin'] ? { bin: path.resolve(opts['kiro-bin']), shim: null } : sandbox.resolveKiroCli();
    if (kiro) log(`kiro-cli: ${kiro.bin}${kiro.shim ? ` (bypassing the shim at ${kiro.shim})` : ''}`);
    // Before any arm is built: a login that has lapsed would only fail every run, so stop here (exit 6).
    const loginCheck = makeLoginCheck({ isUsd, kiroBin: kiro?.bin, authDb, scratchDir, envKeep, agentEngine: config.agentEngine, check: deps.checkLogin });
    if (loginCheck) {
      const login = await loginCheck();
      if (!login.ok) {
        log(`LOGIN FAILURE: kiro-cli is not logged in (${login.detail}). Log in again, then start the chunk right away; nothing was run.`);
        process.exitCode = AUTH_EXIT_CODE;
        return;
      }
      log(login.unavailable ? `warning: login check unavailable: ${login.unavailable}` : 'kiro-cli login ok');
    }
    const ctx = {
      taskInputs: snapshotTaskInputs(tasks),
      kiroBin: kiro?.bin, repo: REPO, cacheDir, realCache, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb, config, envKeep,
      envInfo: null,
      installsGate: createInstallsGate(),
      ...(opts.introspect ? { introspect: true } : {}),
    };
    log(`isolation gate: hashing ${ctx.installsGate.dirs.join(', ')} before and after each run and the batch`);
    const batchWindow = ctx.installsGate.begin();
    const batchFrom = new Date().toISOString();
    if (isOc) {
      ctx.opencode = oc.resolveOpencode({ cacheDir, binOverride: opts['opencode-bin'] && opts['opencode-bin'] !== true ? opts['opencode-bin'] : null });
      ctx.rgBin = oc.resolveRipgrep(opts['rg-bin'] && opts['rg-bin'] !== true ? opts['rg-bin'] : null);
      if (!ctx.rgBin) throw new Error('ripgrep (rg) not found on PATH; install it or pass --rg-bin PATH (opencode would otherwise download it at run time)');
      Object.assign(ctx, { awsCredsFile, awsProfile });
      log(`opencode ${ctx.opencode.version} (${ctx.opencode.bin}), sha256 ${ctx.opencode.sha256.slice(0, 12)}, model ${oc.PROVIDER}/${config.model}, variant ${config.effort}, region ${oc.REGION}`);
    }
    if (isCc) {
      const flagValue = (name) => (opts[name] && opts[name] !== true ? opts[name] : null);
      ctx.claude = cc.resolveClaude({ binOverride: flagValue('claude-bin') ?? undefined, toolsDir: flagValue('claude-tools-dir') ?? undefined });
      if (!ctx.claude.supportsEffort) throw new Error(`${ctx.claude.bin} (claude ${ctx.claude.version}) has no --effort flag, so the run could not apply --effort ${config.effort}; use a claude that lists --effort in claude --help`);
      const claudeChanged = cc.claudeChanges(readRunConfigs(outDir), ctx.claude);
      if (claudeChanged.length && !opts['allow-claude-change']) throw new Error(cc.describeClaudeChanges(claudeChanged, ctx.claude, outDir, flagValue('claude-tools-dir')));
      if (claudeChanged.length) log(`warning: --allow-claude-change: ${cc.describeClaudeChanges(claudeChanged, ctx.claude, outDir, flagValue('claude-tools-dir')).split('. One study')[0]}`);
      Object.assign(ctx, { region: ccRegion, runBudgetUsd, ...(ccCreds ? { awsCreds: ccCreds } : {}) });
      const credsNote = ccCreds ? `credentials from profile ${ccCreds.profile}, read again before a run when they expire within 15 minutes` : `credentials from the environment (${cc.credentialNames().join(', ')})`;
      log(`claude ${ctx.claude.version} (${ctx.claude.bin}), sha256 ${ctx.claude.sha256.slice(0, 12)}, model ${config.model} (canonical ${config.canonicalModel}), effort ${config.effort}, region ${ccRegion}, permission mode ${cc.PERMISSION_MODE}, per-run budget $${runBudgetUsd ?? cc.DEFAULT_RUN_BUDGET_USD}, ${credsNote}`);
      const versionNote = cc.versionWarning(ctx.claude.version);
      if (versionNote) log(`warning: ${versionNote}`);
      const shadow = cc.PROFILE_VARS.filter((k) => process.env[k]);
      if (shadow.length) log(`note: ${shadow.join(', ')} ${shadow.length === 1 ? 'is' : 'are'} set here and is not passed to claude (the SDK would skip the exported keys)`);
    }
    if (isSt) {
      const value = (name) => (opts[name] && opts[name] !== true ? opts[name] : null);
      ctx.strands = st.resolveStrands({ python: value('strands-python') ?? 'python3', agentFile: value('strands-agent') });
      if (stCreds) Object.assign(ctx, { awsCreds: stCreds, strandsSpend: { capUsd: budgetCredits, left: () => budgetCredits - state.charged } });
      const credsNote = stCreds ? `${stModel.region}, keys of profile ${stCreds.profile}, hard spend cap $${budgetCredits} for the command` : 'no credentials passed';
      log(`strands-agents ${ctx.strands.version} (${ctx.strands.python}), agent ${ctx.strands.agentFile ?? 'plain Agent'}, model ${config.model}, ${credsNote}`);
    }
    const { prepared, errors } = prepareAll({ arms, ctx, log, allowPartial: Boolean(opts['allow-partial']) });
    log(`arms:\n${preflightTable(arms, prepared, errors)}`);

    const home = fs.realpathSync(os.homedir());
    const tripExtra = list(opts['tripwire-exclude']);
    ctx.isolation = isolation;
    ctx.hide = [...list(opts.hide), ...list(process.env.BENCH_HIDE_EXTRA)];
    ctx.mask = maskPaths({ benchDir, extraDirs, outDir, awsCredsFile });
    ctx.runCreditLimit = runCreditLimit;
    ctx.stopOn = stopOn;
    ctx.maxToolCalls = maxToolCalls;
    ctx.keyRoots = [benchDir];
    if (arms.some((a) => a.plant)) {
      plantSuite = preparePlantSuite({ opts, arms, tasks, parallel, outDir, ctx, repo: REPO, ...deps.plant });
      ctx.plant = plantSuite;
      plantSuite.log = log;
      ctx.mask.push(...plantSuite.mask);
      if (isolation.mode === 'unshare') {
        const walls = await preflightWalls({ ctx, suite: plantSuite, repo: REPO, outDir, makeIso: (root, plantRun) => makeIso(ctx, arms[0], root, null, { plantRun }) });
        ctx.cgroup = walls.cgroup;
        plantSuite.walls = walls;
        log(`plant walls: prober passed; ${walls.checklist.map((c) => `${c.id} ${c.state}`).join(', ')}; cgroup ${walls.cgroup.ok ? walls.cgroup.caps : `missing (${walls.cgroup.reason})`}`);
      }
      if (isSt) {
        const wrap = (file, args) => makeIso(ctx, arms[0], scratchDir, null).wrap(file, args);
        plantSuite.strandsCensus = preflightStrands({ strands: ctx.strands, suite: plantSuite, arms, env: st.env({ home: scratchDir, tmpdir: scratchDir }), scratch: scratchDir, wrap });
        log(`plant: Strands hook census: ${plantSuite.strandsCensus.problems.length ? plantSuite.strandsCensus.problems.join('; ') : 'no hook, middleware or tool swap that can change a plant call'}`);
      }
      if (plantSuite.hostNoise.length) log(`warning: plant: host failed quiet-host checks (${plantSuite.hostNoise.join(', ')}); this suite is not counted`);
      log(`plant release ${plantSuite.release.manifest.release} (manifest ${plantSuite.release.manifestSha256.slice(0, 12)}, key ${plantSuite.release.keyId.slice(0, 12)}), ${plantSuite.control ? 'control' : plantSuite.counted ? 'counted' : `NOT COUNTED (${plantSuite.notCounted.join('; ')})`} suite`);
    }
    ctx.tripwire = {
      roots: [
        { dir: home, depth: opts['tripwire-depth'] ? intOpt(opts['tripwire-depth'], 'tripwire-depth') : 3, exclude: DEFAULT_EXCLUDES },
        { dir: REPO, depth: 8, exclude: REPO_EXCLUDES },
        ...(opts['tripwire-dir'] ? list(opts['tripwire-dir']) : [path.join(os.tmpdir(), 'konductor-bench')]).map((dir) => ({ dir, depth: 4, exclude: ['target-shared'] })),
      ],
      extraExcludes: tripExtra,
      absExclude: [outDir, cacheDir, cargoTarget, `${cargoTarget}-mcp`, scratchDir, ...(realCache ? [realCache] : [])],
    };

    if (isSt) {
      ctx.envInfo = { kiroCliVersion: null, harnessVersion: ctx.strands.version, modelListSnapshotPath: null };
    } else if (isOc) {
      ctx.envInfo = { kiroCliVersion: null, harnessVersion: ctx.opencode.version, modelListSnapshotPath: null, region: oc.REGION };
    } else if (isCc) {
      ctx.envInfo = { kiroCliVersion: null, harnessVersion: ctx.claude.version, modelListSnapshotPath: null, region: ccRegion };
    } else {
      const modelListPath = path.join(outDir, 'model-list.json');
      fs.writeFileSync(modelListPath, listModels(ctx.kiroBin, authDb, scratchDir, envKeep, config.agentEngine));
      ctx.envInfo = { kiroCliVersion: sandbox.kiroCliVersion(ctx.kiroBin), modelListSnapshotPath: modelListPath };
    }

    const interpreters = toolchain.interpreterVersions();
    const anyChecks = tasks.some((t) => t.checks?.length || t.hiddenDir);
    const toolchainCheck = toolchain.checkPins(toolchain.loadPins(benchDir), interpreters, tasks.map((t) => t.id), { anyChecks });
    for (const m of toolchainCheck.mismatches) log(`warning: toolchain: ${toolchain.describeMismatch(m)}. Results may differ from the validated ones.`);

    const mainArm = arms.find((a) => a.id === 'main' || a.id === 'oc-main' || a.id === 'cc-main');
    runConfig = {
      suite: suite.name, harness: runtimes[0], armIds, taskIds: tasks.map((t) => t.id), replicates, parallel, maxAuthFailures, timeoutSecOverride: timeoutOverride, [isUsd ? 'budgetUsd' : 'budgetCredits']: budgetCredits, censoredFloor, seed,
      profile: profile ? { name: profile.name, aaArm: aa?.spec ? { arm: arms.at(-1).id, repeats: aa.twin } : null } : null,
      runCreditLimit, extraTasks: extraDirs, stopOn, maxToolCalls, armPrefix: armOpts.armPrefix, armAgent: armOpts.armAgent, armConfig: armOpts.armConfig, oracleSkills: armOpts.oracle,
      isolationGates: { installs: ctx.installsGate.dirs, claudeRules: 'an empty rules file in a scratch CLAUDE_CONFIG_DIR (Claude Code runs)' },
      variants: variants.map((v) => ({ ...v })),
      python: pythonPin,
      order: 'replicate-major, seeded shuffle of (task, arm) pairs per replicate',
      timeoutSecByTask: Object.fromEntries(tasks.map((t) => [t.id, t.timeoutSec])),
      level: levelPlan?.record ?? null,
      ...config, ...ctx.envInfo,
      isolation: { ...isolation, ...describeHide(isolation.mode, ctx.hide), mask: ctx.mask }, comparable: isComparableMode(isolation.mode), tripwire: { depth: ctx.tripwire.roots[0].depth, excludes: [...DEFAULT_EXCLUDES, ...tripExtra], roots: ctx.tripwire.roots.map((r) => r.dir) },
      arms: rc.armRecords(arms, prepared, errors, ctx.skillListings),
      resume,
      armDrift: armDrift.length ? armDrift.map((c) => ({ armId: c.armId, recorded: c.recorded, now: c.now, kind: c.kind })) : null,
      originMain: mainArm ? { originMainSha: mainArm.originMainSha, localMainSha: mainArm.localMainSha, behindOrigin: mainArm.behindOrigin, usedRef: mainArm.ref } : null,
      modelNormalized: arms.some((a) => !a.vanilla),
      ...(isSt ? {
        harnessVersion: ctx.strands.version,
        strands: {
          python: ctx.strands.python, version: ctx.strands.version, agentFile: ctx.strands.agentFile, adapter: 'kind B: plant tools are forwarding stubs', census: plantSuite?.strandsCensus ?? null,
          bedrock: stModel ? { ...stModel, spendCapUsd: budgetCredits, awsProfile: stCreds.profile } : null,
        },
        env: rc.envPolicy(process.env, []),
      } : isOc ? {
        harnessVersion: ctx.opencode.version,
        opencode: {
          npmPackage: `opencode-ai@${oc.VERSION}`, version: ctx.opencode.version, binaryPath: ctx.opencode.bin, binarySha256: ctx.opencode.sha256,
          provider: oc.PROVIDER, modelId: config.model, region: oc.REGION, variant: config.effort, title: oc.TITLE,
          awsProfile, ripgrep: ctx.rgBin,
          promptCache: 'Bedrock prompt cache lives about 5 minutes; back-to-back runs can read cache written by the previous run, so cache read and write vary with run order (seeded shuffle kept)',
        },
        env: rc.envPolicy(process.env, []),
      } : isCc ? {
        harnessVersion: ctx.claude.version,
        claudeCode: cc.runConfigRecord({ ctx, config, region: ccRegion, runBudgetUsd, arms }),
        env: rc.envPolicy(process.env, []),
      } : {
        requireMcpStartup: true,
        env: rc.envPolicy(process.env, envKeep),
        kiroBinary: { path: kiro.bin, bypassedShim: kiro.shim },
        kiroEnabledFeatures: process.env.KIRO_ENABLED_FEATURES ?? null,
        agentEnginesAvailable: rc.availableEngines(kiro.bin),
      }),
      ...(plantSuite ? { plant: { release: plantSuite.release.manifest.release, manifestSha256: plantSuite.release.manifestSha256, keyId: plantSuite.release.keyId, control: plantSuite.control, counted: plantSuite.counted, comparable: plantSuite.comparable, notCounted: plantSuite.notCounted, hostNoise: plantSuite.hostNoise, cgroup: ctx.cgroup ? (ctx.cgroup.ok ? ctx.cgroup.caps : `missing: ${ctx.cgroup.reason}`) : 'not checked (no namespace isolation)', boundaryChecklist: plantSuite.walls?.checklist ?? null } } : {}),
      ...rc.benchGit(REPO),
      contentHash: rc.hashTree(benchDir, ['tasks', 'fixtures', 'suites', 'real']),
      taskInputHashes: ctx.taskInputs.hashes(),
      ...(suitesDir ? { suitesDir, suiteFile: suiteFile(opts.suite, benchDir, suitesDir) } : {}),
      ...(realPins ? {
        real: {
          cache: realCache,
          tasks: realPins,
          // Hidden from the agent on top of the bench directories; the checks of these tasks also run without a network.
          hiddenForRealTasks: Object.fromEntries(realTasks.map((t) => [t.id, real.hidePaths(t, { cache: realCache })])),
          agentNetwork: 'open (the model API needs it); fetches are flagged after the run, not blocked',
        },
      } : {}),
      tools: rc.toolVersions({ kiroBin: kiro?.bin }),
      ...(opts.introspect ? { introspect: introspectRunConfig(runtimes[0]) } : {}),
      interpreters,
      toolchainCheck,
      startedAt: new Date().toISOString(),
    };
    writeRunConfig(outDir, runConfig);
    if (variants.length) {
      fs.mkdirSync(path.join(outDir, 'variants'), { recursive: true });
      for (const v of variants) fs.writeFileSync(path.join(outDir, 'variants', `${v.variantId}.json`), JSON.stringify(v, null, 2) + '\n');
    }
    // The Strands launcher env is the whole env, so it is described as one: every key set, nothing passed through.
    const strandsSetup = () => {
      const placeholder = stCreds ? { awsCreds: { current: () => Object.fromEntries(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'].map((k) => [k, '<set>'])) } } : null;
      const set = st.env({ home: '<run-home>', tmpdir: '<run>/tmp', ctx: placeholder });
      return { keys: Object.keys(set).sort(), set, unset: [] };
    };
    const envFor = (konductor) => (isSt
      ? strandsSetup()
      : isCc
      ? cc.envSetup({ arm: { vanilla: !konductor }, ctx, home: '<run-home>', tmpdir: '<run>/tmp', baseEnv: { ...process.env, ...Object.fromEntries(cc.CREDENTIAL_VARS.map((k) => [k, '<set>'])) } })
      : isOc
      ? oc.envSetup({ arm: { vanilla: !konductor }, config, ctx, home: '<run-home>' })
      : buildChildEnv(process.env, { home: '<run-home>', agentEngine: config.agentEngine, keep: envKeep, konductor }));
    fs.writeFileSync(path.join(outDir, 'env.json'), JSON.stringify({
      model: config.model, effort: config.effort,
      konductorArm: describeEnv(process.env, envFor(true)),
      vanillaArm: describeEnv(process.env, envFor(false)),
      interpreters,
      // The skill listing each arm's runs get (claude-listing.js; Kiro's record from its install), by arm id.
      skillListings: Object.fromEntries(arms.map((a) => [a.id, ctx.skillListings?.get(a.id)?.listing ?? null])),
    }, null, 2) + '\n');

    log(`out=${outDir}`);
    const { results, observed, charged, studyLine, guard, authStop } = await runAll({
      tasks, arms, prepared, prepErrors: errors, replicates, parallel, budgetCredits, censoredFloor, seed, outDir, ctx, state, log,
      costOf: isUsd ? USD : CREDITS, unit, gateStrict: Boolean(opts['gate-strict']), replicateOffset, resume, maxAuthFailures, loginCheck,
    });
    const judged = judgeBatch({ gate: batchWindow.end(), results, strict: Boolean(opts['gate-strict']), window: { from: batchFrom, to: new Date().toISOString() } });
    const gate = judged.gate;
    const { infra, skipped: infraCheckSkipped } = studyInfraCheck(results, plantSuite);
    if (infraCheckSkipped) log(infraCheckSkipped);
    const trialRows = plantSuite?.walls && plantSuite.control
      ? results.filter((r) => r?.armId).flatMap((r) => trialGatewayRows(path.join(outDir, r.armId, r.taskId, String(r.replicate)))) : [];
    if (trialRows.length) {
      plantSuite.walls.checklist = checklistWithTrials(plantSuite.walls.results, trialRows);
      log(`plant walls: with the prober trials' gateway rows; ${plantSuite.walls.checklist.map((c) => `${c.id} ${c.state}`).join(', ')}`);
    }
    writeAtomic(path.join(outDir, 'summary.json'), JSON.stringify(summarize(runConfig, { ...state, results, spent: observed, charged }, { isolationGate: gate, ...(authStop.tripped ? { authStop } : {}), ...(infra ? { infraFailure: infra } : {}), ...(infraCheckSkipped ? { infraCheckSkipped } : {}), ...(trialRows.length ? { plantBoundaryChecklist: plantSuite.walls.checklist } : {}), ...(judged.flagged.length ? { installsChangedRuns: judged.flagged } : {}) }), null, 2) + '\n');
    if (judged.warning) log(judged.warning);
    if (!gate.ok) {
      log(judged.alarm);
      process.exitCode = 4;
    }
    log(`finished: ${JSON.stringify(summarize(runConfig, { ...state, results }, {}).counts)}, ${observed.toFixed(3)} ${unit} observed, ${charged.toFixed(3)} charged`);
    log(`final ${studyLine}`);
    for (const line of creditNoteLines(creditNotes(results))) log(line);
    if (authStop.tripped) {
      log(authStop.kind === 'launch'
        ? `LAUNCH FAILURE: ${authStop.reason}. ${authStop.skipped} planned run(s) were skipped. Check that the kiro-cli binary is still in place, then rerun the skipped cells in a new --out or with --replicate-offset.`
        : `LOGIN FAILURE: ${authStop.reason}. ${authStop.skipped} planned run(s) were skipped. Log in to kiro-cli again, then rerun the skipped cells in a new --out or with --replicate-offset.`);
      if (!process.exitCode) process.exitCode = AUTH_EXIT_CODE;
    }
    if (infra) {
      log(`INFRA FAILURE: ${infra.reason}`);
      if (!process.exitCode) process.exitCode = 5;
    }
    if (guard === 'hard') {
      log('credit guard: HARD STOP, this command spent past 100% of --budget-credits; runs already in flight were counted, and no further run started');
      process.exitCode = 3;
    }
    if (profile?.calibrationSample) {
      try {
        const sample = writeCalibrationSample({ run: loadRun(outDir), n: profile.calibrationSample, seed: 1 });
        if (sample) log(`calibration sample: ${sample.items} run(s) listed in ${sample.md}`);
      } catch (e) { log(`calibration sample not written: ${e.message}`); }
    }
  } finally {
    removeHandlers();
    plantSuite?.dispose();
    await new Promise((r) => setTimeout(r, 500));
    procs.removeAllScratch();
  }
}

module.exports = { cmdRun, repoRootOf, maskPaths, replicateOffsetOpt, timeoutSecOpt };
