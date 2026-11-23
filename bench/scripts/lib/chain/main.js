#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The after-capability chain. bench/scripts/run-after-capability.sh is the launcher and documents the phases, modes,
// files and variables; it resolves the state dir and runs: node main.js --self <that script> [mode].
// The state file holds one KEY=VALUE line per key, so a rerun resumes at the first phase not done or skipped.

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { PHASE_NAMES, ts, which, loadConfig, makeContext } = require('./context.js');
const P = require('./proc.js');
const { credsOk } = require('./creds.js');
const { p2Patch, patchesApplyToHead, benchStatus, gitOut, git } = require('./patch.js');
const { p1Wait, p3Autonomy, p4Judge, p5Skillbench, isExec } = require('./phases.js');
const { studyDir, capDirs, logCredits } = require('./study-dirs.js');
const { writeSummary, statusText, planText } = require('./summary.js');

const PHASES = [null, p1Wait, p2Patch, p3Autonomy, p4Judge, p5Skillbench, async (ctx) => { writeSummary(ctx, 'DONE'); return 0; }];
const hasBench = (p) => /bench/i.test(p);

/** Run phase n unless the state file says it is done or skipped. 0, 1 or 130. */
async function runPhase(ctx, n, fn = PHASES[n]) {
  if (ctx.stopping) return 130;
  const name = PHASE_NAMES[n];
  const s = ctx.stGet(`P${n}`);
  if (s === 'done' || s === 'skipped') { ctx.say(`P${n} ${name}: already ${s}, skipping (resume)`); return 0; }
  ctx.stSet(`P${n}`, 'running'); ctx.stSet('CURRENT', String(n)); ctx.stSet(`P${n}_started`, ts()); ctx.stSet(`P${n}_reason`, '');
  ctx.say(`===== P${n} ${name}: START =====`);
  ctx.failReason = ''; ctx.phaseResult = '';
  const rc = await fn(ctx);
  if (rc === 0) {
    ctx.stSet(`P${n}`, ctx.phaseResult || 'done'); ctx.stSet(`P${n}_finished`, ts());
    ctx.say(`===== P${n} ${name}: ${ctx.phaseResult || 'done'} =====`);
    logCredits(ctx);
    return 0;
  }
  if (rc === 130 || ctx.stopping) {
    ctx.stSet(`P${n}`, 'interrupted');
    ctx.say(`===== P${n} ${name}: INTERRUPTED (rerun the script to resume) =====`);
    return 130;
  }
  ctx.stSet(`P${n}`, 'failed'); ctx.stSet(`P${n}_reason`, ctx.failReason);
  ctx.say(`===== P${n} ${name}: FAILED: ${ctx.failReason} =====`);
  logCredits(ctx);
  return 1;
}

/** The pid of a live chain daemon from the pid file, or null. */
function daemonPid(c) {
  const p = P.readTrim(c.pidfile);
  return p && P.alive(p) && P.cmdline(p).includes('run-after-capability') ? p : null;
}

function claimPidfile(ctx) {
  const c = ctx.cfg;
  const write = () => { try { fs.writeFileSync(c.pidfile, `${process.pid}\n`, { flag: 'wx' }); return true; } catch { return false; } };
  if (write()) return true;
  const other = daemonPid(c);
  if (other && other !== String(process.pid)) { ctx.say(`REFUSED: another run-after-capability instance is alive (pid ${other})`); return false; }
  fs.rmSync(c.pidfile, { force: true });
  return write();
}

function onTerm(ctx) {
  ctx.stopping = true;
  ctx.say('signal received: stopping (the current child is told to stop; rerun this script to resume)');
  if (ctx.child) ctx.child.kill('SIGTERM');
  if (ctx.napCancel) ctx.napCancel();
}

/** The six phases in order. 0 done, 1 failed or refused, 130 stopped. */
async function runChain(ctx) {
  const c = ctx.cfg;
  if (hasBench(c.scratchParent)) { process.stderr.write(`SCRATCH_PARENT '${c.scratchParent}' contains the word bench\n`); return 1; }
  fs.mkdirSync(c.stateDir, { recursive: true });
  if (!claimPidfile(ctx)) return 1;
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => onTerm(ctx));
  process.on('exit', () => {
    P.dropScratch(ctx);
    if (P.readTrim(c.pidfile) === String(process.pid)) fs.rmSync(c.pidfile, { force: true });
  });
  ctx.say(`run-after-capability started, pid ${process.pid}; state ${c.statefile}; resuming from: ${[1, 2, 3, 4, 5, 6].map((n) => `P${n}=${ctx.stGet(`P${n}`)} `).join('')}`);
  ctx.stSet('STARTED', ts()); ctx.stSet('FINAL', 'running');
  for (let n = 1; n <= 6; n++) {
    const rc = await runPhase(ctx, n);
    if (rc === 130) {
      ctx.stSet('FINAL', `stopped at phase ${n}`);
      ctx.say(`STOPPED at phase ${n} (${PHASE_NAMES[n]}). Rerun 'bash ${c.self}' to resume.`);
      return 130;
    }
    if (rc) {
      ctx.stSet('FINAL', `FAILED at phase ${n}`);
      writeSummary(ctx, 'FAILED', n);
      ctx.say(`FAILED at phase ${n} (${PHASE_NAMES[n]}): ${ctx.stGet(`P${n}_reason`)}`);
      ctx.say(`To resume after fixing the cause: bash ${c.self}`);
      return 1;
    }
  }
  ctx.stSet('FINAL', 'DONE');
  ctx.say(`DONE: all six phases complete. Summary: ${c.summary}`);
  return 0;
}

