// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js run`: resolve and build all arms, record the run configuration, run, summarize.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { resolveArm } = require('./arms.js');
const { harnessFor, opencode: oc } = require('./harness/index.js');
const { AGENT_ENGINES, DEFAULT_ENGINE } = require('./harness/runtime.js');
const { readProfile } = require('./harness/opencode-creds.js');
const { loadTasks, loadSuite, benchMask, SUITE_NAMES, BENCH_DIR } = require('./tasks.js');
const real = require('./real.js');
const reallib = require('../../real/lib.js');
const { runAll, prepareAll, preflightTable, describePlan, requireBudget, DEFAULT_CENSORED_FLOOR, CREDITS, USD } = require('./orchestrate.js');
const { buildChildEnv, describeEnv } = require('./env.js');
const { resolveIsolation, ISOLATE_MODES } = require('./isolate.js');
const { DEFAULT_EXCLUDES, REPO_EXCLUDES } = require('./tripwire.js');
const procs = require('./procs.js');
const sandbox = require('./sandbox.js');
const rc = require('./runconfig.js');

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

// --agent-engine picks the kiro-cli engine and the matching install (v2: kiro-cli-v2, v3: kiro-v3). opencode has no engine.
function engineOpt(opts, runtimes) {
  const v = opts['agent-engine'];
  if (v === undefined) return DEFAULT_ENGINE;
  if (runtimes.includes('opencode')) throw new Error('--agent-engine applies to kiro-cli arms only; opencode arms have no agent engine');
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
  const usd = runConfig.harness === 'opencode';
  return {
    ...runConfig,
    finishedAt: new Date().toISOString(),
    ...(usd ? { totalCostUsd: state.spent, totalCostUsdCharged: state.charged } : { totalCredits: state.spent, totalCreditsCharged: state.charged }),
    counts: state.results.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {}),
    results: state.results,
    ...extra,
  };
}

