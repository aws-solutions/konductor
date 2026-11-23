// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the chain prints: the summary file (P6, and on a failure), the --status view and the --dry-run plan.

const fs = require('node:fs');
const path = require('node:path');
const { PHASE_NAMES, ts, fmtDur } = require('./context.js');
const { readTrim, pilotState } = require('./proc.js');
const { studyDir } = require('./study-dirs.js');
const { decisionsText } = require('../chain-report.js');

const indent = (text) => text.split('\n').map((l) => `  ${l}`).join('\n');
const readOr = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

/** One phase row: '  P<n> <NAME padded to 10> <state>[  [reason]]'. */
function phaseRow(ctx, n, s) {
  const reason = ctx.stGet(`P${n}_reason`);
  return `  P${n} ${PHASE_NAMES[n].padEnd(10)} ${s}${reason ? `  [${reason}]` : ''}`;
}

/**
 * Write the summary file atomically.
 * @param {'DONE'|'FAILED'} outcome how the chain ended
 * @param {number} [failedPhase] the phase that failed
 */
function writeSummary(ctx, outcome, failedPhase) {
  const c = ctx.cfg;
  const g = (k) => ctx.stGet(k);
  const L = [];
  L.push(`After-capability chain summary, generated ${ts()}`, `State file: ${c.statefile}   Log: ${c.log}`, '', 'Per-phase result');
  for (let n = 1; n <= 6; n++) L.push(phaseRow(ctx, n, n === 6 && outcome === 'DONE' ? 'done' : g(`P${n}`) || 'not-started'));
  L.push('', 'P2 patches and tests', `  bench suite: ${g('P2_tests')}`);
  for (let n = 1; n <= 8; n++) if (g(`P2_commit${n}`)) L.push(`  commit ${n}: ${g(`P2_commit${n}`)}`);
  if (g('P2_note')) L.push(`  note: ${g('P2_note')}`);
  L.push('', 'P3 autonomy rerun (askedUser and second-turn counts, autonomy runs only)',
    `  before the rerun: ${g('P3_before')}`, `  after the rerun:  ${g('P3_after')}`, `  earlier dirs moved to: ${g('P3_dest')}`);
  if (g('P3_note')) L.push(`  note: ${g('P3_note')}`);
  L.push('', 'P4 capability judging');
  const ps = readOr(c.pilotSummary);
  L.push(ps ? indent(ps.replace(/\n$/, '')) : `  (no ${c.pilotSummary} yet)`);
  L.push('', 'P5 skill bench stage 1');
  const sbv = g('P5_study') || readTrim(c.sbStudyfile);
  L.push(`  study: ${sbv || 'none'}   results root: ${g('P5_results')}   last stop: ${g('P5_last_stop')}`);
  if (sbv && fs.existsSync(path.join(sbv, 'decisions/decisions.json'))) {
    L.push(indent(decisionsText(path.join(sbv, 'decisions/decisions.json'))), `  decisions.md: ${sbv}/decisions/decisions.md`);
  } else L.push('  decisions: not available yet');
  L.push('', 'Credits and spend');
  for (const l of readOr(c.log).split('\n').filter((x) => x.includes('credits so far')).slice(-2)) L.push(`  ${l}`);
  L.push('');
  L.push(outcome === 'DONE' ? 'DONE' : `FAILED at phase ${failedPhase} (${PHASE_NAMES[failedPhase] || '?'}): ${g(`P${failedPhase}_reason`)}`);
  fs.writeFileSync(`${c.summary}.tmp`, `${L.join('\n')}\n`);
  fs.renameSync(`${c.summary}.tmp`, c.summary);
  ctx.say(`summary written: ${c.summary}`);
}

/** The --status text. */
function statusText(ctx, daemonPid) {
  const c = ctx.cfg;
  const L = [daemonPid ? `daemon: running, pid ${daemonPid}` : 'daemon: not running', `log: ${c.log}    state: ${c.statefile}`];
  if (fs.existsSync(c.statefile)) {
    for (let n = 1; n <= 6; n++) L.push(phaseRow(ctx, n, ctx.stGet(`P${n}`)));
    L.push(`  final: ${ctx.stGet('FINAL')}   waiting for credentials: ${ctx.stGet('WAITING_FOR_CREDENTIALS')}`);
  } else L.push('  no state yet (nothing has run)');
  const ps = pilotState(ctx);
  L.push(`capability study: ${ps.alive ? `running, pid ${ps.pid}` : 'not running'}   last log line: ${ps.last || '(none)'}`);
  L.push('last 15 log lines:');
  const log = readOr(c.log).split('\n');
  if (log[log.length - 1] === '') log.pop();
  for (const l of log.slice(-15)) L.push(`  ${l}`);
  return `${L.join('\n')}\n`;
}

/** The --dry-run plan. */
function planText(ctx) {
  const c = ctx.cfg;
  const V = studyDir(c) || '(none)';
  const p2 = c.patchList.length === 0
    ? '  P2 PATCH       skipped: no patches given (set PATCHES)'
    : `  P2 PATCH       in ${c.repo}${c.branch ? ` (${c.branch})` : ''}: gates, git apply --check, apply ${c.patchList.join(' ')} in order, node --test "bench/runner/test/*.test.js" (scratch HOME), 0 failures or git apply -R; ${c.patchList.length} local commit(s), no push`;
  const p3 = c.rerunAutonomy !== '1'
    ? '  P3 AUTONOMY    skipped: RERUN_AUTONOMY is not 1'
    : `  P3 AUTONOMY    move ${V}/${c.autonGlob} to ${V}/incomplete/${c.p3DestPrefix}-<UTC>/ ; bash ${c.pilotScript} --foreground (reruns exactly those); askedUser/second-turn before vs after`;
  const L = [
    `PLAN (each phase gated on the previous; state in ${c.statefile}; resume = rerun)`,
    `  P1 WAIT        poll ${c.pollS}s until ${c.pilotPidfile} is gone/not alive and the last line of ${c.pilotLog} is DONE; FAILED or dead-without-DONE stops; timeout ${fmtDur(c.waitTimeoutS)}`,
    p2, p3,
    `  P4 JUDGE       bench.js judge --run <each task dir> --judge-backend opencode --opencode-bin ${c.oc || '(unset)'} --aws-creds-file ${c.creds || '(unset)'} --aws-profile ${c.awsProfile} --aws-region ${c.awsRegion} --profile detailed --concurrency ${c.judgeConc} --budget-usd ${c.judgeBudget} ; wait for credentials (poll ${c.credPollS}s, up to ${fmtDur(c.credTimeoutS)}); reports into ${V}/reports-judged/ ; ${c.pilotSummary}`,
    `  P5 SKILL BENCH bash ${c.sbScript} --foreground${c.sbSkills ? ` --skills ${c.sbSkills}` : ''} with CREDS, EXPOSURE_RUNS, TASKS_PER_SKILL=${c.sbTasks}, RESULTS on the roomiest filesystem; up to ${c.sbRetries} credential reruns; a failed control stops it`,
    `  P6 SUMMARY     ${c.summary} (ends with DONE or FAILED at phase N)`,
  ];
  if (c.credsExpiry) L.push(`Credentials hint: the file is expected to expire about ${c.credsExpiry}.`);
  return `${L.join('\n')}\n`;
}

module.exports = { writeSummary, statusText, planText };
