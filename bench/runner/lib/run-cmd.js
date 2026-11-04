// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js run`: resolve and build all arms, record the run configuration, run, summarize.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveArm } = require('./arms.js');
const { applyArmOptions, attachVariant } = require('./arm-opts.js');
const { STOP_ON } = require('./stop-watch.js');
const { harnessFor, opencode: oc, claudeCode: cc } = require('./harness/index.js');
const { AGENT_ENGINES, DEFAULT_ENGINE, isUsdRuntime } = require('./harness/runtime.js');
const { readProfile } = require('./harness/opencode-creds.js');
const { loadTasks, loadSuite, benchMask, SUITE_NAMES, BENCH_DIR } = require('./tasks.js');
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
const { createInstallsGate, describeChange } = require('./isolation-gates.js');
const toolchain = require('./toolchain.js');

const DEFAULT_MODEL = 'claude-sonnet-5.5';
const DEFAULT_EFFORT = 'high';
const DEFAULT_REPO = path.resolve(BENCH_DIR, '..');
// Censored opencode runs are charged this many USD when the arm has no completed run yet.
const DEFAULT_CENSORED_FLOOR_USD = 0.5;

function intOpt(v, name, min = 1) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`--${name} must be an integer >= ${min}`);
  return n;
}

// --agent-engine picks the kiro-cli engine and the matching install (v2: kiro-cli-v2, v3: kiro-v3). opencode and Claude Code have no engine.
function engineOpt(opts, runtimes) {
  const v = opts['agent-engine'];
  if (v === undefined) return DEFAULT_ENGINE;
  const other = runtimes.find((r) => r !== 'kiro-cli');
  if (other) throw new Error(`--agent-engine applies to kiro-cli arms only; ${other} arms have no agent engine`);
  if (!AGENT_ENGINES.includes(v)) throw new Error(`--agent-engine must be ${AGENT_ENGINES.join(' or ')}`);
  return v;
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
    ...extra,
  };
}