// ---------------------------------------------------------------- read-only checks (dry run and launch)
function credsChecks(ctx, chk) {
  const c = ctx.cfg;
  if (!c.creds) { chk('FAIL', 'CREDS is not set: point CREDS (or AC_CREDS) at the scoped AWS credentials file; only the path is used'); return; }
  let st = null;
  try { st = fs.statSync(c.creds); fs.accessSync(c.creds, fs.constants.R_OK); } catch { st = null; }
  if (!st || st.size === 0) { chk('FAIL', `credentials file missing or empty: ${c.creds}`); return; }
  chk('ok', `credentials file present: ${c.creds} (path only; contents not read${c.credsExpiry ? `; expected to expire about ${c.credsExpiry}` : ''})`);
  if (credsOk(ctx)) chk('ok', `aws bedrock list-foundation-models succeeds with that file (AWS_PROFILE=${c.awsProfile}, ${c.awsRegion})`);
  else chk('WARN', `the credentials check fails right now (${ctx.credNote}); P4 and P5 would wait for a re-vend`);
}

function repoChecks(ctx, chk) {
  const c = ctx.cfg;
  if (git(c.repo, ['rev-parse', '--git-dir']).status !== 0) { chk('FAIL', `not a git repository: ${c.repo}`); return; }
  chk('ok', `repo ${c.repo} at ${gitOut(c.repo, ['rev-parse', '--short=8', 'HEAD']).trim()}`);
  const br = gitOut(c.repo, ['branch', '--show-current']).trim();
  if (!c.branch) chk('ok', `branch ${br} (AC_BRANCH unset, not pinned)`);
  else if (br === c.branch) chk('ok', `branch ${c.branch}`);
  else chk('FAIL', `repo is not on ${c.branch}`);
  const dirty = benchStatus(c.repo);
  if (!dirty) chk('ok', 'bench/ is clean');
  else chk('WARN', `bench/ is not clean right now (${dirty.split('\n').slice(0, 3).join(' ')} ); P2 will refuse unless it is the patches uncommitted`);
  const p2 = ctx.stGet('P2');
  if (p2 === 'done' || p2 === 'skipped') chk('ok', `P2 is already ${p2} in the state file; the patch check is skipped (resume)`);
  else if (c.patchList.length) {
    if (patchesApplyToHead(c) === 0) chk('ok', 'the patches apply in order to a pristine archive of HEAD');
    else chk('FAIL', 'the patches do not apply to a pristine archive of HEAD');
  }
}

/** Every launch and dry-run check, logged as 'check ok|WARN|FAIL: ...'. Returns 0 when none failed. */
function readonlyChecks(ctx) {
  const c = ctx.cfg;
  let failed = 0;
  const chk = (kind, msg) => {
    if (kind === 'ok') ctx.say(`check ok:   ${msg}`);
    else if (kind === 'WARN') ctx.say(`check WARN: ${msg}`);
    else { ctx.say(`check FAIL: ${msg}`); failed = 1; }
  };
  if (hasBench(c.scratchParent)) chk('FAIL', `scratch parent '${c.scratchParent}' contains the word bench`);
  else chk('ok', `scratch parent ${c.scratchParent} has no 'bench' in its path`);
  for (const t of ['node', 'git', 'pgrep', 'tar', 'timeout', c.awsBin]) chk(which(t) ? 'ok' : 'FAIL', which(t) ? `tool ${t}` : `tool ${t} not found`);
  chk(fs.existsSync(c.cliJs) ? 'ok' : 'FAIL', fs.existsSync(c.cliJs) ? `bench runner ${c.cliJs}` : `bench runner missing: ${c.cliJs}`);
  if (c.patchList.length === 0) chk('ok', 'no patches given (PATCHES unset): P2 will be skipped');
  else for (const p of c.patchList) chk(fs.existsSync(p) ? 'ok' : 'FAIL', fs.existsSync(p) ? `patch ${p}` : `patch file missing: ${p}`);
  chk(fs.existsSync(c.pilotScript) ? 'ok' : 'FAIL', fs.existsSync(c.pilotScript) ? `run-real-pilot.sh ${c.pilotScript}` : `missing: ${c.pilotScript}`);
  chk(fs.existsSync(c.sbScript) ? 'ok' : 'FAIL', fs.existsSync(c.sbScript) ? `run-skill-bench.sh ${c.sbScript}` : `missing: ${c.sbScript}`);
  if (c.oc && isExec(c.oc)) chk('ok', `opencode binary ${c.oc}`);
  else chk('FAIL', `opencode binary not found: ${c.oc || '(unset)'}. Set OC (or AC_OC) or put opencode on PATH`);
  credsChecks(ctx, chk);
  const V = studyDir(c);
  if (V) chk('ok', `capability study dir ${V} (${capDirs(V).length} task dirs with a summary)`);
  else chk('FAIL', `no capability study dir (${c.pilotStudyfile})`);
  repoChecks(ctx, chk);
  const ps = P.pilotState(ctx);
  if (ps.alive) chk('ok', `capability study is running (pid ${ps.pid}); P1 will wait. Last log line: ${ps.last || '(empty)'}`);
  else if (P.isDoneLine(ps.last)) chk('ok', 'capability study already finished; P1 will pass at once');
  else chk('WARN', `capability study is not running and its log does not end with DONE (last: ${ps.last || '(empty)'}); P1 would stop the chain`);
  return failed;
}

