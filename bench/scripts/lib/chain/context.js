// SPDX-License-Identifier: Apache-2.0
'use strict';

// The after-capability chain's configuration, log and state file. run-after-capability.sh documents every variable;
// this file reads them the way the script always did (an empty value counts as unset).

const fs = require('node:fs');
const path = require('node:path');

const PHASE_NAMES = ['', 'WAIT', 'PATCH', 'AUTONOMY', 'JUDGE', 'SKILLBENCH', 'SUMMARY'];

const ts = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const fmtDur = (s = 0) => `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const stripNl = (s) => String(s).replace(/[\n\r]/g, ' ');

/** The first non-empty value among the env names, else the default. */
function envOr(env, names, def) {
  for (const n of names) if (env[n]) return env[n];
  return def;
}

/** The first executable on PATH with this name (a name with a slash is checked as is), or ''. */
function which(name, env = process.env) {
  const ok = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch { return false; } };
  if (name.includes('/')) return ok(name) ? name : '';
  for (const d of String(env.PATH || '').split(':')) if (d && ok(path.join(d, name))) return path.join(d, name);
  return '';
}

const realOr = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const intOf = (v) => Number.parseInt(v, 10);

/**
 * The chain's configuration from the environment.
 * @param {object} env process.env as the wrapper passed it (AC_STATE_DIR already resolved by state-dir.sh)
 * @param {string} self the wrapper script path, used in every "rerun 'bash ...'" hint
 * @returns {object} configuration; every path is absolute
 */
function loadConfig(env, self) {
  const selfDir = path.dirname(self);
  const stateDir = env.AC_STATE_DIR;
  const repo = env.AC_REPO || path.resolve(selfDir, '..', '..');
  const patches = envOr(env, ['AC_PATCHES', 'PATCHES'], '');
  const patchList = patches ? patches.split(',').map(realOr) : [];
  const sbStateDir = env.AC_SB_STATE_DIR || stateDir;
  return {
    self, selfDir, stateDir, repo,
    branch: env.AC_BRANCH || '',
    cliJs: env.AC_CLI_JS || path.join(repo, 'bench/runner/bench.js'),
    patchList,
    rerunAutonomy: envOr(env, ['AC_RERUN_AUTONOMY', 'RERUN_AUTONOMY'], patchList.length > 0 ? '1' : '0'),
    p3DestPrefix: env.AC_P3_DEST_PREFIX || 'autonomy-rerun',
    autonGlob: env.AC_AUTONOMY_GLOB || 'pilot-autonomy-*',
    pilotPidfile: env.AC_PILOT_PIDFILE || path.join(stateDir, 'real-pilot.pid'),
    pilotLog: env.AC_PILOT_LOG || path.join(stateDir, 'real-pilot.log'),
    pilotStudyfile: env.AC_PILOT_STUDYFILE || path.join(stateDir, 'real-pilot.study'),
    pilotScript: env.AC_PILOT_SCRIPT || path.join(selfDir, 'run-real-pilot.sh'),
    pilotProcPattern: env.AC_PILOT_PROC_PATTERN || 'run-real-pilot',
    sbScript: env.AC_SB_SCRIPT || path.join(selfDir, 'run-skill-bench.sh'),
    sbStateDir,
    sbSkills: envOr(env, ['AC_SB_SKILLS', 'SB_SKILLS'], ''),
    sbResults: env.AC_SB_RESULTS || '',
    resultsCandidates: env.AC_RESULTS_CANDIDATES || '/var/tmp:/tmp',
    sbTasks: env.AC_TASKS_PER_SKILL || '5',
    exposureOverride: env.AC_EXPOSURE_RUNS || '',
    orchStudy: env.AC_ORCH_STUDY || '',
    creds: envOr(env, ['AC_CREDS', 'CREDS'], ''),
    credsExpiry: envOr(env, ['AC_CREDS_EXPIRY_UTC', 'CREDS_EXPIRY_UTC'], ''),
    oc: envOr(env, ['AC_OC', 'OC'], '') || which('opencode', env),
    awsBin: env.AC_AWS || 'aws',
    awsProfile: envOr(env, ['AC_AWS_PROFILE', 'AWS_PROFILE_NAME'], 'bench'),
    awsRegion: envOr(env, ['AC_AWS_REGION', 'AWS_REGION_NAME'], 'us-east-1'),
    judgeBudget: env.AC_JUDGE_BUDGET_USD || '25',
    judgeConc: env.AC_JUDGE_CONCURRENCY || '2',
    pollS: intOf(env.AC_POLL_S || '60'),
    waitTimeoutS: intOf(env.AC_WAIT_TIMEOUT_S || '129600'),
    credPollS: intOf(env.AC_CRED_POLL_S || '300'),
    credTimeoutS: intOf(env.AC_CRED_TIMEOUT_S || '43200'),
    sbRetries: intOf(env.AC_SB_RETRIES || '3'),
    scratchParent: env.AC_SCRATCH_PARENT || '/tmp',
    benchProcPattern: env.AC_BENCH_PROC_PATTERN || 'bench/runner/bench\\.js',
    nArms: env.AC_N_ARMS || '4',
    reps: env.AC_REPS || '5',
    testTimeoutS: env.AC_TEST_TIMEOUT_S || '3000',
    benchGraceS: intOf(env.AC_BENCH_GRACE_S || '30'),
    log: path.join(stateDir, 'after-capability.log'),
    statefile: path.join(stateDir, 'after-capability.state'),
    pidfile: path.join(stateDir, 'after-capability.pid'),
    summary: path.join(stateDir, 'after-capability-summary.txt'),
    pilotSummary: path.join(stateDir, 'real-pilot-summary.txt'),
    p2TestLog: path.join(stateDir, 'after-capability-p2-tests.log'),
    p3RerunLog: path.join(stateDir, 'real-pilot-autonomy-rerun.log'),
    sbLog: path.join(sbStateDir, 'skill-bench.log'),
    sbStudyfile: path.join(sbStateDir, 'skill-bench.study'),
  };
}

/**
 * The run's shared context: configuration, log switches, the state file and the run-time flags phases set.
 * @param {object} cfg loadConfig()
 * @returns {object} ctx with say(), stGet(), stSet() and the mutable fields stopping, failReason, phaseResult
 */
function makeContext(cfg) {
  const ctx = {
    cfg, logTo: true, echo: false, stopping: false, failReason: '', phaseResult: '', credNote: '',
    child: null, napCancel: null, scratch: [],
  };
  ctx.say = (msg) => {
    const l = `[${ts()}] ${msg}`;
    if (ctx.logTo) fs.appendFileSync(cfg.log, `${l}\n`);
    if (ctx.echo) process.stdout.write(`${l}\n`);
  };
  ctx.fail = (msg) => { ctx.failReason = msg; return 1; };
  ctx.stGet = (k) => {
    let v = '';
    let text = '';
    try { text = fs.readFileSync(cfg.statefile, 'utf8'); } catch { return ''; }
    for (const l of text.split('\n')) {
      const i = l.indexOf('=');
      if (i >= 0 && l.slice(0, i) === k) v = l.slice(i + 1);
    }
    return v;
  };
  ctx.stSet = (k, v) => {
    let text = '';
    try { text = fs.readFileSync(cfg.statefile, 'utf8'); } catch { /* a first write starts the file */ }
    const keep = text.split('\n').filter((l) => l && l.slice(0, l.indexOf('=') < 0 ? l.length : l.indexOf('=')) !== k);
    keep.push(`${k}=${stripNl(v)}`);
    const tmp = `${cfg.statefile}.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, `${keep.join('\n')}\n`);
    fs.renameSync(tmp, cfg.statefile);
  };
  return ctx;
}

module.exports = { PHASE_NAMES, ts, fmtDur, stripNl, envOr, which, loadConfig, makeContext };
