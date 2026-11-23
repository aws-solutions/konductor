// SPDX-License-Identifier: Apache-2.0
'use strict';

// The chain's phases other than P2 (patch.js) and P6 (summary.js): P1 waits for the capability study, P3 reruns the
// autonomy dirs, P4 judges every task dir, P5 runs the skill bench stage 1. Each returns 0, 1 (ctx.failReason set)
// or 130 (stopped); a phase that did nothing sets ctx.phaseResult = 'skipped'.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fmtDur, stripNl } = require('./context.js');
const P = require('./proc.js');
const { credsOk, waitForCredentials } = require('./creds.js');
const { studyDir, capDirs, capDirsKind, globIn } = require('./study-dirs.js');
const { completeState, autonomyStats } = require('../study.js');
const { backend, errorInfo } = require('../judgments.js');
const { pilotSummary } = require('../chain-report.js');

const now = () => Date.now() / 1000;
const tailLines = (f, n) => { try { return fs.readFileSync(f, 'utf8').split('\n').slice(-(n + 1)); } catch { return []; } };
const hasDone = (f) => tailLines(f, 30).some((l) => /^\[[^\]]*\] DONE:/.test(l));
const procsLine = (ctx) => stripNl(P.benchProcs(ctx).slice(0, 2).join('\n'));

// ================================================================ P1 WAIT
async function p1Wait(ctx) {
  const c = ctx.cfg;
  const t0 = now();
  let n = 0;
  ctx.say(`P1: waiting for the capability study (pid file ${c.pilotPidfile}, log ${c.pilotLog}), polling every ${c.pollS}s, timeout ${fmtDur(c.waitTimeoutS)}`);
  for (;;) {
    if (ctx.stopping) return 130;
    let ps = P.pilotState(ctx);
    if (!ps.alive) {
      if (!P.isDoneLine(ps.last) && !P.isFailedLine(ps.last)) {
        // The DONE line is written before the pid file is removed; give a late flush a moment.
        for (let i = 0; i < 3; i++) {
          await P.nap(ctx, 10);
          if (ctx.stopping) return 130;
          ps = P.pilotState(ctx);
          if (P.isDoneLine(ps.last) || P.isFailedLine(ps.last) || ps.alive) break;
        }
      }
      if (!ps.alive) {
        if (P.isDoneLine(ps.last)) { ctx.say(`P1: the capability study is finished. Last log line: ${ps.last}`); return 0; }
        if (P.isFailedLine(ps.last)) {
          return ctx.fail(`the capability study ended FAILED: ${ps.last}. Chain stopped before touching anything. Fix the cause, run 'bash ${c.pilotScript}' to resume the study, then rerun 'bash ${c.self}' (it resumes at P1).`);
        }
        return ctx.fail(`the capability study is not running (pid '${ps.pid || 'none'}' gone or not alive) and its log does not end with a DONE line. Last log line: ${ps.last || '(empty)'}. Chain stopped. Check 'bash ${c.pilotScript} --status', resume the study with 'bash ${c.pilotScript}', then rerun 'bash ${c.self}'.`);
      }
    }
    if (now() - t0 >= c.waitTimeoutS) {
      return ctx.fail(`waited ${fmtDur(c.waitTimeoutS)} and the capability study has not finished (pid ${ps.pid}, last log line: ${ps.last || '(empty)'}). Chain stopped; rerun 'bash ${c.self}' to wait again.`);
    }
    n++;
    if (n % 30 === 1) ctx.say(`P1: still waiting; study running (pid ${ps.pid}), waited ${fmtDur(Math.floor(now() - t0))}. Last log line: ${ps.last || '(empty)'}`);
    await P.nap(ctx, c.pollS);
  }
}

