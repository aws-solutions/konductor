#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * bench.js - benchmark runner for Konductor on kiro-cli or opencode (run, judge, recheck, report, compare, calibrate).
 *
 *   node bench/runner/bench.js run --suite lite|full|hard [--arms a,b] [--tasks id,id]
 *        [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
 *   node bench/runner/bench.js list-arms
 *
 * Every run executes in a scratch HOME and a fresh cwd with an allowlisted
 * environment, optionally inside a read-only mount namespace. See bench/README.md.
 */
'use strict';

const { listArms, KNOWN_ARMS } = require('./lib/arms.js');
const { cmdRun } = require('./lib/run-cmd.js');
const evalCommands = require('./eval-commands.js');

const USAGE = `Usage:
  node bench/runner/bench.js run --suite lite|full|hard [--arms a,b,c] [--tasks id,id]
       [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
       [--model ID] [--effort LEVEL] [--cache DIR] [--cargo-target DIR] [--cargo-online]
       [--seed N] [--isolate unshare|none|auto] [--allow-partial] [--censored-floor X] [--hide DIR,DIR]
       [--env-keep NAME,NAME] [--tripwire-exclude PATH,PATH] [--tripwire-depth N] [--tripwire-dir DIR,DIR]
       [--kiro-bin PATH] [--bench-dir DIR] [--repo-root DIR]
       opencode arms (oc-vanilla, oc-v1.2.0, oc-main; one harness per run):
       --aws-creds-file FILE [--aws-profile bench] [--budget-usd X] [--opencode-bin PATH] [--rg-bin PATH]
  node bench/runner/bench.js judge --run DIR [--judges a,b] [--mode rubric,pairwise] [--baseline vanilla]
       [--concurrency N] [--budget-credits X] [--judge-cmd CMD] [--max-file-chars N] [--max-bundle-chars N]
       [--redact-file FILE] [--judge-timeout-sec N] [--bench-dir DIR] [--allow-small-panel] [--kiro-bin PATH]
       [--isolate unshare|none|auto] [--hide DIR,DIR] [--auth-db FILE]
  node bench/runner/bench.js report --run DIR [--baseline vanilla] [--out report.md]
  node bench/runner/bench.js recheck --run DIR [--bench-dir DIR] [--dry-run]
       (re-evaluates the current task checks against each run's saved workspace; the first results are kept
       under checksOriginal in result.json; stream.jsonl and credit fields are never touched; safe to repeat)
  node bench/runner/bench.js compare --base DIR --head DIR [--min-rel 0.15] [--rule both|any] [--force]
       (exit 0 no regression, 1 regression, 2 refused or error)
  node bench/runner/bench.js skills --run DIR [--bench-dir DIR] [--repo-root DIR] [--json]
       (skill and SOP loads recomputed from stream.jsonl; read-only, works on old and in-progress runs)
  node bench/runner/bench.js calibrate export --run DIR [--n 25] [--seed S] [--out DIR]
  node bench/runner/bench.js calibrate score --labels FILE [--key FILE] [--kappa-min 0.6]
  node bench/runner/bench.js list-arms`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return opts;
}

function cmdListArms() {
  for (const a of listArms()) console.log(`${a.id.padEnd(8)} ${a.condition}${a.note ? `  (${a.note})` : ''}`);
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  const opts = parseArgs(rest);
  if (cmd === 'run') return cmdRun(opts);
  if (cmd === 'list-arms') return cmdListArms();
  if (cmd === 'judge') return evalCommands.cmdJudge(opts);
  if (cmd === 'report') return evalCommands.cmdReport(opts);
  if (cmd === 'recheck') return evalCommands.cmdRecheck(opts);
  if (cmd === 'compare') return evalCommands.cmdCompare(opts);
  if (cmd === 'skills') return evalCommands.cmdSkills(opts);
  if (cmd === 'calibrate') return evalCommands.cmdCalibrate(opts);
  console.error(USAGE);
  process.exitCode = cmd ? 2 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`bench: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main, KNOWN_ARMS };
