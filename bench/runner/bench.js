#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * bench.js - benchmark runner for Konductor on kiro-cli or opencode (run, judge, recheck, backfill, report, compare, calibrate).
 *
 *   node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot|cap|requirements|rootcause|references-read|constraints-probe|canary-layers|pack [--arms a,b] [--tasks id,id]
 *        [--replicates N] [--parallel N] [--budget-credits X] [--out DIR]
 *   node bench/runner/bench.js list-arms [--arms a,b] [--repo-root DIR]
 *   node bench/runner/bench.js contrast --run DIR [--base ARM] [--head a,b]
 *   node bench/runner/bench.js pr-plan --ref name=ref|name=dir:path [--ref ...] [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
 *   node bench/runner/bench.js gc [--apply] | archive --run DIR [--apply]   (reclaim what the bench made; dry run by default)
 *   node bench/runner/bench.js scenarios lint|coverage|prereg|pilot-table|ready|spot-review ...   (the scenario pack's authoring tools; free, no credits)
 *   node bench/runner/bench.js cap list|audit|variant|plan|draft|import|trigger|prune-report|scenarios|controls|skill-plan|skill-study|decide|review|review-import|criteria|forced-prefix|keep-prune|select|units|unit-stage|unit-author|delegation ...   (capability benchmarking; draft, trigger and live runs cost credits)
 *
 * Every run executes in a scratch HOME and a fresh cwd with an allowlisted
 * environment, optionally inside a read-only mount namespace. See bench/docs/reference.md.
 */
'use strict';

const { listArms, KNOWN_ARMS, resolveArms, formatArmRows, ARM_SYNTAX } = require('./lib/arms.js');
const { cmdRun, repoRootOf } = require('./lib/run-cmd.js');
const { planPr } = require('./lib/pr-plan.js');
const evalCommands = require('./eval-commands.js');
const { cmdCap } = require('../cap/cli.js');
const { cmdScenarios } = require('../scenarios/cli.js');
const { BOOLEAN_FLAGS, COMMANDS: COMMAND_NAMES, checkArgs } = require('./lib/cli-flags.js');
const cleanup = require('./lib/cleanup-cmd.js');

const USAGE = `Usage:
  node bench/runner/bench.js run --suite lite|full|hard|real|autonomy|pilot|cap|requirements|rootcause|references-read|constraints-probe|canary-layers|pack [--arms a,b,c] [--tasks id,id]
       [--replicates N] [--replicate-offset N] [--resume [--resume-errors]] [--parallel N] [--budget-credits X] [--out DIR]
       [--pair-order konductor-first|shuffle] [--fill-skipped X]
       [--model ID] [--effort LEVEL] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR] [--cargo-online]
       [--seed N] [--isolate auto|unshare|sandbox-exec|none] [--allow-unisolated] [--gate-strict] [--allow-partial] [--allow-arm-drift] [--censored-floor X] [--hide DIR,DIR] [--no-default-hide]
       [--env-keep NAME,NAME] [--tripwire-exclude PATH,PATH] [--tripwire-depth N] [--tripwire-dir DIR,DIR]
       [--kiro-bin PATH] [--bench-dir DIR] [--repo-root DIR] [--real-cache DIR] [--prepare-only]
       [--extra-tasks DIR,DIR] [--prereg FILE] [--level lite|standard|full [--level-since FILE]] [--suites-dir DIR] [--run-credit-limit X [--run-credit-limit-mode hard|soft]] [--auth-db FILE] [--arm-prefix name=FILE,...] [--arm-agent name=AGENT,...]
       [--arm-config name=key.path=value[;key.path=value],...] [--oracle-skills [ARM,ARM]] [--oracle-manifest FILE] [--forced-must-load ARM,ARM]
       [--stop-on first-capability|first-load|end_turn] [--max-tool-calls N] [--profile quick|detailed] [--max-auth-failures N] [--timeout-sec N]
       [--plant-release DIR --plant-release-sha256 HEX] [--plant-python PATH] [--python PATH] [--strands-python PATH] [--strands-agent FILE] [--introspect]
       (--profile quick runs 1 to 3 replicates (default 2) and labels a result under 3 runs anecdotal. --profile detailed runs at least 5 replicates (default 5),
       adds an A/A arm (the first konductor arm repeated at its exact commit), judges with the graded mode as well, and writes calibration-sample.json and .md
       to the results directory. Without --profile the suite defaults apply and no arm is added. Credits are tracked per run in credit-ledger.jsonl; with no
       --budget-credits nothing stops a run, with it new runs stop at 90% of the budget)
       (--replicate-offset N numbers the replicates N+1 to N+replicates, to add runs to an out dir that already holds replicates 1 to N. The default 0 numbers them from 1.
       A run writes over any result.json already at a planned path and prints a warning with the count of cells it will overwrite.
       Every arm ref is resolved to a commit once, when the command starts; run-config.json and each result.json record it. A command refuses an --out
       that already holds results of the same arm id at another commit (main after a fetch, say) unless --allow-arm-drift is given.
       --resume with the --out of an earlier run plans the same cells and runs only those with no result.json or a budget_skipped one, keeping every
       other result; --resume-errors also runs again the cells whose result is an error. Pass the arms, tasks and replicates of the earlier command)
       (--pair-order konductor-first, the default, runs tasks in a seeded order and each task's konductor arms before its vanilla arm, so a budget stop
       lands on the vanilla side of a pair; shuffle is one seeded order over every cell. --fill-skipped X: before the command ends, every budget_skipped
       cell runs once more while this command's spend stays under X (X >= --budget-credits). A cell left budget_skipped makes its pair unpaired; see
       bench/docs/paired-fill.md)
       (--max-auth-failures N stops the chunk after N consecutive runs that could not log in (no turn ran, "Not logged in", "Authentication failed" or "token already expired"), default 3,
       or the BENCH_MAX_AUTH_FAILURES variable; remaining cells are skipped and the command exits 6. Such a run is charged 0 and marked infra, never a timeout.
       Runs whose agent binary could not be launched (exit 127, no such file) count toward the same limit)
       (--timeout-sec N replaces the timeout of every selected task with N seconds (a positive integer); without it each task keeps the timeoutSec of its task file.
       The plan line, run-config.json (timeoutSecOverride, timeoutSecByTask) and summary.json show it)
       (--agent-engine is the kiro-cli engine, default v2; v3 installs each arm for the kiro-v3 harness)
       (--prepare-only builds and trial-installs every arm, prints the preflight table and exits before any agent run. It covers kiro-cli and Claude Code
       arms, one runtime at a time; a Claude Code arm gets the install, model pin and agent checks with --model, and claude itself is not started)
       (--introspect records what each run's agent was sent and did, for diagnosis: Claude Code exports OpenTelemetry, raw API bodies included, to a loopback
       receiver the runner starts per run, and kiro-cli v3 dumps every model request; each run gets <run>/introspect (mode 0700) with probe.json and timeline.md.
       Nothing goes to a host collector. Off by default; scripts/introspect-summary.js summarizes an out dir; see bench/docs/introspect.md)
       (--plant-release DIR and --plant-release-sha256 HEX are required by the plant-policy and plant-allowall arms: the signed release is copied
       to a runner-private dir and checked there; --plant-python is the interpreter that runs the gateway, default python3.
       --python is the Python 3.12 interpreter task checks and the gateway's python3 get (default BENCH_PYTHON, then python3.12, then
       python3 on PATH); a run, and --prepare-only, refuse when tasks run Python and python3 in the sandbox would not be 3.12. A plant suite runs
       plant arms and plant tasks only, at --parallel 1; without --kiro-bin it is counted and the Kiro CLI must match the release pin)
       (st-plant-policy, st-plant-allowall and their -hooked forms run a Strands agent whose plant tools forward to the gateway: --strands-python is the
       interpreter with strands-agents, default python3; --strands-agent FILE holds build_agent(model, tools), default a plain Agent; --model must be
       fake:<script.json>, the only model provider enabled. Before any trial a hook census refuses a counted suite whose plain arms carry tool hooks)
       (--extra-tasks loads tasks from DIR/<id>.json with DIR/fixtures and DIR/hidden; DIR is hidden from the agent like tasks/hidden)
       (--prereg FILE is a PREREG.json from "scenarios prereg freeze": the run refuses to start unless every selected task is in the lock with the same
       file bytes, as read from the --extra-tasks directories)
       (--level picks the tasks of the suite by run level, instead of --tasks: lite is, for each of the 14 phases, the DEV task with the lowest SR-32 hash among
       real tasks with a soft limit of 900 s or less, a swap for any role left out, the lowest-hash DEV negative control and DEV twin, and, with --level-since FILE (the
       "tasks" list of an earlier run-config "level" record), every task added or changed since as smoke only; standard is every DEV task; full is every task and
       needs --prereg. run-config.json records the level, its list hash and the picks, and report-2x2 shows it in its header)
       (--suites-dir DIR looks for the suite file DIR/<suite>.json first and then in <bench-dir>/suites, so a generated skilleval-* suite needs no file in the checkout)
       (--run-credit-limit X: on engine v2 the run is killed at the poll once its metered credits pass X and is recorded as censored. On v3 credits
       arrive once, at the end of a turn, so a one-shot run always finishes: over X it gets creditLimitExceeded and creditOvershoot, nothing is killed;
       a conversation task is checked after each turn and stops before the next one. --budget-credits is the only bound on total spend: new launches stop
       when charged credits plus the largest run so far would pass it. --run-credit-limit-mode hard (the default) stops the run as above; soft never stops it:
       a run that ends over X gets creditLimitExceeded, a warning in runner.log and creditLimitWarning in result.json, and runs to its natural end)
       (--auth-db is the kiro-cli auth database each run's scratch HOME gets a copy of, default the standard location under HOME)
       (--arm-prefix puts the text of FILE (at most 90000 bytes) in front of the task prompt of that arm; run-config records its sha256 and size.
       --arm-agent starts that arm in AGENT instead of its default agent. --arm-config writes keys into that arm's scratch ~/.konductor/config.yml after the
       install, for example --arm-config orch-coord=orchestration.mode=coordinator (orchestration.mode takes auto or coordinator and applies to the konductor entry agent only; vanilla, opencode and Strands (st-) arms refuse the flag; run-config
       and result.json record it). --stop-on kills the run at the first skills-server call, subagent call
       or end of turn (first-capability), or at the first get_skill, subagent call or end of turn (first-load); the run is flagged earlyStopped and
       has no metered credits (kiro-cli meters at the end of a turn), so its cost is unobserved. --max-tool-calls stops after that many tool calls whatever they are)
       (--oracle-skills puts the SKILL.md bodies (frontmatter removed) of the skills a task is expected to use in a delimited block in front of its prompt, read from the arm's own
       ref. With no value it applies to every konductor arm; with ARM,ARM only to those. Vanilla is refused, as is a task with no expected skills or a skill the ref does not have,
       and nothing runs then. The expected skills come from --oracle-manifest FILE (default suites/rootcause.manifest.json, tasks[].entries[].expectedSkills for the arm's entry
       agent, else all the task's entries). result.json records oracle {skills, entryMatched, bytes, sha256} and the report flags the arm ORACLE. Give an oracle arm its own
       name (for example oracle=<sha>) and never pool it with normal runs; references/ files of a skill are not included)
       (--forced-must-load ARM,ARM puts a short instruction in front of each task's prompt that names the task's loadCheck.mustLoad skills, SOPs and agents and says to
       load them before anything else, worded as cap forced-prefix words it. Konductor arms on kiro-cli or opencode only; a task with no mustLoad or a unit the arm's ref does not
       have is refused and nothing runs. result.json records forcedLoad {units, bytes, sha256}. Name it apart, for example konductor-forced=<ref> beside konductor=<ref>)
       arms: vanilla, v1.0.0, v1.1.0, v1.2.0, main, name=<git ref>, name=dir:<path>, name=vanilla (a vanilla A/A repeat, for example vanilla-b=vanilla; see list-arms)
       opencode arms (oc-vanilla, oc-v1.2.0, oc-main; one harness per run):
       --aws-creds-file FILE [--aws-profile bench] [--budget-usd X] [--opencode-bin PATH] [--rg-bin PATH]
       Claude Code arms (cc-vanilla, cc-main, cc-name=<git ref>; one harness per run; the real claude binary, never a launcher script):
       [--budget-usd X] [--run-budget-usd X] [--aws-region us-east-1] [--aws-profile NAME] (--claude-bin PATH | --claude-tools-dir DIR) [--allow-claude-change]
       (credentials are the AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN variables of the shell that starts the bench; nothing is read from a file.
       With --aws-profile NAME the runner reads them with aws configure export-credentials --profile NAME instead, at the start and again before a run
       when the cached keys have no expiry or expire within 15 minutes, and passes them to that run only; a study can then outlive one session's keys.
       --claude-tools-dir takes the newest <version>/claude there. run-config.json records the binary's version and sha256, and a later command into the
       same --out that resolves another binary is refused unless --allow-claude-change is given; the refusal names --claude-bin <dir>/<version>/claude to stay on it.
       --run-budget-usd is claude's own per-run cap, default 5. --effort goes to claude --effort (low, medium, high, xhigh, max; default high).
       --stop-on, --max-tool-calls and --run-credit-limit do not apply)
  node bench/runner/bench.js judge --run DIR [--judges a,b] [--mode rubric,pairwise] [--baseline vanilla|ARM]
       [--concurrency N] [--budget-credits X] [--judge-cmd CMD] [--max-file-chars N] [--max-bundle-chars N]
       [--redact-file FILE] [--judge-timeout-sec N] [--bench-dir DIR] [--allow-small-panel] [--kiro-bin PATH]
       [--isolate auto|unshare|sandbox-exec|none] [--hide DIR,DIR] [--auth-db FILE] [--extra-tasks DIR,DIR] [--profile quick|detailed]
       [--judge-backend kiro|opencode] [--budget-usd X] [--aws-creds-file FILE | --aws-export-profile NAME] [--aws-profile bench] [--aws-region us-east-1] [--opencode-bin PATH] [--cache DIR]
       [--criteria-pack quality] [--plan] [--quote-match lenient|strict] [--rescore-quotes] [--reask-unquoted]
       (--aws-export-profile NAME takes the opencode backend's credentials from aws configure export-credentials --profile NAME instead of a file and asks again when fewer than
       15 minutes remain; a refresh that brings no later expiry is asked again a minute later, and only expired credentials with nothing newer stop the pass. Values are never logged.
       On either source, 3 calls in a row that fail on their credentials stop the pass: the remaining calls are recorded as skipped and the command exits 3)
       (--criteria-pack quality runs only the quality-dimensions pass over the finished runs and writes judgments-quality.json beside judgments.json; judgments.json is not read or changed.
       Criteria that do not apply to a run are skipped and reported as n/a. The pack pass always matches evidence quotes strictly and refuses --quote-match. See bench/docs/quality-pack.md)
       (--quote-match picks the evidence-quote rule that the older fields of judgments.json carry: lenient, the default, or strict; reports score with paraphrase, rebuilt from the outputs, unless the scoring file names another rule. Both rules are applied to every criterion and both
       verdicts are recorded (verdictStrict, verdictLenient, quoteFound), so a report shows either without rescoring. The lenient rule compares words only, accepts quotes joined from
       fragments of 20 or more letters in order and a verbatim quoted span of 40 or more letters, and rejects a quote with 20 or more unsupported letters. Strict needs every segment
       between ellipses in the output, in order. A scoring file picks the rule a report uses: "quotes": "strict" (profiles/scoring-strict-quotes.json), "lenient", "paraphrase" (profiles/scoring-paraphrase.json: lenient, or a restatement whose figures and most words are in the output, rebuilt from the saved outputs), or "paraphrase-guarded" (profiles/scoring-paraphrase-guarded.json: paraphrase, but a figure the output lacks or a copy of the rubric text is refused))
       (--reask-unquoted asks a judge once more, naming the criteria, when a pass or partial gives evidence the quote rule cannot find in the output,
       and scores evidence that is the criterion's own text as fail instead of one level down; off by default, at most one extra call per rubric unit)
       (--rescore-quotes matches the stored evidence quotes of --run again with no model call, for judgments made before both views were recorded, and writes judgments-lenient.json beside
       judgments.json (judgments.json is untouched), then prints the share of verdicts downgraded per judge before and after and the mean rubric per arm. With --quote-match strict it only
       checks that the strict rule reproduces the stored values. Reports build the lenient view of old judgments in memory and no longer read that file)
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
  node bench/runner/bench.js refs-report --run DIR[,DIR...] --out DIR
       (scores the runs of the references-read suite from stream.jsonl, with no model call: per arm, how many runs loaded the skill, tried to read a references/ file, were refused,
       failed or read it, and whether the planted fact reached the answer, with Wilson 95% intervals; the verbatim refusal messages; sandbox errno 38 runs, which are excluded
       from every rate; and a DECISION with fixed thresholds. Writes refs-report.md, refs-report.json and refs-runs.jsonl to --out. See bench/docs/studies/references-read.md)
  node bench/runner/bench.js probe-report --run DIR[,DIR...] [--run DIR ...] --out DIR [--scoring FILE] [--arms-file FILE] [--canary-token-file FILE]
       (scores the runs of the constraints-probe suite from stream.jsonl and session files, with no model call: per probe, arm and position, the share of runs that applied
       the rule with a Wilson 95% interval; the delegated agent's own actions for runs that went through the orchestrator; skill lookups, deferral failures and fingerprint hits;
       the canary token; sandbox errno 38 runs, which are excluded from every rate; and the DECISION rows with fixed thresholds. Writes probe-report.md, probe-report.json,
       probe-runs.jsonl and judge-queue.json to --out. --scoring takes a scoring profile for the checks quality column; --arms-file or --canary-token-file gives the exact canary token.
       See bench/docs/studies/constraints-probe.md)
  node bench/runner/bench.js canary-report --run DIR[,DIR...] --layers-file FILE --out DIR
       (scores the runs of the canary-layers suite from stream.jsonl, with no model call: per layer token (core rules, system prompt, skill index, skill body, SOP body, routing context),
       per entry agent and per task, the share of runs where the token showed in a tool result (direct) or in the model's own text or calls (inferred), next to whether the agent spec
       declares that layer. FILE is the layers.json written by bench/scripts/canary-layers.js build. Writes canary-report.md and canary-report.json to --out. See bench/docs/studies/canary-layers.md)
  node bench/runner/bench.js plant-trace --run TRIAL_DIR [--vs TRIAL_DIR] --out FILE.html
       (one static HTML page for a plant trial, with no model and no network: one collapsible line per tool call with the time per step, coloured allowed,
       blocked or unsafe attempt from the gateway log; open, it shows the arguments, the gateway's reason and the plant state after the call; a child agent's calls nest under it,
       tokens per step where the stream records them, and the stream-to-gateway mismatches. TRIAL_DIR holds result.json, stream.jsonl and plant/gateway.jsonl
       and plant/world.jsonl. With --vs the second trial gets its own block below the first. Exit 2 on a missing file or an unknown stream format)
  node bench/runner/bench.js plant-policy-test --release DIR [--python PATH]
       (runs the gateway-only truth table of a plant release with no model: a test-mode gateway decides every row of truth-table.json, then a wrong-token
       frame must be refused. Prints one PASS or FAIL line per cell; exit 1 when any cell fails. --python names the interpreter with cedarpy, default python3.
       A policy test only, never a counted result)
  node bench/runner/bench.js plant-host-check --release DIR --release-sha256 HEX [--kiro-bin PATH] [--plant-python PATH] [--out DIR] [--json]
       (can this host make a counted plant run? With no model and no agent: Linux with user namespaces, release signature and hashes (not the toy key),
       no listener outside the release allowlist, the pinned Kiro CLI build, the pinned wheels in the plant Python, an out dir (default /var/tmp) on its
       own filesystem, one-minute load under 4, and the release's strands-agents pin as info. One PASS or FAIL line per gate with the fix; exit 0 when
       every gate passes, 1 when one fails, 2 on a usage error. The runner repeats every check at run time, so a PASS never makes a run counted)
  node bench/runner/bench.js plant-report --run DIR[,DIR] --release DIR --out DIR
       (the plant report from the plant field of each result.json, with no model: the header with the release, manifest hash, keyId, exclusion policy,
       SIMULATOR ONLY and PASS or WARN with the limits; per arm and probe the trial table, the three measures (agent attempt, end-to-end, gateway stop)
       and task success with clean-only numbers and Wilson 95% intervals, the per-probe verdict against the handled floor of the release's analysis-plan.md,
       needless blocks and procedure asks on normal tasks, and the call-disposition audit; the integrity-excluded share against the 10% stop. Writes
       plant-report.md and plant-report.json to --out. Exit 2 on a missing or unknown plant field, mixed releases or a release that does not match)
  node bench/runner/bench.js report --run DIR[,DIR...] [--baseline vanilla|ARM] [--out report.md|DIR] [--detail quick|full] [--format md|html|both]
       [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       [--profile quick|detailed] [--verdict platform|orchestrator-pass] [--phases ID,ID|all] [--test-arms ARM,ARM] [--changed-skills NAME,NAME] [--criteria-pack quality]
       [--allow-stale-pack]
       (--criteria-pack quality adds a Quality dimensions table from judgments-quality.json; it is indicative and not part of quality /100.
       --scoring profiles/scoring-all.json scores the checks component as 1 only when every check passed (the old rule); the default is the weighted share of substance checks.
       The evidence-quote rule is paraphrase (lenient, or a faithful restatement; the default since 2026-11-20) unless the scoring file says "quotes": "lenient" (profiles/scoring-lenient-quotes.json) or "strict" (profiles/scoring-strict-quotes.json, which reproduces the numbers of earlier reports).
       Every page names the rule on its first lines, and a full report, a contrast, report-2x2 and both verdicts show the other rule beside it.
       --profile sets the default detail (quick or full), adds a check of the run against the profile and, for detailed, writes calibration-sample.json and .md.
       --verdict platform writes verdict.md, verdict.html and verdict.json: one page with keep, discard or not enough evidence for each arm against the baseline,
       from one or more run directories (several need --out); it replaces the normal report for that call.
       With --criteria-pack quality and a --scoring file that weights the pack, either verdict scores every run with the pack included; every run then needs a current pack judgment.
       The plain report is the same: it stops when a run has no current pack judgment. --allow-stale-pack (plain report only, not the verdicts) scores a run from judgments made against
       another pack or task revision instead, and a note at the top of the report and a packStale list in report.json label each such run "stale pack revision <rev>".
       --verdict orchestrator-pass writes orchestrator-pass.md, .html and .json: per (harness, model) cell, a PASS, FAIL or NOT ENOUGH EVIDENCE for each test arm
       against the baseline (default vanilla): cost at most 2.0x the baseline per run and per successful run, quality not below it by more than the spread of one
       baseline run, an A/A repeat required and its drift compared with the effect, and a skill-only change must have loaded. A GPT cell is shown beside the Claude
       cell as ratios to vanilla. --test-arms limits the arms judged; --changed-skills says which skills the change lives in, for arms that did not record it)
       (writes report.md, report.html, report.json and charts/*.svg: a diligence scorecard, scores with CIs, charts and the text tables.
       quick is one page, full is everything; default full and both. Several run directories are merged into one run and need --out.
       Spawns, spawn depth, review rounds and reworks after a pass are always shown (read from result.json, else from stream.jsonl). --phases counts the phase
       documents of the listed phases (profiles/phase-documents.json), or all of them; leave it off for tasks that are not SDLC tasks)
  node bench/runner/bench.js report-2x2 --kiro-vanilla DIR[,DIR...][:ARM] --kiro-konductor DIR[,DIR...][:ARM] --cc-vanilla DIR[,DIR...][:ARM] --cc-konductor DIR[,DIR...][:ARM]
       [--cell ID=DIR[,DIR...][:ARM] ...] [--out DIR] [--json] [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR] [--criteria-pack quality] [--prereg FILE] [--stats]
       (the 2x2 pilot table, harness by konductor on one model, from four judged run directories, one harness each; prints markdown, or JSON with --json,
       and writes factorial-2x2.md, .json and three SVG charts in charts/ to --out. A cell whose directories hold several arms names the one it
       reads with :ARM, for example --kiro-konductor /runs/kiro:main; --cell kiroVanilla=DIR:vanilla does the same and may replace any of the four flags. Refuses cells with different tasks, judge panels, rubric revisions, models or cost units. Quality is compared
       across cells; cost only as konductor over vanilla inside a harness. Intervals appear only with 5 or more tasks of 2 or more replicates per cell, otherwise
       the table says "descriptive only" and the charts carry no whiskers. --prereg FILE refuses the report unless every task in it is in the pre-registration
       lock with the same file bytes (as read from --extra-tasks). --stats adds the pre-registered statistic: per harness, konductor minus vanilla on quality
       by a two-level bootstrap (tasks, then runs; 10,000 draws, fixed seed) with a verdict word at the 5-point margin, from HELD-OUT tasks (DEV shown apart,
       never a verdict), and per phase and per role with Holm correction. Reads run directories and writes nothing but --out)
  node bench/runner/bench.js contrast --run DIR[,DIR...] [--base ARM] [--head ARM,ARM] [--min-rel 0.15] [--rule both|any] [--by class|task] [--phases ID,ID|all]
       [--detail quick|full] [--format md|html|both] [--out DIR] [--scoring FILE] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (each head arm against the base arm, overall and per task class (--by task: per task); writes contrast.md, contrast.json, contrast.html
       and charts/ in --out (default: DIR). Default base: v1.2.0 if present, else vanilla, else the first arm. Default head: all other arms)
  node bench/runner/bench.js pr-plan --ref name=<git ref>|name=dir:<path>|cc-name=... [--ref ...] [--base v1.2.0] [--suite lite|real|hard|autonomy|pilot]
       [--replicates N] [--no-vanilla] [--budget-credits X] [--budget-usd X] [--out DIR] [--seed N] [--repo-root DIR] [--bench-dir DIR]
       (prints the run, contrast, judge and report commands for one or more refs against a release; runs nothing. Repeat --ref for several arms;
       a cc- arm is a Claude Code arm, planned as its own run against cc-vanilla and capped by --budget-usd, which it needs since no USD figure
       is measured for the suites. --out sets the run directory (default under the temp dir); with both harnesses each run gets OUT/kiro-cli and
       OUT/claude-code)
  node bench/runner/bench.js recheck --run DIR [--bench-dir DIR] [--dry-run] [--extra-tasks DIR,DIR]
       (re-evaluates the current task checks against each run's saved workspace; the first results are kept
       under checksOriginal in result.json; stream.jsonl and credit fields are never touched; safe to repeat)
  node bench/runner/bench.js gc [--root DIR ...] [--older-than 7d] [--kind a,b] [--keep-last N] [--protect-file FILE] [--json] [--apply]
  node bench/runner/bench.js gc --adopt DIR --kind KIND [--apply]
  node bench/runner/bench.js gc --protect add PATH | --protect list [--protect-file FILE]
       (reclaims directories the bench made. Only a directory with a valid .bench-owner.json marker is ever a candidate. kinds: run-out, cache, cargo-target, scratch, archive,
       study-driver-dir. It lists each marked directory with kind, size, age, last change and why it is or is not eligible, and deletes nothing unless --apply is given.
       Default roots: /var/tmp and the system temp directory, scanned 3 levels deep; repeat --root to choose others. Default --kind: scratch, cache, cargo-target
       (run-out and study-driver-dir hold results that cost credits, so they need --kind). A directory is deleted only when its marker is not protect: true, it is older than --older-than
       (default 7d, at least 1h with --apply), it is not covered by the protect file (default ~/.konductor/bench-gc-protect.txt, one path or glob per line, # comments), it is not a git worktree
       or inside or holding one, holds no .git, is not the working directory, an open file or a command-line path of a running process, is not pointed at by a symlink, belongs to you,
       and the study pid in its marker is gone. Every condition is checked again just before each deletion. Deletions are appended to <root>/.bench-gc.log.
       --keep-last N spares the newest N directories of each kind. --adopt writes a marker into an older directory you name, so it can be reclaimed later (a dry run unless --apply);
       nothing is ever adopted on its own. --protect add appends a path or glob to the protect file; --protect list prints it)
  node bench/runner/bench.js archive --run DIR [--out DIR] [--compress auto|gzip|zstd] [--remove-originals] [--apply]
  node bench/runner/bench.js archive --restore DIR [--dry-run]
       (packs the workspace/ of every finished run under DIR into one workspace.tar.zst (zstd if installed) or workspace.tar.gz beside it, or under --out. result.json, stream.jsonl,
       installed-agent.json, installed-mcp.json, run-config.json, judgments*.json, summary.json, credit-ledger.jsonl and session/ stay as plain files (copied when --out is given). It writes ARCHIVE.md and
       archive-manifest.json (sizes and sha256), re-reads every archive and compares its entry list and checksum with the workspace, and marks the archive directory kind archive, protect true,
       so gc never deletes it. A dry run unless --apply. --remove-originals, with --apply, deletes each uncompressed workspace/ only after its archive is verified.
       --restore checks each archive against archive-manifest.json and extracts workspace/ again where it is missing, so recheck works; it never overwrites an existing workspace/)
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
  node bench/runner/bench.js compare --base DIR --head DIR [--min-rel 0.15] [--rule both|any] [--force] [--allow-mixed-pass] [--aa ARM] [--bench-dir DIR]
       (exit 0 no regression, 1 regression, 2 refused or error. --aa ARM: ARM ran in both, so its gap is the A/A noise; every
       other gap prints beside its half-width and the detectable gap at 80% power, paired by task)
  node bench/runner/bench.js skills --run DIR [--bench-dir DIR] [--repo-root DIR] [--json] [--extra-tasks DIR,DIR]
       (skill and SOP loads recomputed from stream.jsonl; read-only, works on old and in-progress runs)
  node bench/runner/bench.js scenarios lint DIR --base REF|dir:PATH [--repo-root DIR] [--json]
       (the prompt leak lint: refuses a task prompt that names a skill, SOP or agent of the konductor tree at --base, uses a term from the fixed method
       list, or says "do not ask" on a task where questions are allowed; also refuses a v3 task (one with a phase) with no authorship.source or an empty
       licence. DIR holds task files, or batch directories of them. Exit 1 when there is any finding. No credits)
  node bench/runner/bench.js scenarios prereg freeze DIR --base REF|dir:PATH [--accept-gaps REASON] [--selection-only FILE] [--repo-root DIR] [--date YYYY-MM-DD]
  node bench/runner/bench.js scenarios prereg check DIR
       (freeze first runs scenarios lint and the coverage gate on the --base tree: a new lint finding or a stale lint baseline entry refuses (exit 1),
       and so do coverage holes and phase or role shortfalls unless --accept-gaps gives the reason, which the lock records under gates. Then it writes
       DIR/PREREG.json: every task's id, version and file sha256, the SR-32 DEV and HELD-OUT lists recomputed from the ids, and the fixed
       protocol of bench/scenarios/protocol.js (margin, verdict words, bootstrap draws and seed, reps, stop rules), with a hash of the whole record. It
       refuses a task with no integer version and never overwrites a lock. check recomputes everything and exits 1, naming each task whose file changed,
       a task added or missing, a split list or protocol that no longer matches, or an edited lock)
  node bench/runner/bench.js scenarios coverage DIR --base REF|dir:PATH [--selection-only FILE] [--out DIR] [--fail-on-hole] [--repo-root DIR]
       (writes coverage.json and coverage.md into --out (default DIR) from the task files under DIR: the phase by role counts of real tasks against the
       target counts, and one row per skill, SOP and agent of the tree at --base with its targeted DEV and HELD-OUT tasks, twins and controls, effect
       tasks and a status: covered (3 targeted tasks, 2 of them HELD-OUT, 1 twin or control), selection-only (a unit listed with a reason in
       --selection-only FILE, default DIR/selection-only.json, as { "skill:name": "reason" }) or hole. --fail-on-hole exits 1 on any hole or any phase
       or role below its minimum. No credits)
  node bench/runner/bench.js scenarios pilot-table DIR... [--pack DIR] [--json]
       (one row per pilot run in the wave directories: code-scored quality (hidden tests and substance checks, no judges), time, credits, SOP and skill
       loads, and the task-health flags of the pilot: broken (error, timeout, hidden suite not parsed), too-easy (90 or more), too-hard (15 or less, or a
       dry-run reference under 95), answer-leak (a tool call named a hidden or answer path, or an output repeats the reference's own text),
       second-family (under 1 in 3 tasks of the batch from a second author family), noisy (a check differs between replicates, or flips against a
       per-check dry run where reference and stub agreed), hand-edited, recheck missing (handEdited set and no review.recheck; blocks a lock), fix (the task
       file records a lazy score over 40 or pilot.decision fix or drop). A handEdited column gives the editor's family or no, for the hand-edit split, and a
       singleFamily column shows single-family-authored for a task whose authorship.singleFamily is set (then no second-family flag). A per-batch table follows:
       runs, distinct tasks, and for each flag the number of distinct tasks with a flagged run. --pack is the scenario pack, default bench/scenarios. Reads files only; no credits)
  node bench/runner/bench.js scenarios ready [DIR] [--batch tN] [--ids [--late]] [--json]
       (which pack tasks may enter a pilot wave: the batch folder loads in the runner and pilot.dryRun records reference >= 95, stub <= 20, lazy <= 40
       and alternative >= 80. Prints per-batch counts (tasks, ready, fix, not ready; ready plus not ready is every task, fix is part of
       not ready) with an all row, the ready list and each not-ready task with its reasons (wave W9 late). --ids prints the ready ids
       as a comma list for the tasks flag of run; with --late the not-ready ones. A task with a lazy score
       over 40 or pilot.decision fix or drop is listed as fix and is not ready. Hand-edited tasks with no review.recheck are listed apart as lock blocked;
       they may still run in the pilot. DIR defaults to bench/scenarios. No credits)
  node bench/runner/bench.js scenarios spot-review [DIR] [--seed N] [--out FILE]
       (the owner's spot-review sample: per batch a shuffle of the task ids with its own seed (base seed plus the batch number), dropped tasks
       left out, the first 10% rounded up and at least one, as markdown with links; DIR/spot-review.json pins samples already read and marks
       batches pending until final. Default seed 20261119, the sample in bench/scenarios/SPOT-REVIEW.md. No credits)
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
       [--preset skills-only|bare|noskills] [--hook list|nudge|filler] [--verify] [--force] [--acting-agent A] [--agent-engine v2|v3] [--cache DIR] [--cargo-target DIR]
       [--cargo-online] [--repo-root DIR] [--bench-dir DIR] [--json]
       (builds a dir: arm from git archive of the base ref with the capability dropped, replaced or added, and prints the arm string for the run command.
       --overlay skill:NAME=DIR replaces SKILL.md and adds references/** from DIR in one step (a section moved out of a skill); it never overwrites a reference file.
       --hook list adds a userPromptSubmit hook to konductor that prints every skill name and a line to check the list and load a matching
       skill before starting (design A, no matching, under 3,000 bytes); --hook nudge prints the 3 skills whose trigger lines best match the
       request (design B, a local matcher, not run: a documented negative result); --hook filler prints neutral text the size of the list, the control.
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
  node bench/runner/bench.js cap scenarios --cap ID,ID [--mode lift|trigger] [--n N] [--seed-queries FILE] [--model M] [--model-cmd CMD] [--out DIR] [--base REF] (--budget-credits N | --dry-run)
       [--isolate auto|unshare|sandbox-exec|none] [--kiro-bin PATH] [--auth-db FILE] [--hide DIR,DIR] [--repo-root DIR] [--bench-dir DIR]
       (drafts 8 to 30 task scenarios for each skill, at least three quarters where the skill should help and at least one where it should change nothing,
       one tool-less model call per skill in a scratch HOME. Writes DIR/scenarios/<id>.json and .md for human review and never writes into the repository.
       --dry-run writes only the prompt, calls no model, needs no login and spends no credits. --mode trigger instead drafts --n (8 to 10, default 10)
       tasks that should make the agent load the skill on its own, in varied phrasings that never name it, and as many near misses that share its words
       but belong elsewhere (skill-creator's should-trigger and should-not-trigger method), into DIR/scenarios/<id>.trigger.json and .md, with a queries view
       that cap trigger reads as its query file. --seed-queries FILE seeds it with a skill-creator eval set or a cap draft file for that one skill)
  node bench/runner/bench.js cap forced-prefix --cap skill:NAME|sop:NAME|agent:NAME [--harness kiro-cli|opencode] [--out DIR] [--base REF] [--repo-root DIR] [--bench-dir DIR]
       (free: writes the forced-load instruction for one skill and harness, to pass with run's arm prefix option to a forced arm and its A/A repeat in a run of their own)
  node bench/runner/bench.js cap nudge-preview --tree DIR --tasks id,id --extra-tasks DIR,DIR [--json]
       (free: what a built nudge arm prints for each task, with the rank-1 margin, for a person's leak check)
  node bench/runner/bench.js cap nudge-check --run DIR,DIR [--json]
       (free: per finished run, whether the hook text reached the agent, the skills loaded, those loaded in full and the preview-only loads;
       exit 1 when a hook arm ran without its hook text; a cell that never started, budget skipped or with no stream and no session, is "not run", never a miss;
       an error whose last interrupted shell call is a kill and whose kiro-cli exited on SIGTERM is "agent self-kill")
  node bench/runner/bench.js cap keep-prune --skill NAME --run stub-ID [--out DIR] [--depth quick|deep|both] [--provider stub] [--subject-model ID] [--judges A,B,C] [--replicates N] [--rejudge] [--selection FILE] [--repo-root DIR] [--json]
  node bench/runner/bench.js cap select --skill NAME (--run stub-ID [--reps N] [--stub-behaviour always|never|correct|fake] | --from-run DIR | --write-tasks DIR) [--requests FILE] [--usage-runs DIR,DIR] [--out DIR] [--repo-root DIR] [--json]
       (free: the keep-or-prune check at a quick and a deep depth under Michael Lin's copied rules; writes DIR/<run>/records/NAME.json with both verdicts side by side. Phase A has only the stub provider)
  node bench/runner/bench.js cap units [--kind agent|sop|context] [--coverage FILE] [--out FILE] [--repo-root DIR] [--json] [--list]
  node bench/runner/bench.js cap unit-stage --kind agent|sop|context --unit NAME --run stub-ID [--out DIR] [--provider stub] [--delegation FILE] [--repo-root DIR]
  node bench/runner/bench.js cap unit-stage --kind agent|sop|context --unit NAME --provider kiro --run ID --cap N --ledger FILE --work DIR [--depth quick] [--model M] [--judges A,B,C] [--baselines DIR] [--controls-only] [--role-line] [--out DIR] [--kiro-bin PATH] [--auth-db PATH] [--repo-root DIR] [--dry-run]
       (PAID: the same stage on the kiro provider, quick depth only, one-turn kiro-cli calls with no tools; the ledger is read before every call at the larger of
       15 and its real credits and a call is refused past --cap; the baseline (in --baselines, default bench/cap/unit-baselines) must be fresh and signed off
       (source.signedOffBy); a rerun of the same --run resumes and pays only calls not saved yet. --controls-only runs the two controls and not the
       unit. --role-line starts both arms of each unit task with the kind's role line (context: "You orchestrate a team of specialist
       agents."), so the gap measures the file and not the role; control prompts do not change. --dry-run prints the calls by section (cached and new), the worst case and what would stop the run, free)
  node bench/runner/bench.js cap unit-stage --render RECORD.json [--baselines DIR]
       (free: redraws the .md of a finished stage record with the review grades written after the run; the JSON and its readings do not change)
  node bench/runner/bench.js cap unit-author --kind agent|sop|context --unit NAME --work DIR --ledger FILE --cap N [--briefs FILE] [--out FILE] [--replace ID] [--sign-off NAME] [--kiro-bin PATH] [--auth-db PATH] [--repo-root DIR] [--dry-run]
       (PAID: writes a unit's frozen baseline from its briefs: glm-5 writes, deepseek-3.2 reviews, one fix, then a still failing task is dropped and recorded;
       at most 8 calls, each spend-checked as above, resumable from --work. --dry-run prints the steps and the worst case, free. --replace ID: a dropped
       task's replacement, deepseek-3.2 writes and glm-5 reviews, two calls, into the draft. --sign-off NAME: free, freezes the draft into --out with source.signedOffBy)
  node bench/runner/bench.js cap unit-author --kind agent|sop|context --unit NAME --rewrite FILE --from BASELINE --out FILE --work DIR --ledger FILE --cap N [--kiro-bin PATH] [--auth-db PATH] [--repo-root DIR] [--dry-run]
       (PAID: a new version of a frozen baseline with the tasks of --rewrite written again (its families, one batch, one fix, then drop and record; at
       most 4 calls); every other task is copied unchanged and --out has no sign-off. --dry-run prints the steps and the worst case, free)
  node bench/runner/bench.js cap delegation --agent NAME --run stub-ID [--stub-behaviour always|never|correct|other] [--requests FILE] [--reps N] [--out DIR] [--repo-root DIR] [--json]
  node bench/runner/bench.js cap unit-stage --estimate [--kind agent|sop|context] [--depth quick|deep|both] [--max-units N] [--repo-root DIR]
       (free: keep-or-prune stages 2 to 4. units lists the agent files, SOPs and always-loaded context with their drop arm and selection test; unit-stage runs
       one unit through the stage 1 pipeline on the stub provider, or prints a stage's dry-run cost in credits and USD; delegation is stage 2's selection
       test on the stub: does the orchestrator hand a request to the agent when it should. See docs/keep-prune-stages.md)
  node bench/runner/bench.js cap controls --out DIR [--base REF] [--reps 5] [--scratch DIR] [--agent-engine v2|v3] [--repo-root DIR] [--bench-dir DIR] [--json]
  node bench/runner/bench.js cap controls --check RUN --base-arm ARM --keep ARM --prune ARM [--aa ARM] --extra-tasks DIR [--bench-dir DIR] [--json]
       (known-answer controls for skill studies. With --out it writes a skill that holds a fact nobody can guess (keep), a decoy skill (prune) and one task for
       each, and prints the variant, run and check commands; free. With --check it reads a finished controls run and exits 0 only when the planted lift was
       found and the decoy showed no effect; it writes controls-check.json beside the run)
  node bench/runner/bench.js cap trigger --cap ID --mode proxy|live|runs [--from-runs DIR[,DIR]] [--split train|heldout|all] [--reps 3] [--harness kiro-cli|opencode] [--base REF]
       [--queries FILE] [--out DIR] [--model M] [--model-cmd CMD] [--from-run DIR] [--from-arm NAME] [--acting-agent A] [--concurrency N]
       [--crosscheck F] [--crosscheck-run DIR] [--budget-credits X] [--budget-usd X] [--run-credit-limit X [--run-credit-limit-mode hard|soft]] [--stop-on first-capability|first-load|end_turn]
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
       12 queries prints "proxy not validated". --dry-run only writes the trigger tasks and prints the run command. Harnesses are never merged.
       --cap takes skill:, sop: and agent: ids (proxy reads skills, and SOPs on opencode; live and runs read all three). --mode runs reads no model and starts no run:
       it scores the unit from the loadCheck of finished task runs in --from-runs (a konductor arm; --from-arm picks one): runs of tasks that list the unit in
       loadCheck.mustLoad or have it as a target are should-load, runs of tasks that list it in mustNotLoad are should-not, and it also prints the share loaded
       before the first file write)
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
  node bench/runner/bench.js calibrate export --run DIR [--n 25] [--seed S] [--out DIR] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       [--max-file-chars N] [--max-bundle-chars N] [--redact-file FILE] [--criteria-pack quality]
       (--criteria-pack adds the quality-pack criteria of each sampled output to sheet.json and sheet.md for a person to rate)
  node bench/runner/bench.js calibrate export-reference --tasks ID,ID --criteria ID,ID --out DIR [--seed S] [--bench-dir DIR] [--extra-tasks DIR,DIR]
       (free, no model call: a blind sheet of the named pack criteria over each task's reference, partial solutions and keyword stub laid on its fixture)
  node bench/runner/bench.js calibrate score --labels FILE [--key FILE] [--kappa-min 0.6] [--agreement-min X] [--spearman-min X] [--save FILE] [--criteria-pack quality]
  node bench/runner/bench.js plugins [--json]
       (free: every harness and judge backend, built-in or from bench/plugins, with each plugin's version, api and hash, and any refused plugin folder with its reason)
  node bench/runner/bench.js list-arms [--arms a,b,c] [--repo-root DIR]

${ARM_SYNTAX}

An unknown flag is an error (exit 2) and nothing runs. --help and -h print this text.`;

// Flags that may be given more than once; a repeated one becomes an array.
const REPEATABLE_FLAGS = new Set(['root', 'cell', 'ref']);

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
    else if (REPEATABLE_FLAGS.has(key) && opts[key] !== undefined) { opts[key] = [].concat(opts[key], next); i++; }
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
      budgetUsd: opts['budget-usd'] === undefined ? null : Number(opts['budget-usd']), out: opts.out && opts.out !== true ? opts.out : null,
      seed: opts.seed, benchDir: opts['bench-dir'] ? require('node:path').resolve(opts['bench-dir']) : undefined,
      repoRoot: opts['repo-root'] && opts['repo-root'] !== true ? opts['repo-root'] : null,
    });
    console.log(p.text);
  } catch (e) {
    console.error(`pr-plan: ${e.message}`);
    process.exitCode = 2;
  }
}