// ================================================================ P3 AUTONOMY RERUN
function p3Move(ctx, V, dest) {
  for (const name of ctx.stGet('P3_names').split(/\s+/).filter(Boolean)) {
    if (!fs.existsSync(path.join(V, name))) continue;
    if (fs.existsSync(path.join(dest, name))) return ctx.fail(`${dest}/${name} already exists; not overwriting`);
    try { fs.renameSync(path.join(V, name), path.join(dest, name)); } catch { return ctx.fail(`move of ${V}/${name} failed`); }
    ctx.say(`P3: moved ${name} to ${dest}/`);
  }
  const pre = path.join(V, 'reports-prejudge');
  if (fs.existsSync(pre) && !fs.existsSync(path.join(dest, 'reports-prejudge'))) {
    try {
      fs.renameSync(pre, path.join(dest, 'reports-prejudge'));
      ctx.say(`P3: moved the pre-rerun reports-prejudge to ${dest}/ (the rerun regenerates it)`);
    } catch { /* the rerun regenerates it either way */ }
  }
  ctx.stSet('P3_moved', 'yes');
  return 0;
}

async function p3Autonomy(ctx) {
  const c = ctx.cfg;
  if (c.rerunAutonomy !== '1') {
    ctx.say('P3: SKIPPED: RERUN_AUTONOMY is not 1 (it defaults to 1 only when PATCHES is set)');
    ctx.stSet('P3_note', 'rerun not requested');
    ctx.phaseResult = 'skipped';
    return 0;
  }
  const V = studyDir(c);
  if (!V) return ctx.fail(`no study dir (${c.pilotStudyfile})`);
  let dest = ctx.stGet('P3_dest');
  const dirs = capDirsKind(c, V, 'autonomy');
  if (dirs.length === 0 && !dest) { ctx.say(`P3: SKIPPED: the study has no autonomy task dirs under ${V}`); ctx.phaseResult = 'skipped'; return 0; }
  const ps = P.pilotState(ctx);
  if (ps.alive) return ctx.fail(`the capability study is still running (pid ${ps.pid})`);
  if (P.benchProcs(ctx).length) return ctx.fail(`a bench.js process is running: ${procsLine(ctx)}`);
  // Every other task dir must already be complete, so the rerun touches exactly the autonomy dirs.
  const auton = new Set(dirs);
  const bad = capDirs(V).filter((d) => !auton.has(d)).map((d) => [d, completeState(d, c.nArms, c.reps)]).filter(([, s]) => s !== 'complete');
  if (bad.length) return ctx.fail(`non-autonomy task dirs are not complete:${bad.map(([d, s]) => ` ${path.basename(d)}(${s})`).join('')}. Rerunning would redo them too. Chain stopped; nothing moved.`);
  if (!dest) {
    const utc = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    dest = path.join(V, 'incomplete', `${c.p3DestPrefix}-${utc}`);
    ctx.stSet('P3_dest', dest);
    ctx.stSet('P3_names', dirs.map((d) => path.basename(d)).join(' '));
    ctx.stSet('P3_total_dirs', String(capDirs(V).length));
    ctx.stSet('P3_moved', 'no');
  }
  const nTotal = ctx.stGet('P3_total_dirs');
  if (ctx.stGet('P3_moved') !== 'yes') {
    try { fs.mkdirSync(dest, { recursive: true }); } catch { return ctx.fail(`cannot create ${dest}`); }
    const rc = p3Move(ctx, V, dest);
    if (rc) return rc;
  }
  let before = ctx.stGet('P3_before');
  if (!before) { before = autonomyStats(globIn(dest, c.autonGlob)); ctx.stSet('P3_before', before); }
  ctx.say(`P3: autonomy results BEFORE the rerun (${dest}): ${before}`);
  ctx.say(`P3: rerunning the autonomy tasks through ${c.pilotScript} --foreground (it skips complete dirs); output: ${c.p3RerunLog}`);
  const env = { ...process.env, STATE_DIR: c.stateDir, REPO: c.repo, CLI_JS: c.cliJs };
  delete env.RP_CHILD;
  const rc = await P.runChild(ctx, 'bash', [c.pilotScript, '--foreground'], { out: c.p3RerunLog, cwd: c.stateDir, env });
  if (ctx.stopping) return 130;
  ctx.say(`P3: run-real-pilot exited ${rc}; last lines: ${stripNl(tailLines(c.p3RerunLog, 3).join('\n'))}`);
  if (rc !== 0 || !hasDone(c.p3RerunLog)) {
    return ctx.fail(`the autonomy rerun did not finish with DONE (exit ${rc}). See ${c.p3RerunLog}. The old dirs are in ${dest}. Rerun 'bash ${c.self}' to resume (run-real-pilot resumes task by task).`);
  }
  const okN = capDirs(V).filter((d) => completeState(d, c.nArms, c.reps) === 'complete').length;
  if (String(okN) !== nTotal) return ctx.fail(`after the rerun ${okN} of ${nTotal} task dirs are complete (expected all). See ${c.p3RerunLog}`);
  const after = autonomyStats(globIn(V, c.autonGlob));
  ctx.stSet('P3_after', after);
  ctx.say(`P3: BEFORE the rerun (${dest}): ${before}`);
  ctx.say(`P3: AFTER  the rerun (${V}): ${after}`);
  return 0;
}

