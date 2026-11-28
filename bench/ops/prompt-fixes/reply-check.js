#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reply check for the prompt-fix adaptive arm: does the root reply carry the lines the arm asks for (Plan, Skills,
// Review gate), in the right place, with the pre-registered solo or team choice? A diagnostic, not a counted verdict.
//   node reply-check.js score   --runs DIR [--arm konductor-adaptive] [--early yes] [--out FILE]   free: checks E1 to E7
//   node reply-check.js prompts --runs DIR --out DIR [--arm A] [--prefix P] [--tasks ID,ID] [--early yes]
//                               free: one frozen reviewer prompt per run (P.<task>.r<rep>.review-prompt.txt) and its
//                               entry in DIR/manifest.json (task, run dir, sha256, deterministic score); an existing
//                               prompt is never rewritten
//   node reply-check.js plan    --tasks smoke|all|ID,ID --reps N --run-limit N [--runs DIR]   free: paid call count and cost
//   node reply-check.js may-run --runs DIR --ledger FILE --cap N --run-cap N --run-limit N
//                               free: exit 0 and "left N" when one more early-stopped run fits both caps, else 1 and why
//   node reply-check.js rebook-early --runs DIR [--arm A] [--apply yes]
//                               free: tops up early stops an older bench booked at the floor to their measured
//                               creditSplit (D-299), in DIR/rebooked; without --apply yes it only says what it would book
//   node reply-check.js review  --prompts DIR --out DIR --claude MODEL --cap N --runs DIR --cap-usd X --work DIR
//                               [--kiro-bin F] [--auth-db F] [--aws-export-profile P] [--cache DIR] [--panel-module F]
//                               PAID: per prompt, one Claude reviewer call (kiro-cli, counted at max(15, real)) and one
//                               call per panel judge (opencode, USD); each call is checked against the ledgers first
//   node reply-check.js compare --prompts DIR --reviews DIR [--out FILE]   free: both reviewers side by side, flagged
// --early yes treats every run as stopped early (E5 to E7 are not reached). The caps are the owner's approval of
// 2026-11-27 (300 credits for the runs and the Claude reviewer together, USD 0.50 for the panel); the owner script
// run-prompt-fix-arms.sh reply-check passes them. The panel's majority is the verdict; Claude is shown beside it.
// The parts: reply-manifest.js (checks, reply shape, manifest), reply-score.js (scoring and prompts), reply-budget.js
// (plan, caps, re-booking) and reply-review.js (review and compare). This file is the command line.

const fs = require('node:fs');
const path = require('node:path');
const { EXPECT } = require('../../runner/lib/plan-call.js');
const { expectationsFor, checkReview, panelCallUsd, readManifest, sha256, PANEL, MANIFEST } = require('./reply-manifest.js');
const { timeline, scoreRun, transcriptOf, reviewPrompt, runsOf, eventsOf, verdictOf, stoppedOf, scoreTable } = require('./reply-score.js');
const { paidPlan, mayRun, rebookEarly } = require('./reply-budget.js');
const { review, compare, panelCallerOf } = require('./reply-review.js');

const BENCH = path.join(__dirname, '..', '..');
const SMOKE = ['t12-mux-parallel-merge', 't1-bug-date-range', 't12-split-shared-file', 'probe-e2e-explicit-yes'];