// Every command the flag table (runner/lib/cli-flags.js) accepts, and the function that runs it. Heavy modules load when the command runs.
const DISPATCH = {
  run: (opts) => cmdRun(opts),
  'list-arms': (opts) => cmdListArms(opts),
  plugins: (opts) => require('./lib/plugins-cmd.js').cmdPlugins(opts),
  'pr-plan': (opts) => cmdPrPlan(opts),
  contrast: (opts) => evalCommands.cmdContrast(opts),
  judge: (opts) => evalCommands.cmdJudge(opts),
  report: (opts) => evalCommands.cmdReport(opts),
  'report-2x2': (opts) => evalCommands.cmdReport2x2(opts),
  recheck: (opts) => evalCommands.cmdRecheck(opts),
  explain: (opts) => evalCommands.cmdExplain(opts),
  trace: (opts) => evalCommands.cmdTrace(opts),
  'refs-report': (opts) => require('../report/refs.js').cmdRefsReport(opts),
  'probe-report': (opts) => require('../report/probes.js').cmdProbeReport(opts),
  'canary-report': (opts) => require('../report/canary-layers.js').cmdCanaryReport(opts),
  'plant-report': (opts) => require('../report/plant.js').cmdPlantReport(opts),
  'plant-trace': (opts) => require('../report/plant-trace/index.js').cmdPlantTrace(opts),
  'plant-policy-test': (opts) => require('./lib/plant/policy-test.js').cmdPlantPolicyTest(opts),
  'plant-host-check': (opts) => require('./lib/plant/host-check.js').cmdPlantHostCheck(opts),
  backfill: (opts) => evalCommands.cmdBackfill(opts),
  compare: (opts) => evalCommands.cmdCompare(opts),
  skills: (opts) => evalCommands.cmdSkills(opts),
  calibrate: (opts) => evalCommands.cmdCalibrate(opts),
  cap: (opts) => cmdCap(opts),
  scenarios: (opts) => cmdScenarios(opts),
  gc: (opts) => cleanup.cmdGc(opts),
  archive: (opts) => cleanup.cmdArchive(opts),
};

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === '--help' || cmd === '-h' || cmd === 'help') { console.log(USAGE); return; }
  const opts = parseArgs(rest);
  if (opts.help !== undefined && COMMAND_NAMES.includes(cmd)) { console.log(USAGE); return; }
  const problem = COMMAND_NAMES.includes(cmd) ? checkArgs(cmd, opts) : null;
  if (problem) { console.error(`bench: ${problem}`); process.exitCode = 2; return; }
  if (Object.hasOwn(DISPATCH, cmd)) return DISPATCH[cmd](opts);
  console.error(USAGE);
  process.exitCode = cmd ? 2 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`bench: ${e.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main, KNOWN_ARMS, DISPATCH, USAGE };