// ================================================================ P4 JUDGE CAPABILITY
const judgeArgs = (c, d) => ['judge', '--run', d, '--judge-backend', 'opencode', '--opencode-bin', c.oc, '--aws-creds-file', c.creds,
  '--aws-profile', c.awsProfile, '--aws-region', c.awsRegion, '--profile', 'detailed', '--concurrency', c.judgeConc, '--budget-usd', c.judgeBudget];

async function p4JudgeOne(ctx, d) {
  const c = ctx.cfg;
  const name = path.basename(d);
  const jl = path.join(c.stateDir, `judge-capability-${name}.log`);
  const jf = path.join(d, 'judgments.json');
  if (fs.existsSync(jf)) {
    const be = backend(jf) ?? 'unreadable';
    if (be !== 'opencode') return ctx.fail(`${jf} was written by the '${be}' backend; one backend per study. Move it aside by hand to rejudge.`);
  }
  for (let attempt = 1; ; attempt++) {
    const w = await waitForCredentials(ctx, `judging ${name}`);
    if (w === 130) return 130;
    if (w) return ctx.fail(`no valid credentials for judging ${name} (waited ${fmtDur(c.credTimeoutS)}); rerun 'bash ${c.self}' after re-vending`);
    ctx.say(`P4: judging ${name} (attempt ${attempt}, budget cap $${c.judgeBudget}, log ${jl})`);
    const rc = await P.nodeRun(ctx, jl, judgeArgs(c, d));
    if (ctx.stopping) return 130;
    const i = errorInfo(jf);
    const errs = i ? String(i.errors) : 'unreadable';
    const cerrs = i ? i.credErrors : 0;
    const bud = i ? i.budgetSkipped : 0;
    const spent = i && i.spentUsd !== null ? i.spentUsd.toFixed(4) : '0';
    ctx.say(`P4: ${name}: judge exit ${rc}, judge errors ${errs}, of which credential errors ${cerrs}, budget-skipped ${bud}, spent $${spent}`);
    if (rc === 0 && !i) return ctx.fail(`judging ${name} exited 0 but ${jf} is missing or unreadable; see ${jl}`);
    if (rc === 3 || bud !== 0) return ctx.fail(`judging ${name} hit the $${c.judgeBudget} budget guard (exit ${rc}, ${bud} skipped). Rerun with AC_JUDGE_BUDGET_USD=<higher> bash ${c.self} (finished calls are cached).`);
    if (rc !== 0) {
      if (credsOk(ctx)) return ctx.fail(`judging ${name} exited ${rc} with valid credentials; see ${jl}`);
      if (attempt >= 5) return ctx.fail(`judging ${name} failed ${attempt} times on credentials; see ${jl}`);
      ctx.say(`P4: ${name} stopped on credentials; waiting, then resuming from the cache`);
      continue;
    }
    if (cerrs !== 0) {
      if (attempt >= 5) return ctx.fail(`judging ${name} still has ${cerrs} credential errors after ${attempt} attempts; see ${jl}`);
      ctx.say(`P4: ${name} has ${cerrs} credential-rejected calls (not cached); rerunning after a credentials check`);
      credsOk(ctx);
      if (ctx.credNote) ctx.say(`P4: credential check: ${ctx.credNote}`);
      continue;
    }
    ctx.stSet(`P4_dir_${name}`, `exit ${rc} errors ${errs} spent $${spent}`);
    return 0;
  }
}

