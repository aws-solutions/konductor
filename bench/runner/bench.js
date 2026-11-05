#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * bench.js - benchmark runner for Konductor on kiro-cli or opencode (run, judge, recheck, backfill, report, compare, calibrate).
 *
 *   node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot|cap|requirements [--arms a,b] [--tasks id,id]
 *        [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
 *   node bench/runner/bench.js list-arms [--arms a,b] [--repo-root DIR]
 *   node bench/runner/bench.js contrast --run DIR [--base ARM] [--head a,b]
 *   node bench/runner/bench.js pr-plan --ref name=ref|name=dir:path [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
 *   node bench/runner/bench.js cap list|audit|variant|plan|draft|import|trigger|prune-report|scenarios|controls|skill-plan|skill-study|decide|review|review-import|criteria|forced-prefix ...   (capability benchmarking; draft, trigger and live runs cost credits)
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
  node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot|cap|requirements [--arms a,b,c] [--tasks id,id]
       [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
       [--model ID] [--effort LEVEL] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR] [--cargo-online]
       [--seed N] [--isolate auto|unshare|sandbox-exec|none] [--allow-unisolated] [--allow-partial] [--censored-floor X] [--hide DIR,DIR] [--no-default-hide]
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
       Claude Code arms (cc-vanilla, cc-main, cc-name=<git ref>; one harness per run; the real claude binary, never a launcher script):
       [--budget-usd X] [--run-budget-usd X] [--aws-region us-east-1] (--claude-bin PATH | --claude-tools-dir DIR)
       (credentials are the AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN variables of the shell that starts the bench; nothing is read from a file.
       --run-budget-usd is claude's own per-run cap, default 5. --effort, --stop-on, --max-tool-calls and --run-credit-limit do not apply)
  node bench/runner/bench.js judge --run DIR [--judges a,b] [--mode rubric,pairwise] [--baseline vanilla|ARM]
       [--concurrency N] [--budget-credits X] [--judge-cmd CMD] [--max-file-chars N] [--max-bundle-chars N]
       [--redact-file FILE] [--judge-timeout-sec N] [--bench-dir DIR] [--allow-small-panel] [--kiro-bin PATH]
       [--isolate auto|unshare|sandbox-exec|none] [--hide DIR,DIR] [--auth-db FILE] [--extra-tasks DIR,DIR] [--profile quick|detailed]
       [--judge-backend kiro|opencode] [--budget-usd X] [--aws-creds-file FILE] [--aws-profile bench] [--aws-region us-east-1] [--opencode-bin PATH] [--cache DIR]
       [--criteria-pack quality] [--plan] [--rescore-quotes [--quote-match lenient|strict]]
       (--criteria-pack quality runs only the quality-dimensions pass over the finished runs and writes judgments-quality.json beside judgments.json; judgments.json is not read or changed.
       Criteria that do not apply to a run are skipped and reported as n/a. See bench/QUALITY-PACK.md)
       (--rescore-quotes matches the stored evidence quotes of --run again with no model call and writes judgments-lenient.json beside judgments.json (judgments.json is untouched),
       then prints the share of verdicts downgraded per judge before and after and the mean rubric per arm. The lenient rule ignores table pipes, list markers and escapes, accepts
       fragments joined by spaces, new lines or ellipses when every fragment of 20 or more letters is found in order, and accepts a verbatim quoted sentence of 40 or more letters
       inside the judge's prose; a quote with a fragment the output does not hold is still lowered one level. --quote-match strict only checks that the default rule reproduces the stored values.
       A report reads the new file when its scoring file sets "quotes": "lenient")
       (--plan works in every mode: it prints the backend, the panel, the call count per mode, the calls the cache already holds and an estimated spend, calls no model and writes nothing.
       A real pass prints the backend and the panel before its first call)
       (--judge-backend opencode asks the panel through opencode run on Amazon Bedrock (tools off, a one-line system prompt, temperature 0 where the model takes one)
       instead of kiro-cli. It needs --aws-creds-file, costs USD (--budget-usd, not --budget-credits) and cannot be combined with --judge-cmd. Panel ids stay the same
       (gpt-5.6-luna, deepseek-3.2, glm-5, qwen3-coder-next, minimax-m2.5) and are mapped to Bedrock ids. One results directory keeps one backend; kiro is the default)
       (--mode takes rubric, pairwise, graded. graded asks for a 1 to 5 grade of each response in both answer orders and reports where the preference flipped
       with position. --profile detailed makes rubric,pairwise,graded the default modes. Every call is a line in credit-ledger.jsonl)
  node bench/runner/bench.js explain --run DIR [--arm A] [--task T] [--rep N] [--brief] [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (how the quality number of saved runs was computed: every check with what was observed, hidden tests, the rubric per judge with its evidence and downgrade
       notes, the weights and their renormalisation, the final number, and the number if checks were scored as a fraction. --run takes a run directory with
       several arms, a 2x2 cell directory, or a 2x2 root (then --arm may name a cell). --brief prints one line per run. Reads files only; no model, no writes)
  node bench/runner/bench.js trace --run DIR --arm A --task T --rep N [--format md|json] [--full] [--instructions] [--repo-root DIR]
       (the timeline of one saved run from its stream.jsonl: the prompt, each assistant turn, every tool call, skill discovery and loads, each delegation with its
       brief and what came back, files written, credits and time per turn, and a header with the entry agent, skills listed against loaded, the spawn tree, wall time,
       credits, flags and what the run directory cannot show. --full prints briefs, results and thoughts in full. --instructions adds, for each skill load and
       delegation, the installed instruction lines that mention it (read from the arm's commit in --repo-root, default this repository), marked INFERRED. Kiro and Claude Code runs)
  node bench/runner/bench.js report --run DIR[,DIR...] [--baseline vanilla|ARM] [--out report.md|DIR] [--detail quick|full] [--format md|html|both]
       [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       [--profile quick|detailed] [--verdict platform|orchestrator-pass] [--phases ID,ID|all] [--test-arms ARM,ARM] [--changed-skills NAME,NAME] [--criteria-pack quality]
       (--criteria-pack quality adds a Quality dimensions table from judgments-quality.json; it is indicative and not part of quality /100.
       --scoring profiles/scoring-fractional.json scores the checks component as passed / total instead of 1 only when every check passed; the default is unchanged.
       --profile sets the default detail (quick or full), adds a check of the run against the profile and, for detailed, writes calibration-sample.json and .md.
       --verdict platform writes verdict.md, verdict.html and verdict.json: one page with keep, discard or not enough evidence for each arm against the baseline,
       from one or more run directories (several need --out); it replaces the normal report for that call.
       With --criteria-pack quality and a --scoring file that weights the pack, either verdict scores every run with the pack included; every run then needs a current pack judgment.
       --verdict orchestrator-pass writes orchestrator-pass.md, .html and .json: per (harness, model) cell, a PASS, FAIL or NOT ENOUGH EVIDENCE for each test arm
       against the baseline (default vanilla): cost at most 2.0x the baseline per run and per successful run, quality not below it by more than the spread of one
       baseline run, an A/A repeat required and its drift compared with the effect, and a skill-only change must have loaded. A GPT cell is shown beside the Claude
       cell as ratios to vanilla. --test-arms limits the arms judged; --changed-skills says which skills the change lives in, for arms that did not record it)
       (writes report.md, report.html, report.json and charts/*.svg: a diligence scorecard, scores with CIs, charts and the text tables.
       quick is one page, full is everything; default full and both. Several run directories are merged into one run and need --out.
       Spawns, spawn depth, review rounds and reworks after a pass are always shown (read from result.json, else from stream.jsonl). --phases counts the phase
       documents of the listed phases (profiles/phase-documents.json), or all of them; leave it off for tasks that are not SDLC tasks)
  node bench/runner/bench.js report-2x2 --kiro-vanilla DIR[,DIR...] --kiro-konductor DIR[,DIR...] --cc-vanilla DIR[,DIR...] --cc-konductor DIR[,DIR...]
       [--out DIR] [--json] [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR] [--criteria-pack quality]
       (the 2x2 pilot table, harness by konductor on one model, from four judged run directories, one harness each; prints markdown, or JSON with --json,
       and writes factorial-2x2.md, .json and three SVG charts in charts/ to --out. Refuses cells with different tasks, judge panels, rubric revisions, models or cost units. Quality is compared
       across cells; cost only as konductor over vanilla inside a harness. Intervals appear only with 5 or more tasks of 2 or more replicates per cell, otherwise
       the table says "descriptive only" and the charts carry no whiskers. Reads run directories and writes nothing but --out)
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
  node bench/runner/bench.js cap variant --scratch DIR [--base REF] [--drop ID,ID] [--replace ID=FILE] [--overlay ID=DIR] [--add ID=FILE --to-agent A,B]
       [--preset skills-only|bare] [--verify] [--force] [--acting-agent A] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR]
       [--cargo-online] [--repo-root DIR] [--bench-dir DIR] [--json]
       (builds a dir: arm from git archive of the base ref with the capability dropped, replaced or added, and prints the arm string for the run command.
       --overlay skill:NAME=DIR replaces SKILL.md and adds references/** from DIR in one step (a section moved out of a skill); it never overwrites a reference file.
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
  node bench/runner/bench.js cap import --from FILE --cap ID [--n 24] [--out DIR] [--repo-root DIR] [--bench-dir DIR]
       (reads a skill-creator style JSON array of { query, should_trigger } into the same draft format; should_trigger true is expect load, false is none)
  node bench/runner/bench.js cap scenarios --cap ID,ID [--mode lift|trigger] [--n N] [--seed-queries FILE] [--model M] [--model-cmd CMD] [--out DIR] [--base REF] [--dry-run]
       [--isolate auto|unshare|sandbox-exec|none] [--kiro-bin PATH] [--auth-db FILE] [--hide DIR,DIR] [--repo-root DIR] [--bench-dir DIR]
       (drafts 8 to 30 task scenarios for each skill, at least three quarters where the skill should help and at least one where it should change nothing,
       one tool-less model call per skill in a scratch HOME. Writes DIR/scenarios/<id>.json and .md for human review and never writes into the repository.
       --dry-run writes only the prompt, calls no model, needs no login and spends no credits. --mode trigger instead drafts --n (8 to 10, default 10)
       tasks that should make the agent load the skill on its own, in varied phrasings that never name it, and as many near misses that share its words
       but belong elsewhere (skill-creator's should-trigger and should-not-trigger method), into DIR/scenarios/<id>.trigger.json and .md, with a queries view
       that cap trigger reads as its query file. --seed-queries FILE seeds it with a skill-creator eval set or a cap draft file for that one skill)
  node bench/runner/bench.js cap forced-prefix --cap skill:NAME [--harness kiro-cli|opencode] [--out DIR] [--base REF] [--repo-root DIR] [--bench-dir DIR]
       (free: writes the forced-load instruction for one skill and harness, to pass with run's arm prefix option to a forced arm and its A/A repeat in a run of their own)
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
  node bench/runner/bench.js cap skill-plan --base REF [--runs DIR[,DIR...]] [--runs-glob GLOB] [--tier loaded|large|duplicates|triage|all] [--only a,b]
       [--tasks-per-skill N] [--reps N] [--max-sections N] [--min-section-bytes N] [--large a,b] [--large-top N] [--duplicates a:b,c:d]
       [--agent-engine v2|v3] [--model M] [--arm-config name=key.path=value] [--credits-per-run X|low,mid,high] [--sec-per-run N] [--judge-usd-per-run X]
       [--budget-credits X] [--profile quick|detailed] [--allow-regex] [--screen] [--screen-tasks N] [--forced-load low-load|always|off] [--out DIR] [--json] [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (read-only, no credits: which skills get which study. Tiers: loaded (the skill loaded in a finished run), large (named large skills and the biggest),
       duplicates (near-duplicate and named pairs), triage (the rest: free checks only, because a skill nobody loads cannot show lift). Per skill: the tasks
       that exercise it (registry links, tasks naming it, tasks where it loaded), the shortfall against the profile minimum, the sections that can be tested,
       the waves (1 control, A/A and delete; 2 section removals; 3 moves to references) and credit, judge and wall-clock estimates from observed per-run
       figures. --budget-credits marks the skills that fit, in tier order. --screen puts skills that enter through the same agent into one shared wave 1
       (one control and A/A, one delete arm per skill, the most common tasks, at most --screen-tasks). --forced-load adds the forced wave as its own estimate line,
       3 arms x tasks x reps x qualifying skills, outside the totals. Writes skill-plan.md and skill-plan.json with --out)
  node bench/runner/bench.js cap skill-study --study DIR (--init | --status | --dry-run | [run]) [--tier T] [--only a,b] [--base REF] [--runs DIR[,DIR...]] [--runs-glob GLOB]
       [--tasks-per-skill N] [--reps N] [--max-sections N] [--min-section-bytes N] [--large a,b] [--large-top N] [--duplicates a:b,c:d] [--agent-engine v2|v3]
       [--model M] [--arm-config name=key.path=value] [--credits-per-run X|low,mid,high] [--sec-per-run N] [--judge-usd-per-run X] [--budget-credits X]
       [--profile quick|detailed] [--allow-regex] [--screen] [--screen-tasks N] [--seed N] [--scratch DIR] [--control-reps N] [--judge-backend kiro|opencode] [--aws-creds-file FILE]
       [--aws-profile NAME] [--aws-region R] [--budget-usd X] [--wave-budget-credits X] [--auth-db FILE] [--cache DIR] [--cargo-target DIR] [--kiro-bin PATH]
       [--opencode-bin PATH] [--forced-load low-load|always|off] [--forced-held-min X] [--waves 1|all] [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (the per-skill study in one shared directory. --init plans it into study.json (idempotent for the same base); --status shows waves, runs and credits;
       --dry-run prints each wave and its exact commands and builds nothing; with none of them it runs: the known-answer controls first (a failed control stops the study),
       then per skill wave 1, then wave 2 only if removing the skill lost quality, then wave 3 for the sections whose removal lost quality, judging each wave
       on the opencode backend with --aws-creds-file, and finally cap decide. Resumable: a finished wave is skipped, an unfinished one is moved to incomplete/.
       --forced-load adds wave 1f after wave 1: the skill forced to load (frc and its A/A repeat frc-b) against the skill deleted (with a neutral filler of the
       same word count), for skills that loaded in under 30% of wave 1 control runs (low-load; an unknown rate does not run it) or for all (always). It is reported in
       its own section of decisions.md, never feeds a call, and a failure is recorded in w1f.failed without stopping the study. --forced-held-min X (default 0.9)
       is the share of runs each forced arm (frc and frc-b) must load the skill in. --forced-load off clears a value saved in the study. --waves 1 runs the controls and wave 1 only and skips the forced wave and waves 2 and 3.
       Spends credits only when it runs; run it with no other bench study active)
  node bench/runner/bench.js cap decide --study DIR [--out DIR] [--no-patches] [--forced-held-min X] [--json] [--repo-root DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (read-only, no credits: one call per skill from the study waves: DELETE, PRUNE (sections to remove or move, with SKILL.md line ranges), KEEP or NEEDS DATA,
       with confidence, lift against the control with an interval, the A/A spread, tokens saved and a unified diff per DELETE or PRUNE under patches/. No call
       unless the controls passed, an A/A arm exists, scores are on a 0 to 1 scale, enough runs back it and the skill loaded. Nothing is applied)
  node bench/runner/bench.js cap review --run DIR [--n N] [--seed S] [--sample-only] [--out DIR] [--key-out DIR] [--force] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       [--max-file-chars N] [--max-bundle-chars N] [--redact-file FILE]
       (free, no model call: a static review page, review.html, for a person to rate the calibration sample side by side, one task at a time,
       pass, partial or fail per rubric criterion. n and seed default to the run's calibration-sample.json, else 25 and 1. Each task shows every
       arm's run of the drawn task and replicate (--sample-only: the drawn runs only) under the letters A, B, ... in a seeded random order; the
       letter-to-arm map goes to review-key.json in its own directory, never the page's. Outputs are the judge bundles, with the same redaction
       plus credential scrubbing. The page loads nothing and needs no server; ratings download as a JSON file. Defaults: --out
       DIR/calibration/review, --key-out DIR/calibration/review-key. The key records the run relative to itself, not as an absolute path)
  node bench/runner/bench.js cap review-import --ratings FILE --key FILE [--run DIR] [--rater ID] [--out DIR] [--save FILE] [--force] [--kappa-min 0.6] [--agreement-min X] [--spearman-min X] [--json]
       (free: checks the downloaded ratings against review-key.json (always given with --key; never looked for next to the page), finds the
       run from the key's own location or --run DIR when the run moved without its key, joins each letter back to its run and keeps the
       ratings per rater under raters/ID/ in the key's directory (ID from --rater, else the Rater name on the page). Each rater is scored alone, and all raters on file are pooled into the
       sheet.json and key.json that calibrate score reads and into DIR/calibration/result.json, which report reads; it prints judge-vs-human
       kappa, agreement and Spearman and checks any evidence quotes against the output. A file that rates nothing is refused. An existing
       rater's ratings, or a result.json this page did not write, are kept unless --force; nothing is written when the import is refused)
  node bench/runner/bench.js cap criteria --study DIR | --runs DIR[,DIR] | --runs-glob 'DIR/*' [--baseline ARM] [--aa ARM] [--out DIR] [--json] [--margin 0.1]
       [--saturated 0.95] [--judge-disagree 0.3] [--replicate-sd 0.4] [--min-runs 5] [--no-adjust] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (read-only, no model call, advisory: per rubric criterion and check, the pass rate per arm and the variant minus baseline difference with an interval,
       flagged NON-DISCRIMINATING, SATURATED or HIGH-VARIANCE (or reported INSUFFICIENT-DATA) from the judgments and check results on disk. Writes criteria.md and criteria.json to --out
       (default DIR/criteria for --study). Changes no call, margin or floor of cap decide)
  node bench/runner/bench.js calibrate export --run DIR [--n 25] [--seed S] [--out DIR] [--bench-dir DIR]
       [--max-file-chars N] [--max-bundle-chars N] [--redact-file FILE] [--criteria-pack quality]
       (--criteria-pack adds the quality-pack criteria of each sampled output to sheet.json and sheet.md for a person to rate)
  node bench/runner/bench.js calibrate score --labels FILE [--key FILE] [--kappa-min 0.6] [--agreement-min X] [--spearman-min X] [--save FILE] [--criteria-pack quality]
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
  if (cmd === 'report-2x2') return evalCommands.cmdReport2x2(opts);
  if (cmd === 'recheck') return evalCommands.cmdRecheck(opts);
  if (cmd === 'explain') return evalCommands.cmdExplain(opts);
  if (cmd === 'trace') return evalCommands.cmdTrace(opts);
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
