#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * bench.js - benchmark runner for Konductor on kiro-cli or opencode (run, judge, recheck, report, compare, calibrate).
 *
 *   node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot [--arms a,b] [--tasks id,id]
 *        [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
 *   node bench/runner/bench.js list-arms [--arms a,b] [--repo-root DIR]
 *   node bench/runner/bench.js contrast --run DIR [--base ARM] [--head a,b]
 *   node bench/runner/bench.js pr-plan --ref name=ref|name=dir:path [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
 *
 * Every run executes in a scratch HOME and a fresh cwd with an allowlisted
 * environment, optionally inside a read-only mount namespace. See bench/README.md.
 */
'use strict';

const { listArms, KNOWN_ARMS, resolveArms, formatArmRows, ARM_SYNTAX } = require('./lib/arms.js');
const { cmdRun, repoRootOf } = require('./lib/run-cmd.js');
const { planPr } = require('./lib/pr-plan.js');
const evalCommands = require('./eval-commands.js');
const { BOOLEAN_FLAGS, COMMANDS: COMMAND_NAMES, checkArgs } = require('./lib/cli-flags.js');

const USAGE = `Usage:
  node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot [--arms a,b,c] [--tasks id,id]
       [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
       [--model ID] [--effort LEVEL] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR] [--cargo-online]
       [--seed N] [--isolate auto|unshare|sandbox-exec|none] [--allow-partial] [--censored-floor X] [--hide DIR,DIR]
       [--env-keep NAME,NAME] [--tripwire-exclude PATH,PATH] [--tripwire-depth N] [--tripwire-dir DIR,DIR]
       [--kiro-bin PATH] [--bench-dir DIR] [--repo-root DIR] [--real-cache DIR] [--prepare-only]
       (--agent-engine is the kiro-cli engine, default v2; v3 installs each arm for the kiro-v3 harness)
       (--prepare-only builds and trial-installs every arm, prints the preflight table and exits before any agent run)
       arms: vanilla, v1.0.0, v1.1.0, v1.2.0, main, name=<git ref>, name=dir:<path> (see list-arms for the syntax)
       opencode arms (oc-vanilla, oc-v1.2.0, oc-main; one harness per run):
       --aws-creds-file FILE [--aws-profile bench] [--budget-usd X] [--opencode-bin PATH] [--rg-bin PATH]
  node bench/runner/bench.js judge --run DIR [--judges a,b] [--mode rubric,pairwise] [--baseline vanilla|ARM]
       [--concurrency N] [--budget-credits X] [--judge-cmd CMD] [--max-file-chars N] [--max-bundle-chars N]
       [--redact-file FILE] [--judge-timeout-sec N] [--bench-dir DIR] [--allow-small-panel] [--kiro-bin PATH]
       [--isolate auto|unshare|sandbox-exec|none] [--hide DIR,DIR] [--auth-db FILE]
  node bench/runner/bench.js report --run DIR [--baseline vanilla|ARM] [--out report.md] [--bench-dir DIR]
  node bench/runner/bench.js contrast --run DIR [--base ARM] [--head ARM,ARM] [--min-rel 0.15] [--rule both|any] [--bench-dir DIR]
       (each head arm against the base arm, overall and per task class; writes contrast.md and contrast.json
       in DIR. Default base: v1.2.0 if present, else vanilla, else the first arm. Default head: all other arms)
  node bench/runner/bench.js pr-plan --ref name=<git ref>|name=dir:<path> [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
       [--replicates N] [--no-vanilla] [--budget-credits X] [--seed N] [--repo-root DIR] [--bench-dir DIR]
       (prints the run, contrast, judge and report commands for one ref against a release; runs nothing)
  node bench/runner/bench.js recheck --run DIR [--bench-dir DIR] [--dry-run]
       (re-evaluates the current task checks against each run's saved workspace; the first results are kept
       under checksOriginal in result.json; stream.jsonl and credit fields are never touched; safe to repeat)
  node bench/runner/bench.js compare --base DIR --head DIR [--min-rel 0.15] [--rule both|any] [--force] [--bench-dir DIR]
       (exit 0 no regression, 1 regression, 2 refused or error)
  node bench/runner/bench.js skills --run DIR [--bench-dir DIR] [--repo-root DIR] [--json]
       (skill and SOP loads recomputed from stream.jsonl; read-only, works on old and in-progress runs)
  node bench/runner/bench.js calibrate export --run DIR [--n 25] [--seed S] [--out DIR] [--bench-dir DIR]
       [--max-file-chars N] [--max-bundle-chars N] [--redact-file FILE]
  node bench/runner/bench.js calibrate score --labels FILE [--key FILE] [--kappa-min 0.6] [--agreement-min X] [--spearman-min X]
  node bench/runner/bench.js list-arms [--arms a,b,c] [--repo-root DIR]

${ARM_SYNTAX}

An unknown flag is an error (exit 2) and nothing runs. --help and -h print this text.`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { opts.help = true; continue; }
    if (!a.startsWith('--')) { opts._.push(a); continue; }
    const key = a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) { opts[key] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--') || next === '-h') opts[key] = true;
    else { opts[key] = next; i++; }
  }
  return opts;
}

function cmdListArms(opts) {
  for (const a of listArms()) console.log(`${a.id.padEnd(11)} ${a.condition}${a.note ? `  (${a.note})` : ''}`);
  console.log(`\n${ARM_SYNTAX}`);
  if (opts.arms && opts.arms !== true) {
    const repo = repoRootOf(opts);
    console.log(`\nResolved against ${repo} (local refs only, nothing is fetched or built):\n${formatArmRows(resolveArms(String(opts.arms).split(',').filter(Boolean), repo))}`);
  }
}

function cmdPrPlan(opts) {
  try {
    const p = planPr({
      ref: opts.ref, base: opts.base === undefined ? undefined : opts.base, suite: opts.suite === undefined ? undefined : opts.suite,
      replicates: opts.replicates, noVanilla: Boolean(opts['no-vanilla']), budgetCredits: opts['budget-credits'] === undefined ? null : Number(opts['budget-credits']),
      seed: opts.seed, benchDir: opts['bench-dir'] ? require('node:path').resolve(opts['bench-dir']) : undefined,
      repoRoot: opts['repo-root'] && opts['repo-root'] !== true ? opts['repo-root'] : null,
    });
    console.log(p.text);
  } catch (e) {
    console.error(`pr-plan: ${e.message}`);
    process.exitCode = 2;
  }
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(USAGE); return; }
  const opts = parseArgs(rest);
  if (opts.help !== undefined && COMMAND_NAMES.includes(cmd)) { console.log(USAGE); return; }
  const problem = COMMAND_NAMES.includes(cmd) ? checkArgs(cmd, opts) : null;
  if (problem) { console.error(`bench: ${problem}`); process.exitCode = 2; return; }
  if (cmd === 'run') return cmdRun(opts);
  if (cmd === 'list-arms') return cmdListArms(opts);
  if (cmd === 'pr-plan') return cmdPrPlan(opts);
  if (cmd === 'contrast') return evalCommands.cmdContrast(opts);
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