async function p4Reports(ctx, V, RJ) {
  const c = ctx.cfg;
  const real = capDirsKind(c, V, 'real').join(',');
  const pilot = capDirsKind(c, V, 'pilot').join(',');
  const all = capDirs(V).join(',');
  try { fs.mkdirSync(RJ, { recursive: true }); } catch { ctx.say(`P4: cannot create ${RJ}`); return 1; }
  const specs = [];
  if (real) specs.push(['report-real', ['report', '--run', real, '--profile', 'detailed', '--baseline', 'vanilla', '--out', `${RJ}/report-real`]]);
  if (pilot) specs.push(['report-pilot', ['report', '--run', pilot, '--profile', 'detailed', '--baseline', 'vanilla', '--out', `${RJ}/report-pilot`]]);
  specs.push(['pass', ['report', '--run', all, '--verdict', 'orchestrator-pass', '--baseline', 'vanilla', '--out', `${RJ}/pass`]]);
  specs.push(['platform', ['report', '--run', all, '--verdict', 'platform', '--baseline', 'vanilla', '--out', `${RJ}/platform`]]);
  if (real) specs.push(['contrast-real', ['contrast', '--run', real, '--base', 'vanilla', '--out', `${RJ}/contrast-real`]]);
  if (pilot) specs.push(['contrast-pilot', ['contrast', '--run', pilot, '--base', 'vanilla', '--out', `${RJ}/contrast-pilot`]]);
  let warn = 0;
  for (const [name, args] of specs) {
    ctx.say(`P4: report ${name}`);
    const rc = await P.nodeRun(ctx, `${RJ}/${name}.stdout.txt`, args);
    if (ctx.stopping) return 130;
    if (rc !== 0) { warn++; ctx.say(`P4: WARNING: report '${name}' exited ${rc} (see ${RJ}/${name}.stdout.txt). Reports are free: rerun them by hand.`); }
  }
  ctx.stSet('P4_report_failures', String(warn));
  return 0;
}

async function p4Judge(ctx) {
  const c = ctx.cfg;
  const V = studyDir(c);
  if (!V) return ctx.fail('no study dir');
  const RJ = path.join(V, 'reports-judged');
  const dirs = capDirs(V);
  if (dirs.length === 0) return ctx.fail(`no task dirs under ${V}`);
  if (!c.oc || !isExec(c.oc)) return ctx.fail(`opencode binary not found or not executable: ${c.oc}`);
  ctx.say(`P4: judging ${dirs.length} capability task dirs one after another with the opencode backend on Bedrock (credentials file ${c.creds}, path only)`);
  if (c.credsExpiry) ctx.say(`P4: credentials hint: the file is expected to expire about ${c.credsExpiry}; if it does, the chain waits for a re-vend and resumes from the cache`);
  for (const [i, d] of dirs.entries()) {
    const rc = await p4JudgeOne(ctx, d);
    if (rc) return rc;
    ctx.say(`P4: [${i + 1}/${dirs.length}] ${path.basename(d)} judged`);
  }
  const rc = await p4Reports(ctx, V, RJ);
  if (rc) return rc;
  try { fs.writeFileSync(c.pilotSummary, `${pilotSummary(V, RJ)}\n`); } catch { ctx.say(`P4: WARNING: could not write ${c.pilotSummary}`); }
  ctx.stSet('P4_summary', c.pilotSummary);
  ctx.say(`P4: wrote ${c.pilotSummary}`);
  return 0;
}

