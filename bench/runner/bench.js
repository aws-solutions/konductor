#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * bench.js - benchmark runner for Konductor on kiro-cli or opencode (run, judge, recheck, report, compare, calibrate).
 *
 *   node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot|cap [--arms a,b] [--tasks id,id]
 *        [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
 *   node bench/runner/bench.js list-arms [--arms a,b] [--repo-root DIR]
 *   node bench/runner/bench.js contrast --run DIR [--base ARM] [--head a,b]
 *   node bench/runner/bench.js pr-plan --ref name=ref|name=dir:path [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
 *   node bench/runner/bench.js cap list|audit|variant|plan ...   (capability benchmarking; free, no model calls)
 *
 * Every run executes in a scratch HOME and a fresh cwd with an allowlisted
 * environment, optionally inside a read-only mount namespace. See bench/README.md.
 */
'use strict';

const { listArms, KNOWN_ARMS, resolveArms, formatArmRows, ARM_SYNTAX } = require('./lib/arms.js');
const { cmdRun, repoRootOf } = require('./lib/run-cmd.js');
const { planPr } = require('./lib/pr-plan.js');
const evalCommands = require('./eval-commands.js');
const { cmdCap } = require('../cap/cli.js');
const { BOOLEAN_FLAGS, COMMANDS: COMMAND_NAMES, checkArgs } = require('./lib/cli-flags.js');

const USAGE = `Usage:
  node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot|cap [--arms a,b,c] [--tasks id,id]
       [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
       [--model ID] [--effort LEVEL] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR] [--cargo-online]
       [--seed N] [--isolate auto|unshare|sandbox-exec|none] [--allow-partial] [--censored-floor X] [--hide DIR,DIR]
       [--env-keep NAME,NAME] [--tripwire-exclude PATH,PATH] [--tripwire-depth N] [--tripwire-dir DIR,DIR]
       [--kiro-bin PATH] [--bench-dir DIR] [--repo-root DIR] [--real-cache DIR] [--prepare-only]
       [--extra-tasks DIR,DIR] [--run-credit-limit X] [--auth-db FILE] [--arm-prefix name=FILE,...] [--arm-agent name=AGENT,...]
       [--stop-on first-capability|first-load|end_turn] [--max-tool-calls N]
       (--agent-engine is the kiro-cli engine, default v2; v3 installs each arm for the kiro-v3 harness)
       (--prepare-only builds and trial-installs every arm, prints the preflight table and exits before any agent run)
       (--extra-tasks loads tasks from DIR/<id>.json with DIR/fixtures and DIR/hidden; DIR is hidden from the agent like tasks/hidden)
       (--run-credit-limit kills a run once its metered credits pass X; the run is recorded as censored. New launches also stop when
       charged credits plus the largest run so far would pass --budget-credits)
       (--auth-db is the kiro-cli auth database each run's scratch HOME gets a copy of, default the standard location under HOME)
       (--arm-prefix puts the text of FILE (at most 90000 bytes) in front of the task prompt of that arm; run-config records its sha256 and size.
       --arm-agent starts that arm in AGENT instead of its default agent. --stop-on kills the run at the first skills-server call, subagent call
       or end of turn (first-capability), or at the first get_skill, subagent call or end of turn (first-load); the run is flagged earlyStopped and
       has no metered credits (kiro-cli meters at the end of a turn), so its cost is unobserved. --max-tool-calls stops after that many tool calls whatever they are)
       arms: vanilla, v1.0.0, v1.1.0, v1.2.0, main, name=<git ref>, name=dir:<path> (see list-arms for the syntax)
       opencode arms (oc-vanilla, oc-v1.2.0, oc-main; one harness per run):
       --aws-creds-file FILE [--aws-profile bench] [--budget-usd X] [--opencode-bin PATH] [--rg-bin PATH]
  node bench/runner/bench.js judge --run DIR [--judges a,b] [--mode rubric,pairwise] [--baseline vanilla|ARM]
       [--concurrency N] [--budget-credits X] [--judge-cmd CMD] [--max-file-chars N] [--max-bundle-chars N]
       [--redact-file FILE] [--judge-timeout-sec N] [--bench-dir DIR] [--allow-small-panel] [--kiro-bin PATH]
       [--isolate auto|unshare|sandbox-exec|none] [--hide DIR,DIR] [--auth-db FILE] [--extra-tasks DIR,DIR]
  node bench/runner/bench.js report --run DIR [--baseline vanilla|ARM] [--out report.md] [--bench-dir DIR] [--extra-tasks DIR,DIR]
  node bench/runner/bench.js contrast --run DIR [--base ARM] [--head ARM,ARM] [--min-rel 0.15] [--rule both|any] [--by class|task]
       [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (each head arm against the base arm, overall and per task class (--by task: per task); writes contrast.md and contrast.json
       in DIR. Default base: v1.2.0 if present, else vanilla, else the first arm. Default head: all other arms)
  node bench/runner/bench.js pr-plan --ref name=<git ref>|name=dir:<path> [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
       [--replicates N] [--no-vanilla] [--budget-credits X] [--seed N] [--repo-root DIR] [--bench-dir DIR]
       (prints the run, contrast, judge and report commands for one ref against a release; runs nothing)
  node bench/runner/bench.js recheck --run DIR [--bench-dir DIR] [--dry-run] [--extra-tasks DIR,DIR]
       (re-evaluates the current task checks against each run's saved workspace; the first results are kept
       under checksOriginal in result.json; stream.jsonl and credit fields are never touched; safe to repeat)
  node bench/runner/bench.js compare --base DIR --head DIR [--min-rel 0.15] [--rule both|any] [--force] [--bench-dir DIR]
       (exit 0 no regression, 1 regression, 2 refused or error)
  node bench/runner/bench.js skills --run DIR [--bench-dir DIR] [--repo-root DIR] [--json] [--extra-tasks DIR,DIR]
       (skill and SOP loads recomputed from stream.jsonl; read-only, works on old and in-progress runs)
  node bench/runner/bench.js cap list [--base REF] [--cap ID,ID] [--kind skill|agent|sop|context] [--all] [--init] [--json]
       [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (registry plus a scan of the capabilities at --base (default v1.2.0): owner, agents that reach each, tasks, trigger
       queries, gaps. --init prints skeleton registry entries for unregistered capabilities and writes nothing. No credits)
  node bench/runner/bench.js cap audit [--base REF] [--harness kiro-cli|opencode|both] [--out DIR] [--public] [--json]
       [--cap ID,ID] [--kind skill|agent|sop|context] [--all] [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (static checks, no model: description lint, bytes, near duplicates, reachability, inbound references, startup bytes,
       task coverage, leakage, registry validity; writes cap-audit.md and cap-audit.json; exit 1 on any error finding.
       --public also scans registry text, task prompts and docs for internal markers. --base takes a ref, dir:PATH or an arm spec)
  node bench/runner/bench.js cap variant --scratch DIR [--base REF] [--drop ID,ID] [--replace ID=FILE] [--add ID=FILE --to-agent A,B]
       [--preset skills-only|bare] [--verify] [--force] [--acting-agent A] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR]
       [--cargo-online] [--repo-root DIR] [--bench-dir DIR] [--json]
       (builds a dir: arm from git archive of the base ref with the capability dropped, replaced or added, and prints the arm string for the run command.
       --verify builds it and trial-installs it with a scratch HOME. Exit 2 when the capability is not reachable at startup, unless --force)
  node bench/runner/bench.js cap plan --mode lift|trigger|improve --cap ID [--base REF] [--reps N] [--tasks id,id] [--budget-credits X]
       [--vanilla] [--allow-regex] [--force] [--candidate FILE] [--acting-agent A] [--agent-engine v2|v3] [--scratch DIR] [--seed N]
       [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR] [--json]
       (prints the variant, run, contrast, judge and report commands and a credit estimate; runs nothing. Refuses regex-only lift tasks
       without --allow-regex, and refuses to guess credits without observed figures unless --budget-credits is given)
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
  if (cmd === 'cap') return cmdCap(opts);
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
