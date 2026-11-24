#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Helpers of run-cc-fill.sh, the fill of run-cc-compare.sh's study. Free: no model call.
//
//   node cc-fill.js cells OUT TASK RUNCAP [BENCH]   one line per cell of TASK: "arm rep action reason", action one of
//                                                   run (run it again), keep, flag (keep, and name it in the report) or
//                                                   ask (an error this file cannot place; the owner rules on it)
//   node cc-fill.js aside OUT TASK ARM REP          move one errored cell aside as <rep>.prefill-N, its result.json
//                                                   renamed attempt-result.json (as the runner keeps a throttled try), so
//                                                   --resume runs it again and no report reads the old try
//   node cc-fill.js spent OUT SINCE RUNCAP          USD of every ledger run entry at or after SINCE (ISO time) in OUT's
//                                                   task ledgers, throttled tries included; RUNCAP when a cost is unknown
//
// Rules (a run result is kept; only a cell that never really ran is run again):
//   no result.json, or budget_skipped                    run   (never ran)
//   infraError, authFailure, launchFailure, throttled    run   (the agent never got a fair try; moved aside first)
//   success                                              keep
//   agent self-kill (BENCH's self-kill.js, D-243)        flag  (the agent's own act, scored as it is)
//   timeout                                              flag  (the task's own time cap, the same for both arms)
//   error at 95% or more of the run's USD cap            flag  (claude's own --max-budget-usd stop)
//   any other error                                      ask
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ARMS = ['cc-vanilla', 'cc-konductor'];
const REPS = [1, 2];
const CAP_SHARE = 0.95;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }; // missing or cut: null

/** [action, reason] for one cell's result `r` (null when none) in run folder `dir`. */
function classify(r, dir, runCap, bench) {
  if (!r) return ['run', 'no result'];
  if (r.status === 'budget_skipped') return ['run', 'budget skipped'];
  if (r.status === 'success') return ['keep', 'success'];
  const infra = r.infraError || r.authFailure || r.launchFailure || ((r.flags || []).includes('throttled') && 'throttled');
  if (infra) return ['run', `infra: ${String(infra).slice(0, 120)}`];
  let selfKill = Boolean(r.agentSelfKill);
  if (!selfKill && bench) selfKill = require(path.join(bench, 'bench/runner/lib/self-kill.js')).isSelfKill(dir, r.status);
  if (selfKill) return ['flag', 'agent self-kill'];
  if (r.status === 'timeout') return ['flag', 'timed out at the task time cap'];
  if (r.status === 'error' && Number.isFinite(r.costUsd) && r.costUsd >= CAP_SHARE * runCap) return ['flag', `hit the USD ${runCap} run cap`];
  return ['ask', `${r.status}: ${String(r.error ?? r.stopReason ?? 'no message').slice(0, 120)}`];
}

function cells(out, task, runCap, bench) {
  const rows = [];
  for (const arm of ARMS) for (const rep of REPS) {
    const dir = path.join(out, task, arm, task, String(rep));
    const [action, reason] = classify(readJson(path.join(dir, 'result.json')), dir, runCap, bench);
    rows.push([arm, rep, action, reason]);
  }
  return rows;
}

/** Moves cell OUT/TASK/ARM/TASK/REP to the first free REP.prefill-N; returns the new path. */
function aside(out, task, arm, rep) {
  const dir = path.join(out, task, arm, task, String(rep));
  if (!fs.existsSync(path.join(dir, 'result.json'))) throw new Error(`${dir} has no result.json to move aside`);
  let n = 1;
  while (fs.existsSync(`${dir}.prefill-${n}`)) n++;
  const to = `${dir}.prefill-${n}`;
  fs.renameSync(dir, to);
  fs.renameSync(path.join(to, 'result.json'), path.join(to, 'attempt-result.json'));
  return to;
}

function spent(out, since, runCap) {
  const from = Date.parse(since);
  if (!Number.isFinite(from)) throw new Error(`SINCE ${since} is not a time`);
  let total = 0;
  for (const task of fs.existsSync(out) ? fs.readdirSync(out) : []) {
    const file = path.join(out, task, 'credit-ledger.jsonl');
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let e;
      try { e = JSON.parse(line); } catch { continue; } // blank or partial last line
      if (e.kind !== 'run' || !(Date.parse(e.at) >= from)) continue;
      total += Number.isFinite(e.credits) ? e.credits : runCap;
    }
  }
  return total;
}

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  try {
    if (cmd === 'cells') for (const row of cells(a[0], a[1], Number(a[2]), a[3])) console.log(row.join(' '));
    else if (cmd === 'aside') console.log(aside(a[0], a[1], a[2], a[3]));
    else if (cmd === 'spent') console.log(spent(a[0], a[1], Number(a[2])).toFixed(2));
    else { console.error('usage: see the top of cc-fill.js'); process.exitCode = 64; }
  } catch (e) { console.error(`cc-fill ${cmd}: ${e.message}`); process.exitCode = 1; }
}

module.exports = { classify, cells, aside, spent, ARMS, REPS };