// Builds and trial-installs every arm exactly as `run` does before it launches an agent, prints the preflight table
// and stops. It needs no kiro-cli login, creates no run directory and starts no agent, so it spends no credits.
function prepareOnlyRun({ opts, arms, runtimes, repo, agentEngine, log }) {
  if (runtimes.some((r) => r !== 'kiro-cli')) throw new Error('--prepare-only covers kiro-cli arms; opencode and Claude Code arms need their binary and AWS credentials, so check them with a normal run');
  const cacheDir = path.resolve(opts.cache || path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(opts['cargo-target'] || process.env.CARGO_TARGET_DIR || path.join(cacheDir, 'cargo-target'));
  fs.mkdirSync(cacheDir, { recursive: true });
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);
  for (const a of arms) for (const w of a.warnings) log(`warning: arm ${a.id}: ${w}`);
  const window = createInstallsGate().begin();
  try {
    const ctx = {
      repo, cacheDir, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb: null,
      config: { model: opts.model || DEFAULT_MODEL, effort: opts.effort || DEFAULT_EFFORT, agentEngine }, envKeep: list(opts['env-keep']),
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

const repoRootOf = (opts) => path.resolve(opts['repo-root'] && opts['repo-root'] !== true ? opts['repo-root'] : process.env.BENCH_REPO_ROOT || DEFAULT_REPO);

async function cmdRun(opts) {
  if (!SUITE_NAMES.includes(opts.suite)) throw new Error(`--suite ${SUITE_NAMES.join('|')} is required`);
  const benchDir = opts['bench-dir'] ? path.resolve(opts['bench-dir']) : BENCH_DIR;
  const extraDirs = list(opts['extra-tasks']).map((d) => path.resolve(d));
  const tasksAll = loadTasks(benchDir, { extraDirs });
  const suite = loadSuite(opts.suite, tasksAll, benchDir);
  const taskIds = opts.tasks ? list(opts.tasks) : suite.taskIds;
  const tasks = taskIds.map((id) => {
    const t = tasksAll.get(id);
    if (!t) throw new Error(`unknown task "${id}" (known: ${[...tasksAll.keys()].join(', ') || 'none'})`);
    return t;
  });
  if (!tasks.length) throw new Error('no tasks selected');
  // Real tasks read their base tree from a local cache filled beforehand; stop here, not after the arms are built.
  const prepareOnly = Boolean(opts['prepare-only']);
  const realTasks = prepareOnly ? [] : tasks.filter((t) => t.real);
  const realCache = realTasks.length ? reallib.resolveCache(opts['real-cache'] && opts['real-cache'] !== true ? opts['real-cache'] : undefined) : null;
  if (realCache) process.env.BENCH_REAL_CACHE = realCache;
  const realPins = realCache ? real.preflight(realTasks, { cache: realCache }) : null;
  const profile = optionalProfile(opts.profile);
  const armIds = [...(opts.arms ? list(opts.arms) : suite.arms)];
  const replicates = profile ? replicatesFor(profile, opts.replicates) : opts.replicates ? intOpt(opts.replicates, 'replicates') : suite.replicates;
  const parallel = opts.parallel ? intOpt(opts.parallel, 'parallel') : suite.parallel;
  const REPO = repoRootOf(opts);
  const arms = armIds.map((id) => resolveArm(id, REPO));
  const armOpts = applyArmOptions(arms, opts);
  const aa = profile?.aaArm ? aaArmFor(arms) : null;
  if (aa?.spec) {
    // The repeat runs under the same conditions as the arm it repeats, so it takes that arm's prefix, entry agent and config.
    const twin = arms.find((a) => a.id === aa.twin);
    const copy = resolveArm(aa.spec, REPO);
    for (const k of ['prefixText', 'prefixInfo', 'agent', 'agentOverride', 'armConfig']) if (twin[k] !== undefined) copy[k] = twin[k];
    arms.push(copy);
    armIds.push(copy.id);
  }
  const variants = arms.map(attachVariant).filter(Boolean);
  const runtimes = [...new Set(arms.map((a) => harnessFor(a).id))];
  const agentEngine = engineOpt(opts, runtimes);
  if (!runtimes.includes('claude-code')) for (const flag of ['claude-bin', 'claude-tools-dir', 'run-budget-usd']) if (opts[flag] !== undefined) throw new Error(`--${flag} applies to Claude Code (cc-) arms only`);
  if (prepareOnly) return prepareOnlyRun({ opts, arms, runtimes, repo: REPO, agentEngine, log: (m) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}] ${m}`) });
  if (runtimes.length > 1) throw new Error(`arms from different harnesses cannot share one run (${arms.map((a) => `${a.id}: ${harnessFor(a).id}`).join(', ')}); run them separately with different --out`);
  const isOc = runtimes[0] === 'opencode';
  const isCc = runtimes[0] === 'claude-code';
  const isUsd = isOc || isCc;
  const unit = isUsd ? 'usd' : 'credits';
  const budgetFlag = isUsd ? 'budget-usd' : 'budget-credits';
  if (opts[isUsd ? 'budget-credits' : 'budget-usd'] !== undefined) throw new Error(`--${isUsd ? 'budget-credits' : 'budget-usd'} does not apply here: ${isUsd ? `${runtimes[0]} runs are costed in USD, use --budget-usd` : 'kiro-cli runs are costed in credits, use --budget-credits'}`);
  if (isCc) {
    for (const flag of ['effort', 'stop-on', 'max-tool-calls', 'aws-creds-file', 'aws-profile']) {
      if (opts[flag] !== undefined) throw new Error(`--${flag} does not apply to Claude Code arms (${{ effort: 'the effort level is not passed to claude, so a value would be recorded but not applied', 'stop-on': 'the early-stop watcher reads kiro-cli and opencode events only', 'max-tool-calls': 'the early-stop watcher reads kiro-cli and opencode events only', 'aws-creds-file': 'credentials come from the AWS_* variables in the environment that starts the bench', 'aws-profile': 'credentials come from the AWS_* variables in the environment that starts the bench' }[flag]})`);
    }
  }
  if (isCc) {
    const multiTurn = tasks.filter((t) => t.autonomy).map((t) => t.id);
    if (multiTurn.length) throw new Error(`multi-turn (autonomy) tasks are not supported on the Claude Code harness yet: ${multiTurn.join(', ')}; the resume flags have not been verified. Choose other tasks with --tasks`);
  }
  const budgetCredits = opts[budgetFlag] ? Number(opts[budgetFlag]) : null;
  if (budgetCredits !== null && !(budgetCredits > 0)) throw new Error(`--${budgetFlag} must be a positive number`);
  const censoredFloor = opts['censored-floor'] ? Number(opts['censored-floor']) : isUsd ? DEFAULT_CENSORED_FLOOR_USD : DEFAULT_CENSORED_FLOOR;
  if (!(censoredFloor >= 0)) throw new Error('--censored-floor must be a non-negative number');
  let runCreditLimit = null;
  if (opts['run-credit-limit'] !== undefined) {
    runCreditLimit = Number(opts['run-credit-limit']);
    if (opts['run-credit-limit'] === true || !(runCreditLimit > 0)) throw new Error('--run-credit-limit must be a positive number');
    if (isUsd) throw new Error(`--run-credit-limit applies to kiro-cli arms only; ${runtimes[0]} runs are costed in USD${isCc ? ' (use --run-budget-usd for a per-run cap)' : ''}`);
  }
  let stopOn = null;
  if (opts['stop-on'] !== undefined) {
    stopOn = opts['stop-on'];
    if (!STOP_ON.includes(stopOn)) throw new Error(`--stop-on takes ${STOP_ON.slice(0, -1).join(', ')} or ${STOP_ON.at(-1)}`);
  }
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
  const plan = describePlan({ tasks, arms, replicates, parallel, budgetCredits, unit });
  log(plan.text);
  const note = budgetNote(plan.planned, budgetCredits, budgetFlag);
  if (note) log(note);
  if (opts['no-default-hide']) { process.env.BENCH_NO_DEFAULT_HIDE = '1'; log('--no-default-hide: the credential paths added to the default hide set stay readable'); }
  const isolation = resolveIsolation(isolate);
  log(`isolation: ${isolation.mode} (${isolation.reason})`);
  if (!isComparableMode(isolation.mode)) log('warning: no OS isolation. These runs are recorded as not comparable and no verdict will count them.');
  if (parallel > 1) log(`warning: --parallel ${parallel} shares one account; wall-clock comparisons need --parallel 1`);

  for (const a of arms) for (const w of a.warnings) log(`warning: arm ${a.id}: ${w}`);

  const outDir = path.resolve(opts.out || path.join(REPO, 'bench', 'results', new Date().toISOString().replace(/[:.]/g, '-')));
  const cacheDir = path.resolve(opts.cache || path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(opts['cargo-target'] || process.env.CARGO_TARGET_DIR || path.join(cacheDir, 'cargo-target'));
  const authDb = isUsd ? null : opts['auth-db'] && opts['auth-db'] !== true ? path.resolve(opts['auth-db']) : sandbox.defaultAuthDb();
  if (authDb && !fs.existsSync(authDb)) throw new Error(`kiro-cli auth database not found: ${authDb} (log in with kiro-cli first)`);
  const awsCredsFile = isOc ? path.resolve(need(opts, 'aws-creds-file')) : null;
  const awsProfile = isOc ? (opts['aws-profile'] && opts['aws-profile'] !== true ? opts['aws-profile'] : 'bench') : null;
  if (isOc) readProfile(awsCredsFile, awsProfile);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);

  let runBudgetUsd = null;
  let ccRegion = null;
  if (isCc) {
    if (opts['run-budget-usd'] !== undefined) {
      runBudgetUsd = Number(opts['run-budget-usd']);
      if (opts['run-budget-usd'] === true || !(runBudgetUsd > 0)) throw new Error('--run-budget-usd must be a positive number');
    }
    ccRegion = opts['aws-region'] && opts['aws-region'] !== true ? opts['aws-region'] : cc.REGION;
    cc.checkCredentials(process.env);
  } else if (opts['aws-region'] !== undefined) {
    throw new Error('--aws-region applies to Claude Code (cc-) arms only; judge commands take it separately');
  }
  const ccModel = isCc ? opts.model || cc.DEFAULT_MODEL : null;
  if (isCc && !cc.canonicalModel(ccModel)) throw new Error('--model needs a Bedrock model id, for example us.anthropic.claude-sonnet-5-5');
  const config = isCc
    ? { model: ccModel, canonicalModel: cc.canonicalModel(ccModel), effort: 'default' }
    : isOc
    ? { model: opts.model || oc.DEFAULT_MODEL, effort: oc.variantOf(opts.effort || DEFAULT_EFFORT) }
    : { model: opts.model || DEFAULT_MODEL, effort: opts.effort || DEFAULT_EFFORT, agentEngine };
  const state = { results: [], spent: 0, charged: 0 };
  let runConfig = { suite: suite.name, armIds, startedAt: new Date().toISOString(), seed };
  const flush = (signal) => {
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summarize(runConfig, state, { interrupted: signal }), null, 2) + '\n');
  };
  const removeHandlers = procs.installSignalHandlers({ flush, log });

  try {
    const kiro = isUsd ? null : opts['kiro-bin'] ? { bin: path.resolve(opts['kiro-bin']), shim: null } : sandbox.resolveKiroCli();
    if (kiro) log(`kiro-cli: ${kiro.bin}${kiro.shim ? ` (bypassing the shim at ${kiro.shim})` : ''}`);
    const ctx = {
      kiroBin: kiro?.bin, repo: REPO, cacheDir, realCache, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb, config, envKeep,
      envInfo: null,
      installsGate: createInstallsGate(),
    };
    log(`isolation gate: hashing ${ctx.installsGate.dirs.join(', ')} before and after each run and the batch`);
    const batchWindow = ctx.installsGate.begin();
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
      Object.assign(ctx, { region: ccRegion, runBudgetUsd });
      log(`claude ${ctx.claude.version} (${ctx.claude.bin}), sha256 ${ctx.claude.sha256.slice(0, 12)}, model ${config.model} (canonical ${config.canonicalModel}), region ${ccRegion}, permission mode ${cc.PERMISSION_MODE}, per-run budget $${runBudgetUsd ?? cc.DEFAULT_RUN_BUDGET_USD}, credentials from the environment (${cc.credentialNames().join(', ')})`);
      const shadow = cc.PROFILE_VARS.filter((k) => process.env[k]);
      if (shadow.length) log(`note: ${shadow.join(', ')} ${shadow.length === 1 ? 'is' : 'are'} set here and is not passed to claude (the SDK would skip the exported keys)`);
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
    ctx.tripwire = {
      roots: [
        { dir: home, depth: opts['tripwire-depth'] ? intOpt(opts['tripwire-depth'], 'tripwire-depth') : 3, exclude: DEFAULT_EXCLUDES },
        { dir: REPO, depth: 8, exclude: REPO_EXCLUDES },
        ...(opts['tripwire-dir'] ? list(opts['tripwire-dir']) : [path.join(os.tmpdir(), 'konductor-bench')]).map((dir) => ({ dir, depth: 4, exclude: ['target-shared'] })),
      ],
      extraExcludes: tripExtra,
      absExclude: [outDir, cacheDir, cargoTarget, `${cargoTarget}-mcp`, scratchDir, ...(realCache ? [realCache] : [])],
    };

    if (isOc) {
      ctx.envInfo = { kiroCliVersion: null, harnessVersion: ctx.opencode.version, modelListSnapshotPath: null, region: oc.REGION };
    } else if (isCc) {
      ctx.envInfo = { kiroCliVersion: null, harnessVersion: ctx.claude.version, modelListSnapshotPath: null, region: ccRegion };
    } else {
      const modelListPath = path.join(outDir, 'model-list.json');
      fs.writeFileSync(modelListPath, listModels(ctx.kiroBin, authDb, scratchDir, envKeep, config.agentEngine));
      ctx.envInfo = { kiroCliVersion: sandbox.kiroCliVersion(), modelListSnapshotPath: modelListPath };
    }

    const interpreters = toolchain.interpreterVersions();
    const toolchainCheck = toolchain.checkPins(toolchain.loadPins(benchDir), interpreters, tasks.map((t) => t.id));
    for (const m of toolchainCheck.mismatches) log(`warning: toolchain: ${toolchain.describeMismatch(m)}. Results may differ from the validated ones.`);

    const mainArm = arms.find((a) => a.id === 'main' || a.id === 'oc-main' || a.id === 'cc-main');
    runConfig = {
      suite: suite.name, harness: runtimes[0], armIds, taskIds: tasks.map((t) => t.id), replicates, parallel, [isUsd ? 'budgetUsd' : 'budgetCredits']: budgetCredits, censoredFloor, seed,
      profile: profile ? { name: profile.name, aaArm: aa?.spec ? { arm: arms.at(-1).id, repeats: aa.twin } : null } : null,
      runCreditLimit, extraTasks: extraDirs, stopOn, maxToolCalls, armPrefix: armOpts.armPrefix, armAgent: armOpts.armAgent, armConfig: armOpts.armConfig,
      isolationGates: { installs: ctx.installsGate.dirs, claudeRules: 'an empty rules file in a scratch CLAUDE_CONFIG_DIR (Claude Code runs)' },
      variants: variants.map((v) => ({ ...v })),
      order: 'replicate-major, seeded shuffle of (task, arm) pairs per replicate',
      timeoutSecByTask: Object.fromEntries(tasks.map((t) => [t.id, t.timeoutSec])),
      ...config, ...ctx.envInfo,
      isolation: { ...isolation, ...describeHide(isolation.mode, ctx.hide), mask: ctx.mask }, comparable: isComparableMode(isolation.mode), tripwire: { depth: ctx.tripwire.roots[0].depth, excludes: [...DEFAULT_EXCLUDES, ...tripExtra], roots: ctx.tripwire.roots.map((r) => r.dir) },
      arms: rc.armRecords(arms, prepared, errors),
      originMain: mainArm ? { originMainSha: mainArm.originMainSha, localMainSha: mainArm.localMainSha, behindOrigin: mainArm.behindOrigin, usedRef: mainArm.ref } : null,
      modelNormalized: arms.some((a) => !a.vanilla),
      ...(isOc ? {
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
        agentEnginesAvailable: rc.availableEngines(),
      }),
      ...rc.benchGit(REPO),
      contentHash: rc.hashTree(benchDir, ['tasks', 'fixtures', 'suites', 'real']),
      ...(realPins ? {
        real: {
          cache: realCache,
          tasks: realPins,
          // Hidden from the agent on top of the bench directories; the checks of these tasks also run without a network.
          hiddenForRealTasks: Object.fromEntries(realTasks.map((t) => [t.id, real.hidePaths(t, { cache: realCache })])),
          agentNetwork: 'open (the model API needs it); fetches are flagged after the run, not blocked',
        },
      } : {}),
      tools: rc.toolVersions(),
      interpreters,
      toolchainCheck,
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outDir, 'run-config.json'), JSON.stringify(runConfig, null, 2) + '\n');
    if (variants.length) {
      fs.mkdirSync(path.join(outDir, 'variants'), { recursive: true });
      for (const v of variants) fs.writeFileSync(path.join(outDir, 'variants', `${v.variantId}.json`), JSON.stringify(v, null, 2) + '\n');
    }
    const envFor = (konductor) => (isCc
      ? cc.envSetup({ arm: { vanilla: !konductor }, ctx, home: '<run-home>', baseEnv: { ...process.env, ...Object.fromEntries(cc.CREDENTIAL_VARS.map((k) => [k, '<set>'])) } })
      : isOc
      ? oc.envSetup({ arm: { vanilla: !konductor }, config, ctx, home: '<run-home>' })
      : buildChildEnv(process.env, { home: '<run-home>', agentEngine: config.agentEngine, keep: envKeep, konductor }));
    fs.writeFileSync(path.join(outDir, 'env.json'), JSON.stringify({
      konductorArm: describeEnv(process.env, envFor(true)),
      vanillaArm: describeEnv(process.env, envFor(false)),
      interpreters,
    }, null, 2) + '\n');

    log(`out=${outDir}`);
    const { results, observed, charged, studyLine, guard } = await runAll({
      tasks, arms, prepared, prepErrors: errors, replicates, parallel, budgetCredits, censoredFloor, seed, outDir, ctx, state, log,
      costOf: isUsd ? USD : CREDITS, unit,
    });
    const gate = batchWindow.end();
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summarize(runConfig, { ...state, results, spent: observed, charged }, { isolationGate: gate }), null, 2) + '\n');
    if (!gate.ok) {
      log(`ISOLATION FAILURE: ${describeChange(gate)}. Treat this batch as invalid.`);
      process.exitCode = 4;
    }
    log(`finished: ${JSON.stringify(summarize(runConfig, { ...state, results }, {}).counts)}, ${observed.toFixed(3)} ${unit} observed, ${charged.toFixed(3)} charged`);
    log(`final ${studyLine}`);
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
    await new Promise((r) => setTimeout(r, 500));
    procs.removeAllScratch();
  }
}

module.exports = { cmdRun, repoRootOf, maskPaths };