function findTaskPrompt(taskId) {
  const dirs = fs.readdirSync(path.join(BENCH, 'scenarios')).map((d) => path.join(BENCH, 'scenarios', d)).concat([path.join(BENCH, 'complex'), path.join(BENCH, 'tasks')]);
  for (const d of dirs) {
    const f = path.join(d, `${taskId}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).prompt;
  }
  throw new Error(`no task file for ${taskId}`);
}

/**
 * Writes one reviewer prompt per run of `arm` under `runs` into `out`, named `<prefix>.<task>.r<rep>`, and records it in
 * out/manifest.json with its run dir, sha256 and deterministic score. `tasks` (a list) keeps only those tasks. A prompt
 * already in the manifest is kept as it is (frozen): the reviewers must read the same bytes on a rerun.
 */
function writePrompts({ runs, out, arm, prefix, tasks = null, early = false, log }) {
  fs.mkdirSync(out, { recursive: true });
  const m = readManifest(out);
  for (const { dir, result } of runsOf(runs, arm)) {
    if (tasks && !tasks.includes(result.taskId)) continue;
    const name = `${prefix ? `${prefix}.` : ''}${result.taskId}.r${result.replicate ?? 1}`;
    const f = path.join(out, `${name}.review-prompt.txt`);
    if (m.entries[name] && fs.existsSync(f)) { log(`${f} kept (frozen)`); continue; }
    const p = reviewPrompt({ taskId: result.taskId, taskPrompt: findTaskPrompt(result.taskId), transcript: transcriptOf(eventsOf(dir)) });
    const s = scoreRun({ events: eventsOf(dir), orch: result.orch, taskId: result.taskId, stopped: stoppedOf(result, early) });
    fs.writeFileSync(f, p);
    m.entries[name] = { taskId: result.taskId, replicate: result.replicate ?? 1, dir, file: path.basename(f), sha256: sha256(p), kchars: p.length / 1000,
      score: Object.fromEntries(s.checks.map((c) => [c.id, verdictOf(c.met)])) };
    log(`${f} ${(p.length / 1000).toFixed(1)}K chars`);
  }
  fs.writeFileSync(path.join(out, MANIFEST), `${JSON.stringify(m, null, 2)}\n`);
  return m;
}

class UsageError extends Error {}

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new UsageError(`bad argument ${rest[i]}`);
    const key = rest[i].slice(2);
    if (key in opts) throw new UsageError(`--${key} is given twice`);
    opts[key] = rest[i + 1];
  }
  return { cmd, opts };
}

const need = (opts, ...keys) => { for (const k of keys) if (opts[k] === undefined) throw new UsageError(`--${k} is required`); };

function main(argv, log = console.log) {
  const { cmd, opts } = parseArgs(argv);
  const arm = opts.arm ?? 'konductor-adaptive';
  const early = opts.early === 'yes';
  if (cmd === 'score') {
    const table = scoreTable(runsOf(opts.runs, arm), early);
    if (opts.out) fs.writeFileSync(opts.out, `${table}\n`);
    log(table);
  } else if (cmd === 'prompts') {
    need(opts, 'runs', 'out');
    writePrompts({ runs: opts.runs, out: opts.out, arm, prefix: opts.prefix ?? '', tasks: opts.tasks ? opts.tasks.split(',') : null, early, log });
  } else if (cmd === 'plan') {
    const tasks = opts.tasks === 'smoke' ? SMOKE : opts.tasks === 'all' ? Object.keys(EXPECT.tasks) : opts.tasks.split(',');
    tasks.forEach(expectationsFor);
    const existing = opts.runs ? runsOf(opts.runs, arm).length : 0;
    const p = paidPlan({ tasks, reps: Number(opts.reps), runLimit: Number(opts['run-limit']), existing, promptKChars: Number(opts['prompt-kchars'] ?? 12) });
    log(JSON.stringify(p, null, 2));
  } else if (cmd === 'may-run') {
    need(opts, 'runs', 'ledger', 'cap', 'run-cap', 'run-limit');
    const r = mayRun({ runs: opts.runs, ledger: opts.ledger, cap: Number(opts.cap), runCap: Number(opts['run-cap']), runLimit: Number(opts['run-limit']) });
    log(r.ok ? `left ${r.left}` : r.why);
    return r.ok ? 0 : 1;
  } else if (cmd === 'rebook-early') {
    need(opts, 'runs');
    const apply = opts.apply === 'yes';
    const done = rebookEarly({ runs: opts.runs, arm, apply });
    for (const x of done) log(`${x.cell}: early stop booked ${x.booked}, measured ${x.measured}; ${apply ? 'booked' : 'would book'} ${x.topUp} more`);
    if (!done.length) log('no early stop to re-book');
  } else if (cmd === 'review') {
    need(opts, 'prompts', 'out', 'claude', 'cap', 'runs', 'cap-usd', 'work');
    const cap = Number(opts.cap); const capUsd = Number(opts['cap-usd']);
    if (!(cap > 0) || !(capUsd > 0)) throw new UsageError('--cap and --cap-usd must be positive numbers');
    return review({ promptsDir: opts.prompts, out: opts.out, claudeModel: opts.claude, capCredits: cap, runsDir: opts.runs, capUsd, workDir: opts.work,
      kiroBin: opts['kiro-bin'], authDb: opts['auth-db'], panelCaller: panelCallerOf(opts), log }).then(() => 0);
  } else if (cmd === 'compare') {
    need(opts, 'prompts', 'reviews');
    const md = compare({ promptsDir: opts.prompts, reviewsDir: opts.reviews });
    if (opts.out) fs.writeFileSync(opts.out, md);
    log(md);
  } else {
    throw new UsageError('usage: reply-check.js score|prompts|plan|may-run|rebook-early|review|compare (see the header)');
  }
  return 0;
}

if (require.main === module) {
  Promise.resolve().then(() => main(process.argv.slice(2))).then((code) => { process.exitCode = code; }, (err) => {
    console.error(err.message);
    process.exitCode = err instanceof UsageError ? 64 : 1;
  });
}

module.exports = { expectationsFor, timeline, scoreRun, transcriptOf, reviewPrompt, checkReview, paidPlan, panelCallUsd, writePrompts, readManifest, sha256, mayRun, rebookEarly, main, SMOKE, PANEL, MANIFEST };