// ================================================================ P5 SKILL BENCH STAGE 1
function isExec(f) { try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; } }

function pickResultsRoot(c) {
  const cands = c.resultsCandidates.split(':').filter((d) => { try { return fs.statSync(d).isDirectory() && (fs.accessSync(d, fs.constants.W_OK), true); } catch { return false; } });
  const free = cands.map((d) => Number(P.freeGb(d) || 0));
  const best = Math.max(0, ...free);
  const i = free.findIndex((f) => f >= Math.floor((best * 9) / 10) && f > 0);
  return i >= 0 ? path.join(cands[i], 'konductor-skill-bench-results') : '';
}

function exposureRuns(c) {
  if (c.exposureOverride) return c.exposureOverride;
  const V = studyDir(c);
  if (!V) return '';
  const l = [];
  if (c.orchStudy) for (const k of ['claude', 'gpt']) if (fs.existsSync(path.join(c.orchStudy, k))) l.push(path.join(c.orchStudy, k));
  return [...l, ...capDirs(V)].join(',');
}

function sbEnv(c, results, exposure) {
  const env = { ...process.env, CREDS: c.creds, OC: c.oc, RESULTS: results, EXPOSURE_RUNS: exposure, TASKS_PER_SKILL: c.sbTasks,
    STATE_DIR: c.sbStateDir, REPO: c.repo, CLI_JS: c.cliJs, BENCH_DIR: path.join(c.repo, 'bench'), SCRATCH_PARENT: c.scratchParent };
  delete env.SB_CHILD;
  return env;
}

const fileSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
function stopReasonAfter(file, off) {
  let text = '';
  try { text = fs.readFileSync(file).subarray(off).toString('utf8'); } catch { return ''; }
  const all = [...text.matchAll(/study stopped: ([^ \n]+)/g)];
  return all.length ? all[all.length - 1][1] : '';
}