// Builds and trial-installs every arm exactly as `run` does before it launches an agent, prints the preflight table
// and stops. It needs no kiro-cli login, creates no run directory and starts no agent, so it spends no credits.
function prepareOnlyRun({ opts, arms, runtimes, repo, agentEngine, log }) {
  if (runtimes.includes('opencode')) throw new Error('--prepare-only covers kiro-cli arms; opencode arms need their binary and AWS profile, so check them with a normal run');
  const cacheDir = path.resolve(opts.cache || path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(opts['cargo-target'] || process.env.CARGO_TARGET_DIR || path.join(cacheDir, 'cargo-target'));
  fs.mkdirSync(cacheDir, { recursive: true });
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);
  for (const a of arms) for (const w of a.warnings) log(`warning: arm ${a.id}: ${w}`);
  try {
    const ctx = {
      repo, cacheDir, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb: null,
      config: { model: opts.model || DEFAULT_MODEL, effort: opts.effort || DEFAULT_EFFORT, agentEngine }, envKeep: list(opts['env-keep']),
    };
    const { prepared, errors } = prepareAll({ arms, ctx, log, allowPartial: Boolean(opts['allow-partial']) });
    console.log(preflightTable(arms, prepared, errors));
    console.log(`prepare-only: ${prepared.size} arm(s) built and trial-installed, ${errors.size} failed; no agent was started`);
    if (errors.size) process.exitCode = 1;
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
  const armIds = opts.arms ? list(opts.arms) : suite.arms;
  const replicates = opts.replicates ? intOpt(opts.replicates, 'replicates') : suite.replicates;
  const parallel = opts.parallel ? intOpt(opts.parallel, 'parallel') : suite.parallel;
  const REPO = repoRootOf(opts);
  const arms = armIds.map((id) => resolveArm(id, REPO));
  const runtimes = [...new Set(arms.map((a) => harnessFor(a).id))];
  const agentEngine = engineOpt(opts, runtimes);
  if (prepareOnly) return prepareOnlyRun({ opts, arms, runtimes, repo: REPO, agentEngine, log: (m) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}] ${m}`) });
  if (runtimes.length > 1) throw new Error(`arms from different harnesses cannot share one run (${arms.map((a) => `${a.id}: ${harnessFor(a).id}`).join(', ')}); run them separately with different --out`);
  const isOc = runtimes[0] === 'opencode';
  const unit = isOc ? 'usd' : 'credits';
  const budgetFlag = isOc ? 'budget-usd' : 'budget-credits';
  if (opts[isOc ? 'budget-credits' : 'budget-usd'] !== undefined) throw new Error(`--${isOc ? 'budget-credits' : 'budget-usd'} does not apply here: ${isOc ? 'opencode runs are costed in USD, use --budget-usd' : 'kiro-cli runs are costed in credits, use --budget-credits'}`);
  const budgetCredits = opts[budgetFlag] ? Number(opts[budgetFlag]) : null;
  if (budgetCredits !== null && !(budgetCredits > 0)) throw new Error(`--${budgetFlag} must be a positive number`);
  const censoredFloor = opts['censored-floor'] ? Number(opts['censored-floor']) : isOc ? DEFAULT_CENSORED_FLOOR_USD : DEFAULT_CENSORED_FLOOR;
  if (!(censoredFloor >= 0)) throw new Error('--censored-floor must be a non-negative number');
  let runCreditLimit = null;
  if (opts['run-credit-limit'] !== undefined) {
    runCreditLimit = Number(opts['run-credit-limit']);
    if (opts['run-credit-limit'] === true || !(runCreditLimit > 0)) throw new Error('--run-credit-limit must be a positive number');
    if (isOc) throw new Error('--run-credit-limit applies to kiro-cli arms only; opencode runs are costed in USD');
  }
  const seed = opts.seed === undefined ? Date.now() % 2147483647 : intOpt(opts.seed, 'seed', 0);
  const isolate = opts.isolate || 'auto';
  if (!ISOLATE_MODES.includes(isolate)) throw new Error(`--isolate must be one of ${ISOLATE_MODES.join(', ')}`);
  const envKeep = list(opts['env-keep']);

  const log = (m) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}] ${m}`);
  const plan = describePlan({ tasks, arms, replicates, parallel, budgetCredits, unit });
  requireBudget(plan.planned, budgetCredits, budgetFlag);
  log(plan.text);
  const isolation = resolveIsolation(isolate);
  log(`isolation: ${isolation.mode} (${isolation.reason})`);
  if (parallel > 1) log(`warning: --parallel ${parallel} shares one account; wall-clock comparisons need --parallel 1`);

  for (const a of arms) for (const w of a.warnings) log(`warning: arm ${a.id}: ${w}`);

  const outDir = path.resolve(opts.out || path.join(REPO, 'bench', 'results', new Date().toISOString().replace(/[:.]/g, '-')));
  const cacheDir = path.resolve(opts.cache || path.join(os.tmpdir(), 'b-cache'));
  const cargoTarget = path.resolve(opts['cargo-target'] || process.env.CARGO_TARGET_DIR || path.join(cacheDir, 'cargo-target'));
  const authDb = isOc ? null : sandbox.defaultAuthDb();
  if (authDb && !fs.existsSync(authDb)) throw new Error(`kiro-cli auth database not found: ${authDb} (log in with kiro-cli first)`);
  const awsCredsFile = isOc ? path.resolve(need(opts, 'aws-creds-file')) : null;
  const awsProfile = isOc ? (opts['aws-profile'] && opts['aws-profile'] !== true ? opts['aws-profile'] : 'bench') : null;
  if (isOc) readProfile(awsCredsFile, awsProfile);

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  const scratchDir = sandbox.makeScratchRoot();
  procs.trackScratch(scratchDir);

  const config = isOc
    ? { model: opts.model || oc.DEFAULT_MODEL, effort: oc.variantOf(opts.effort || DEFAULT_EFFORT) }
    : { model: opts.model || DEFAULT_MODEL, effort: opts.effort || DEFAULT_EFFORT, agentEngine };
  const state = { results: [], spent: 0, charged: 0 };
  let runConfig = { suite: suite.name, armIds, startedAt: new Date().toISOString(), seed };
  const flush = (signal) => {
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summarize(runConfig, state, { interrupted: signal }), null, 2) + '\n');
  };
  const removeHandlers = procs.installSignalHandlers({ flush, log });

  try {
    const kiro = isOc ? null : opts['kiro-bin'] ? { bin: path.resolve(opts['kiro-bin']), shim: null } : sandbox.resolveKiroCli();
    if (kiro) log(`kiro-cli: ${kiro.bin}${kiro.shim ? ` (bypassing the shim at ${kiro.shim})` : ''}`);
    const ctx = {
      kiroBin: kiro?.bin, repo: REPO, cacheDir, realCache, cargoTarget, cargoOnline: Boolean(opts['cargo-online']), scratchDir, authDb, config, envKeep,
      envInfo: null,
    };
    if (isOc) {
      ctx.opencode = oc.resolveOpencode({ cacheDir, binOverride: opts['opencode-bin'] && opts['opencode-bin'] !== true ? opts['opencode-bin'] : null });
      ctx.rgBin = oc.resolveRipgrep(opts['rg-bin'] && opts['rg-bin'] !== true ? opts['rg-bin'] : null);
      if (!ctx.rgBin) throw new Error('ripgrep (rg) not found on PATH; install it or pass --rg-bin PATH (opencode would otherwise download it at run time)');
      Object.assign(ctx, { awsCredsFile, awsProfile });
      log(`opencode ${ctx.opencode.version} (${ctx.opencode.bin}), sha256 ${ctx.opencode.sha256.slice(0, 12)}, model ${oc.PROVIDER}/${config.model}, variant ${config.effort}, region ${oc.REGION}`);
    }
    const { prepared, errors } = prepareAll({ arms, ctx, log, allowPartial: Boolean(opts['allow-partial']) });
    log(`arms:\n${preflightTable(arms, prepared, errors)}`);

    const home = fs.realpathSync(os.homedir());
    const tripExtra = list(opts['tripwire-exclude']);
    ctx.isolation = isolation;
    ctx.hide = [...list(opts.hide), ...list(process.env.BENCH_HIDE_EXTRA)];
    ctx.mask = maskPaths({ benchDir, extraDirs, outDir, awsCredsFile });
    ctx.runCreditLimit = runCreditLimit;
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
    } else {
      const modelListPath = path.join(outDir, 'model-list.json');
      fs.writeFileSync(modelListPath, listModels(ctx.kiroBin, authDb, scratchDir, envKeep, config.agentEngine));
      ctx.envInfo = { kiroCliVersion: sandbox.kiroCliVersion(), modelListSnapshotPath: modelListPath };
    }

    const mainArm = arms.find((a) => a.id === 'main' || a.id === 'oc-main');
    runConfig = {
      suite: suite.name, harness: runtimes[0], armIds, taskIds: tasks.map((t) => t.id), replicates, parallel, [isOc ? 'budgetUsd' : 'budgetCredits']: budgetCredits, censoredFloor, seed,
      runCreditLimit, extraTasks: extraDirs,
      order: 'replicate-major, seeded shuffle of (task, arm) pairs per replicate',
      timeoutSecByTask: Object.fromEntries(tasks.map((t) => [t.id, t.timeoutSec])),
      ...config, ...ctx.envInfo,
      isolation: { ...isolation, hide: ctx.hide, mask: ctx.mask }, tripwire: { depth: ctx.tripwire.roots[0].depth, excludes: [...DEFAULT_EXCLUDES, ...tripExtra], roots: ctx.tripwire.roots.map((r) => r.dir) },
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
      startedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(outDir, 'run-config.json'), JSON.stringify(runConfig, null, 2) + '\n');
    const envFor = (konductor) => (isOc
      ? oc.envSetup({ arm: { vanilla: !konductor }, config, ctx, home: '<run-home>' })
      : buildChildEnv(process.env, { home: '<run-home>', agentEngine: config.agentEngine, keep: envKeep, konductor }));
    fs.writeFileSync(path.join(outDir, 'env.json'), JSON.stringify({
      konductorArm: describeEnv(process.env, envFor(true)),
      vanillaArm: describeEnv(process.env, envFor(false)),
    }, null, 2) + '\n');

    log(`out=${outDir}`);
    const { results, observed, charged } = await runAll({
      tasks, arms, prepared, prepErrors: errors, replicates, parallel, budgetCredits, censoredFloor, seed, outDir, ctx, state, log,
      costOf: isOc ? USD : CREDITS, unit,
    });
    fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summarize(runConfig, { ...state, results, spent: observed, charged }, {}), null, 2) + '\n');
    log(`finished: ${JSON.stringify(summarize(runConfig, { ...state, results }, {}).counts)}, ${observed.toFixed(3)} ${unit} observed, ${charged.toFixed(3)} charged`);
  } finally {
    removeHandlers();
    await new Promise((r) => setTimeout(r, 500));
    procs.removeAllScratch();
  }
}

module.exports = { cmdRun, repoRootOf, maskPaths };
