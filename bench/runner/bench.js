#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * bench.js - benchmark runner for Konductor on kiro-cli or opencode (run, judge, recheck, backfill, report, compare, calibrate).
 *
 *   node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot|cap [--arms a,b] [--tasks id,id]
 *        [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
 *   node bench/runner/bench.js list-arms [--arms a,b] [--repo-root DIR]
 *   node bench/runner/bench.js contrast --run DIR [--base ARM] [--head a,b]
 *   node bench/runner/bench.js pr-plan --ref name=ref|name=dir:path [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
 *   node bench/runner/bench.js cap list|audit|variant|plan|draft|import|trigger|prune-report ...   (capability benchmarking; draft, trigger and live runs cost credits)
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
       [--arm-config name=key.path=value[;key.path=value],...]
       [--stop-on first-capability|first-load|end_turn] [--max-tool-calls N] [--profile quick|detailed]
       (--profile quick runs 1 to 3 replicates (default 2) and labels a result under 3 runs anecdotal. --profile detailed runs at least 5 replicates (default 5),
       adds an A/A arm (the first konductor arm repeated at its exact commit), judges with the graded mode as well, and writes calibration-sample.json and .md
       to the results directory. Without --profile the suite defaults apply and no arm is added. Credits are tracked per run in credit-ledger.jsonl; with no
       --budget-credits nothing stops a run, with it new runs stop at 90% of the budget)
       (--agent-engine is the kiro-cli engine, default v2; v3 installs each arm for the kiro-v3 harness)
       (--prepare-only builds and trial-installs every arm, prints the preflight table and exits before any agent run)
       (--extra-tasks loads tasks from DIR/<id>.json with DIR/fixtures and DIR/hidden; DIR is hidden from the agent like tasks/hidden)
       (--run-credit-limit kills a run once its metered credits pass X; the run is recorded as censored. New launches also stop when
       charged credits plus the largest run so far would pass --budget-credits)
       (--auth-db is the kiro-cli auth database each run's scratch HOME gets a copy of, default the standard location under HOME)
       (--arm-prefix puts the text of FILE (at most 90000 bytes) in front of the task prompt of that arm; run-config records its sha256 and size.
       --arm-agent starts that arm in AGENT instead of its default agent. --arm-config writes keys into that arm's scratch ~/.konductor/config.yml after the
       install, for example --arm-config orch-coord=orchestration.mode=coordinator (orchestration.mode takes auto or coordinator; vanilla refuses it; run-config
       and result.json record it). --stop-on kills the run at the first skills-server call, subagent call
       or end of turn (first-capability), or at the first get_skill, subagent call or end of turn (first-load); the run is flagged earlyStopped and
       has no metered credits (kiro-cli meters at the end of a turn), so its cost is unobserved. --max-tool-calls stops after that many tool calls whatever they are)
       arms: vanilla, v1.0.0, v1.1.0, v1.2.0, main, name=<git ref>, name=dir:<path> (see list-arms for the syntax)
       opencode arms (oc-vanilla, oc-v1.2.0, oc-main; one harness per run):
       --aws-creds-file FILE [--aws-profile bench] [--budget-usd X] [--opencode-bin PATH] [--rg-bin PATH]
  node bench/runner/bench.js judge --run DIR [--judges a,b] [--mode rubric,pairwise] [--baseline vanilla|ARM]
       [--concurrency N] [--budget-credits X] [--judge-cmd CMD] [--max-file-chars N] [--max-bundle-chars N]
       [--redact-file FILE] [--judge-timeout-sec N] [--bench-dir DIR] [--allow-small-panel] [--kiro-bin PATH]
       [--isolate auto|unshare|sandbox-exec|none] [--hide DIR,DIR] [--auth-db FILE] [--extra-tasks DIR,DIR] [--profile quick|detailed]
       (--mode takes rubric, pairwise, graded. graded asks for a 1 to 5 grade of each response in both answer orders and reports where the preference flipped
       with position. --profile detailed makes rubric,pairwise,graded the default modes. Every call is a line in credit-ledger.jsonl)
  node bench/runner/bench.js report --run DIR[,DIR...] [--baseline vanilla|ARM] [--out report.md|DIR] [--detail quick|full] [--format md|html|both]
       [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       [--profile quick|detailed] [--verdict platform|orchestrator-pass] [--phases ID,ID|all] [--test-arms ARM,ARM] [--changed-skills NAME,NAME]
       (--profile sets the default detail (quick or full), adds a check of the run against the profile and, for detailed, writes calibration-sample.json and .md.
       --verdict platform writes verdict.md, verdict.html and verdict.json: one page with keep, discard or not enough evidence for each arm against the baseline,
       from one or more run directories (several need --out); it replaces the normal report for that call.
       --verdict orchestrator-pass writes orchestrator-pass.md, .html and .json: per (harness, model) cell, a PASS, FAIL or NOT ENOUGH EVIDENCE for each test arm
       against the baseline (default vanilla): cost at most 2.0x the baseline per run and per successful run, quality not below it by more than the spread of one
       baseline run, an A/A repeat required and its drift compared with the effect, and a skill-only change must have loaded. A GPT cell is shown beside the Claude
       cell as ratios to vanilla. --test-arms limits the arms judged; --changed-skills says which skills the change lives in, for arms that did not record it)
       (writes report.md, report.html, report.json and charts/*.svg: a diligence scorecard, scores with CIs, charts and the text tables.
       quick is one page, full is everything; default full and both. Several run directories are merged into one run and need --out.
       Spawns, spawn depth, review rounds and reworks after a pass are always shown (read from result.json, else from stream.jsonl). --phases counts the phase
       documents of the listed phases (profiles/phase-documents.json), or all of them; leave it off for tasks that are not SDLC tasks)
  node bench/runner/bench.js contrast --run DIR[,DIR...] [--base ARM] [--head ARM,ARM] [--min-rel 0.15] [--rule both|any] [--by class|task] [--phases ID,ID|all]
       [--detail quick|full] [--format md|html|both] [--out DIR] [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (each head arm against the base arm, overall and per task class (--by task: per task); writes contrast.md, contrast.json, contrast.html
       and charts/ in --out (default: DIR). Default base: v1.2.0 if present, else vanilla, else the first arm. Default head: all other arms)
  node bench/runner/bench.js pr-plan --ref name=<git ref>|name=dir:<path> [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
       [--replicates N] [--no-vanilla] [--budget-credits X] [--seed N] [--repo-root DIR] [--bench-dir DIR]
       (prints the run, contrast, judge and report commands for one ref against a release; runs nothing)
  node bench/runner/bench.js recheck --run DIR [--bench-dir DIR] [--dry-run] [--extra-tasks DIR,DIR]
       (re-evaluates the current task checks against each run's saved workspace; the first results are kept
       under checksOriginal in result.json; stream.jsonl and credit fields are never touched; safe to repeat)
  node bench/runner/bench.js backfill --run DIR [--credits] [--skills] [--write] [--bench-dir DIR] [--repo-root DIR] [--extra-tasks DIR,DIR]
       (repairs finished runs from their stream.jsonl with the runner's own parsers. DIR is one results cell, for example <study>/claude.
       --credits (the default when no mode is given): engine v3 runs saved before the runner could read v3; rewrites credits, turn duration,
       tool names and spawn metrics. A timed-out or killed run has no credit data in v3 and stays censored.
       --skills: rewrites the skill-load fields and capInvocation, which the orchestrator pass rule reads, and prints skills loaded per arm before
       and after. Killed and timed-out runs are included, since their skill calls are in the stream; their credits are not touched.
       --bench-dir and --repo-root locate the tasks and the skill listing, as for "skills". Give both modes to run them in one pass, credits first.
       Without --write it only prints what it would change. --credits --write keeps result.json.pre-backfill, adds creditsBackfill and appends a
       "backfill" line to credit-ledger.jsonl, never editing an earlier line. --skills --write keeps result.json.pre-skills-backfill and adds
       skillsBackfill. Run it when the cell has finished; safe to repeat)
  node bench/runner/bench.js compare --base DIR --head DIR [--min-rel 0.15] [--rule both|any] [--force] [--bench-dir DIR]
       (exit 0 no regression, 1 regression, 2 refused or error)
  node bench/runner/bench.js skills --run DIR [--bench-dir DIR] [--repo-root DIR] [--json] [--extra-tasks DIR,DIR]
       (skill and SOP loads recomputed from stream.jsonl; read-only, works on old and in-progress runs)
  node bench/runner/bench.js cap list [--base REF] [--cap ID,ID] [--kind skill|agent|sop|context] [--all] [--init] [--json]
       [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (registry plus a scan of the capabilities at --base (default v1.2.0): owner, agents that reach each, tasks, trigger
       queries, gaps. --init prints skeleton registry entries for unregistered capabilities and writes nothing. No credits)
  node bench/runner/bench.js cap audit [--base REF] [--harness kiro-cli|opencode|both] [--out DIR] [--public] [--json] [--update-baseline [--force]]
       [--cap ID,ID] [--kind skill|agent|sop|context] [--all] [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (static checks, no model: description lint, bytes, near duplicates, reachability, inbound references, startup bytes,
       task coverage, leakage, registry validity; writes cap-audit.md and cap-audit.json; exit 1 on any error finding.
       --public also scans registry text, task prompts and docs for internal markers. --base takes a ref, dir:PATH or an arm spec.
       Lint checks: name equals directory and is kebab-case, third-person description, SKILL.md length, links, orphan and too-deep reference files,
       frontmatter keys, a When to Use section that repeats the description, blocks copied between skills. If bench/capabilities/audit-baseline.json
       exists, only listed lint findings are tolerated: a new finding fails, and so does a listed one that no longer occurs. --update-baseline writes
       the file (all findings if absent; afterwards it only removes stale waivers, adding needs --force); it is never run for you)
  node bench/runner/bench.js cap variant --scratch DIR [--base REF] [--drop ID,ID] [--replace ID=FILE] [--add ID=FILE --to-agent A,B]
       [--preset skills-only|bare] [--verify] [--force] [--acting-agent A] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR]
       [--cargo-online] [--repo-root DIR] [--bench-dir DIR] [--json]
       (builds a dir: arm from git archive of the base ref with the capability dropped, replaced or added, and prints the arm string for the run command.
       --verify builds it and trial-installs it with a scratch HOME. Exit 2 when the capability is not reachable at startup, unless --force)
  node bench/runner/bench.js cap plan --mode lift|trigger|improve --cap ID [--base REF] [--reps N] [--tasks id,id] [--budget-credits X]
       [--vanilla] [--allow-regex] [--force] [--candidate FILE] [--acting-agent A] [--agent-engine v2|v3] [--scratch DIR] [--seed N]
       [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR] [--json] [--profile quick|detailed]
       (prints the variant, run, contrast, judge and report commands and a credit estimate; runs nothing. Refuses regex-only lift tasks
       without --allow-regex, and refuses to guess credits without observed figures unless --budget-credits is given or --profile is.
       --profile sets the replicates and the profile flag on the printed commands. With detailed, a skill plan also prints the scenario and known-answer
       controls steps and warns when it has fewer than 8 tasks. With a profile the printed run has no budget unless you pass --budget-credits)
  node bench/runner/bench.js cap draft --cap ID,ID [--n 24] [--model M] [--out DIR] [--base REF] [--model-cmd CMD] [--isolate auto|unshare|sandbox-exec|none]
       [--kiro-bin PATH] [--auth-db FILE] [--hide DIR,DIR] [--repo-root DIR] [--bench-dir DIR]
       (one tool-less model call per capability, in a scratch HOME and an empty directory: candidate trigger queries (about half should load,
       half should not, at least half of those near misses of a similar capability), task ideas and, for a SOP, its declared output sections.
       Writes DIR/drafts/<id>.json and .md for human review; assigns no splits; never writes into the repository. Costs credits)
  node bench/runner/bench.js cap import --from FILE --cap ID [--out DIR] [--repo-root DIR] [--bench-dir DIR]
       (reads a skill-creator style JSON array of { query, should_trigger } into the same draft format; should_trigger true is expect load, false is none)
  node bench/runner/bench.js cap scenarios --cap ID,ID [--n 8] [--model M] [--model-cmd CMD] [--out DIR] [--base REF] [--dry-run]
       [--isolate auto|unshare|sandbox-exec|none] [--kiro-bin PATH] [--auth-db FILE] [--hide DIR,DIR] [--repo-root DIR] [--bench-dir DIR]
       (drafts 8 to 30 task scenarios for each skill, at least three quarters where the skill should help and at least one where it should change nothing,
       one tool-less model call per skill in a scratch HOME. Writes DIR/scenarios/<id>.json and .md for human review and never writes into the repository.
       --dry-run writes only the prompt, calls no model, needs no login and spends no credits)
  node bench/runner/bench.js cap controls --out DIR [--base REF] [--reps 5] [--scratch DIR] [--agent-engine v2|v3] [--repo-root DIR] [--bench-dir DIR] [--json]
  node bench/runner/bench.js cap controls --check RUN --base-arm ARM --keep ARM --prune ARM [--aa ARM] --extra-tasks DIR [--bench-dir DIR] [--json]
       (known-answer controls for skill studies. With --out it writes a skill that holds a fact nobody can guess (keep), a decoy skill (prune) and one task for
       each, and prints the variant, run and check commands; free. With --check it reads a finished controls run and exits 0 only when the planted lift was
       found and the decoy showed no effect; it writes controls-check.json beside the run)
  node bench/runner/bench.js cap trigger --cap ID --mode proxy|live [--split train|heldout|all] [--reps 3] [--harness kiro-cli|opencode] [--base REF]
       [--queries FILE] [--out DIR] [--model M] [--model-cmd CMD] [--from-run DIR] [--from-arm NAME] [--acting-agent A] [--concurrency N]
       [--crosscheck F] [--crosscheck-run DIR] [--budget-credits X] [--budget-usd X] [--run-credit-limit X] [--stop-on first-capability|first-load|end_turn]
       [--max-tool-calls N] [--seed N] [--censored-floor X] [--dry-run] [--kiro-bin PATH] [--auth-db FILE] [--isolate auto|unshare|sandbox-exec|none]
       [--hide DIR,DIR] [--cache DIR] [--cargo-target DIR] [--cargo-online] [--agent-engine v2|v3] [--effort LEVEL] [--aws-creds-file FILE]
       [--aws-profile NAME] [--opencode-bin PATH] [--rg-bin PATH] [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR] [--json] [--profile quick|detailed]
       (trigger precision, recall and F1 with Wilson intervals for one capability; queries come from the registry (train, heldout or both; the
       reserve is never used) or from a draft file with --queries. proxy: tool-less model calls; on kiro-cli the model writes find_skills arguments,
       the offline find_skills returns the candidates and a second call picks, so retrieval failures and judgment failures are reported separately;
       on opencode the skill index is in the prompt. The surface is the acting agent's skill filter from --from-run's recorded startupResources
       (arm --from-arm) or from the agent spec at --base. live: real runs of trigger tasks, stopped at the first load or delegation (first-load by
       default; first-capability also stops at find_skills), at most 4 tool calls; needs --budget-credits (--budget-usd on opencode) unless --profile is given, which also sets --reps (quick 1 to 3, detailed at least 5). --crosscheck F
       runs a share F of the queries live (at least one per kind) and --crosscheck-run DIR reads a finished live run; kappa below 0.6 or fewer than
       12 queries prints "proxy not validated". --dry-run only writes the trigger tasks and prints the run command. Harnesses are never merged)
  node bench/runner/bench.js cap prune-report --base REF [--harness kiro-cli|opencode|both] [--runs DIR[,DIR...]] [--runs-glob GLOB]
       [--min-exposure N] [--evidence FILE] [--out DIR] [--json] [--detail quick|full] [--format md|html|both] [--repo-root DIR] [--bench-dir DIR]
       (read-only, no credits: one recommendation per skill and harness from the audit at --base, the skill loads recomputed from the stream.jsonl of
       every non-vanilla run in the run directories (quote the glob), and an optional evidence file. Classes: HARMS, RELOCATE, PRUNE, FIX, KEEP, NEEDS DATA,
       plus a TRIM flag. A class is a recommendation, never a deletion. Writes prune-report.md, .html, .json and charts/ with one decision card per skill; exit 0, or 2 on an input error)
  node bench/runner/bench.js calibrate export --run DIR [--n 25] [--seed S] [--out DIR] [--bench-dir DIR]
       [--max-file-chars N] [--max-bundle-chars N] [--redact-file FILE]
  node bench/runner/bench.js calibrate score --labels FILE [--key FILE] [--kappa-min 0.6] [--agreement-min X] [--spearman-min X] [--save FILE]
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
  if (cmd === 'backfill') return evalCommands.cmdBackfill(opts);
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