// ---------------------------------------------------------------- entry points
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchDaemon(ctx) {
  const c = ctx.cfg;
  fs.appendFileSync(c.log, `---- launched ${ts()} ----\n`);
  const fd = fs.openSync(c.log, 'a');
  const child = spawn('bash', [c.self, '--foreground'], { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, AC_CHILD: '1' } });
  child.unref();
  fs.closeSync(fd);
  let dp = null;
  for (let i = 0; i < 20 && !(dp = daemonPid(c)); i++) await sleepMs(500);
  if (!dp) { process.stdout.write(`the daemon did not start or was refused; see ${c.log}\n`); return 1; }
  process.stdout.write(`LAUNCHED: pid ${dp}\nlog:     tail -f ${c.log}\nstatus:  bash ${c.self} --status\nstop:    bash ${c.self} --stop     (resume: rerun this script)\n`);
  return 0;
}

function parseMode(args) {
  let mode = 'daemon';
  for (const a of args) {
    const m = { '--foreground': 'foreground', '--dry-run': 'dry-run', '--status': 'status', '--stop': 'stop' }[a];
    if (!m) { process.stderr.write(`unknown option: ${a} (see --help)\n`); process.exit(2); }
    mode = m;
  }
  return process.env.AC_CHILD === '1' ? 'foreground' : mode;
}

async function main(argv) {
  const i = argv.indexOf('--self');
  if (i < 0 || !argv[i + 1]) { process.stderr.write('usage: node main.js --self <run-after-capability.sh> [--foreground|--dry-run|--status|--stop]\n'); return 2; }
  const self = argv[i + 1];
  const mode = parseMode([...argv.slice(0, i), ...argv.slice(i + 2)]);
  const ctx = makeContext(loadConfig(process.env, self));
  const c = ctx.cfg;
  if (mode === 'status') {
    ctx.logTo = false; ctx.echo = true;
    process.stdout.write(statusText(ctx, daemonPid(c)));
    return 0;
  }
  if (mode === 'stop') {
    const dp = daemonPid(c);
    if (dp) { process.kill(Number(dp), 'SIGTERM'); process.stdout.write(`sent SIGTERM to ${dp}; the running child is stopped and the state records where; resume: bash ${c.self}   watch: tail -f ${c.log}\n`); }
    else process.stdout.write('not running\n');
    return 0;
  }
  if (mode === 'dry-run') {
    ctx.logTo = false; ctx.echo = true;
    process.stdout.write('DRY RUN: nothing is changed (no state, no log, no checkout edit)\n');
    process.stdout.write(planText(ctx));
    process.stdout.write('\n');
    const rc = readonlyChecks(ctx);
    process.stdout.write(`\ndry run: ${rc === 0 ? 'all checks passed' : 'a check failed; a real launch would refuse'}\n`);
    return rc;
  }
  if (process.env.AC_CHILD !== '1') {
    ctx.echo = true;
    fs.mkdirSync(c.stateDir, { recursive: true });
    const dp = daemonPid(c);
    if (dp) { process.stdout.write(`REFUSED: already running (pid ${dp}). Use: bash ${c.self} --status | --stop\n`); return 1; }
    if (readonlyChecks(ctx)) { ctx.say('launch checks failed; nothing launched'); return 1; }
    if (mode === 'daemon') return launchDaemon(ctx);
  }
  return runChain(ctx);
}

if (require.main === module) main(process.argv.slice(2)).then((rc) => process.exit(rc));

module.exports = { main, runPhase, runChain, readonlyChecks, daemonPid };
