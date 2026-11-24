#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Helpers of run-cc-team.sh. Free: reads saved files, no model call.
//
//   node cc-team-reuse.js check RUNS JUDGED TASKS...   checks that the saved Claude Code study (run-cc-compare.sh, at its
//                                                      pre-D-241 setup) can be reused beside the team-mode arm, and prints
//                                                      each task's saved cc-konductor USD, the new arm's expected USD and
//                                                      the judge pass's expected USD; exits 1 naming every mismatch
//
// Reuse is valid when every task is done and ran at the setup the new arm runs at: frozen bench 69149846, the pinned
// Claude Code, the same model, seed, effort, replicates, isolation and USD 1 run cap, cc-vanilla and cc-konductor at
// konductor f5d18459, and all four runs a success. The new arm's expected USD of a task is the sum of the task's two
// saved cc-konductor costs (the same arm and model; team mode spawns no teammate under claude -p). The judge expected
// USD halves each task's saved judge spend: the new arm has 2 runs a task, the study judged 4.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const { readJsonOrNull: readJson } = require('../../runner/lib/util.js'); // missing or cut: null

const WANT = {
  benchCommit: '69149846ad65f1016ec386e88ec9043bdec57203',
  model: 'us.anthropic.claude-sonnet-5-5',
  harnessVersion: '2.1.330.1791',
  seed: 20261121,
  effort: 'high',
  replicates: 2,
  armIds: 'cc-vanilla,cc-konductor=f5d184596378ae72ae531d80647548512c14cacf',
  isolation: 'unshare',
  runCapUsd: 1,
};
const ARMS = ['cc-vanilla', 'cc-konductor'];
const REPS = [1, 2];

/** The setup fields of one task's run-config.json, in WANT's shape. */
function setupOf(rc) {
  return {
    benchCommit: rc.benchCommit, model: rc.model, harnessVersion: rc.harnessVersion, seed: rc.seed, effort: rc.effort,
    replicates: rc.replicates, armIds: (rc.armIds ?? []).join(','), isolation: rc.isolation?.mode,
    runCapUsd: rc.claudeCode?.maxBudgetUsdPerRun,
  };
}

/** USD of a judge log's last "live spend $X USD" line, or null. */
function judgeSpend(log) {
  let text;
  try { text = fs.readFileSync(log, 'utf8'); } catch { return null; }
  const m = [...text.matchAll(/live spend \$([0-9.]+) USD/g)].pop();
  return m ? Number(m[1]) : null;
}

/** Per task: { task, problems[], konductor[usd, usd], judge } from the saved study. */
function survey(runs, judged, tasks) {
  return tasks.map((task) => {
    const problems = [];
    if (!fs.existsSync(path.join(runs, `${task}.done`))) problems.push(`${task}: not done`);
    const rc = readJson(path.join(runs, task, 'run-config.json'));
    if (!rc) problems.push(`${task}: no run-config.json`);
    else {
      const got = setupOf(rc);
      for (const [k, want] of Object.entries(WANT)) if (got[k] !== want) problems.push(`${task}: ${k} is ${got[k]}, want ${want}`);
    }
    const konductor = [];
    for (const arm of ARMS) for (const rep of REPS) {
      const r = readJson(path.join(runs, task, arm, task, String(rep), 'result.json'));
      if (!r) { problems.push(`${task}: ${arm} #${rep} has no result.json`); continue; }
      if (r.status !== 'success') problems.push(`${task}: ${arm} #${rep} is ${r.status}, not success`);
      for (const k of ['model', 'harnessVersion']) if (r[k] !== WANT[k]) problems.push(`${task}: ${arm} #${rep} ${k} is ${r[k]}, want ${WANT[k]}`);
      if (arm === 'cc-konductor') konductor.push(Number(r.costUsd) || 0);
    }
    return { task, problems, konductor, judge: judgeSpend(path.join(judged, `${task}-judge.log`)) };
  });
}

function render(rows) {
  const usd = (x) => x.toFixed(2);
  const lines = ['| task | saved cc-konductor #1 USD | #2 USD | expected new arm USD |', '| --- | --- | --- | --- |'];
  let total = 0;
  let judge = 0;
  for (const r of rows) {
    const sum = r.konductor.reduce((a, b) => a + b, 0);
    total += sum;
    judge += (r.judge ?? 0.2) / 2;   // a task with no judge log counts the judge script's per-task worst case
    lines.push(`| ${r.task} | ${usd(r.konductor[0] ?? 0)} | ${usd(r.konductor[1] ?? 0)} | ${usd(sum)} |`);
  }
  const n = rows.length;
  lines.push('', `reused: ${n * 4} saved runs (${n * 2} cc-vanilla, ${n * 2} cc-konductor), ${n} of ${n} tasks`);
  lines.push(`new arm: expected USD ${usd(total)} for ${n * 2} runs (USD ${usd(total / (n * 2))} a run)`);
  lines.push(`judge: expected USD ${usd(judge)} (half the study's judge spend a task)`);
  return lines.join('\n');
}

if (require.main === module) {
  const [cmd, runs, judged, ...tasks] = process.argv.slice(2);
  if (cmd !== 'check' || !runs || !judged || !tasks.length) { console.error('usage: node cc-team-reuse.js check RUNS JUDGED TASKS...'); process.exit(64); }
  const rows = survey(runs, judged, tasks);
  const problems = rows.flatMap((r) => r.problems);
  if (problems.length) { console.error(`the saved study cannot be reused:\n  ${problems.join('\n  ')}`); process.exit(1); }
  console.log(render(rows));
}

module.exports = { WANT, setupOf, judgeSpend, survey, render };