async function p5Preflight(ctx, env, sel) {
  const c = ctx.cfg;
  ctx.say('P5: run-skill-bench --preflight');
  const r = spawnSync('bash', [c.sbScript, '--preflight', ...sel], { env, encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  fs.appendFileSync(c.sbLog, `${out.replace(/\n+$/, '')}\n`);
  if (r.status !== 0) return ctx.fail(`run-skill-bench --preflight failed: ${stripNl(out.split('\n').filter((l) => /preflight FAIL|FAILED/.test(l)).slice(0, 3).join('\n'))}`);
  ctx.say('P5: preflight passed');
  return 0;
}

/** What to do after a failed run-skill-bench: a final failure (1), or 'retry' after credentials came back. */
async function p5AfterFailure(ctx, rc, reason, sbv, attempt) {
  const c = ctx.cfg;
  if (reason.startsWith('controls-run-failed')) {
    return ctx.fail(`the known-answer controls could not run (the runner exited with an error): see ${sbv}/logs/controls-run.log; no verdict was made (${reason}), so stage 1 stopped. Nothing was applied.`);
  }
  if (reason.startsWith('controls-failed')) {
    return ctx.fail(`THE KNOWN-ANSWER CONTROLS FAILED (${reason}): no skill verdict can be trusted, so stage 1 stopped. Study ${sbv}, controls under controls/. Nothing was applied.`);
  }
  if (reason.startsWith('judge-failed') || !credsOk(ctx)) {
    if (attempt > c.sbRetries) return ctx.fail(`run-skill-bench stopped on credentials (${reason}) and the ${c.sbRetries} reruns are used up. Re-vend and rerun 'bash ${c.self}' to resume.`);
    ctx.say(`P5: stopped on credentials (${reason}); waiting for credentials, then rerunning (the study resumes; finished waves and cached judge calls are kept)`);
    const w = await waitForCredentials(ctx, `the skill bench stage 1 (rerun ${attempt} of ${c.sbRetries})`);
    if (w === 130) return 130;
    if (w) return ctx.fail(`no valid credentials after waiting; rerun 'bash ${c.self}' after re-vending`);
    return 'retry';
  }
  return ctx.fail(`run-skill-bench failed (exit ${rc}, reason: ${reason || 'none recorded'}), not a credentials problem. Study ${sbv || 'unknown'}; log ${c.sbLog}. Chain stopped.`);
}

async function p5Skillbench(ctx) {
  const c = ctx.cfg;
  if (!c.oc || !isExec(c.oc)) return ctx.fail(`opencode binary not found or not executable: ${c.oc || '(unset)'}; set OC or AC_OC`);
  if (!fs.existsSync(c.sbScript)) return ctx.fail(`run-skill-bench.sh not found: ${c.sbScript}`);
  const sel = c.sbSkills ? ['--skills', c.sbSkills] : [];
  const results = c.sbResults || pickResultsRoot(c);
  if (!results) return ctx.fail('no writable results filesystem found');
  try { fs.mkdirSync(results, { recursive: true }); } catch { return ctx.fail(`cannot create ${results}`); }
  ctx.stSet('P5_results', results);
  ctx.stSet('P5_skills', c.sbSkills);
  const exposure = exposureRuns(c);
  const env = sbEnv(c, results, exposure);
  const df = spawnSync('df', ['-Pk', results], { encoding: 'utf8' }).stdout.split('\n')[1] || '';
  ctx.say(`P5: results root ${results} (${P.freeGb(results)} GB free; df: ${df.split(/\s+/)[0] || ''} ${df.split(/\s+/)[5] || ''}); ${c.scratchParent} has ${P.freeGb(c.scratchParent)} GB free`);
  ctx.say(`P5: exposure runs: ${exposure ? exposure.split(',').length : 0} directories; tasks per skill ${c.sbTasks}; skills: ${c.sbSkills || 'all'}`);
  const w = await waitForCredentials(ctx, 'the skill bench stage 1');
  if (w === 130) return 130;
  if (w) return ctx.fail(`no valid credentials for stage 1; rerun 'bash ${c.self}' after re-vending`);
  const ps = P.pilotState(ctx);
  if (ps.alive) return ctx.fail(`the capability study is running (pid ${ps.pid})`);
  let rc = await p5Preflight(ctx, env, sel);
  if (rc) return rc;
  for (let attempt = 1; ; attempt++) {
    const off = fileSize(c.sbLog);
    ctx.say(`P5: starting run-skill-bench --foreground (attempt ${attempt} of ${c.sbRetries + 1}; controls run first; log ${c.sbLog})`);
    rc = await P.runChild(ctx, 'bash', [c.sbScript, '--foreground', ...sel], { out: c.sbLog, cwd: c.stateDir, env });
    if (ctx.stopping) return 130;
    const sbv = P.readTrim(c.sbStudyfile);
    if (sbv) ctx.stSet('P5_study', sbv);
    if (rc === 0) {
      ctx.say(`P5: run-skill-bench finished (exit 0); study ${sbv}`);
      if (fs.existsSync(path.join(sbv, 'decisions/decisions.md'))) ctx.say(`P5: decisions: ${sbv}/decisions/decisions.md`);
      else ctx.say(`P5: WARNING: no decisions/decisions.md found under ${sbv}`);
      return 0;
    }
    const reason = stopReasonAfter(c.sbLog, off);
    ctx.stSet('P5_last_stop', `exit ${rc} reason ${reason || 'none recorded'}`);
    ctx.say(`P5: run-skill-bench exited ${rc}; stop reason: ${reason || 'none recorded'}`);
    const next = await p5AfterFailure(ctx, rc, reason, sbv, attempt);
    if (next !== 'retry') return next;
  }
}

module.exports = { p1Wait, p3Autonomy, p4Judge, p5Skillbench, judgeArgs, isExec };
