// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js run`: resolve and build all arms, record the run configuration, run, summarize.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveArm } = require('./arms.js');
const { applyArmOptions, attachVariant } = require('./arm-opts.js');
const { applyOracle } = require('./oracle.js');
const { applyForcedMustLoad } = require('./forced-must-load.js');
const { STOP_ON } = require('./stop-watch.js');
const { harnessFor } = require('./harness/index.js');
const { AGENT_ENGINES, DEFAULT_ENGINE, isUsdRuntime, descriptorOf, supporting, notSupporting, joinNames } = require('./harness/runtime.js');
const { DESCRIPTORS, REGISTRY } = require('./harness/descriptors.js');
const { isSuiteName, loadTasks, loadSuite, suiteExtraDirs, suiteDirs, suiteFile, mergeExtraDirs, benchMask, SUITE_NAMES, BENCH_DIR } = require('./tasks.js');
const { repoRootOf } = require('./flag-values.js');
const real = require('./real.js');
const reallib = require('../../real/lib.js');
const { runAll, prepareAll, preflightTable, describePlan, budgetNote, DEFAULT_CENSORED_FLOOR, CREDITS, USD, PAIR_ORDERS } = require('./orchestrate.js');
const { resolveIsolation, describeHide, ISOLATE_MODES, isComparableMode } = require('./isolate.js');
const { DEFAULT_EXCLUDES, REPO_EXCLUDES } = require('./tripwire.js');
const procs = require('./procs.js');
const sandbox = require('./sandbox.js');
const rc = require('./runconfig.js');
const { envInfoOf, harnessRunConfig, writeEnvJson } = require('./run-harness.js');
const { optionalProfile, replicatesFor, aaArmFor, writeCalibrationSample } = require('./profiles.js');
const { loadRun } = require('./load-run.js');
const { createInstallsGate, describeChange, judgeBatch } = require('./isolation-gates.js');
const toolchain = require('./toolchain.js');
const { pinPython } = require('./python-pin.js');
const { isFreeRun, requireRunBudget } = require('./paid-run.js');
// A string flag value, or null when the flag is absent or given bare.
const strOpt = (v) => (v !== undefined && v !== true && v !== '' ? String(v) : null);
const { ensureOwnedDir, writeAtomic } = require('./owned.js');
const { studyInfraCheck } = require('./infra-check.js');
const { maxAuthFailuresOf, AUTH_EXIT_CODE } = require('./auth-failure.js');
const { makeLoginCheck } = require('./login-check.js');
const { preparePlantSuite, checkSuiteShape } = require('./plant/intake.js');
const { preflightWalls, trialGatewayRows, checklistWithTrials } = require('./plant/walls.js');
const { makeIso } = require('./run-one.js');
const { pinConflicts, describeConflicts } = require('./study-pins.js');
const { writeRunConfig } = require('./run-configs.js');
const { makeRunnerLog } = require('./log.js');
const { preloadSchemas } = require('./schema.js');
const { snapshotTaskInputs } = require('./task-inputs.js');
const { requirePrereg } = require('../../scenarios/prereg.js');
const { planLevel } = require('../../scenarios/konductor/levels.js');
const { creditNotes, creditNoteLines } = require('./credit-notes.js');
const { runConfigRecord: introspectRunConfig } = require('./introspect/index.js');

const DEFAULT_EFFORT = 'high';
// Censored opencode runs are charged this many USD when the arm has no completed run yet.
const DEFAULT_CENSORED_FLOOR_USD = 0.5;
// --run-credit-limit-mode values; the first is the default (hard: stop the run at the limit; soft: warn and let it finish).
const CREDIT_LIMIT_MODES = ['hard', 'soft'];

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
  // A harness checks what prepare-only needs of it (prepareOnlyCheck: Claude Code's Bedrock model, its scratch root, a
  // run of its arms alone); its binary itself is never started.
  for (const r of runtimes) harnessFor({ runtime: r }).prepareOnlyCheck?.({ opts, runtimes, defaultEffort: DEFAULT_EFFORT });
  const cacheDir = path.resolve(opts.cache || path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(opts['cargo-target'] || process.env.CARGO_TARGET_DIR || path.join(cacheDir, 'cargo-target'));
  ensureOwnedDir(cacheDir, 'cache');
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);
  for (const a of arms) for (const w of a.warnings) log(`warning: arm ${a.id}: ${w}`);
  const window = createInstallsGate().begin();
  try {
    const py = pinPython({ tasks, scratchDir, benchDir, flag: strOpt(opts.python), plantPython: strOpt(opts['plant-python']) });
    if (py) log(`python: ${py.version} (${py.executable}, from ${py.source}); python3 in the sandbox is ${py.sandboxVersion}`);
    const ctx = {
      repo, cacheDir, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb: null,
      config: modelConfigOf({ runtime: runtimes[0], opts, agentEngine }), envKeep: list(opts['env-keep']),
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
 * Returns the parsed values the run uses: `{budgetFlag, budgetCredits, censoredFloor, runCreditLimit, runCreditLimitMode, stopOn}`.
 * `runCreditLimitMode` is 'hard' (stop the run at the limit) or 'soft' (warn, flag and let it finish); null without a limit.
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
  // A harness checks its own flags here (checkFlags: Claude Code's effort word).
  harnessFor({ runtime }).checkFlags?.({ opts, defaultEffort: DEFAULT_EFFORT });
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
  const mode = opts['run-credit-limit-mode'];
  if (mode !== undefined && !CREDIT_LIMIT_MODES.includes(mode)) throw new Error(`--run-credit-limit-mode takes ${CREDIT_LIMIT_MODES.join(' or ')}${typeof mode === 'string' ? `, not "${mode}"` : ''}`);
  if (mode !== undefined && runCreditLimit === null) throw new Error('--run-credit-limit-mode needs --run-credit-limit');
  const runCreditLimitMode = runCreditLimit === null ? null : mode ?? 'hard';
  let stopOn = null;
  if (opts['stop-on'] !== undefined) {
    stopOn = opts['stop-on'];
    if (!STOP_ON.includes(stopOn)) throw new Error(`--stop-on takes ${STOP_ON.slice(0, -1).join(', ')} or ${STOP_ON.at(-1)}`);
  }
  return { budgetFlag, budgetCredits, censoredFloor, runCreditLimit, runCreditLimitMode, stopOn };
}

/**
 * The run limits and switches of `opts`, checked (DEBT D-24): auth-failure stop, tool-call limit, seed, isolation mode
 * (--isolate none also needs --allow-unisolated) and the env names to keep. Throws on a bad value.
 */
function runLimitsOpt(opts) {
  const maxAuthFailures = maxAuthFailuresOf(opts['max-auth-failures'], process.env.BENCH_MAX_AUTH_FAILURES);
  const maxToolCalls = opts['max-tool-calls'] === undefined ? null : intOpt(opts['max-tool-calls'], 'max-tool-calls');
  const seed = opts.seed === undefined ? Date.now() % 2147483647 : intOpt(opts.seed, 'seed', 0);
  const isolate = opts.isolate || 'auto';
  if (!ISOLATE_MODES.includes(isolate)) throw new Error(`--isolate must be one of ${ISOLATE_MODES.join(', ')}`);
  if (isolate === 'none' && !opts['allow-unisolated']) {
    throw new Error('--isolate none runs the agent with no containment, and its results are recorded as not comparable and are never counted by a verdict. Pass --allow-unisolated as well to run anyway.');
  }
  const envKeep = list(opts['env-keep']);
  return { maxAuthFailures, maxToolCalls, seed, isolate, envKeep };
}

/**
 * --pair-order and --fill-skipped, checked. --fill-skipped X runs every budget_skipped cell once more before the
 * command ends, while this command's spend stays under X (the same rules as --budget-credits, which X must not be under).
 */
function fillOpts(opts, budgetCredits) {
  const pairOrder = opts['pair-order'] === undefined ? 'konductor-first' : opts['pair-order'];
  if (!PAIR_ORDERS.includes(pairOrder)) throw new Error(`--pair-order takes ${PAIR_ORDERS.join(' or ')}`);
  let fillBudget = null;
  if (opts['fill-skipped'] !== undefined) {
    fillBudget = Number(opts['fill-skipped']);
    if (opts['fill-skipped'] === true || !(fillBudget > 0)) throw new Error('--fill-skipped must be a positive number: the budget of the fill pass');
    if (budgetCredits !== null && fillBudget < budgetCredits) throw new Error(`--fill-skipped ${fillBudget} is under the budget ${budgetCredits}: the fill pass would skip the same cells`);
  }
  return { pairOrder, fillBudget };
}

/**
 * Prepares the plant suite of a run (DEBT D-24): release intake, the wall prober under unshare, the Strands hook census,
 * and the log lines that say what the suite counts as. Sets ctx.plant, ctx.cgroup and the plant masks; returns the suite.
 */
async function setUpPlantSuite({ opts, arms, tasks, parallel, outDir, ctx, repo, deps, isolation, harness, scratchDir, log }) {
  const plantSuite = preparePlantSuite({ opts, arms, tasks, parallel, outDir, ctx, repo, ...deps.plant });
  // A setup step that throws after intake removes the suite here: the caller has not been handed it yet.
  try {
    ctx.plant = plantSuite;
    plantSuite.log = log;
    ctx.mask.push(...plantSuite.mask);
    if (isolation.mode === 'unshare') {
      const walls = await preflightWalls({ ctx, suite: plantSuite, repo, outDir, makeIso: (root, plantRun) => makeIso(ctx, arms[0], root, null, { plantRun }) });
      ctx.cgroup = walls.cgroup;
      plantSuite.walls = walls;
      log(`plant walls: prober passed; ${walls.checklist.map((c) => `${c.id} ${c.state}`).join(', ')}; cgroup ${walls.cgroup.ok ? walls.cgroup.caps : `missing (${walls.cgroup.reason})`}`);
    }
    // A harness whose agent can change plant calls in its own process checks the suite first (Strands: the hook census).
    harness.plantPreflight?.({ ctx, suite: plantSuite, arms, scratchDir, wrap: (file, args) => makeIso(ctx, arms[0], scratchDir, null).wrap(file, args), log });
    if (plantSuite.hostNoise.length) log(`warning: plant: host failed quiet-host checks (${plantSuite.hostNoise.join(', ')}); this suite is not counted`);
    log(`plant release ${plantSuite.release.manifest.release} (manifest ${plantSuite.release.manifestSha256.slice(0, 12)}, key ${plantSuite.release.keyId.slice(0, 12)}), ${plantSuite.control ? 'control' : plantSuite.counted ? 'counted' : `NOT COUNTED (${plantSuite.notCounted.join('; ')})`} suite`);
  } catch (e) {
    plantSuite.dispose();
    throw e;
  }
  return plantSuite;
}

/**
 * The closing lines of a run (DEBT D-24): the study line, unfilled budget-skipped cells, credit notes, and a login,
 * launch, infra or hard credit stop, each of which sets process.exitCode (auth AUTH_EXIT_CODE, infra 5, hard stop 3).
 */
function logOutcome({ results, studyLine, fill, authStop, infra, guard, log }) {
  log(`final ${studyLine}`);
  const leftSkipped = results.filter((r) => r?.status === 'budget_skipped').length;
  if (leftSkipped) log(`budget_skipped: ${leftSkipped} cell(s) never ran${fill ? ` (fill pass: ${fill.filled} of ${fill.tried} filled)` : ''}; their pairs are unpaired until filled (--resume, or --fill-skipped X)`);
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
}

/**
 * The tasks of a run (DEBT D-24): the suite's task list, or --tasks, or the --level selection, each with --timeout-sec
 * applied. Throws on an unknown or empty selection, and when --prereg does not cover it.
 */
function selectTasks(opts, benchDir, suitesDir) {
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
  return { extraDirs, suite, levelPlan, timeoutOverride, tasks };
}

/**
 * The arms of a run (DEBT D-24): --arms or the suite's, resolved against `repo`, with the arm flags, the oracle and the
 * forced loads applied, the profile's A/A repeat added (it copies its twin's prefix, agent and config), and the variants.
 */
function resolveRunArms({ opts, suite, tasks, repo, benchDir, profile }) {
  const armIds = [...(opts.arms ? list(opts.arms) : suite.arms)];
  const arms = armIds.map((id) => resolveArm(id, repo));
  const armOpts = applyArmOptions(arms, opts);
  armOpts.oracle = applyOracle(arms, opts, { tasks, repo, benchDir });
  armOpts.forcedMustLoad = applyForcedMustLoad(arms, opts, { tasks, repo });
  const aa = profile?.aaArm ? aaArmFor(arms) : null;
  if (aa?.spec) {
    // The repeat runs under the same conditions as the arm it repeats, so it takes that arm's prefix, entry agent and config.
    const twin = arms.find((a) => a.id === aa.twin);
    const copy = resolveArm(aa.spec, repo);
    for (const k of ['prefixText', 'prefixInfo', 'agent', 'agentOverride', 'armConfig', 'oracle', 'forcedLoad']) if (twin[k] !== undefined) copy[k] = twin[k];
    arms.push(copy);
    armIds.push(copy.id);
  }
  return { arms, armIds, armOpts, aa, variants: arms.map(attachVariant).filter(Boolean) };
}

/**
 * The dirs and files a run writes or reads (DEBT D-24): --out (a timestamped dir under bench/results by default), the
 * --resume state, arm drift against earlier results there (refused unless --allow-arm-drift), the cache and cargo
 * target, the kiro-cli auth db and opencode's credentials file. Makes the owned dirs, and refuses a scratch root under
 * which Claude Code or konductor would find skills that are not the arm's.
 */
function runPaths({ opts, repo, arms, isUsd, runtime, log }) {
  const outDir = path.resolve(opts.out || path.join(repo, 'bench', 'results', new Date().toISOString().replace(/[:.]/g, '-')));
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
  // A harness whose agent reads a credentials file names it (credentialsFile: opencode's --aws-creds-file and profile).
  const { awsCredsFile = null, awsProfile = null } = harnessFor({ runtime }).credentialsFile?.({ opts }) ?? {};

  ensureOwnedDir(outDir, 'run-out');
  ensureOwnedDir(cacheDir, 'cache');
  if (opts['cargo-target'] || !process.env.CARGO_TARGET_DIR) for (const t of [cargoTarget, `${cargoTarget}-mcp`]) ensureOwnedDir(t, 'cargo-target');
  // A harness whose agent loads skill dirs found above its cwd checks the scratch root (Claude Code: .claude/skills;
  // the konductor agents on Kiro CLI: .kiro/skills/ws-*, D-36). Runs, trial installs and probes all sit under os.tmpdir().
  harnessFor({ runtime }).checkScratchRoot?.(os.tmpdir());
  return { outDir, resume, armDrift, cacheDir, cargoTarget, authDb, awsCredsFile, awsProfile };
}

/**
 * Logs the plan of a run (profile, A/A repeat, cells, budget note, isolation and the warnings that make it not
 * comparable) and resolves the isolation mode, which it returns (DEBT D-24). --no-default-hide sets its env switch.
 */
function announceRun({ opts, profile, aa, tasks, arms, replicates, parallel, budgetCredits, budgetFlag, unit, timeoutOverride, isolate, log }) {
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
  return isolation;
}

/**
 * The tripwire roots of a run (DEBT D-24): the real HOME (depth --tripwire-depth, default 3), the repo (depth 8) and
 * --tripwire-dir (default TMPDIR/konductor-bench), with the run's own out, cache, cargo and scratch dirs excluded.
 */
function tripwireOf({ opts, home, repo, tripExtra, outDir, cacheDir, cargoTarget, scratchDir, realCache }) {
  return {
    roots: [
      { dir: home, depth: opts['tripwire-depth'] ? intOpt(opts['tripwire-depth'], 'tripwire-depth') : 3, exclude: DEFAULT_EXCLUDES },
      { dir: repo, depth: 8, exclude: REPO_EXCLUDES },
      ...(opts['tripwire-dir'] ? list(opts['tripwire-dir']) : [path.join(os.tmpdir(), 'konductor-bench')]).map((dir) => ({ dir, depth: 4, exclude: ['target-shared'] })),
    ],
    extraExcludes: tripExtra,
    absExclude: [outDir, cacheDir, cargoTarget, `${cargoTarget}-mcp`, scratchDir, ...(realCache ? [realCache] : [])],
  };
}

/** The interpreter versions and the toolchain pin check of `tasks`, with a warning per mismatch (DEBT D-24). */
function toolchainOf(tasks, benchDir, log) {
  const interpreters = toolchain.interpreterVersions();
  const anyChecks = tasks.some((t) => t.checks?.length || t.hiddenDir);
  const toolchainCheck = toolchain.checkPins(toolchain.loadPins(benchDir), interpreters, tasks.map((t) => t.id), { anyChecks });
  for (const m of toolchainCheck.mismatches) log(`warning: toolchain: ${toolchain.describeMismatch(m)}. Results may differ from the validated ones.`);
  return { interpreters, toolchainCheck };
}

/** Writes `value` as indented JSON to `file` (atomically: a temp file, then a rename), making its dir. */
function writeJsonFile(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

/**
 * The gateway rows of a plant control suite's trials, folded into the wall checklist (B-4, B-5 from real trials) and
 * logged; [] for any other suite (DEBT D-24).
 */
function plantChecklistAfter({ plantSuite, results, outDir, log }) {
  const trialRows = plantSuite?.walls && plantSuite.control
    ? results.filter((r) => r?.armId).flatMap((r) => trialGatewayRows(path.join(outDir, r.armId, r.taskId, String(r.replicate)))) : [];
  if (trialRows.length) {
    plantSuite.walls.checklist = checklistWithTrials(plantSuite.walls.results, trialRows);
    log(`plant walls: with the prober trials' gateway rows; ${plantSuite.walls.checklist.map((c) => `${c.id} ${c.state}`).join(', ')}`);
  }
  return trialRows;
}

/** The profile's calibration sample of the finished run in `outDir`; a failure is logged, never thrown (DEBT D-24). */
function writeSampleOf(profile, outDir, log) {
  try {
    const sample = writeCalibrationSample({ run: loadRun(outDir), n: profile.calibrationSample, seed: 1 });
    if (sample) log(`calibration sample: ${sample.items} run(s) listed in ${sample.md}`);
  } catch (e) { log(`calibration sample not written: ${e.message}`); }
}

/** The model, effort (and agent engine for Kiro CLI) a run of `runtime` uses, from --model and --effort (DEBT D-24). */
function modelConfigOf({ runtime, opts, agentEngine }) {
  return harnessFor({ runtime }).modelConfig({ opts, agentEngine, defaultEffort: DEFAULT_EFFORT });
}

/**
 * The run-config record of a run (DEBT D-24): the plan, the flags, the arms, the isolation, the harness record, the
 * plant suite, the bench commit and content hashes, the real-repo pins and the tool versions, with startedAt.
 */
/**
 * The run-config.json record of a run. `flags`: what the command line chose (suite, runtimes, armIds, tasks, replicates, parallel, maxAuthFailures, timeoutOverride, isUsd, budgetCredits, censoredFloor, seed, pairOrder, fillBudget, profile, aa, runCreditLimit, extraDirs, stopOn, maxToolCalls, armOpts, levelPlan, config, isolation, resume, stModel, stCreds, awsProfile, ccRegion, runBudgetUsd, envKeep, tripExtra and the
 * parsed `opts`). `built`: what the runner prepared (ctx, arms, variants, pythonPin, prepared, errors, armDrift, plantSuite, kiro, realPins, realCache, realTasks, interpreters, toolchainCheck). `paths`: where the repo, bench and suites live.
 */
function buildRunConfig({ flags, built, paths }) {
  const { suite, runtimes, armIds, tasks, replicates, parallel, maxAuthFailures, timeoutOverride, isUsd, budgetCredits, censoredFloor, seed, pairOrder, fillBudget, profile, aa, runCreditLimit, extraDirs, stopOn, maxToolCalls, armOpts, levelPlan, config, isolation, resume, stModel, stCreds, awsProfile, ccRegion, runBudgetUsd, envKeep, tripExtra, opts } = flags;
  const { ctx, arms, variants, pythonPin, prepared, errors, armDrift, plantSuite, kiro, realPins, realCache, realTasks, interpreters, toolchainCheck } = built;
  const { REPO, benchDir, suitesDir } = paths;
  const mainArm = arms.find((a) => a.id === 'main' || a.id === 'oc-main' || a.id === 'cc-main');
  return {
    suite: suite.name, harness: runtimes[0], armIds, taskIds: tasks.map((t) => t.id), replicates, parallel, maxAuthFailures, timeoutSecOverride: timeoutOverride, [isUsd ? 'budgetUsd' : 'budgetCredits']: budgetCredits, censoredFloor, seed,
    pairOrder, fillBudget,
    profile: profile ? { name: profile.name, aaArm: aa?.spec ? { arm: arms.at(-1).id, repeats: aa.twin } : null } : null,
    runCreditLimit, extraTasks: extraDirs, stopOn, maxToolCalls, armPrefix: armOpts.armPrefix, armAgent: armOpts.armAgent, armConfig: armOpts.armConfig, oracleSkills: armOpts.oracle, forcedMustLoad: armOpts.forcedMustLoad,
    isolationGates: { installs: ctx.installsGate.dirs, claudeRules: 'an empty rules file in a scratch CLAUDE_CONFIG_DIR (Claude Code runs)' },
    variants: variants.map((v) => ({ ...v })),
    python: pythonPin,
    plugins: REGISTRY.record(),
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
    ...harnessRunConfig({ runtime: runtimes[0], ctx, config, plantSuite, stModel, stCreds, budgetCredits, awsProfile, ccRegion, runBudgetUsd, arms, envKeep, kiro }),
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
}

/**
 * The kiro-cli login check, run before any arm is built: a lapsed login would only fail every run. True when the run
 * may go on (no check, or logged in); false after it logs the failure and sets exit code 6.
 */
async function loginOk(loginCheck, log) {
  if (!loginCheck) return true;
  const login = await loginCheck();
  if (!login.ok) {
    log(`LOGIN FAILURE: kiro-cli is not logged in (${login.detail}). Log in again, then start the chunk right away; nothing was run.`);
    process.exitCode = AUTH_EXIT_CODE;
    return false;
  }
  log(login.unavailable ? `warning: login check unavailable: ${login.unavailable}` : 'kiro-cli login ok');
  return true;
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
  const { extraDirs, suite, levelPlan, timeoutOverride, tasks } = selectTasks(opts, benchDir, suitesDir);
  // Real tasks read their base tree from a local cache filled beforehand; stop here, not after the arms are built.
  const prepareOnly = Boolean(opts['prepare-only']);
  const realTasks = prepareOnly ? [] : tasks.filter((t) => t.real);
  const realCache = realTasks.length ? reallib.resolveCache(opts['real-cache'] && opts['real-cache'] !== true ? opts['real-cache'] : undefined) : null;
  if (realCache) process.env.BENCH_REAL_CACHE = realCache;
  const realPins = realCache ? real.preflight(realTasks, { cache: realCache }) : null;
  const profile = optionalProfile(opts.profile);
  const replicates = profile ? replicatesFor(profile, opts.replicates) : opts.replicates ? intOpt(opts.replicates, 'replicates') : suite.replicates;
  const replicateOffset = replicateOffsetOpt(opts);
  const parallel = opts.parallel ? intOpt(opts.parallel, 'parallel') : suite.parallel;
  const REPO = repoRootOf(opts);
  const { arms, armIds, armOpts, aa, variants } = resolveRunArms({ opts, suite, tasks, repo: REPO, benchDir, profile });
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
  const desc = descriptorOf(runtimes[0]);
  const unit = desc.costUnit;
  const isUsd = unit === 'usd';
  const { budgetFlag, budgetCredits, censoredFloor, runCreditLimit, stopOn } = checkHarnessFlags({ opts, tasks, runtime: runtimes[0] });
  // A harness whose agent signs its own model calls checks its credentials before anything starts (runCredentials).
  const harness = harnessFor({ runtime: runtimes[0] });
  const ccCreds = harness.runCredentials ? harness.runCredentials({ opts, deps }).creds : null;
  requireRunBudget({ free: isFreeRun({ opts }), budget: budgetCredits, budgetFlag });
  const { maxAuthFailures, maxToolCalls, seed, isolate, envKeep } = runLimitsOpt(opts);
  const { pairOrder, fillBudget } = fillOpts(opts, budgetCredits);

  // Console lines as before, and the same lines plus start, cell and end events in <out>/runner.log once the out dir is known.
  const log = makeRunnerLog({ write: (s) => console.error(s) });
  const isolation = announceRun({ opts, profile, aa, tasks, arms, replicates, parallel, budgetCredits, budgetFlag, unit, timeoutOverride, isolate, log });

  const { outDir, resume, armDrift, cacheDir, cargoTarget, authDb, awsCredsFile, awsProfile } = runPaths({ opts, repo: REPO, arms, isUsd, runtime: runtimes[0], log });
  log.attach(outDir);
  log.event('info', 'start', { suite: suite.name, harness: runtimes[0], arms: arms.map((a) => a.id), tasks: tasks.map((t) => t.id), replicates, resume: Boolean(resume) });
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);
  // Pins python3 for the agent, the checks and the gateway (S6); refuses when tasks run Python and 3.12 is not found.
  const pythonPin = pinPython({ tasks, scratchDir, benchDir, flag: strOpt(opts.python), plantPython: strOpt(opts['plant-python']) });

  // The harness's own run options (runOptions): Claude Code's per-run budget and region, Strands' Bedrock model and keys.
  const runOpts = harness.runOptions ? harness.runOptions({ opts, deps }) : {};
  if (opts['aws-region'] !== undefined && runOpts.region === undefined) throw new Error('--aws-region applies to Claude Code (cc-) arms only; judge commands take it separately');
  const { runBudgetUsd = null, region: ccRegion = null, stModel = null, stCreds = null } = runOpts;
  // A Strands run on Bedrock spends money. It needs --budget-usd (what is left of it is each run's hard cap, enforced
  // in the launcher before every model call) and --aws-profile (only that profile's exported keys reach the agent).
  // Strands arms are plant arms, and a plant suite runs at --parallel 1 (intake.js), so no two runs share what is left.
  const config = modelConfigOf({ runtime: runtimes[0], opts, agentEngine });
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
    if (!(await loginOk(loginCheck, log))) return;
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
    // The harness's own run context: its binary, credentials and spend cap (setUpRun; Kiro CLI's is set above).
    harness.setUpRun?.(ctx, { opts, cacheDir, awsCredsFile, awsProfile, config, outDir, ccRegion, runBudgetUsd, ccCreds, stModel, stCreds, budgetCredits, state, log });
    const { prepared, errors } = prepareAll({ arms, ctx, log, allowPartial: Boolean(opts['allow-partial']) });
    log(`arms:\n${preflightTable(arms, prepared, errors)}`);

    const home = fs.realpathSync(os.homedir());
    const tripExtra = list(opts['tripwire-exclude']);
    ctx.isolation = isolation;
    ctx.hide = [...list(opts.hide), ...list(process.env.BENCH_HIDE_EXTRA)];
    ctx.mask = maskPaths({ benchDir, extraDirs, outDir, awsCredsFile });
    Object.assign(ctx, { runCreditLimit, stopOn, maxToolCalls });
    ctx.keyRoots = [benchDir];
    if (arms.some((a) => a.plant)) plantSuite = await setUpPlantSuite({ opts, arms, tasks, parallel, outDir, ctx, repo: REPO, deps, isolation, harness, scratchDir, log });
    ctx.tripwire = tripwireOf({ opts, home, repo: REPO, tripExtra, outDir, cacheDir, cargoTarget, scratchDir, realCache });
    ctx.envInfo = envInfoOf({ runtime: runtimes[0], ctx, ccRegion, outDir, authDb, scratchDir, envKeep, config });
    const { interpreters, toolchainCheck } = toolchainOf(tasks, benchDir, log);

    runConfig = buildRunConfig({
      flags: { suite, runtimes, armIds, tasks, replicates, parallel, maxAuthFailures, timeoutOverride, isUsd, budgetCredits, censoredFloor, seed, pairOrder, fillBudget, profile, aa, runCreditLimit, extraDirs, stopOn, maxToolCalls, armOpts, levelPlan, config, isolation, resume, stModel, stCreds, awsProfile, ccRegion, runBudgetUsd, envKeep, tripExtra, opts },
      built: { ctx, arms, variants, pythonPin, prepared, errors, armDrift, plantSuite, kiro, realPins, realCache, realTasks, interpreters, toolchainCheck },
      paths: { REPO, benchDir, suitesDir },
    });
    writeRunConfig(outDir, runConfig);
    for (const v of variants) writeJsonFile(path.join(outDir, 'variants', `${v.variantId}.json`), v);
    writeEnvJson({ outDir, runtime: runtimes[0], ctx, config, envKeep, stCreds, interpreters, arms });

    log(`out=${outDir}`);
    const { results, observed, charged, studyLine, guard, authStop, fill } = await runAll({
      tasks, arms, prepared, prepErrors: errors, replicates, parallel, budgetCredits, censoredFloor, seed, outDir, ctx, state, log,
      costOf: isUsd ? USD : CREDITS, unit, gateStrict: Boolean(opts['gate-strict']), replicateOffset, resume, maxAuthFailures, loginCheck,
      pairOrder, fillBudget,
    });
    const judged = judgeBatch({ gate: batchWindow.end(), results, strict: Boolean(opts['gate-strict']), window: { from: batchFrom, to: new Date().toISOString() } });
    const gate = judged.gate;
    const { infra, skipped: infraCheckSkipped } = studyInfraCheck(results, plantSuite);
    if (infraCheckSkipped) log(infraCheckSkipped);
    const trialRows = plantChecklistAfter({ plantSuite, results, outDir, log });
    writeAtomic(path.join(outDir, 'summary.json'), JSON.stringify(summarize(runConfig, { ...state, results, spent: observed, charged }, { isolationGate: gate, ...(authStop.tripped ? { authStop } : {}), ...(fill ? { fill } : {}), ...(infra ? { infraFailure: infra } : {}), ...(infraCheckSkipped ? { infraCheckSkipped } : {}), ...(trialRows.length ? { plantBoundaryChecklist: plantSuite.walls.checklist } : {}), ...(judged.flagged.length ? { installsChangedRuns: judged.flagged } : {}) }), null, 2) + '\n');
    if (judged.warning) log(judged.warning);
    if (!gate.ok) {
      log(judged.alarm);
      process.exitCode = 4;
    }
    const counts = summarize(runConfig, { ...state, results }, {}).counts;
    log(`finished: ${JSON.stringify(counts)}, ${observed.toFixed(3)} ${unit} observed, ${charged.toFixed(3)} charged`);
    log.event(gate.ok ? 'info' : 'error', 'end', { counts, observed, charged, unit, isolationGateOk: gate.ok });
    logOutcome({ results, studyLine, fill, authStop, infra, guard, log });
    if (profile?.calibrationSample) writeSampleOf(profile, outDir, log);
  } finally {
    removeHandlers();
    plantSuite?.dispose();
    await new Promise((r) => setTimeout(r, 500));
    procs.removeAllScratch();
  }
}

module.exports = { cmdRun, repoRootOf, maskPaths, replicateOffsetOpt, timeoutSecOpt, fillOpts };
