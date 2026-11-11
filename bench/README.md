# bench

**Measure what Konductor, and each skill in it, adds to an AI coding agent.**

bench runs the same tasks with and without a change, scores the output with a panel of judge models,
and reports cost, quality and run-to-run noise. It is plain Node, with no install step beyond the tools below.

Two kinds of question, two sets of commands:

| You want to know | Use | Needs credits? |
| --- | --- | --- |
| Is the whole platform better than the bare agent? | `run`, `judge`, `report --verdict platform` | yes |
| Is this one skill loaded, needed, or padded? | the `cap` commands (below) | some are free |

Jump to: [Which command answers my question](#which-command-answers-my-question) |
[Try it without credits](#try-it-without-credits) |
[Run it against a skill or an agent](#run-it-against-a-skill-or-an-agent) |
[Evaluate one skill](#evaluate-one-skill-step-by-step) |
[Read the answer](#read-the-answer) |
[Cleaning up](#cleaning-up) |
[What it cannot tell you yet](#what-it-cannot-tell-you-yet) |
[Reference](#reference)

## Pick your question

| Question | Command | Harness | Cost |
| --- | --- | --- | --- |
| Can any agent reach this skill? Is its description well formed? | `cap audit` | kiro-cli, opencode | free |
| Which tasks would test this skill? | `cap scenarios` (add `--mode trigger` for load tests) | kiro-cli login (one model call per skill) | under 1 credit per call; one retry if the draft fails its checks; `--dry-run` is free |
| Does the agent load the skill for the right requests, and skip it for near misses? | `cap trigger --mode proxy` or `--mode live` | kiro-cli, opencode | proxy about 0.09 credits per call; live runs a real agent per query and needs `--budget-credits` (kiro-cli) or `--budget-usd` (opencode) |
| Which skills across my finished runs were never loaded? | `cap prune-report` | kiro-cli, opencode | free |
| Is this skill needed? Which sections can go? | `cap skill-plan`, `cap skill-study`, `cap decide` | kiro-cli | hundreds of credits per skill |
| Does the skill help once it is loaded? | `cap skill-study --forced-load` | kiro-cli | adds one wave |
| Which rubric items and checks tell the arms apart? | `cap criteria` | any finished run | free |
| Is the whole platform worth keeping? | `run`, `judge`, `report --verdict platform` | kiro-cli, opencode, Claude Code | credits or USD |

Not covered: per-skill studies on opencode or Claude Code.

## Which command answers my question

Costs: **free** means no model call. **Tens of credits** is a few credits up to about a hundred. **Hundreds of credits per skill** is a controlled study.
Credits are Kiro credits; the opencode and Claude Code harnesses and the opencode judge bill in USD. `main` is `origin/main` as last fetched, and no command here fetches.
`$RUNS` is a directory of finished runs, `$OUT` a directory you choose. Commands in this table start with `node bench/runner/bench.js`, except `pilot-2x2.sh`.

| Question | Command | It needs | Cost | Read this |
| --- | --- | --- | --- | --- |
| Is a skill well formed, oversized, a near duplicate of another, reachable by an agent? | `cap audit --base main --cap skill:NAME --out $OUT/audit` | Node, git, the ref | free | `cap-audit.md`: bytes, `tok~`, `nearest` (similarity to the closest skill), `kiro agents` (0 means no agent lists it), and the findings. Exit 1 only on an error finding |
| Is a skill ever loaded in finished runs? Is it redundant, a prune candidate, a trim candidate? | `cap prune-report --base main --runs $RUNS --out $OUT/prune` (per-run detail: `skills --run DIR`) | finished runs of non-vanilla arms | free | `prune-report.md`: one class per skill and harness (HARMS, RELOCATE, PRUNE, FIX, KEEP, NEEDS DATA), the load rate with its exposure n, and a TRIM flag for a skill over the 90th percentile of size or above 0.6 Jaccard similarity to a neighbour. FIX means offered but never loaded. A class is a recommendation, never a deletion; see the table in [CAP-PLAYBOOK.md](CAP-PLAYBOOK.md) |
| Which tasks would test a skill? | `cap scenarios --cap skill:NAME [--mode trigger] --out $OUT/ops` | `--dry-run` needs nothing; otherwise a kiro-cli login | free with `--dry-run`, under 1 credit otherwise | `$OUT/ops/scenarios/`: unreviewed drafts for a person to edit |
| Does the agent load the skill for the right requests and skip near misses? | `cap trigger --cap skill:NAME --mode proxy --queries FILE --base main` (`--mode live` runs real agents) | a kiro-cli login, or opencode | proxy: about 0.09 credits per call; live: capped by `--budget-credits` | recall first, then precision and F1 with Wilson intervals, and what fired instead. "proxy not validated" means a miss is informative and a hit is not proof |
| Is the skill needed against vanilla, and which sections can go? | `cap skill-plan --base main --only NAME --runs $RUNS --out $OUT/plan`, then `cap skill-study`, then `cap decide --study DIR` | kiro-cli login and AWS credentials for the opencode judge | plan and decide: free. Study: hundreds of credits per skill | `decisions/decisions.md`: DELETE, PRUNE (line ranges and a patch), KEEP or NEEDS DATA, with the reason |
| Do the rubric items and checks of a study tell the arms apart? | `cap criteria --study DIR` | a finished study | free | `criteria.md`: items flagged NON-DISCRIMINATING, SATURATED or HIGH-VARIANCE |
| Is konductor better than the bare agent overall? | `run --suite lite\|full\|hard\|real\|autonomy\|pilot`, then `judge --run`, then `report --run` | kiro-cli login; judge credentials | lite: tens of credits. The others: see the next table | `report.md`: the diligence scorecard first, then quality /100, reliability, cost ratio and the noise band. `report --verdict platform` gives keep, discard or not enough evidence per arm |
| Does the code structure, the test quality, the written content (README, guides, design docs, reviews) or the design quality differ between arms, beyond what the task rubric checks? | `judge --run $RUNS --criteria-pack quality` (add `--plan` first), then `report --run $RUNS --criteria-pack quality` | finished runs; the judge credentials of the earlier judging | free with `--plan`; otherwise about one more rubric pass of judge calls | the "Quality dimensions" section of `report.md`: a 0 to 100 score per dimension and arm, the runs where it did not apply (n/a), and JUDGES DIFFER where the panel disagrees. Indicative, and not part of quality /100 |
| Does konductor produce clearer requirements and better task breakdowns than the bare agent, and is the work well made even when the task is small? | `run --suite requirements` (plan first with `pr-plan --suite requirements`), `judge --run $RUNS`, `judge --run $RUNS --criteria-pack quality`, then `report --run $RUNS --criteria-pack quality --scoring bench/profiles/scoring-quality.json` | kiro-cli login and judge credentials | tens of credits for the runs; judging about one rubric pass plus one pack pass | the "Quality dimensions" and "Process signals" tables, and a quality /100 that includes the pack. Details in [Suites and arms](#suites-and-arms) |
| Can a Kiro agent read the `references/*.md` files that skills now keep their detail in, or is the read refused or skipped? | `node bench/scripts/refs-study.js plan` (free), then the generated `run-all.sh` (`--dry-run` first), then `refs-report --run $RUNS --out $OUT` | kiro-cli login; no other bench process | about 53 to 142 credits for 27 runs at 3 replicates (mid 88.5); the plan, the dry-run and `refs-report` are free | `refs-report.md`: per arm, how many runs loaded the skill, tried a read, were refused, errored or read the file, with Wilson intervals; the verbatim refusal messages; errno 38 runs counted apart; and a DECISION (refused, works, does not follow the pointer, inconclusive). See [REFERENCES-READ.md](REFERENCES-READ.md) |
| Which skills load when the agent that owns them does the work, and which sibling loads instead? | `run --suite rootcause --tasks ID,ID --arms vanilla,v1.2.0,... --arm-agent v1.2.0=AGENT,...` once per entry agent (commands in `suites/rootcause.manifest.json`), then `skills --run DIR` | kiro-cli login | about 790 credits for all six entry agents (mid estimate) | `skillsLoaded` per run, to compare with `expectedPairs` in the manifest. See [Rootcause suite](#rootcause-suite) |
| Does guidance that lives only in the `constraints` skill reach Kiro agents, and does it change what they do? | `node bench/scripts/probe-study.js plan` (free), then the generated `run-all.sh` (`--dry-run` first), then `probe-report --run $RUNS --out $OUT --arms-file ARMS --scoring bench/profiles/scoring-fractional.json` | kiro-cli login; no other bench process | about 630 to 1,670 credits for 250 runs at 5 replicates (mid 1,045); the plan, the dry-run and `probe-report` are free | `probe-report.md`: applied/usable with Wilson intervals per probe, arm and position, deferral failures and errno 38 runs counted apart, and the DECISION rows with the counts behind each. See [CONSTRAINTS-PROBE.md](CONSTRAINTS-PROBE.md) |
| Which konductor layers (core rules, system prompt, skill index, skill body, SOP body, routing context) reach the model without being forced, per entry agent? | `node bench/scripts/canary-layers.js build --ref SHA --base DIR`, `... commands --base DIR`, then `canary-report --run DIR/runs --layers-file DIR/layers.json --out OUT` | kiro-cli login; no other bench process | about 3 tasks x 3 replicates x 6 entry agents = 54 runs at 2 to 4 credits each; the build, the commands and `canary-report` are free | `canary-report.md`: per layer, per agent and per task, the runs where the token showed in a tool result or in the model's own text, next to what the agent spec declares. See [CANARY-LAYERS.md](CANARY-LAYERS.md) |
| Does the choice of evidence-quote rule change a score, a rank or a call? | `report --run $RUNS` (the "Quote-rule sensitivity" section), or `report --verdict platform --run $RUNS` (the "Sensitivity" block) | finished, judged runs | free | the rule in use on the first lines, then strict against lenient: downgrade rate per judge, mean rubric and quality per arm with rank flips, and per arm whether the keep, discard or not-enough-evidence call is the same. `--scoring bench/profiles/scoring-strict-quotes.json` makes strict the rule in use |
| Why did this run get this quality number? Which check or judge verdict cost the points? | `explain --run $RUNS --arm A --task T --rep N` (`--brief` for one line per run) | finished runs | free | checks with what was observed, hidden tests, the rubric per judge with evidence and downgrade notes, weights, the renormalised sum, and the number if checks were scored as a fraction |
| Why did konductor behave this way in this run: what it read, which skills it looked up and loaded, whom it delegated to with what brief, what came back? | `trace --run $RUNS --arm A --task T --rep N` (`--instructions` adds the installed instruction lines that mention each skill or agent) | one finished kiro-cli or Claude Code run | free | a timeline plus a header: entry agent, skills listed against loaded, spawn tree, wall time, credits, flags and what the run directory cannot show |
| Does the answer depend on the harness (Kiro CLI against Claude Code)? | `bash bench/scripts/pilot-2x2.sh`, then `report-2x2` | both harnesses and Bedrock credentials | credits on Kiro, USD on Claude Code and the judge | `factorial-2x2.md` and `charts/`: quality per cell, the konductor effect per harness, cost ratios inside each harness |
| What is taking my disk, and what can I safely delete? Can I shrink a finished run and still re-score it? | `gc` (dry run), then `gc --apply`; `archive --run $RUNS --apply [--remove-originals]`, later `archive --restore $RUNS` | Node, `tar`, optionally `zstd` | free | the plan: kind, size, age and why each directory is kept or deleted; `ARCHIVE.md` and `archive-manifest.json` for an archive |

### Start each process

Run these from the repository root. Add `--budget-credits N` to any `run` to stop new runs at 90% of N; `run` prints the worst-case wall clock first.
`--prepare-only` builds and trial-installs every arm and spends nothing. The arms, replicates and cost per suite are in [Suites and arms](#suites-and-arms).

| Process | Start it with | Note |
| --- | --- | --- |
| lite | `node bench/runner/bench.js run --suite lite --budget-credits 100 --out $OUT/lite` | vanilla, v1.2.0 and main, 1 replicate. One pass cost about 61 credits (n=1) |
| full | `node bench/runner/bench.js run --suite full --budget-credits N --out $OUT/full` | all five arms, 3 replicates; no observed cost on file |
| hard | `node bench/runner/bench.js run --suite hard --budget-credits N --out $OUT/hard` | six tasks scored by hidden tests, 3 arms, 3 replicates |
| real | `node bench/real/fetch.js` once, then `node bench/runner/bench.js run --suite real --budget-credits N --out $OUT/real` | pinned public projects scored by their own tests; the fetch is the only networked step. About 121 credits or more per pass |
| autonomy | `node bench/runner/bench.js run --suite autonomy --budget-credits 400 --out $OUT/autonomy` | a scripted user answers questions; see [Autonomy tier](#autonomy-tier) |
| pilot | `node bench/runner/bench.js pr-plan --ref opt-a=REF --suite pilot --budget-credits 150`, then the `run --suite pilot` line it prints | 8 tasks, 1 replicate, for trying one option arm against a release |
| requirements | `node bench/runner/bench.js pr-plan --ref opt-a=REF --suite requirements --budget-credits 150`, then the `run --suite requirements` line it prints | 2 document tasks (a requirements document, a work breakdown), 3 replicates. Not in `full`. See [Suites and arms](#suites-and-arms) |
| references-read | `bash run-all.sh` written by `node bench/scripts/refs-study.js driver` (one `run` per arm and entry agent) | 3 tasks in `bench/refs/` where one fact lives only in a skill's `references/*.md`, run on seven arms (origin/main, the slim `dynamodb-design`, the Asana fold, forced-load twins, a readable control). Not in `full`. The suite names `bench/refs` in `extraTasks`. See [REFERENCES-READ.md](REFERENCES-READ.md) |
| rootcause | `node bench/runner/bench.js run --suite rootcause --tasks ID,ID --arms vanilla,v1.2.0,main --arm-agent v1.2.0=AGENT,main=AGENT --out DIR` (per entry agent, see `suites/rootcause.manifest.json`) | 20 tasks (9 existing, 11 new in `bench/rootcause/`) run through the agent that owns the skills they unlock, to see which skills load. Not in `full`. The suite adds `bench/rootcause` as an extra task directory by itself. See [Rootcause suite](#rootcause-suite) |
| complex | `node bench/runner/bench.js run --suite complex --budget-credits N --out $OUT/complex` | larger multi-step tasks in `bench/complex/` (design then implement, multi-file refactor, feature across layers, review then fix), 3 arms, 1 replicate, scored by hidden tests, checks and rubric. See [Benchmark tasks](README-tasks.md#complex-tasks) |
| constraints-probe | `bash run-all.sh` written by `node bench/scripts/probe-study.js driver` (one `run` per arm and entry agent) | 8 tasks in `bench/probes/` that exercise five rules held only by the `constraints` skill, run as entry agent and as delegated subagent on five arms. Not in `full`. The suite names `bench/probes` in `extraTasks`. See [CONSTRAINTS-PROBE.md](CONSTRAINTS-PROBE.md) |
| cap | no command of its own | `--suite cap` is the fallback the `cap` commands use; start that work with `cap` |
| scoring and report | `node bench/runner/bench.js judge --run $OUT/lite`, then `node bench/runner/bench.js report --run $OUT/lite` | `judge` spends credits (or USD with `--judge-backend opencode`); `report` is free and writes `report.md`, `report.html`, `report.json` and `charts/` |
| 2x2 | `bash bench/scripts/pilot-2x2.sh --dry-run ...`, then without `--dry-run` | see [2x2 pilot](#2x2-pilot) |

## What you need

| To do this | You need |
| --- | --- |
| Read help, audit, plan, draft prompts | Node 22+, `git`, a checkout with the ref you want to inspect |
| Draft scenarios or run a proxy trigger test | the above, plus `kiro-cli` logged in (or `--model-cmd`) |
| Run anything that starts an agent | `kiro-cli` on PATH and logged in, `tar`, `cargo` (offline cache or `--cargo-online`), `unshare` and `setpriv` (Linux) |
| Judge with the opencode backend, run opencode or Claude Code arms | an AWS credentials file or exported `AWS_*` variables for Amazon Bedrock; costs are in USD |

## Try it without credits

These commands call no model and spend nothing (see `--help`):

```bash
node bench/runner/bench.js --help                                   # every command and flag
node bench/runner/bench.js cap list --base main                     # agents, skills and SOPs, who reaches them, linked tasks, gaps
node bench/runner/bench.js cap audit --base main --out /tmp/audit   # description lint, size, near duplicates, reachability
node bench/runner/bench.js cap scenarios --cap skill:backend-review --dry-run --out /tmp/scn   # writes the prompt to /tmp/scn/scenarios/, no model call
node --test "bench/runner/test/*.test.js"                           # unit tests
```

`--base REF` reads local refs only; the runner never fetches. `main` means `origin/main`, and `HEAD` is not accepted (use a branch, tag or remote-tracking name).
`cap audit` writes `cap-audit.md` and `cap-audit.json` and exits 1 on any error finding, for example `ratchet-stale` when a waiver in `bench/capabilities/audit-baseline.json` no longer applies. Exit 1 is a finding, not a crash.

## Run it against a skill or an agent

`$BASE` is a ref (`main`), or `dir:PATH` to read a working tree with your edits, for `cap audit` and `cap list`.
The skill and agent names come from `cap list --base $BASE --kind skill` and `--kind agent`; an id is `skill:NAME` or `agent:NAME`.

One skill, `backend-review`:

```bash
BASE=main; OUT=/var/tmp/bench-skill; RUNS=/path/to/finished/run-dir
node bench/runner/bench.js cap audit --base $BASE --cap skill:backend-review --out $OUT/audit          # free: lint, size, nearest neighbour, reachability
node bench/runner/bench.js cap prune-report --base $BASE --runs $RUNS --out $OUT/prune                  # free: loaded in your finished runs? class and TRIM flag
node bench/runner/bench.js cap scenarios --cap skill:backend-review --mode trigger --n 10 --out $OUT/ops   # under 1 credit; add --dry-run for none
node bench/runner/bench.js cap trigger --cap skill:backend-review --mode proxy \
  --queries $OUT/ops/scenarios/skill-backend-review.trigger.json --base $BASE                           # review and edit the draft first
node bench/runner/bench.js cap skill-plan --base $BASE --only backend-review --runs $RUNS --out $OUT/plan   # free: tasks, waves, credit estimate
```

The study itself (`cap skill-study`, then `cap decide` and `cap criteria`) is steps 5 to 8 of [Evaluate one skill](#evaluate-one-skill-step-by-step).
`$RUNS` is optional for `cap skill-plan` but needed for `cap prune-report`; without runs the plan shows credit figures as n/a.

One agent, `k-architect`:

```bash
BASE=main; OUT=/var/tmp/bench-agent
node bench/runner/bench.js cap list --base $BASE --kind agent                                           # free: which agents exist, and their linked tasks
node bench/runner/bench.js cap audit --base $BASE --cap agent:k-architect --out $OUT/audit             # free: size, description, who can reach it
node bench/runner/bench.js cap plan --mode lift --cap agent:k-architect --base $BASE \
  --tasks design-hold-service --budget-credits 100                                                       # free: prints the commands, runs nothing
```

`cap plan` prints five numbered steps: build a variant with the agent removed, run it against the base and an A/A repeat of the base
(`base`, `base-b`, `x-minus`), contrast, judge, report. The run and judge steps spend credits (it prints an estimate, judge not included); the rest is free. Copy the printed lines in order. A lift counts only when it is larger than the `base-b` against `base` spread.
Pass `--tasks` with the ids of tasks that exercise the agent. `cap list --base $BASE --cap agent:k-architect` names them on its last line
("target-only tasks design-hold-service"); a task that is not linked in the registry still works when you pass it this way.

Limits today. These commands work on the skills and agents of this repository at the ref you give, and the agent that does the work is konductor.
Testing an arbitrary third-party skill or agent definition is not supported yet. Per-skill studies run on Kiro CLI only.

## Evaluate one skill, step by step

Each step says what it costs and whether a person has to act. Replace `backend-review` and `$BASE` (a ref, for example `main`) with your own.
`$OPS` and `$STUDY` are output directories you choose, and `$RUNS` holds finished run directories (see step 5).

| # | Step | Command | You do |
| --- | --- | --- | --- |
| 1 | Check it statically | `cap audit --base $BASE --cap skill:backend-review` | read the findings |
| 2 | Draft load tests: requests that should load the skill, and near misses that should not | `cap scenarios --cap skill:backend-review --mode trigger --n 10 --out $OPS` | **review and edit the draft**; it is marked unreviewed |
| 3 | Draft lift tasks | `cap scenarios --cap skill:backend-review --n 8 --out $OPS` | **turn approved drafts into task files** (fixture, hidden tests or checks, rubric); see `README-tasks.md` |
| 4 | Is it picked up? | `cap trigger --cap skill:backend-review --mode proxy --queries $OPS/scenarios/skill-backend-review.trigger.json --base $BASE` | read recall first; to check a sample against real runs, add `--crosscheck 0.3 --budget-credits N --run-credit-limit M`; `--mode live --budget-credits N` runs every query for real |
| 5 | Plan the study | `cap skill-plan --base $BASE --only backend-review --profile detailed --runs $RUNS --forced-load low-load --out $OPS/plan` | read the estimate; `$RUNS` is one or more finished run directories |
| 6 | Run it | `cap skill-study --study $STUDY --init` with the same flags as step 5, then `--study $STUDY --dry-run`, then `--study $STUDY --waves 1`, then `--study $STUDY` | supply credentials (`--aws-creds-file`) and a budget |
| 7 | Get the call | `cap decide --study $STUDY` | read `decisions/decisions.md` |
| 8 | Check the tests themselves | `cap criteria --study $STUDY` | drop or reword items it flags |

`cap skill-study` runs the agents on kiro-cli and judges on the opencode backend, so it needs both a kiro login and AWS credentials.
Without `--runs`, `cap skill-plan` still works, but credit figures read n/a and `--forced-load low-load` counts no skill because no load rate is known (`--forced-load always` counts every selected skill).
`--init` uses the plan flags, and its base defaults to `v1.2.0`, so pass `--base` and `--only` there too. `--init` and `--dry-run` spend nothing.
The full flag list is in `node bench/runner/bench.js --help`; the reasoning behind each step is in [CAP-PLAYBOOK.md](CAP-PLAYBOOK.md).

### What the study runs

| Wave | Arms | Question |
| --- | --- | --- |
| 1 | control (skill present), the same control again (A/A), skill deleted. Known-answer controls run first and must pass. | Is the skill needed? The A/A pair sets the noise band. |
| 1f | skill forced to load, the same again (A/A), skill deleted (optional; `low-load` picks skills that load under 30% of the time, `always` picks all) | Does it help once loaded? Never changes a call. `--waves 1` skips it. |
| 2 | one section removed per arm (only if wave 1 shows a loss) | Which sections can be removed? |
| 3 | the same sections moved into `references/` | Which can be moved instead? |

### Where the output lands

Everything is under `$STUDY`: `study.json`, `skills/<skill>/` with `w1`, `w2` and `w3`, `controls/`, `logs/`, and `decisions/` with
`decisions.md`, `decisions.json`, `evidence.json` and `patches/<skill>.patch`. A patch is a suggestion; nothing is applied for you.
A finished wave is skipped on a rerun, so a stopped study resumes where it was.

## Read the answer

`cap decide` gives one call per skill.

| Call | Meaning |
| --- | --- |
| DELETE | Removing the skill lost no more than the 0.10 margin (the interval rules out a larger loss), or improved quality outside the A/A spread. |
| PRUNE | The skill is needed, but some sections can be removed or moved. Line ranges and a patch are included. |
| KEEP | Removing it lost quality, and no section could be cut, or the section waves have not run. |
| NEEDS DATA | The study could not decide. The reason is printed. |

A DELETE or PRUNE call needs: passed known-answer controls, an A/A arm, at least 15 runs per side, a skill that loaded in at least 30% of control runs,
and medium or high confidence (30 or more runs per side for high). A "no effect" DELETE also needs an A/A spread under the 0.10 margin. These thresholds are this project's own choices.
Anything weaker is NEEDS DATA, which means "this study cannot say", not "no effect". The reason is printed.
The most common reasons: the skill loaded in under 30% of control runs, wave 1 had not finished, or tasks timed out.

## Find out why a run behaved that way

Two read-only commands answer "why" for a finished run. Neither calls a model nor writes into the run directory. The examples use a five-arm lite run; replace the path with yours.

`explain` shows the arithmetic behind one quality number. A run directory with several arms works, as does a 2x2 cell directory or a 2x2 root (then `--arm` may name a cell such as `kiro-vanilla`).

```
node bench/runner/bench.js explain --run /var/tmp/stack-cmp/run --arm v1.2.0 --task design-hold-service --rep 1
node bench/runner/bench.js explain --run /var/tmp/stack-cmp/run --task design-hold-service --brief
node bench/runner/bench.js explain --run /var/tmp/pilot-2x2-req --arm kiro-konductor --task plan-multipart-feature
```

The output has six parts. First the header, then the checks, each with what was observed when it failed. Then hidden tests, and the rubric with each judge's verdict per criterion, its quote, and a note when the quote was not found and the verdict dropped one level. Then the weights with their renormalisation and the final number, and last a what-if with checks scored as a fraction. `--scoring FILE` explains under another weights file.

`trace` shows what one run did, in order: the prompt, each assistant message, every tool call with shortened arguments, `find_skills` and `get_skill` calls, each delegation with the brief and what the specialist returned, files written, and credits and time per turn where the stream records them. Messages and tool calls made while a delegation is open are attributed to the specialist; that attribution is read from order and, for tool calls, the sub-task id, so treat a message line as probable.

```
node bench/runner/bench.js trace --run /var/tmp/stack-cmp/run --arm mainsha --task design-hold-service --rep 1
node bench/runner/bench.js trace --run /var/tmp/stack-cmp/run --arm stack149 --task design-hold-service --rep 1 --instructions
node bench/runner/bench.js trace --run /var/tmp/pilot-2x2 --arm cc-konductor --task design-hold-service --rep 1 --format json
```

The header lists the entry agent, how many skills its installed filter offered against which were loaded, the spawn tree, wall time, credits or USD, the result flags, and what the run directory cannot show. A run saved before session files were kept is flagged `transcriptPartial`; the header then says no session files exist and the trace comes from `stream.jsonl` alone, which has messages, thoughts, tool calls and their results but no model prompts and no per-event timestamps.

`--instructions` adds, under each skill load and delegation, the lines of installed instruction text that mention the skill or agent. It reads the installed agent's prompt from the run, and the agent spec, the contexts it lists and the delegation skill from the arm's commit in `--repo-root` (default: this repository). Each result is marked INFERRED. A match shows what the instructions say about the name; it does not prove the instruction caused the call. Add `--full` to print briefs, results and thoughts without shortening.

A run's quality can also be read in the report (`report --run $RUNS`); `explain` is for one run. For skills, `cap prune-report` and `skills --run DIR` count loads over many runs; `trace` is for one.

## Cleaning up

Runs leave a lot behind: the run output, the shared build cache, the cargo target, scratch homes, and a copy of every workspace. Two commands reclaim that space. Both are dry runs until you add `--apply`, and neither deletes anything it did not find a marker for.

**What the bench removes by itself.** The scratch home of a run (it holds a copy of the login database) is deleted when the run ends or is interrupted. `cap variant` removes its temporary build directory, and `pilot-2x2.sh` removes its scratch directory on exit unless you pass `--keep`. Run output, caches and cargo targets stay until you clean them.

**The marker.** Every directory the bench creates and may later reclaim gets a file, `.bench-owner.json`: the run output (`--out`), `--cache`, `--cargo-target`, the scratch root, the directories of the pilot, probe and references drivers, and `cap variant` scratch directories. It records the kind (`run-out`, `cache`, `cargo-target`, `scratch`, `archive`, `study-driver-dir`), when it was made and last used, the bench commit, the command line (a value after a flag that looks like a credential is replaced), the process id, and `protect: false`. It holds no environment and no secrets. A directory that already existed when a command asked for it is not marked, so a cache you pointed `--cache` at stays yours.

**gc.** `node bench/runner/bench.js gc` scans `/var/tmp` and the system temp directory (three levels deep; repeat `--root DIR` to choose others) and lists every marked directory with its kind, size, age, last change and the reason it is kept or eligible. It does nothing else without `--apply`. The default kinds are `scratch`, `cache` and `cargo-target`; `run-out` and `study-driver-dir` hold results that cost credits, so they need `--kind run-out` (or `--kind run-out,study-driver-dir`). Archives are never deleted. A directory is deleted only when all of this holds, checked again just before each deletion:

- its marker is valid and says `protect: false`, and the directory is yours;
- it is older than `--older-than` (default `7d`; with `--apply` at least `1h`), counting the newest file inside, not only the marker;
- no protect entry covers it or lies inside it;
- it is not a git worktree, not inside a checkout, has no `.git` at its top, holds no linked worktree at any depth, and is not the home directory, a temp directory, a scan root, the repository root or the working directory (a plain repository inside a run's `workspace/` does not block it);
- no process has it as its working directory, an open file, or a path on its command line, and the process id in its marker is gone;
- no symlink elsewhere points into it.

`--keep-last N` spares the newest N directories of each kind. Deletions never follow a symlink, and each one is appended to `<root>/.bench-gc.log`. Where `/proc` cannot be read, nothing is eligible.

**The protect file.** `~/.konductor/bench-gc-protect.txt` (change it with `--protect-file`) holds one path or glob per line, `#` starts a comment. `*` and `?` stay inside one path segment, `**` crosses segments. An entry protects the path, everything below it, and any directory that contains it. It is read on every run and wins over a marker. Edit it by hand or with `gc --protect add PATH`; `gc --protect list` prints it.

**Directories made before markers existed.** They have no marker, so gc ignores them. To opt one in, name it and its kind: `gc --adopt DIR --kind cache` shows what it would write, and `--apply` writes it. The marker takes the directory's own age, so an old directory is eligible right away, and gc still applies every check above. Nothing is adopted automatically.

**archive.** To keep a finished run but drop the bulk, `archive --run DIR --apply` packs each run's `workspace/` into `workspace.tar.zst` (zstd if installed, else `workspace.tar.gz`; `--compress` picks one) beside it, or under `--out DIR`, which also copies the evidence files. `result.json`, `stream.jsonl`, `installed-agent.json`, `run-config.json`, `judgments*.json`, `summary.json`, `credit-ledger.jsonl` and `session/` stay as plain files. It writes `ARCHIVE.md` and `archive-manifest.json` (size and sha256 of every archive), re-reads each archive, compares its entry list and checksum with the workspace, and marks the archive directory `kind archive`, `protect true`, so gc never deletes it. With `--remove-originals` it then deletes each uncompressed `workspace/`, but only after its archive verified. `archive --restore DIR` checks every archive against the manifest and extracts `workspace/` where it is missing; it never overwrites one. `recheck` and `judge` need the workspaces, so on an archived run restore first; `recheck` prints that hint itself.

```sh
node bench/runner/bench.js gc                              # what could go, and why not the rest
node bench/runner/bench.js gc --older-than 14d --keep-last 2 --apply
node bench/runner/bench.js gc --adopt /var/tmp/old-cache --kind cache --apply
node bench/runner/bench.js archive --run $RUNS             # plan
node bench/runner/bench.js archive --run $RUNS --apply --remove-originals
node bench/runner/bench.js archive --restore $RUNS
```

## What it cannot tell you yet

- A skill the agent never loads cannot show lift. Write tasks that need the skill, or use the forced-load wave.
- `cap trigger` measures how the agent picks skills when the skill text is visible. A proxy hit is not proof; live runs are the check.
- `cap skill-study` and the forced-load wave run on kiro-cli only. `cap trigger` supports kiro-cli and opencode. Claude Code arms go through `run` only; no `cap` command runs them.
- A "no effect" call needs the A/A spread to be under 0.10, so a noisy pair gives NEEDS DATA even with 15 runs per side.
- Judge agreement with a person is a check you run: `cap review` writes the page, `cap review-import` scores the ratings (see [Calibration](#calibration)).

## Reference

The sections below are the full reference. [CAP-PLAYBOOK.md](CAP-PLAYBOOK.md) is the how-to for skill studies,
[README-tasks.md](README-tasks.md) describes the task format, and [RUNBOOK.md](RUNBOOK.md) covers unattended studies.

| Topic | Section |
| --- | --- |
| Prerequisites and `run` flags | [Prerequisites](#prerequisites), [Quick start](#quick-start) |
| Suites and arms | [Suites and arms](#suites-and-arms) |
| Other harnesses | [opencode harness](#opencode-harness), [Claude Code harness](#claude-code-harness), [2x2 pilot](#2x2-pilot) |
| Isolation and safety | [Isolation, environment, safety](#isolation-environment-safety) |
| Judging and calibration | [Judging](#judging), [Calibration](#calibration) |
| Per-capability commands | [Capability benchmarking (cap)](#capability-benchmarking-cap) |
| Reading reports | [How to read results](#how-to-read-results), [Reports, scores and the diligence scorecard](#reports-scores-and-the-diligence-scorecard) |
| Platform verdict, profiles, credits | [Profiles, credit ledger and platform verdict](#profiles-credit-ledger-and-platform-verdict) |
| Orchestrator study | [Orchestrator study](#orchestrator-study-cells-gates-metrics-and-the-pass-rule) |

---

## Platform benchmark
Runs the same tasks against kiro-cli with and without Konductor, scores the outputs with a cross-provider
judge panel, and reports cost, quality and regressions. Node only. Task format: `bench/README-tasks.md`.
## Prerequisites
- `kiro-cli` on PATH and logged in; `git`, `tar`, `cargo` (offline cache or `--cargo-online`), Node 22+,
  `unshare` and `setpriv`.
## Quick start
```bash
OUT=/tmp/bench-out
node bench/runner/bench.js run --suite lite --budget-credits 60 --out $OUT   # every arm
node bench/runner/bench.js judge --run $OUT                         # rubric + pairwise, 3-family panel
node bench/runner/bench.js report --run $OUT                        # report.md, report.html, report.json, charts/ in $OUT
node bench/runner/bench.js run --suite pilot --profile detailed --out $OUT   # 5 replicates, an A/A arm, graded judging, a calibration sample
node bench/runner/bench.js report --run $A,$B,$C --verdict platform --out $V  # keep, discard or not enough evidence per arm: verdict.md and .html
node bench/runner/bench.js compare --base $OLD --head $OUT          # regression check
node bench/runner/bench.js recheck --run $OUT [--dry-run]                    # re-apply corrected task checks to saved workspaces
node bench/runner/bench.js backfill --run $OUT [--credits] [--skills] [--write]  # repair finished runs from stream.jsonl: credits (default) and/or skill-load fields (dry run by default)
node bench/runner/bench.js calibrate export --run $OUT --n 25 --seed 1   # then: calibrate score
node --test "bench/runner/test/*.test.js"                           # unit tests
node bench/tasks/validate-tasks.js                                  # tasks vs reference solutions
```
Run flags: `--arms a,b`, `--tasks id,id`, `--replicates N`, `--replicate-offset N`, `--parallel N`, `--budget-credits X`,
`--model ID` (default claude-sonnet-5.5), `--effort LEVEL` (default high), `--agent-engine v2|v3` (default v2), `--seed N`,
`--isolate auto|unshare|sandbox-exec|none`, `--allow-partial`, `--censored-floor X`, `--env-keep NAME,..`,
`--hide PATH,..`, `--no-default-hide`, `--tripwire-exclude PATH,..`, `--tripwire-depth N`, `--tripwire-dir DIR,..`,
`--kiro-bin PATH`, `--cache DIR`, `--cargo-target DIR`, `--cargo-online`, `--bench-dir DIR`, `--real-cache DIR`, `--prepare-only`.
`--suite lite|full|hard|real|autonomy|pilot|cap|requirements|rootcause|complex|references-read|constraints-probe|canary-layers` (`cap` is the fallback the `cap` commands use; they name their arms).

`run --oracle-skills [ARM,ARM] [--oracle-manifest FILE]` is the oracle arm: for konductor arms, the SKILL.md bodies of the skills a task is expected to use (default manifest `suites/rootcause.manifest.json`, `tasks[].entries[].expectedSkills`) are put, between BEGIN and END ORACLE SKILLS lines, in front of the task prompt, read from the arm's own ref. It separates "the skill was not loaded" from "the skill adds nothing". Vanilla is refused; an unknown skill, a task with no manifest entry or no expected skills stops the run before it starts. `result.json` records `oracle: {skills, entryMatched, bytes, sha256}`, the report flags the arm `ORACLE`, and an oracle arm is never paired as an A/A repeat of the same ref. Give the arm its own name (for example `oracle=<sha>`) and never pool it with normal runs. A skill's `references/` files are not included.
Replicates are numbered from 1. To add replicates to an out dir that already holds 1 to N, pass `--replicate-offset N` (a non-negative integer, default 0): the new ones are N+1 to N+`--replicates`. A run overwrites any `result.json` already at a planned path and prints a warning with the count of cells it will overwrite.
No credit cap is the default: every run is a line in `credit-ledger.jsonl` in the results directory and `run` prints the running total. `--budget-credits X` is an optional guard
that stops new runs at 90% of X; a run that carries the command past 100% ends it with exit code 3. `run` prints the worst-case wall clock first. See "Profiles, credit ledger and platform verdict".
The unit tests for the real-task track run a fake project's pytest suite. Without `python3 -m pytest`
those 9 tests are skipped, not failed, and the summary shows them in its `skipped` count; install
pytest (`python3 -m pip install --user pytest`) to cover them. Set `BENCH_REQUIRE_PYTEST=1` on CI
and reference hosts so a missing pytest fails those tests instead of skipping them.
An unknown or mistyped flag is an error (exit 2) that lists the known flags, and nothing runs. `--help` and `-h` print the usage.

`--agent-engine` selects the kiro-cli agent engine for every arm of the run and installs agents that engine loads:
`v2` runs `konductor install --harness kiro-cli-v2` and launches `kiro-cli chat --agent-engine v2`; `v3` runs
`konductor install --harness kiro-v3` and launches with `--agent-engine v3`. An arm whose CLI has no `kiro-v3`
harness fails the trial install and shows as FAILED in the preflight table (`--prepare-only` checks this without
starting an agent). The engine is recorded as `agentEngine` in `run-config.json` and each `result.json`
(`installHarness` names the install). It applies to kiro-cli arms only; opencode runs reject the flag.

## Suites and arms
- lite: vanilla, v1.2.0, main; 1 replicate, `--parallel 1` (wall-clock comparisons need 1). full: all
  five arms, 3 replicates. hard: six tasks with hidden acceptance tests, three arms, 3 replicates, `--parallel 1`.
  `run --suite hard` scores each run by the share of hidden tests passed; the report shows it as
  "hidden tests passed" (mean fraction, and how many runs pass all) beside "pass". See `bench/README-tasks.md`.
  Hidden tests, partial solutions, solutions and fixtures are masked in the agent's namespace.
- real: eight pinned tasks from public Python and JavaScript projects (rich, click, markdown-it-py, commander.js), three
  arms, 1 replicate. A run starts from the real base commit and is scored by the pull request's own tests: FAIL_TO_PASS is
  the score ("FAIL_TO_PASS passed"), PASS_TO_PASS the regression figure. Fill the local cache once with
  `node bench/real/fetch.js` (the only networked step); runs copy from it and the checks run offline. The agent keeps its
  network, the fix is public and the model may remember it, so the report has a separate contamination row
  (externalFetch, fixRecall). Host copies of the projects and the package caches are masked per run. Proofs:
  `node bench/real/validate-real.js` and `node bench/real/prove-mask.js`. Details in `bench/README-tasks.md`.
- requirements: two document tasks on copies of the inventory service. `req-vague-request` turns a vague stakeholder
  request into `docs/requirements.md` (nine seeded items: three vague terms, two conflicts, one impossible constraint,
  one missing non-functional requirement, two unstated assumptions). `plan-multipart-feature` writes a work breakdown at
  `docs/plan.md` for a five-part feature and implements nothing (three dependency edges, one parallel part, a
  migration-order trap, a concurrency requirement). Three arms, 3 replicates, `--parallel 1`; the `full` suite does not
  include them and `lite` and `pilot` are unchanged, so earlier runs stay comparable. Plan first, with no model call:
  `pr-plan --ref NAME=REF --suite requirements --budget-credits N`. Then
  `run --suite requirements --out $OUT/req --budget-credits N` (`--prepare-only` builds the arms and spends nothing), or
  pass `--tasks req-vague-request,plan-multipart-feature` to `pilot-2x2.sh` for the four cells. The checks only find out
  whether an item was named; the rubric and the quality pack (`requirements`, `plan`, `change` artifact types) judge how
  well it was handled. Details in `bench/README-tasks.md`.

### Rootcause suite

`--suite rootcause` lists 20 tasks: 9 from `bench/tasks` and 11 new ones in `bench/rootcause/` (frontend and infrastructure review, DynamoDB design, Smithy model, status report, AGENTS.md, threat model, a decision task with scripted answers, a plan review, an estimate conversion, a requirements-to-design handoff). The suite file names that directory in `extraTasks`, so no `--extra-tasks` flag is needed (the flag still works and is not counted twice). The directory is hidden from the agent like `bench/fixtures`. Each task is run through the entry agent that owns its skills, chosen per arm with `--arm-agent`, so one `run` covers one entry agent. `suites/rootcause.manifest.json` holds the entry agents, expected skills, per-agent task lists, credit plan and ready-made commands. It measures whether a skill loads, not whether it helps. Validate the new tasks with `node bench/tasks/validate-tasks.js --extra-tasks bench/rootcause`. Details in `bench/README-tasks.md`.

- `main` is the remote-tracking ref `origin/main` as last fetched (the runner never fetches), labelled
  `main-unreleased@<sha>`; run-config records origin and local SHAs and `behindOrigin`. Without it,
  local main is used with a warning.
- Every konductor arm is built from its own ref (CLI, synth, `skill-lookup-mcp`) via `git archive`, so
  a dirty tree never leaks in. Cache key: commit SHA; the MCP binary sha256 is stored with it and in
  run-config; a cache hit is rebuilt if the binary no longer matches.
- All arms are built, trial-installed and listed in a preflight table before any credit is spent;
  a failure aborts unless `--allow-partial`.
- After install, `model` in every `~/.kiro/agents/*.json` is rewritten to the pinned model
  (`modelNormalized`, `rewrittenAgents`). A parent session on another model (for example after a
  safety refusal) sets `modelMismatch` and status `error`. Subagent sessions record no model; the pin
  was checked by billing. Order: replicate-major, seeded shuffle of (task, arm) pairs (`--seed`); a
  budget stop skips whole later replicates when the next is projected to overshoot.

## opencode harness
A second harness runs the same tasks through `opencode run` on Amazon Bedrock. It has no vendor prompts of its
own to tune and reports real tokens and list-price USD instead of credits. One harness per run (`run` refuses
mixed arms, and `report` refuses a mixed directory); `compare` exits 2 across harnesses unless `--force`.
```bash
node bench/runner/bench.js run --suite lite --arms oc-vanilla,oc-v1.2.0,oc-main --out $OUT \
  --aws-creds-file ~/creds --aws-profile bench --budget-usd 5 [--effort high] [--repo-root DIR]
```
- Arms: `oc-vanilla` (empty config, no agent, built-in `build`), `oc-v1.2.0`, `oc-main` (local `origin/main`, no fetch).
  `opencode-ai@1.19.5` is installed with `npm --prefix <cache>/opencode-1.19.5` (scripts off, nothing global);
  version and binary sha256 go to run-config. `--opencode-bin PATH` overrides; `rg` must be on PATH or `--rg-bin`.
- Konductor arms install the ref's `claude` harness (`synth` + `install --harness claude`) into a scratch dir and
  translate it: tools list becomes a `permission` map, mux/cmux variants dropped, built-in agents disabled,
  101 skills (SOPs as `sop-<name>`) put in the scratch config. All of it lives in the scratch HOME, not the workspace.
- Permissions mirror each agent's `tools` list. The shipped orchestrator lists Write and Bash, so it may edit and run
  commands, as under kiro-cli `--trust-all-tools` (`@builtin`). `Agent(a, b)` limits `task` to a and b; Write/Edit
  both map to `edit` (opencode has one); Read adds `list`; unlisted tools and `question` are denied. Dropped: `Workflow`,
  `SendMessage`, `mcp__*`. Fidelity risk: prompts still name Claude tool names, skills load on demand (as with the
  kiro skills server) instead of being preloaded, and there is no MCP server. This is konductor content on a different runtime.
- `--effort` maps one to one to the opencode variant (`low|medium|high|xhigh|max`, default `high`). Subagents do
  not inherit the CLI variant (their sessions recorded `default`), so it is also written into every agent file;
  a session on another variant sets `variantMismatch`. `--title bench` is always passed: without it opencode makes an
  unmetered Haiku call for the session title.
- Credentials: `--aws-creds-file` is read-only input; only the named profile is copied to `<scratch HOME>/.aws`,
  `AWS_PROFILE`/`AWS_REGION=us-east-1` are set, the real `~/.aws` and the file itself are hidden in the namespace, and
  the copy is deleted when the agent exits and on any signal. Exact secret values are scrubbed from outputs
  (`credsRedacted`); `env.json` lists names only.
- Usage comes from the session database (`opencode db`), summed over the parent and every subagent session
  (stream and export carry the parent only). `tokens.total` = input + output + cache read + cache write;
  `costUsd` is list price (2 / 10 / 0.1 / 2.5 USD per M tokens for in / out / cache read / cache write on Sonnet 5.5).
  A timed-out run uses the rows present and sets `costCensored`. `credits` stays null. Flags: `usageMismatch`,
  `usageUnavailable`, `orphanSessions`, `variantMismatch`, `throttled`.
- Bedrock caches prompts for about 5 minutes, so a run started soon after another can read its cache: cost carries
  run-order noise (the seeded shuffle is kept). The model id, region, variant, version and start time are recorded.

## Claude Code harness
A third harness runs the same tasks through `claude -p` (Claude Code) on Amazon Bedrock, so a study can cross harness
(Kiro CLI, Claude Code) with konductor (off, on) on one model. Like opencode it is a USD cell: real tokens and the
list-price cost the stream reports, `credits` null. One harness per run; `compare` exits 2 across harnesses unless `--force`.
```bash
# credentials: export them in the shell that starts the bench (names below), then
node bench/runner/bench.js run --suite lite --arms cc-vanilla,cc-main --out $OUT \
  --budget-usd 5 [--run-budget-usd 1] [--aws-region us-east-1] (--claude-bin PATH | --claude-tools-dir DIR) [--repo-root DIR]
bash bench/scripts/claude-code-smoke.sh --profile NAME      # the checked first run; see "Smoke test" below
```
- Arms: `cc-vanilla` (empty config dir, no `--agent`), `cc-main`, `cc-name=<git ref>` (same grammar as `oc-`). A konductor arm is
  built from its own source tree, `synth`-ed, and installed with `konductor install --harness claude` into each run's scratch
  HOME (the install writes absolute paths, so it is repeated per run). It starts in `--agent konductor`. The ref must carry the
  dashed model pin (`model: claude-sonnet-5-5`) on every agent: a dotted pin is not a Bedrock id and sub-agent spawns fail, so
  the install is refused with that reason, as is any install that does not give exactly 11 agents.
- The binary: `--claude-bin PATH` (`BENCH_CLAUDE_BIN`), or the newest `<version>/claude` under `--claude-tools-dir DIR`
  (`BENCH_CLAUDE_TOOLS_DIR`). There is no default location. A launcher script is refused (the resolved file must be named
  `claude` and be at least 50 MB): a launcher can override the model, region and credentials, so a vanilla arm through it is
  not vanilla. Version, file name and sha256 go to run-config; a version other than the validated one logs a warning.
- Command: `claude -p PROMPT --output-format stream-json --verbose --model us.anthropic.claude-sonnet-5-5 --max-budget-usd N
  --permission-mode acceptEdits [--agent konductor] [--include-hook-events] --allowedTools Bash Edit Write Read`, stdin from
  `/dev/null`. `--max-budget-usd` is `--run-budget-usd` (default 5). `--effort`, `--stop-on`, `--max-tool-calls`,
  `--run-credit-limit`, `--aws-creds-file` and `--agent-engine` are refused for these arms; the effort level is not passed to
  claude, so results say `effort: default`. Multi-turn (autonomy) tasks are not supported yet and are refused when the run starts.
- Credentials come from the environment of the shell that starts the bench: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
  `AWS_SESSION_TOKEN`, for example from `aws configure export-credentials --format env`. They go to claude through its
  process environment only; no file is written. `AWS_PROFILE`, `AWS_DEFAULT_PROFILE`, `AWS_CONFIG_FILE` and
  `AWS_SHARED_CREDENTIALS_FILE` are never passed on: with a profile set, the SDK skips the exported keys and the run fails with
  `cloud_credential_error`. That failure is recorded as an infra error, not a model failure. Exact secret values are scrubbed
  from every output file; run-config and `env.json` list variable names only.
- Isolation: per run, `HOME` and `CLAUDE_CONFIG_DIR=<HOME>/.claude` are scratch, `<config>/rules/empty.md` is the only rules
  file (the invoking user's rules never load), telemetry, auto-update and error reporting are off. Built-in agents (`Explore`,
  `general-purpose`, `Plan`, ...) and skills exist even in the vanilla arm, so vanilla is not empty; run-config says so.
- Model identity: a run counts only if every `modelUsage[*].canonicalModel` and every assistant `message.model` (main agent and
  sub-agents, `<synthetic>` ignored) equals the canonical model of `--model` (`claude-sonnet-5-5` for
  `us.anthropic.claude-sonnet-5-5`). Anything else sets `modelMismatch`, status `error`, and the run is left out of the
  medians. The `modelUsage` keys are not compared: they legitimately differ between the main agent (profile id) and sub-agents.
- Cost and tokens: `costUsd` is `total_cost_usd` of the last `result` line, tokens are the sums of `modelUsage`
  (`costBasis: list`). A session that resumes after a background task prints a second `result` line; totals are cumulative, so
  the last is used and durations are summed. A run killed before its `result` line (timeout, SIGTERM, exit 143) has
  `costCensored: true`, `tokens` as a lower bound from the assistant messages seen, and `costUsd` null; the budget ledger then
  charges the arm median or the censored floor.
- Orchestration metrics: spawn count is `subagent_stats.spawned` (failed spawns included), depth comes from the
  `parent_tool_use_id` chain and `subagent_stats.max_depth`; review rounds and reworks read the `Agent` tool input and the
  sub-agent's notification summary. Skill loads are `Skill` tool calls and reads of a `SKILL.md`, in all sessions.
  `result.json` gains `claudeCode` (models seen, `modelUsage` keys, cost basis, hook events, permission denials, spawn counts,
  where the task directory landed). A denied tool call exits 0; it shows as the `permissionDenied` flag and a count. A result line with no `total_cost_usd` or `modelUsage` sets `costMissing` (the cost is null, not 0), and unparseable stream lines set `streamTruncated`.
- Cleanup: `TMPDIR` and `CLAUDE_CODE_TMPDIR` are both the run's own directory (run-config lists the variable names). Claude Code
  writes task output to `<tmp>/claude-<uid>/<cwd slug>/`; each run removes that directory under its temp directory and under the
  default temp directory (the slug is unique to the run, so parallel runs never touch each other). `claudeCode.tmpCleanup`
  records which one held it. Whether claude honors `CLAUDE_CODE_TMPDIR` is unverified until a run creates a task directory.
- Smoke test: `claude-code-smoke.sh` runs one vanilla and one delegating konductor task (about $0.2 to $0.5), checks the
  credentials under claude's exact environment first, prints PASS/FAIL per criterion (schema, success, cost > 0, one canonical
  model, at least one spawn and no failed spawn, 11 agents with the pin, no credential value in any output, nothing left in
  `/tmp/claude-<uid>` or the scratch directories) and removes what it made. `--dry-run` shows the plan without credentials.
  Two lines answer an open question: whether `claude` honors `TMPDIR` or `CLAUDE_CODE_TMPDIR` for `/tmp/claude-<uid>`, and
  whether sub-agents still start when isolation makes `/tmp` read-only. The `INFO` line says where the task directory was
  found (the run temp directory or the default one), or `no task directory was made` (expected for runs that only use
  Read/Write and a foreground sub-agent). The konductor task prints `delegation worked under isolation: yes` or `no`. If it says `no` under the
  default isolation, run the script again with `--isolate none`: a pass there and a fail here means the isolation is the cause;
  a fail in both is something else. Until the first run, treat both as unverified. Only this script removes its own
  `/tmp/claude-<uid>` entries; other Claude Code sessions' entries are left alone.
  - `--out DIR` copies the two result directories there before cleanup. DIR must not exist or be empty; a directory that
    already has files is refused with exit 2 (also with `--dry-run`), so a second run cannot nest into the first.
  - `--refresh-cmd CMD` (or `SMOKE_REFRESH_CMD`) is for expired credentials: when `aws configure export-credentials` fails, CMD
    runs once in your normal environment with the terminal attached (a login prompt can work), then the export is retried once.
    Use whatever refreshes your credentials, for example `--refresh-cmd '<your credentials refresh command>'`. It is skipped when
    credentials are already exported and with `--dry-run`. On a failed export the script prints the first line of the AWS CLI
    error (at most 200 characters, with key ids and values on secret or token lines redacted).
  - Leftover checks: files named `mcs-telemetry-*` in the scratch temp directory are written by host tooling that inherits
    `TMPDIR`, so they are not counted; any other file there fails. The credentials check looks for regular files named
    `credentials` or `.credentials.json` under the scratch HOME and temp directory; an `.aws` directory alone does not fail
    it, and the preflight sets `AWS_CLI_SESSION_ID_DISABLED=true` so the AWS CLI does not create session state there.
- Known gaps: `askedUser` is true only when the `AskUserQuestion` tool is called (the name is in the binary; no recorded stream
  has it), otherwise the final-text detector decides. Whether claude honors `TMPDIR` or `CLAUDE_CODE_TMPDIR` for `/tmp/claude-<uid>` is not
  verified (the smoke script reports it). The `global.` inference profile is untested (the default is `us.`). Only the `SessionStart` hook
  was seen under `-p`; the `--include-hook-events` flag is passed to konductor arms when the binary has it. The skill startup
  size (`startupResources`) is not measured for this harness.
- Where it plugs in (for reviewers): `runner/lib/harness/claude-code.js` and `claude-code-parse.js`; `harness/runtime.js`
  (`runtimeOf`, `isUsdRuntime`) and `harness/index.js`; `arms.js` (`cc-` prefix) and `profiles.js` (A/A repeat prefix);
  `run-cmd.js` (flags, guards, config, run-config record); `run-one.js` (post-run `cleanupRun`); `result.js` and
  `schema/result.schema.json` (`claudeCode`, harness enum, canonical model check); `skills.js` (Claude load extractor);
  `orch-metrics.js` (accepts a spawn tree); `report/aggregate.js` (`BASIS`, baseline), `report/render.js`, `report/compare.js`;
  `report/load.js` and `report/orchpass.js` (`cellKeyOf`) needed no change. The credit meter and early-stop watcher read kiro-cli
  and opencode events only, so their flags are refused here.

## 2x2 pilot
A small pilot of the question "does konductor help, and does the answer depend on the harness?": Kiro CLI and Claude Code,
each vanilla and with konductor, on one model, judged by one panel. The design, units and limits are in
[PILOT-2X2.md](PILOT-2X2.md). One repetition of five lite tasks in four cells is 20 runs. It measures what each cell costs
and checks the whole pipeline; with n=1 per task the table is descriptive, not a test.

```bash
# 1. Look at the plan. Reads no credentials, starts nothing.
bash bench/scripts/pilot-2x2.sh --dry-run --profile NAME --budget-usd CEILING --kiro-credit-limit N \
  --claude-tools-dir DIR --out /var/tmp/pilot-2x2
# 2. Run it, from your own terminal. Rerun the same command to resume.
bash bench/scripts/pilot-2x2.sh --profile NAME --budget-usd CEILING --kiro-credit-limit N \
  --claude-tools-dir DIR --out /var/tmp/pilot-2x2
# 3. Only the table, from finished and judged cells
bash bench/scripts/pilot-2x2.sh --cells report --out /var/tmp/pilot-2x2
```
- Sequence: `kiro-konductor`, `kiro-vanilla`, `cc-konductor`, `cc-vanilla` (the konductor cell goes first so a refused install stops before the other cell spends), then rubric judging of each directory with
  `gpt-5.6-luna`, `deepseek-3.2` and `glm-5` through opencode, then `report-2x2`. `--cells kiro|cc|judge|report` runs one part.
- Budgets have no default. `--budget-usd` is the USD ceiling for the Claude Code runs and the judging together: Claude Code
  runs stop starting at 90% of it and the rest is held for judging. `--kiro-credit-limit` is the credit limit of one Kiro run (the
  runner's `--run-credit-limit`). `--run-budget-usd` caps one Claude Code run (default 1.5); a run gets the smaller of that and the allowance left, none starts
  with less than USD 0.05 left, and claude checks its cap between turns, so the last run can pass the allowance by up to one turn.
- Cost: the figures below are the inputs for choosing the ceiling, not a forecast. Measured earlier on other tasks: Kiro runs
  averaged 1.74 credits for vanilla (50 runs) and 4.44 for konductor (25 runs; the longest run 14.6 credits); the
  Claude Code smoke runs cost about USD 0.044 vanilla and USD 0.185 with konductor on trivial tasks; rubric judging cost about
  USD 0.009 per run. The Claude Code cost on the five real tasks has not been measured. The pilot exists to measure it.
- Resume: each (cell, task) is its own `bench.js run` under `OUT/cells/<cell>/<task>`. Finished tasks are skipped. An
  unfinished, interrupted or infra-errored directory is moved to `OUT/incomplete/` and rerun; nothing is deleted. `--out` must
  be empty or the output of this script with the same `--tasks`, `--reps`, `--seed` and commit; it cannot sit inside another
  pilot output or the checkout.
- Credentials: AWS keys come from `--profile` (exported with `aws configure export-credentials`; `--refresh-cmd CMD` runs once
  if that fails) or from the three `AWS_*` variables already in the shell. Claude Code gets them through its environment.
  Judging gets a mode 0600 credentials file in the scratch directory, removed when judging ends or the script exits. Nothing
  is printed, put on a command line or written under `OUT`. Kiro runs get no AWS keys.
- Table: `bench.js report-2x2 --kiro-vanilla DIR --kiro-konductor DIR --cc-vanilla DIR --cc-konductor DIR [--out DIR] [--json]`
  (each flag takes one or more comma-separated judged run directories; `--out` also writes `charts/quality-by-cell.svg`, `konductor-effect.svg` and `cost-ratio.svg`, linked from the markdown, described in [PILOT-2X2.md](PILOT-2X2.md#charts)). It refuses cells with different tasks, judge panel,
  rubric revision, model, konductor commit (a mismatch, a missing commit, or more than one in a cell), a run judged by only part of the panel, or cost unit. It prints quality per task and cell, the five contrasts, the
  konductor over vanilla cost ratio inside each harness, success, timeouts, delegation and model identity. Intervals appear
  only with 5 or more tasks of 2 or more replicates per cell (`--reps 2` or more).
- Paste back: `OUT/report/factorial-2x2.md` (its charts are in `OUT/report/charts/`), the spend table the script prints at the end, and the `NOT DONE` list if there is one.
  `OUT/logs/` holds the runner output; it carries no credentials.
- Not covered: autonomy tasks (Claude Code refuses them), the pairwise judge mode, and any statistics at n=1.

## Skills actually used
Which skills and SOPs a run loaded is read after the fact from `stream.jsonl`; nothing is added to the runs (no hooks, no
extra servers, no config change). New runs write these `result.json` fields (all nullable): `skillsLoaded`
(`{name, via: get_skill|skill-tool|disclose_context, count}`), `skillQueries` (strings passed to `find_skills`), `sopsLoaded` (the SOP subset),
`skillBytesLoaded` (bytes of text the load calls returned), `skillCallsFailed` (errors, empty results, calls with no answer),
`skillCallsFailedByTool` (the same count split as `{get_skill, load_resource, find_skills}`; the opencode and Claude Code skill tool counts under `get_skill`),
`findSkillsCalls`/`findSkillsEmpty`, `startupResourceCount`, `targetLoaded`, `targetAttempted`, `targetReachable`, `sopNameSource`
and `skillsScope`. `report` appends a "Skills actually used" section when any run has them.
```bash
node bench/runner/bench.js skills --run $OUT [--bench-dir DIR] [--repo-root DIR] [--json]   # read-only, any run dir
```
- kiro-cli: calls of the `konductor-skills` server in all sessions, subagents included. opencode: the `skill` tool in the parent
  session only (`skillsScope: parent-session`); subagent sessions are not in the stream.
- SOP names: a listing of the arm's `agent-sops/`, else the installed agent's `--agent-sop-filter`, else the `sop-`/`k-`/`kiro-`
  convention (`sopNameSource`). `targetLoaded` is null for vanilla arms and for targets that are agents, not skills or SOPs.
  `targetReachable` says whether the arm exposes the target to a tool call: kiro-cli serves SOPs as prompts only and limits
  `get_skill` to `--skill-name-filter`, so `targetLoaded` can be false by construction.
- `startupResources` (run-config, per arm) lists what loads at spawn without a tool call, with sizes: kiro-cli prompt and
  `resources` of the installed agent (rule files included); opencode primary agent file and the skill index (names and
  descriptions). Vanilla gets the built-in agent, best effort and unsized. `skills` on an old run sizes rule files from `--repo-root`.
- Limits: a load is a call that returned text; reading a `SKILL.md` with the file tool is not counted; bytes include JSON framing.

## Skill evaluation scenarios

`bench/skilleval/skilleval.js` turns one skill into a frozen set of text-only bench tasks, so a skill can be tested for the effect of its rules instead of its name. Every model call is cached on disk under `bench/skilleval/<skill>/cache/` by prompt hash (reruns cost nothing and need no credentials) and total spend is capped by `--budget-usd` (default 3).
```bash
S=test-coverage-analysis
node bench/skilleval/skilleval.js extract   --skill $S --ref GITREF [--repo DIR | --skill-file FILE] [--count 12] [--chunk-chars 72000]
node bench/skilleval/skilleval.js vote      --skill $S [--judges a,b,c] [--decisions FILE]
node bench/skilleval/skilleval.js scenarios --skill $S --domain "software testing" [--max 20]
node bench/skilleval/skilleval.js check     --skill $S
node bench/skilleval/skilleval.js freeze    --skill $S [--noise-margin 0.05]
node bench/skilleval/skilleval.js verify    --skill $S
node bench/skilleval/skilleval.js emit      --skill $S
```
Model calls use the opencode and Bedrock judge backend (`--opencode-bin`, `--aws-creds-file`, `--aws-profile`, `--aws-region`, as for `judge`). Outputs go to `bench/skilleval/<skill>/`.
- `extract`: about 12 rules from `SKILL.md`, each an observable property of a written answer, with a quoted source line (a script checks the quote is in the file; failures are listed in `rejected`) and a tag `useful`, `generic` or `style`. A `SKILL.md` longer than `--chunk-chars` (default 72000) is split at headings into equal parts, each part is asked for its share of the rules plus one, quotes are checked against the whole file, and the merged rules are cut to `--count` (taking turns across parts) and numbered in source order. Writes `rules.json`.
- `vote`: three judges (default `gpt-5.6-luna,deepseek-3.2,glm-5`) see one rule and a request type, never the skill name or text. A rule survives with at least 2 worth votes and fewer than 2 style-only votes. Writes `votes.json`, `survivors.json` and `flagged.md` (split worth votes, any style vote, style tag, judge errors). `rule-table.md` lists every rule with its bucket and status. `owner-decisions.json` overrides the vote on the next run: `{"R03": "keep", "R07": "drop", "R09": {"decision": "keep", "bucket": "format"}}`. A kept rule is a `value` rule unless the owner buckets it `format`; a format rule gets no scenario of its own and its rubric items go in the format bucket.
- `scenarios`: a model (default `glm-5`) writes up to `--max` requests in three kinds: rule scenarios (about 50 percent, the rule matters and is not stated), skill-blind scenarios (30 percent, written from the one-line description and `--domain` only) and near-miss requests (20 percent, related but the skill should not apply). Scripts reject skill vocabulary (a stoplist built from the skill name, headings, bold and code spans), requests for a saved file or a command, konductor procedure names and near-duplicates; one repair round asks again for the shortfall. Fewer scenarios than the cap is a normal result. A second model call per scenario writes 4 to 6 rubric items, bucketed value, guard and format (near-miss: guard only, expectation "skill not loaded"). Writes `scenarios.json` and `rubric.json`. Each rubric is checked against its request: a count that contradicts the request (for example "4 e2e" when the request lists 2 e2e tests, or a total that is not the sum of the lists), a total that is not the sum of its parts, or a rule id in an item is an error, and the model is asked once to rewrite only the flagged items (the other items are kept as they were); a rubric still in error is dropped. Numbers and names that the request and the rules do not contain are warnings, stored per item in `rubric.json` and not blocking. `check` runs the same test on the stored files with no model call and exits 1 on any error. Rubric facts written by a model still need a human read before the freeze.
- `freeze`: writes `freeze.json` with the sha256 of `survivors.json`, `scenarios.json`, `rubric.json` and `thresholds.json` (created from `thresholds.default.json`: gain interval low end above 0, positive mean on the second batch, no quality loss beyond `noiseMargin`, default 0.05 and provisional; expert check and layout swap are report-only). Later `extract`, `vote` and `scenarios` runs refuse; `verify` re-hashes and exits 1 on any change.
- `emit`: one task per scenario in `<skill>/tasks/` (class `simple`, no checks, timeout 300, prompt only, bucket weights value 3, guard 2, format 1), the suite `bench/suites/skilleval-<skill>.json` (arms `vanilla,main`), `oracle-manifest.json` and `expectations.json`.
```bash
node bench/runner/bench.js run --suite skilleval-$S --arms vanilla,natural=GITSHA,oracle=GITSHA --oracle-skills oracle \
  --oracle-manifest bench/skilleval/$S/oracle-manifest.json --budget-credits N --out $OUT
```
The oracle arm puts the skill body in front of every prompt, near-miss tasks included, which measures the cost of applying the skill where it should not apply; `expectations.json` records that the natural path should not load the skill for them. Tests: `node --test bench/skilleval/test/`.

### Tasks from the committed skill eval data

`bench/skilleval/import.js` builds tasks and trigger queries on demand from `bench/skill-evals/skills/<skill>/`, with no model call. The data is written by a model (skill-creator style, two cases per behavior), so treat results from it as supporting evidence. The skills themselves come from the git ref of each arm; a skill whose `skills/<name>/SKILL.md` is not in `--ref` is skipped.

```bash
node bench/skilleval/import.js tasks   --skill NAME[,NAME]|all --ref GITREF --out DIR [--include-limited] [--suites-dir DIR]
node bench/skilleval/import.js queries --skill NAME --out FILE        # then: bench.js cap import --cap skill:NAME --from FILE
node bench/skilleval/import.js report  --ref GITREF [--skill NAME[,NAME]]
node bench/tasks/validate-tasks.js --only-extra --extra-tasks DIR/NAME/tasks
```

`tasks` writes `DIR/<skill>/tasks/*.json` with fixtures flattened to one name (`fx-<skill>-<sub>`) and `<fixture>.KEY.md` renamed to `.bench-answer-key.md`, the suite `skilleval-import-<skill>.json` (in `DIR/<skill>/suites/`, or `--suites-dir bench/suites` to register it), `oracle-manifest.json`, and `provenance.json` (source, skill, scenario and eval ids, tags, content hash; the task schema takes no extra fields). A scenario task takes its rubric from the criteria (value bucket, weight 3; restraint items and checks that cannot be machine-checked become guard items, weight 2; the pass anchor is kept only when short) and its checks from `floor_checks` plus the `scripted_checks` of an eval case that repeats the scenario. Eval cases that do not repeat a scenario get their own task, tagged `eval-only`. Shell checks become `file_exists`, `contains`, `not_contains` or `cmd` checks; a check that needs python3, git, a checksum tool or another non-POSIX tool becomes a rubric item. A prompt that forbids edits gets a `fixture_unchanged` guard. Tasks are skipped when the prompt names a konductor procedure, or when the fixture needs a `setup.sh` (the task schema has no setup command). The five `limited` skills are held back unless `--include-limited`. Tests: `node --test bench/skilleval/test/import.test.js`.

`bench.js run --suites-dir DIR` looks for the suite file `DIR/<suite>.json` first and then in `bench/suites` (or `<bench-dir>/suites`), so a generated `skilleval-import-<skill>` suite can stay outside the checkout: write it with `import.js tasks --suites-dir DIR` and pass the same `DIR` to `run`, together with `--extra-tasks DIR/<skill>/tasks` (or rely on the suite file's own `extraTasks`). The flag is only on `run`; `judge`, `report` and the other commands read the tasks from the run directory and `--extra-tasks`, not from a suite file. A missing `DIR` or a suite found in neither place is an error that names the directories searched. The run configuration records the directory and the suite file used.

## Isolation, environment, safety
- Each run gets a scratch HOME and a fresh cwd under `/tmp/w-<random>/`, with a copy of the auth
  database (kiro-cli's `~/Library/Application Support/kiro-cli` on macOS, `~/.local/share/kiro-cli`
  elsewhere, copied to the same place under the scratch HOME) that is deleted when the agent exits. The agent and the check commands get an allowlisted
  environment (PATH, locale, proxies, TERM=dumb, TMPDIR, pins); `--env-keep` adds Kiro variables.
  Mandatory-MCP variables are never passed. `env.json` lists the final variable names.
- The arm build (cargo on the ref under test) also gets an allowlisted environment: PATH, locale, TERM, toolchain variables (CC, CFLAGS, LDFLAGS,
  LD_LIBRARY_PATH, PKG_CONFIG_PATH, RUSTFLAGS and similar) and, for `--cargo-online` only, the proxy variables. Cloud, forge, registry and agent
  credentials and the SSH agent are not passed. HOME is a scratch directory removed after the build; CARGO_HOME and RUSTUP_HOME point at the real
  ones so an offline build finds its crates. `BENCH_BUILD_ENV_KEEP=NAME,NAME` adds more variables; a credential-looking name is refused.
  Residual risk: a build script of an arbitrary ref still runs as you and can read any file you can read, including the real CARGO_HOME. Build only
  refs you trust, or build on a host with nothing in that account to lose.
- `run` records `env.json` with the interpreter versions (node, python3, python, pytest). `tasks/toolchain/pins.json` lists the versions the checks
  were validated with; a mismatch is logged and kept in `run-config.json` as `toolchainCheck`, and never fails the run.
- `--isolate auto` (default) uses `unshare --user --map-root-user --mount --pid --fork --kill-child`
  and aborts when the probe fails; `--isolate none` is the explicit opt-out. Inside: the real home,
  /tmp, /var/tmp and /dev/shm are read-only and only the run's scratch root is writable. Hidden (empty
  tmpfs for directories, /dev/null for files): `.aws .ssh .gnupg .kiro .konductor .claude .claude.json
  .config .docker .git-credentials .netrc .npmrc .pypirc`, shell and REPL history files, the kiro auth
  database, container-runtime sockets (docker, containerd, podman), `/tmp/ssh-*`, `/run/user/<uid>`,
  user-writable trees outside the home (hidden, or read-only if a PATH tool lives there), the bench
  `fixtures`, `tasks/solutions`, `tasks/stubs`, `tasks/hidden`, `tasks/partials`, every answer key and the output directory. Capabilities
  are emptied after setup (`setpriv`, no-new-privs), so the agent cannot remount or unmount anything.
- Also hidden by default, on top of that list: the single-sign-on cookie and token directories, `.gitconfig`,
  `.cargo/credentials*` (the files only: `.cargo/bin`, `.rustup`, `.cache` and the language toolchains stay
  readable), and the cloud-CLI and password-store credentials `.kube .azure .oci .vault-token .pgpass .my.cnf
  .s3cfg .boto .password-store .gem/credentials .terraform.d/credentials.tfrc.json .local/share/keyrings`.
  `--no-default-hide` (or env `BENCH_NO_DEFAULT_HIDE=1`) turns off only this added set; the list above and
  `--hide` extras are unaffected. `run-config.json` records `isolation.hideInHome` (the effective list, empty
  with `--isolate none`), `isolation.hide` (extras) and `isolation.defaultHide`.
- Site-specific cookie or token paths: `--hide PATH,..` or env `BENCH_HIDE_EXTRA=a,b` (names relative
  to the home, or absolute; files and directories). Not network isolated: the agent can reach any host
  the machine can, and sibling runs' scratch dirs stay readable when `--parallel` is above 1.
- macOS has no `unshare`, so there `--isolate auto` picks `--isolate sandbox-exec` and aborts when its
  probe fails. The runner wraps each command in `sandbox-exec -p <profile>` with a profile generated per
  run: writes to the real home (also through `/System/Volumes/Data`), `/tmp`, `/var/tmp`, the user temp
  dir and user-writable trees (including a user-writable `/usr/local`, as Intel Homebrew leaves it) are
  denied, except `~/Library` (system frameworks write caches and keychains there, but the dirs macOS runs
  code from, `LaunchAgents`, `Services`, `Scripts`, `QuickLook` and similar, stay denied) and the run's
  scratch root. The probe checks that scratch is writable, the home and temp dir are not, and a masked
  file cannot be read. The child's `stream.jsonl` and `stderr.txt` are written under the scratch root
  (`<run>/stdio/`) while it runs and moved into the out dir when it exits: the out dir is masked, and
  sandbox-exec denies even `fstat` on a descriptor whose file sits under a masked path, which made
  the v3 engine's node abort at startup. The same
  hidden paths and masks as above are denied for reading, writing and Unix-socket connects (a denied
  read fails with "Operation not permitted" instead of showing an empty directory), plus the kiro-cli
  auth database under `~/Library/Application Support/kiro-cli` and launchd's per-session sockets under
  `/var/run/com.apple.launchd.*` (where `SSH_AUTH_SOCK` points), and the user's keychains under
  `~/Library/Keychains`. `open`, `osascript`, `launchctl`, `security` and `git-credential-osxkeychain`
  cannot run, so items whose ACL trusts those tools cannot be read without a prompt. Capabilities and the pid namespace have no equivalent, so a process the agent detaches
  with `setsid` can outlive the run. launchd stays reachable over Mach, and jobs it starts run outside
  the sandbox, so a program that submits a job without `launchctl` can still run code outside the
  sandbox, including writing a login item. securityd is also reachable over Mach, so a program
  that calls the Security framework directly can still ask for keychain items; items that do not
  trust it prompt the user, and an unattended run has no one to approve. Offline checks deny outbound connections except to localhost.
- Every `konductor` CLI call (synth, install) runs with a scratch HOME and the allowlisted environment,
  and refuses to start with the real HOME, so `~/.konductor/installs` and `~/.konductor/logs` are never written.
- Tripwire (always on): after each run the real HOME (depth 3), the repository and `--tripwire-dir` are
  scanned for entries newer than a marker. Hits go to `homeTripwireHits`. The `homeTripwire` flag is
  raised for any hit with `--isolate none`, for hits in the `~/Library` dirs macOS runs code from
  (`LaunchAgents`, `Services`, `Scripts`, `QuickLook` and similar) with `--isolate sandbox-exec`
  (system processes write elsewhere in `~/Library` all the time), and never with `--isolate unshare`, where a hit is another process (an IDE).
  A hit on a credentials path (`.aws`, `credentials`, `.credentials.json`) prints a note on stderr: the run's scratch HOME hides
  those paths, so the hit may come from a credentials refresh in another shell.
  With `none` or `sandbox-exec`, a scan that stops at its entry cap raises `homeTripwireTruncated`.
- SIGINT/SIGTERM/SIGHUP kills every agent group, removes scratch dirs and auth copies, writes
  `summary.json` with `interrupted`, and exits non-zero. The judge phase does the same for its calls.

## Metrics notes
- A run that times out or dies before its final metering event has unobserved spend: `creditsCensored`
  is true and `creditsLowerBound` is the known floor. The budget guard charges such a run the median of
  the arm's completed runs, or `--censored-floor` (default 1.0), stored as `creditsCharged`; reports use
  that value, never 0. Failure rates sit beside every cost figure. `turnDurationMs` is null without
  a `runFinished` event.
- Engine v3 reports credits only at turn end (a `turn_completion` summary in the stream), never before. A single prompt is one turn, sub-agents
  included, and the summary is written a few lines before `runFinished`. In four saved runs (8 to 15 minutes, 15.4 to 29.4 credits) it was the only
  credit event; the session log's `usage_summary` is written at the same instant, and `context_usage` events carry context-window tokens, not spend.
  So the live total stays at 0 until a run finishes, and `--run-credit-limit` cannot stop a one-shot v3 run (see the limit's contract below;
  `--budget-credits` still stops new runs between runs). A killed or timed-out run has no credit data at all: it is censored, with a lower bound of 0. The summary also lists the tools the
  sub-agents used, so it appears to cover their spend (seen on one coordinator run). `modelCalls.meteringEntries` counts turns on v3, not model calls. v3 names a tool call by title, so tool names are mapped from the titles in `lib/stream.js` and unmapped
  titles count as `unknown`; a sub-agent call is "Sub-agent: <name>" with the target in `rawInput.name`.
- `backfill --run DIR [--credits] [--skills] [--write]` repairs v3 runs saved before the runner could read this, from each `stream.jsonl` with
  the runner's own parsers. DIR is one cell (`<study>/claude`). It is a dry run without `--write`. Run it after the cell finishes. Repeating it
  changes nothing. `--credits` is the default when no mode flag is given; `--skills` adds the skill pass, and both flags run both passes, credits first.
  - Credits: recomputes credits, turn duration, tool names and the spawn metrics. `--write` keeps `result.json.pre-backfill`, adds `creditsBackfill`, and
    appends a `backfill` line to `credit-ledger.jsonl` (earlier lines are never edited). A timed-out or killed run stays censored; the dry run flags one
    whose `result.json` also lacks the spawns its stream shows.
  - Skills: recomputes the skill fields (`skillsLoaded`, `skillCallsFailed`, `targetLoaded` and the rest of `SKILL_FIELDS`) and `capInvocation`, which the
    orchestrator pass rule and the cap reports read. It prints skill loads per arm before and after. `--write` keeps `result.json.pre-skills-backfill`
    (a separate name, so a copy from the credit pass is never touched) and adds `skillsBackfill`. A killed or timed-out run is included, because its skill
    calls are in the stream even though its turn never ended; no credit field is touched. A run with no stream, a task missing from `--bench-dir`, a
    budget skip or an opencode run is skipped. `--bench-dir` and `--repo-root` work as for `skills`. A run whose copy exists and differs is refused.
- Skill loads on engine v3: a loaded skills-server call is titled `@konductor-skills/get_skill` with the name in `rawInput.arguments.name`. A call
  made before the tool was loaded is refused (`Tool Call` failed, or a bare `get_skill` title with no input) and counts in `skillCallsFailed`, never as a
  load; the model then loads the tool and retries. A refused `load_resource` call with a `skill::<name>` id, the model treating a server skill as a
  native resource, also counts in `skillCallsFailed` (under `load_resource` in `skillCallsFailedByTool`) and names the skill as requested. The
  extraction's `failedCalls` lists each failed `get_skill` or `load_resource` call, and names a bare call the stream recorded no arguments for
  `(args not recorded)`. A refused `load_resource` is also the run's first decision, as a refused `get_skill` is (`firstDecision.kind` is
  `get_skill`), so a run whose only attempt was refused is not `none`. `--stop-on` ignores refused calls too. The skill fields in `result.json` are written when the run
  ends, so runs saved by an older runner keep empty `skillsLoaded`; `bench.js skills` recomputes from `stream.jsonl` without writing, `backfill --skills` writes the recomputed fields, and `report` reads `result.json`.
- SOP activations on engine v3: a successful `skill::sop-<name>` load is not a `load_resource` call in the stream. It is titled
  `Load skill: sop-<name>` (`Loaded skill:` when it finishes) with `_meta.kiro.toolId` `disclose_context`, and the answer carries
  `contentLength`. It counts as a load with `via: disclose_context` in `skillsLoaded` and `sopsLoaded`, sets `targetLoaded` and
  `targetAttempted`, and is the first decision (`skill`) when it comes first. A denied or empty one counts as a failed `load_resource` call.
  Tool counts do not change (`toolNameOf` still returns null for this call). Runs saved before this existed keep their numbers until
  `bench.js skills --run` recomputes them or `backfill --skills` writes them; `backfill --skills` leaves a result unchanged when it
  recorded no failed skill calls and nothing else differs, so it does not rewrite old runs just to add a split of zeros. `report` tables are
  unchanged. `trace` adds a `failed skill calls` line, and `skillCallsFailedByTool` in the JSON header, when the run recorded any.
- `workToolCalls` leaves out the `subagent` call and the subagent `summary` pseudo-tool. Transcript
  size sums the parent and subagent sessions (`transcriptPartial` if one is missing). Session files are copied to `<run>/session/`
  from the run's scratch home: engine v2 writes `~/.kiro/sessions/cli/<id>.json` and `.jsonl`; engine v3 (kiro-cli 3.x) writes
  `~/.kiro/sessions/<workspace hash>/sess_<id>/` with `session.json`, `messages.jsonl` and `sub-executions/<id>.jsonl`, copied to `session/sess_<id>/`.
  Before this was handled, v3 runs copied nothing and fell back to the size of `stream.jsonl`, so every v3 run read `transcriptPartial`; runs saved by
  that runner keep the flag and have no `session/` directory. The copy skips symlinks and special files, replaces the user's home path with
  `<host-home>`, and the run's credential scrub covers it. Other metering
  units are flagged. `askedUser` marks a final message that ends with a question, asks for approval,
  or stops for a reason other than `end_turn`. `streamModel` is the model the session's model setting held in an engine v3 stream (the setting starts at `auto`, then
  holds the pinned model); the diligence scorecard counts it, beside the session file's model and agent files rewritten to the pin, as a record of the model. It shows the
  model the session was set to, not which model served each request. A kiro-cli run without konductor has no agent file to rewrite and, before session files were saved, no
  session model, so its pin could not be checked; runs saved before `streamModel` existed still read as unverified, and the scorecard says how many have no model record. `skillsMcpOk` records whether a `konductor-skills` call
  succeeded; konductor arms run with `--require-mcp-startup`.
- A post-run failure keeps the run's credits and sets `infraError`; a socket or FIFO in the workspace is
  skipped by the snapshot. The cwd must hold no answer key. Checks: `file_exists`, `contains`,
  `not_contains` (flags `im`), `min_matches`, `labelled_findings`, `fixture_unchanged`, `cmd` (`sh -c`), one shared matcher.
- `recheck --run DIR` re-evaluates the current task checks against each run's saved `workspace/` (in a
  scratch copy) and rewrites only the check fields of `result.json`: `checks`, `checksAllPassed`,
  `checksRevision`, `checksRecheckedAt`; the first results stay in `checksOriginal`. Repeating it changes
  nothing until the task's checks change. `stream.jsonl` and credit fields are never touched. The report's
  "pass" then uses the rechecked results and says so. Judge bundles keep showing `checksOriginal`, so
  cached judge calls stay valid.

## Judging
- Judges run as a separate headless `kiro-cli chat --no-interactive --trust-tools=` call in their own
  scratch HOME and empty cwd, inside the same read-only namespace as the agent (`--isolate`, `--hide`).
  `--kiro-bin PATH` picks the binary; each call's raw stream is kept in `<out>/judge/raw/`.
- Judges come from `--judges`, else the suite file, else `gpt-5.6-luna`, `deepseek-3.2`, `glm-5`
  (`qwen3-coder-next`, `minimax-m2.5` also work). The judge phase refuses fewer than 3 model families
  unless `--allow-small-panel` (recorded in `judgments.json`, flagged in the report). One judge per
  family; Claude models and the subject model's family are refused.
- A judge sees the task, rubric, the fixture's `.bench-answer-key.md` and one output bundle: final text,
  files changed versus the fixture (`.kiro/specs/**` included; only tool state is skipped), check
  results. Never the transcript, tool calls or arm names. Arm-revealing phrases (agent and tool
  names, skill, SOP, steering, maker-checker, delegation, versions) are deleted, not replaced by a
  marker; deliverable paths stay. `--redact-file` adds rules; the rules that fired are recorded.
- Rubric mode scores each criterion pass/partial/fail (1/0.5/0, weighted, 0..1). A verdict whose evidence quote is not found in the
  output drops one level (`evidenceDowngraded`); "(nothing in the output)" counts as not found. Each criterion records `verdictRaw` (the judge's)
  and `verdictScored`; each record has `score` and `scoreRaw`, and the report shows both per judge plus the share of quotes
  not found. Records carry a `taskRevision` (hash of prompt, rubric and answer key); records made against
  an older wording are left out of the report and listed. A unit skipped by `--budget-credits` never
  replaces an earlier result, and rubric calls run before pairwise calls so a cap covers every judge first. Pairwise mode
  compares each arm with the baseline twice with A/B swapped; disagreement is a tie (`positionInconsistent`).
- Evidence-quote rule. Two rules decide whether a quote is found, and every report names the one it used on its first lines.
  - **Lenient (the default, tightened).** The rule compares words only: punctuation, table pipes, list markers, escapes and ellipses are ignored. A quote cut into pieces and joined by spaces, new lines or ellipses is accepted when the pieces appear in the output in order, no unfound stretch has 20 or more letters, and the found pieces carry at least 60% of the quote's letters. A verbatim quoted span of 40 or more letters inside the judge's prose is also accepted. The tightening: whichever way a quote was accepted, it is rejected when 20 or more of its letters are unsupported, meaning outside every stretch of 20 letters or more that the output holds (looked up anywhere in the output, order ignored). A word that is in the output only inside a shorter stretch counts as unsupported, which is the stricter reading. 19 unsupported letters are accepted. Because punctuation is ignored, a quote that differs only in an operator (`qty < 0` for `qty > 0`) is still accepted; a scan of the 304 saved verdicts that only the lenient rule accepted found no such case.
  - **Strict.** Every non-trivial segment between `...` or the ellipsis character must appear in the output, in order, ignoring case, whitespace, quote marks and markdown emphasis. This was the default before. Select it with `"quotes": "strict"` in a scoring file (`profiles/scoring-strict-quotes.json` has the default weights), or `judge --quote-match strict` for the fields older readers use.
  - **Both views are recorded.** `judge` applies both rules to every criterion and writes `verdictStrict`, `verdictLenient` and `quoteFound` (`{ strict, lenient }`) beside the older fields, plus `scoreStrict` and `scoreLenient` on the record. The older fields (`verdict`, `evidenceFound`, `score`) hold the default rule's values, so a reader that knows nothing of the new fields still works. A report switches views by reading these fields; it needs no rescoring pass and no extra file. For judgments made before this change (strict as stored), `report` builds the lenient view in memory from the saved output when the run directory still holds its workspace; otherwise that record stays strict and the page says "strict only: lenient view needs judge --rescore-quotes". Nothing is written either way.
  - **Old reports are not directly comparable.** Reports made before lenient became the default are strict. On the root-cause study the lenient rule raised the rubric by 0.04 to 0.26 per cell against strict, so read an old report with `profiles/scoring-strict-quotes.json` when you compare it with a new one. The strict profile reproduces the earlier numbers; only the added rule line and sensitivity tables differ on the page. This change of default is intended and moves every default output.
  - **Sensitivity.** Every full report has a "Quote-rule sensitivity" section: per judge, the share of criteria lowered under the rule in use and under the other; per arm, mean rubric and quality under both with the rank under each and flips marked; and one warning line when the arm order differs. `report --verdict platform` and `--verdict orchestrator-pass` score with the rule in use and add a "Sensitivity" block with the call, the quality difference with its interval and the A/A band under the other rule, marked "same call" or "DIFFERENT CALL". `contrast` and `report-2x2` carry the same line and a table. The diligence scorecard's judge agreement row shows the share of quotes lowered per judge under the rule in use with the strict share beside it.
  - **The quality-pack pass is always strict.** Its prompt asks for exact text and its own quote checks (including quotes from the answer key) were built for it, so it does not use the lenient rule. Its tables say "quality pack quotes: strict". `judge --criteria-pack` refuses `--quote-match`.
  - **`judge --run DIR --rescore-quotes`** still works for old judgments: it matches the stored quotes again with no model call, applies the tightened rule, and writes `judgments-lenient.json` beside `judgments.json` (which it never changes), then prints the share of verdicts lowered per judge and the mean rubric per arm before and after. Reports no longer read that file. `--quote-match strict` with it only checks that the strict rule reproduces the stored values.
- Runs with `infraError` or no kept workspace are not judged; they are listed in `notJudged`.
- Replies must be strict JSON; one retry, then `judgeError` is recorded. Results are cached by hash of
  (judge, prompt) in `<out>/judge/cache`. `spentCredits` and `spentByJudge` add up over invocations;
  a cached call costs 0 and keeps its original latency with `cached: true`. Only a reply that passes the same check
  (valid JSON, right shape) is cached. A stored reply that fails it is not replayed: the judge is asked again and the old file is
  kept as `<key>.rejected.json`.
- `--mode graded` asks the judge to grade both responses of a pair 1 to 5, once with the baseline in position A and once with it in B. A record keeps the mean grades, the
  difference, and `orderDisagreement` (one order favored the arm, the other the baseline). The report lists the disagreement rate; above 25% it says the judges follow position.
  Graded grades are shown beside the quality score and never feed it, so `scoring.json` still decides quality.
- Other flags: `--mode rubric,pairwise,graded`, `--profile`, `--concurrency 2`, `--budget-credits X` (per invocation; stops new calls at 90%), `--max-file-chars`,
  `--max-bundle-chars`, `--judge-cmd CMD` (test double: prompt on stdin, reply on stdout), `--auth-db`.
  `--judge-backend kiro|opencode` picks the program that asks the models (see "Judge backends" below).
- Plan first. `judge --run DIR ... --plan` works in every mode (rubric, pairwise, graded, and `--criteria-pack`). It prints the backend, the panel, the number of calls per mode, how many the cache already holds, and an estimated spend. Then it stops: no model is called, no login or credentials file is read, and nothing is written. The estimate prints a low figure (the mean cost per call) and a high figure (every call at its p90, an upper bound), and names its source. The source is the earlier judging in that directory when there is any (the high figure then scales that mean by the observed p90 to mean ratio), else `profiles/judge-cost-observed.json`: spend per call measured by backend, judge and pass (rubric, pairwise, graded, pack) over about 15,000 live opencode calls and 171 live kiro calls, with the share of failed calls that were asked again included. Cached calls cost nothing and are not in the means. The kiro entries are credits and have no p90, so a kiro plan prints one figure; opencode entries are USD. A judge with no entry of its own uses the pooled figure for that pass. The estimate says unknown only when the data file is missing or has nothing for the backend. A real pass prints the backend and the panel on stderr before its first call. Without `--plan`, `--mode` and the other flags decide what runs, so check the plan's call count before a pass on the default backend.

### Judge backends
`--judge-backend kiro` (the default) asks the panel through kiro-cli. `--judge-backend opencode` asks the same panel through `opencode run` on Amazon Bedrock.

Why. kiro-cli puts its own agent prompt and tool definitions in front of every judge prompt. On 252 saved judge calls that was about 7.2k to 11.4k tokens of non-judge context per call, over half of the input for a median call. A replay of 159 cached prompts through a bare model path (one-line system prompt, no tools) differed from the kiro answers in two places. gpt-5.6-luna pairwise: kiro returned a tie for 21% of prompts against 7%, and 8 of 14 pairs changed with answer order against 0 of 14. deepseek-3.2 rubric: 11 partial and 6 fail out of 162 criteria on kiro against 4 partial and 0 to 1 fail. The samples are small. The Bedrock model behind a name may also differ from the model kiro serves under that name (version, reasoning setting, sampling), so a difference does not show that the wrapper caused it. The backend lets a study be judged without the wrapper, and judging a copy of a directory on the other backend gives a cross-check.

Set up.
- An AWS shared-credentials file with a profile that can invoke the models in one region, passed as `--aws-creds-file FILE` (`--aws-profile`, default `bench`; `--aws-region`, default `us-east-1`). Per call, only that profile is copied into the call's scratch HOME, and the copy is deleted when the call ends. Credential values are scrubbed from the kept raw output and from error messages.
- opencode: `--opencode-bin PATH`, or leave it out and the bench installs `opencode-ai@1.19.5` with install scripts off, as for the opencode harness (`--cache DIR`, default `$TMPDIR/b-cache`). The version and the binary's sha256 are recorded.
- `--judge-backend opencode` cannot be combined with `--judge-cmd`.

What a call is. One `opencode run` per judge call, in its own scratch HOME, XDG directories and empty working directory, with an allow-listed environment (no inherited credentials or login tokens), the model catalog fetch off and every tool and built-in agent off. The prompt goes in unchanged as the user message through stdin, so the argv size limit does not apply (the 120000 byte check stays on the kiro path). The system prompt is fixed and its hash is recorded in `judgments.json`: "You are an evaluator. Reply only with the JSON object the user asks for." opencode adds two things the bench cannot switch off: a line naming the model, and a small environment block (working directory, platform, date), about 100 tokens a call.

Panel ids stay the logical names, so the family rules (never Claude, never the subject's family, at least 3 families, the GPT-subject substitution) are unchanged. The backend maps them:

| panel id | Bedrock model id | temperature |
|---|---|---|
| gpt-5.6-luna | global.openai.gpt-5.6-luna | not sent (see below) |
| deepseek-3.2 | deepseek.v3.2 | 0 |
| glm-5 | zai.glm-5 | 0 |
| qwen3-coder-next | qwen.qwen3-coder-next | 0 (us-east-1 only) |
| minimax-m2.5 | minimax.minimax-m2.5 | 0 |

A raw Bedrock id is refused as a judge name (its family would read differently); an id with no mapping is refused before any call.

Temperature. gpt-5.6-luna rejects the temperature field on Bedrock, so luna cannot run at temperature 0; it uses the model's default sampling, and opencode also sends reasoning effort "medium" for it, which a raw Converse call does not. For the other four the agent asks for temperature 0 and the model entry allows a temperature, because opencode drops the value for a model it does not know to accept one. This was checked on opencode 1.19.5 by capturing the request it sends to a local stand-in endpoint (no model call): temperature 0 was sent for those four, none for luna, and minimax-m2.5 also gets top_p 0.95 and top_k 40 from opencode's defaults. opencode's log and session database do not record the request, so a run cannot confirm this per call. `judgments.json` records `temperatureApplied` per judge as configured, not as observed.

Cost and limits. Tokens and USD come from opencode's session database for the call (USD is opencode's list-price figure; if the database cannot be read, the event stream totals are used and the call says so). Credits stay 0. Each call is a line in `credit-ledger.jsonl` with `unit: "usd"` and a `usd` field; credit totals and the credit guard never count it. `--budget-usd X` stops new calls at 90% of X and exits 3 past 100%; `--budget-credits` is refused with this backend and `--budget-usd` with kiro. A throttled call is retried with exponential backoff (2 s, doubling, capped at 60 s, up to 6 tries; failed tries cost nothing). `--concurrency` still applies (default 2). Each call also pays opencode's start-up, about 3 s, and about 1 s more to read the database.

One backend per results directory. Judging a directory that already holds judgments from the other backend is refused (judgments written before the label existed count as kiro); judge a copy instead. The cache key includes the backend, the system prompt hash, the Bedrock id and the temperature setting, so kiro and opencode answers never serve each other, and kiro keys are unchanged. `judgments.json` gets `backend` and, for opencode, `backendInfo` (opencode version, binary sha256, region, system prompt and hash, the Bedrock id, agent and temperature per judge) plus `spentUsd` and `spentUsdByJudge`. `report` names the backend and, for several directories pooled with `--run A,B`, flags directories judged on different backends as not comparable; `--profile detailed` lists that as a shortfall.

```
node bench/runner/bench.js judge --run V/claude --judge-backend opencode --aws-creds-file CREDS --aws-profile bench --aws-region us-east-1 --profile detailed --budget-usd 25
node bench/runner/bench.js report --run V/claude --profile detailed
```

## Quality dimensions pack
The task rubrics check that a run did what its task asked. The quality pack adds anchored criteria for how well it did it. Code: modularity, maintainability, inline documentation, test quality and change discipline (any change, of any size). Documents: written content, scenario coverage, threat model completeness and design structure. Deliverables: requirements clarity, non-functional requirements from request to design, design scalability and resilience, and task breakdown. The criteria, their three anchors per level and the sources are in [QUALITY-PACK.md](QUALITY-PACK.md).

- It is a separate pass over finished runs. `judge --run DIR --criteria-pack quality` writes `judgments-quality.json` and does not read or change `judgments.json`, so `qualityOfRun` and every existing report stay as they are. `--plan` prints the number of judge calls and calls nothing (see below). `--mode`, `--baseline` and `--profile` do not apply to it.
- A criterion applies only when the task asked for the artifact. A dimension the task did not ask for is n/a with the reason, never a fail. An artifact the task asked for and the agent did not produce scores fail without a judge call.
- The judge grades only what the agent changed, quotes the evidence, and a quote that is not in the output drops the verdict one level, as in the rubric pass.
- Em dashes, en dashes, curly quotes, stock filler words and sentences over 35 words are counted by a program, not judged.
- `report` and `report-2x2` take `--criteria-pack quality` and add a "Quality dimensions" table. Without the flag their output is byte-identical to before. `calibrate export` and `calibrate score` take it too, so a person can rate a sample.
- To make the pack part of the quality score, pass a scoring file that weights it: `report --run DIR --criteria-pack quality --scoring bench/profiles/scoring-quality.json` (hidden 0.4, checks 0.16, rubric 0.24, pack 0.2). Each run gets one pack score, the mean over every criterion that applied to it, so a one-line fix and a design document are scored on the same scale. A run where nothing applied is scored on the other components. The report then refuses any run without a current pack judgment instead of leaving it out. A scoring file with a pack weight is refused by every other command, and `profiles/scoring.json` is unchanged, so earlier numbers stay comparable.
- The "Quality dimensions" section also has a "Process signals" table. It shows spawns per run, runs that delegated, distinct agents, whether an assumptions section was written (in a document, in the final message) and whether the run ended on a question. They are read from the recorded results, not judged, and not scored.
- No sample has been rated yet. Read the scores as a way to see where arms differ, not as a measure.
- A weighted pack needs a current pack judgment for every run, so `report` stops when one was made against another pack or task revision. `report --allow-stale-pack` (plain report only) scores those runs from the stale judgments instead. The report then opens with a note and `report.json` carries a `packStale` list, each run labelled "stale pack revision <rev>". Without the flag the check is unchanged, and the verdict pages never take it. Rejudging with `judge --criteria-pack quality` is still the way to get comparable numbers.
- `report --verdict platform|orchestrator-pass --criteria-pack quality --scoring profiles/scoring-quality-fractional.json` scores every run with the pack included, so the paired intervals, the A/A noise floor and the call use the pack-weighted number. Every run needs a current pack judgment, the scoring file must weight the pack, and without the flag nothing changes.

## Calibration
`calibrate export` writes a blinded `sheet.json`/`sheet.md` and a separate `key.json`. Fill the labels,
then `calibrate score` prints judge-vs-human and judge-vs-judge agreement, Cohen's kappa and Spearman
with PASS or WARN (defaults 0.6, 0.7, 0.6; `--kappa-min`, `--agreement-min`, `--spearman-min`). Under
about 30 criterion pairs is indicative only.

`cap review --run DIR` is the same check with the outputs side by side. It writes `DIR/calibration/review/review.html`, one static file
with the data, style and script inline: it loads nothing, opens no port and needs no server (a Content-Security-Policy allows only its own
script and style, and no connections). It draws the runs `calibrate export` would draw, with n and seed taken from `calibration-sample.json`
when the detailed profile wrote one, and for each drawn task and replicate shows every arm's run of it (`--sample-only` shows the drawn
runs alone). The outputs are the judge bundles, with the same redaction and then credential scrubbing. Each task's outputs carry the
letters A, B and so on in a seeded random order. Which arm is behind each letter is kept in `review-key.json`, which goes to its own
directory, `DIR/calibration/review-key/` by default (`--key-out DIR`; a key directory that is the page directory or inside it is refused),
so the page directory holds only `review.html` and can be handed to the rater whole. If the page directory already holds what a review
or an import writes (`review-key.json`, `key.json`, `sheet.json`, a `raters/` directory, an `.import-*` staging directory, or a
temporary `*.json.tmp-PID` of one of those files), `cap review` refuses and writes nothing, even with `--force`: move or delete it first.
Other files there, such as a downloaded `ratings-*.json`, are left alone. The key records the run directory relative to itself and no absolute path, and the page's
viewer id does not depend on where the run is. For each output it also records a hash of what the rater saw: the `stream.jsonl`
bytes, the shown checks (`checksOriginal` when a recheck kept them, else `checks`), the questions and turns, and the raw bytes of the
workspace files the bundle was built from. A `recheck` does not change it.
The rater marks each criterion pass, partial or fail (an evidence quote and notes are optional), the
browser keeps the ratings in local storage, and Download ratings saves them as a JSON file. Load ratings resumes from such a file.

`cap review-import --ratings FILE --key DIR/calibration/review-key/review-key.json` checks the file against the key (same page, known items
and criteria, verdicts pass, partial, fail or null) and joins each letter back to its arm, task and replicate. `--key` is always
required; a key is never looked for next to the page or the ratings. The run is found from the key's own location, so a run moved
together with its key still imports; for a run moved without its key, pass `--run DIR`. An import refuses a directory that lacks the
key's runs, or where any rated output no longer shows what the page showed (a re-run in the same layout, a changed stream or
an edited workspace file), and names the first such output. A key from an older or unknown version is refused with the advice to regenerate the page
with `cap review --run DIR`; ratings made on the old page will not import. Ratings are kept per rater in `raters/ID/` beside the key; the id is `--rater ID`, else the Rater name typed on the page. A file that rates no criterion, or has no
rater id, is refused. Importing a rater that is already on file is refused unless `--force`, so a second import never replaces the first.

With several raters on file, each is scored alone (`raters/ID/result.json`), and all of them are pooled for the combined result: the
`sheet.json` and `key.json` beside the key (the key names the run relative to itself) list every output once per rater, so each rater's labels count as their own criterion pairs
against each judge in the same kappa, agreement and Spearman code `calibrate score` uses. The command prints that table, says how many
evidence quotes were found in the output (the judges' quote rule), and saves the pooled result, with each rater's figures under `byRater`,
to `DIR/calibration/result.json`, where `report` and the detailed profile look for it. A `result.json` that this page did not write is
kept unless `--force` or `--save FILE`. A refused import writes nothing, and an import that fails partway leaves the
rater off file: it scores in a staging directory beside the key (removed when the import ends; a stale staging directory from a
killed run is cleared by the next import), then writes the backup, the per-rater and pooled files and the result, and the rater's own
`ratings.json` last. Rater, criterion and item ids are plain ids, so names such as `__proto__` work. A new rater id needs no `--force`; only replacing a rater
already on file does. Before each import rewrites the pooled result, the one it replaces is copied to `result.prev.json` beside it
(one level: an older `result.prev.json` is replaced).

Each rater's kappa is shown next to the pooled one: the lowest judge-vs-human kappa for that rater, the same reduction the report
applies to the pooled result. The import prints them, `result.json` keeps them under `raterKappa`, and the report's Human calibration
row lists them after the pooled kappa with the lowest in bold. A rater under the kappa bar used for the pooled value (0.6 by default,
`--kappa-min` on import) is marked "below". The row's status still follows the pooled kappa.

```
node bench/runner/bench.js cap review --run V/claude
node bench/runner/bench.js cap review-import --ratings ~/Downloads/ratings-VIEWER.json --key V/claude/calibration/review-key/review-key.json --rater alice
```

## Benchmark a PR or work in progress
Any commit or working tree can be an arm: `--arms vanilla,v1.2.0,pr-95=<ref>,wip=dir:<path>`. A name is
`[a-z0-9][a-z0-9._-]{0,40}`; `vanilla`, `main` and `vX.Y.Z` are reserved. A bare ref (`feat/x`) is refused.
- `name=<ref>` resolves in `--repo-root` without fetching: a local branch, tag, remote-tracking ref
  (`origin/feat/x`), `refs/pull/<n>/head`, or a commit SHA. It is built from `git archive`, so a dirty tree never leaks.
- `name=dir:<path>` snapshots tracked and untracked files that are not ignored (a plain copy skips `.git`,
  `node_modules`, `target`, `dist`, `build`) and labels the arm `name@<hash12>`, recorded as dirty.
- Each arm records ref, SHA, source, dirty, content hash, merge-base with `origin/main`, commits ahead and the
  top-level paths changed (names only) in run-config and every result.json.
Make the code local first; the runner never fetches. Fetch a pull request or a branch yourself:
```bash
git fetch origin pull/95/head:pr-95          # then pr-95=pr-95
git fetch origin feat/x                      # then pr-95=origin/feat/x
git worktree add --detach /tmp/wip HEAD      # edit files in /tmp/wip, then wip=dir:/tmp/wip
node bench/runner/bench.js pr-plan --ref pr-95=pr-95 --suite lite   # prints the commands and a budget, runs nothing
node bench/runner/bench.js run --suite lite --arms vanilla,v1.2.0,pr-95=pr-95 --replicates 3 --budget-credits 300 --out $OUT
node bench/runner/bench.js run ... --prepare-only                   # build and trial-install every arm, print the table, no agent
node bench/runner/bench.js judge --run $OUT --baseline v1.2.0       # pairwise against v1.2.0 instead of vanilla
node bench/runner/bench.js contrast --run $OUT --base v1.2.0        # contrast.md + contrast.json in $OUT
```
`contrast` compares each other arm with the base, overall and per task class: cost, wall clock, model, work-tool and
subagent calls (medians), hidden and regression test pass fractions, checks, rubric, and the flags (askedUser,
externalFetch, fixRecall, modelMismatch, timeouts). Each row shows n, both deltas and a verdict from the same noise
rule as `compare`; fewer than 3 runs a side gives "n too small". Failed runs stay in the counts. `compare` across two
runs reports a same-named arm that resolved to a different SHA as "arm changed" instead of refusing.
- One replicate is anecdotal. Use `--replicates 3` or more before calling a difference real.
- Orchestration costs more than a single agent; do not judge a konductor change on cost alone. Read the quality
  (hidden tests, checks, rubric) and autonomy (askedUser) columns next to it.
- A ref must exist locally; builds need the cargo offline cache or `--cargo-online`; a directory snapshot leaves
  out ignored files; a ref without `cli/konductor-rs` and `mcp` fails fast with the reason.

## Autonomy tier
Does a change need less help from the user? Every other prompt ends "Do not ask me questions", so no run ever asks.
The six `autonomy-*` tasks leave a decision open, and a scripted user (no model) answers whatever the agent asks.
- Measured per run: `turns`, `interjections` (scripted replies), `questions` (turn, text, matched clarifications),
  `unmatchedQuestions`, `askedFirstTurn`, `interjectionCapHit`, `autonomous` (no interjection), `intendedTests` and
  `invariantTests` (hidden test split), `completedWithoutHelp` (autonomous and both groups all pass) and
  `assumptionsStated` (a text heuristic on the last message). Cost, calls and wall clock add up over all turns.
- Intended tests follow the scripted answers; invariants hold under any reasonable reading (old behavior kept, no crash,
  no data lost). A wrong guess lowers intended, not invariants. One task needs no question (`noQuestionNeeded`), so
  asking there is over-asking; one is risky (delete files), so asking first is right.
- The scripted user: a turn that ends with a question, an approval request or a non end_turn stop is an ask. Each
  clarification has regex keywords; those that match the question and were not used yet are answered (several in one
  numbered reply); no match gets "Use your best judgment and continue." and counts as unmatched. After `maxInterjections`
  (4) it sends "Proceed with your best judgment now and do not ask further questions." once, sets `interjectionCapHit`,
  and the next turn ends the run. The timeout covers all turns together.
- Resume: `kiro-cli chat --resume-id <session id>` (`--resume` if no id was read), opencode `-s <session id>`, with the same
  cwd, scratch HOME and isolation, and the credential copy kept until the last turn. Per-turn streams are `stream-N.jsonl`.
  Checked once with kiro-cli 2.35.2 on a trivial two-turn task (0.15 credits): the resumed turn kept the session id and
  the earlier context, the model stayed pinned, and credits were summed over both turns. One run, so not a rate.
  To repeat it, point `--bench-dir` at a scratch directory with one ask-then-answer task and use `--budget-credits 3`.
- Run: `node bench/runner/bench.js run --suite autonomy --budget-credits 400 --out $OUT`, then `judge`, `report`,
  `contrast --run $OUT --base v1.2.0`. `report.md` gets an "Autonomy" section per arm: asked rate, mean interjections,
  questions on the no-question task and unmatched questions (shown apart), cap hits, intended and invariant tests,
  completed-without-help rate, interjections per successful run, cost and wall clock for all turns. `contrast` and
  `compare` gain `interjections`, `unmatchedQuestions`, `intendedFraction`, `invariantFraction`, `completedWithoutHelp`.

## Piloting orchestration options
Make an option an arm, run it against a release, and read quality, autonomy and cost together.
- Arm: a branch or tag as `opt-a=<ref>` (built from `git archive`), or a worktree as `opt-a=dir:<path>` (edits count, recorded dirty).
- Plan, runs nothing: `pr-plan --ref opt-a=<ref> --suite pilot --budget-credits 150` (also `--base v1.2.0`, `--base main`). The
  `pilot` suite is 8 tasks borrowed from lite (3), real (2) and autonomy (3, one needs no question); 1 replicate. There are no
  observed figures for autonomy tasks, so `pr-plan` refuses to guess a cap and wants `--budget-credits`.
- Sequence: `run --suite pilot --arms vanilla,v1.2.0,main,opt-a=<ref>`, then `contrast --run $OUT --base v1.2.0` (no credits),
  `judge --run $OUT --baseline v1.2.0`, `report --run $OUT --baseline v1.2.0`.
- Read three things together. Quality: hidden and regression tests, checks, rubric. Autonomy: `interjections`,
  `unmatchedQuestions`, `completedWithoutHelp` (fewer is better, but asking on the no-question task is over-asking). Cost:
  credits and wall clock with failed and timed-out runs included. Cheaper with lower quality or more help is not an improvement.
- Caveats: n=1 per cell is anecdotal; rerun the tasks that show signal with `--replicates 3`. Vanilla is at ceiling on small
  tasks, so look at cost, autonomy and the real and autonomy tiers. Wall-clock numbers need `--parallel 1` and nothing else
  using the Kiro account. The agent has open network (see the contamination row).

Observed credits for one pass, claude-sonnet-5.5 unless noted, n=1 per cell (a guide, not a forecast; `+` is a lower bound):

| suite (tasks) | vanilla | v1.2.0 | main |
| --- | --- | --- | --- |
| lite (5) | 6.78 | 23.31 | 31.01 |
| real (7) | 14.22 | 61.32 | 45.33+ |
| hard-A (6) | 20.06 | not run | not run |
| haiku-5.5, partial (1 task) | 0.42 | not run | 0.66 |

## Capability benchmarking (cap)
`cap` answers questions about one skill, SOP, agent or context file. `list`, `audit`, `variant`, `plan`, `prune-report`, `skill-plan`, `decide` and `criteria` are free; `draft`, `trigger`, `skill-study` and live runs spend credits.
- `cap list` shows the registry plus a scan of the tree at `--base` (default `v1.2.0`): owner, agents that reach each capability, tasks, gaps.
  `--init` prints skeleton registry entries for unregistered ones and writes nothing.
- `cap audit --base REF --harness kiro-cli|opencode|both` writes `cap-audit.md` and `cap-audit.json` and exits 1 on any error
  finding. `--base` takes a ref, `dir:PATH` or an arm spec; `--public` also scans registry text, task prompts and these docs for internal markers.
- `cap prune-report --base REF --runs-glob 'DIR/*' [--evidence FILE]` recomputes skill loads from the streams of every finished, non-vanilla run and writes one
  recommendation per skill and harness: HARMS, RELOCATE, PRUNE, FIX, KEEP or NEEDS DATA, plus a TRIM flag. Free, read-only, never a deletion.
  How to evaluate skills and decide keep, fix, trim, relocate or prune: [CAP-PLAYBOOK.md](CAP-PLAYBOOK.md).
  A skill counts as exposed in a run when the agent that started the run lists it (its own installed skill filter, else the base tree's listing for that agent), or an agent the stream shows the run spawning lists it, or the run loaded it. Each run keeps the entry agent's own `installed-agent.json` (`--arm-agent k-developer` saves k-developer's, not konductor's). Runs saved before that fix hold konductor's file for every entry agent; `prune-report` ignores that file when its name differs from the entry agent, uses the base tree's listing instead, and counts those runs in `usage.runs.staleInstalledAgent` with a warning.
- `cap variant --scratch DIR --drop ID | --replace ID=FILE | --add ID=FILE --to-agent A | --preset skills-only|bare` builds a `dir:`
  arm from `git archive` of the base ref (never the working tree) and prints the `--arms name=dir:PATH` string. `--verify` builds it with
  the offline cargo cache and trial-installs it in a scratch HOME, then compares the installed skill, SOP and context lists with the ops.
- `cap scenarios --cap ID,ID [--n 8] [--dry-run]` drafts 8 to 30 task scenarios per skill into `DIR/scenarios/<id>.json` and `.md` for review. `--dry-run` writes the prompt only: no model call, no login, no credits.
- `cap scenarios --cap ID --mode trigger [--n 10] [--seed-queries FILE] [--dry-run]` drafts tasks for a skill that rarely loads: `--n` (8 to 10, default 10) tasks that should make the agent load it on its own and as many near misses that should not, into `DIR/scenarios/<id>.trigger.json` and `.md`.
  It follows skill-creator's trigger eval method (Description Optimization, step 1): realistic, concrete requests in varied phrasings that never name the skill, and near misses that share its words but belong elsewhere rather than unrelated requests.
  The checks: no prompt names the skill in any one-term spelling (joined by nothing or one hyphen, underscore, dot or space, any case; never across a sentence end or a line: `backend_review`, `Backend Review`), no more than 2 should-trigger prompts open with the same three words, each near miss lists the terms it shares with the skill text (each must appear as a whole word in both), and at least half name the neighbour they belong to.
  `--seed-queries` takes a skill-creator eval set (`[{ query, should_trigger }]`) or a `cap draft` file as starting intents. The file also has a `queries` view, so `cap trigger --queries DIR/scenarios/<id>.trigger.json` measures organic triggering on the same set. The draft is unreviewed: a person deletes, edits and turns the approved ones into tasks.
- `cap controls --out DIR` writes a planted-lift skill and a decoy skill with one task each and prints the variant, run and check commands; `cap controls --check RUN ...` exits 0 only when the planted lift was found and the decoy showed none.
- `cap plan --mode lift|trigger|improve --cap ID` (pass `--tasks id,id` when the registry links no lift task) prints the variant, run, contrast, judge and report commands and a credit estimate
  from the observed table. It refuses a task scored by checks alone unless `--allow-regex`, and refuses to guess credits without observed
  figures unless `--budget-credits X` is given. A skills-only change the acting agent cannot reach at startup stops with exit 2 unless `--force`.
- `cap variant ... --overlay skill:NAME=DIR` replaces `SKILL.md` and adds `references/**` from DIR in one step (a section moved out of a skill). Only those paths are accepted, links and other files are refused, and an existing reference file is never overwritten.
- `cap skill-plan --base REF --runs DIR[,DIR] [--tier ...] [--only a,b]` plans the per-skill study: the tiers (loaded, large, duplicates, triage), the tasks that exercise each skill, the sections that can be tested, the waves and credit, judge and wall-clock estimates from the per-run figures in the run directories. Free; `--out DIR` writes `skill-plan.md` and `.json`. `--forced-load low-load|always` adds the forced wave as its own line with its formula (3 arms x tasks x reps x qualifying skills), outside the totals; under low-load a skill qualifies when its load rate in the runs on file is known and under 30%. `bench/scripts/run-skill-bench.sh` takes `--forced-load low-load|always|off`, `--forced-held-min X` and `--waves 1|all`, checks them before anything runs, and passes all three to every `cap skill-study` call (init, dry run, run, resume, the daemon child); a dry run with no study passes only `--forced-load` to the plan, which estimates every wave. `run-skill-bench.sh --waves 1` is the way to run wave 1 only through the script.
- `cap skill-study --study DIR` runs that plan and `cap decide --study DIR` reads it. The study directory holds `study.json`, one folder per skill (`w1`, `w2`, `w3`, markers, overlay files), `controls/`, `incomplete/`, `logs/` and `decisions/`. `bench/scripts/run-skill-bench.sh` wraps it: preflight, daemon, `--status`, `--stop`, `--dry-run`, `--tier`, `--skills`.
  Waves: 1 control, an A/A repeat and the skill deleted; 2 one section removed per arm, only if deleting the skill lost quality; 3 the same sections moved to `references/<id>.md` behind an "open when" line, only for sections whose removal lost quality. Controls run first; a failed control stops the study.
  `--forced-load low-load|always` adds wave 1f (`w1f`) after wave 1, for skills that loaded in under 30% of wave 1 control runs (low-load) or for every skill (always). A low-load skill whose wave 1 load rate is unknown is skipped, with the reason in `w1f.skipped`. The arms, in a run of their own and judged with `frc` as the baseline: `frc` is the base ref with a first instruction that names the skill and says to load it with `get_skill`, `frc-b` its A/A repeat with the same instruction, and `del` the skill deleted with a neutral filler instruction of about the same word count (within 10%, single spaces, from a fixed list of sentences) in the same place (`forced-prefix.txt` and `forced-filler.txt` in the skill's study folder).
  The wave must pass the same isolation gate as the others, and one more: every run must carry exactly the prompt prefix its arm was planned with (the hashes in `w1f.arms.json`), and a run in any other wave must carry none. A wave that fails it is not read and is rerun on resume. A forced wave that fails (a build, run or judge error) is recorded in `w1f.failed` and reported, and the study goes on with wave 2 and the next skills; a resume retries it. To run wave 1 only, use `cap skill-study --study DIR --waves 1`: it runs the controls and wave 1, and skips the forced wave and waves 2 and 3. Use it rather than a wrapper that filters steps by label; a wrapper that must filter has to skip every label matching `/-w(1f|2|3)-(run|judge)$/` (exported as `AFTER_WAVE1_STEP` from `cap/skillstudy.js`), the forced wave's `<skill>-w1f-run` and `-judge` included.
  `cap decide` reads wave 1f after it makes the call and reports it in its own section of `decisions.md` and as `forced` in `decisions.json`, with `usedForCall: false`: forced load rate, delete against forced, A/A spread and the reading. The forced comparisons are one family, counted over the skills with a finished forced wave: each interval is at 1 - 0.05/m (Bonferroni) and the "helps" or "no effect" reading comes from it. Wave 1 keeps its own intervals. Forcing counts as held only when `frc` and its repeat `frc-b` each loaded the skill in at least 90% of their runs (`--forced-held-min X` on `cap skill-study` or `cap decide`); the section prints the observed rate of each forced arm. `--forced-load` and `--forced-held-min` given on a run are saved in `study.json`, so a resume without them does the same; the run log says whether each value came from the flag or from `study.json`. A dry run saves nothing and creates no directory. `--forced-load off` clears a saved value: it is saved as `off`, and the run and later resumes run no forced wave. When forced load helps a skill under the load floor, the reading adds "forced load helps; fix the description". The section also states the remaining confound: the two instructions differ in text, and the forced arm spends an extra turn on the load. It never changes a DELETE, PRUNE, KEEP or NEEDS DATA call and adds no row to `evidence.json`.
  `cap decide` writes `decisions.md`, `decisions.json`, `evidence.json` (rows for `cap prune-report --evidence`) and `patches/<skill>.patch`. Calls: DELETE, PRUNE (each section with `skills/NAME/SKILL.md:start-end`, remove or move, tokens saved), KEEP, NEEDS DATA. Quality is the bench score on a 0 to 1 scale; a difference counts only outside the A/A spread; the margin is 0.10 and runs per side must reach 15 (our own thresholds). No DELETE or PRUNE call without passed controls, an A/A arm, valid units, enough runs, a skill that loaded in at least 30% of control runs, and a result that clears the decision-card rule (confidence medium or high). Nothing is applied.
- `cap criteria --study DIR` (or `--runs DIR[,DIR] --baseline ARM [--aa ARM]`) flags the rubric criteria and checks that do not separate the arms. It reads `judgments.json` (one record per judge and replicate, with a verdict per criterion) and the check results in each `result.json`; it makes no model call. Advisory only: it changes no call, margin or floor, and `cap decide` does not read it. It writes `criteria.md` and `criteria.json` to `--out` (default `DIR/criteria` for a study; with `--runs` and no `--out` it prints the markdown).
  Per item and arm it gives the pass rate (pass 1, partial 0.5, fail 0, a rubric criterion averaged over judges) and, for each variant arm, the difference from the baseline with an interval: paired by run directory when two or more directories hold both arms, otherwise a bootstrap over the replicates of the one task the item belongs to. The A/A arm is shown for context and is not a variant. Flags:
  - NON-DISCRIMINATING: in every variant comparison the item scored the same in every run (always pass, always fail) with at least `--min-runs` runs per arm (default 5), or the interval lies inside the `cap decide` margin (`--margin`; its default is the `MARGIN` constant of `cap/decide.js` (0.10), imported so the two cannot drift). An item that scored the same in every run but has fewer runs on a side is reported as INSUFFICIENT-DATA and not flagged.
  - SATURATED: every arm at or above `--saturated` (default 0.95), or every arm at or below 1 minus it, with at least `--min-runs` runs per arm; with fewer it is reported as INSUFFICIENT-DATA.
  - HIGH-VARIANCE: judges gave different verdicts on more than `--judge-disagree` of the runs (default 0.3), or the pooled replicate SD of one arm and task is above `--replicate-sd` (default 0.4; 0.5 is a coin flip). The judge rate is strict: any difference counts, partial against pass or fail included. A coarse rate, pass against not pass, is shown beside it and does not drive the flag. Both are measured only where a run has two or more judges, and the report says when they are not. Both halves need `--min-runs` runs per arm (and that many runs with two or more judges for the judge half); with fewer the item is reported as INSUFFICIENT-DATA.
  Checks are matched in this order: an explicit `id` (or `name`) when every check result carries one; a content id, a hash of the fields the task schema defines for a check (`type`, `path`, `pattern`, `cmd`, `expectExit`, `min`, `labels`, `manifest`, `allowAdditions`, `group`), computed the same way from the task file and from each result record; then position, only when a run has as many check results as the task defines (or as the first run of a task with no loaded definition) with the same type at each place. Anything else is an error for that task's checks, which are then not judged, and so is an explicit id or name used twice in one result list. A task with no check list falls back to the first run seen. Task files and the schema are not changed, since a real id would change `checksRevision` and mark earlier results as not current. Result records do not carry `expectExit`, and older ones may lack `group`; a task check that sets either falls back to position, and the report names the missing fields. Two checks with the same content are numbered in list order (`#1`, `#2`); they run the same check on the same workspace, so the pairing cannot change a value. Intervals are widened for the number of items on each arm pair (Bonferroni), which makes NON-DISCRIMINATING harder to reach; `--no-adjust` turns that off. Thresholds are checked before anything is read, and a bad one exits 2: `--margin` above 0 and at most 1, `--saturated` above 0.5 and at most 1, `--judge-disagree` and `--replicate-sd` from 0 to 1, `--min-runs` a whole number of 1 or more. Infra errors and model mismatches are left out as in `cap decide`. These thresholds are our own.
- Registry: `capabilities/<kind>/<name>.json`, schema `schema/capability.schema.json`, checked by every `cap` command and by
  `node tasks/validate-tasks.js`. To add one: run `cap list --init --cap ID`, save the entry under its path, fill in `owner`, link tasks,
  then run `cap audit`. Only a person edits these files; stored query splits are never recomputed.
- Variants: ops edit a copy. `drop` removes the file and the name from every skill, SOP and context list of every agent spec and from
  `clientConfig.claudeCli.skills` (synth rejects a listed skill that has no directory). `variant.json` sits beside the tree, so it does
  not change the arm hash; it records the base commit, each op with before and after sha256, inbound references and the tree hash.
- Runner additions: `contrast --by task`; `--extra-tasks DIR` on `run`, `judge`, `report`, `contrast`, `recheck`, `skills` (tasks in
  `DIR/<id>.json`, `DIR/fixtures`, `DIR/hidden`, masked from the agent; check with `validate-tasks.js --only-extra --extra-tasks DIR`);
  `run` stops launching at 90% of `--budget-credits` or when charged credits plus the largest run so far would pass it, and `--run-credit-limit X`
  limits one run to X credits. Engine v2 meters after every model call, so the run's process group is killed once the credits metered so far pass
  X and the run is recorded as censored (flag `creditLimit`). Engine v3 reports a turn's spend only when the turn ends, so a one-shot run always
  finishes: if it spent more than X it gets the flag `creditLimitExceeded` and nothing is killed. A conversation task (autonomy) is checked when each
  turn ends, and over the limit the next turn is not started (flag `creditLimit`, an error naming the turn). With a limit, `result.json` records
  `creditLimit` and `creditOvershoot` (credits above X, else null) for v2 and v3 alike, and the `done` line shows the overshoot. On v3 the
  overshoot of a one-shot run can be the whole run, so `--budget-credits` is the only bound on total spend.
- Reading the audit: tokens are bytes / 4, an estimate. "Unreachable" means no agent spec lists the capability, so no kiro agent can
  load it. A near-duplicate score is Jaccard on description words. Leakage fails above 5% shared 8-word shingles. Each `cap`
  command that builds hashes `~/.konductor/installs` before and after and exits 1 if it changed.
- `cap draft --cap ID,ID [--n 24]` makes one tool-less model call per capability (scratch HOME, empty cwd, no tools, credential copy removed
  after) and writes `DIR/drafts/<id>.json` and `.md`: candidate trigger queries with a rationale each (about half should-not, at least half of
  those near misses of a similar capability), two task ideas and, for a SOP, its declared output sections. It assigns no splits and never
  writes into the repository. A person reviews, assigns `split` (about 60/40 train/heldout plus 4 per polarity in `reserve`) and copies the
  approved `id`, `text`, `expect`, `nearMissOf` into the registry. `cap import --from FILE --cap ID [--n 24]` reads `[{query, should_trigger}]` the same way and applies the same checks as `cap draft`: the query text rules (length, one paragraph, no capability name in any spelling (backend_review or Backend Review for backend-review), no procedure or agent name, no dashes, no public-repo marker), at least 6 queries of each kind and at most n + 4 in all. It refuses a `split` on any item; a person assigns splits after review.
- `cap trigger --cap ID --mode proxy|live` scores precision, recall and F1 with Wilson 95% intervals, per query over repeats (a hit is a load in at
  least half of them; skill-creator counts per run, and F1 with its interval is our own), plus what fired instead. Queries come from the registry (`--split train|heldout|all`) or a draft (`--queries FILE`).
  Harnesses are reported separately, never merged. Trust each mode for what it sees:
  - proxy asks a model what it would do without starting an agent. On kiro-cli it writes `find_skills` arguments, an offline copy of the tool
    returns the candidates, and a second call picks; retrieval failures (the wording never reaches the skill) and judgment failures are
    counted apart. On opencode the skill index is in the prompt. It cannot see task context or delegation hops: a miss is informative, a hit is not proof.
  - live runs real trigger tasks and stops at the first load or delegation (`--stop-on first-load`, default) within 4 tool calls. A killed run
    has no metered credits at all (metering arrives at the end of a turn), so live spend is unobserved; give `--budget-credits` and `--run-credit-limit`.
  - Agreement of the two on a sample (`--crosscheck F` or `--crosscheck-run DIR`) is Cohen's kappa; below 0.6 or under 12 queries every proxy
    report says "proxy not validated".
- Forced load: `run --arm-prefix name=FILE` puts the file's text in front of the task prompt of one arm (recorded as sha256 and size); use
  "load skill X before you start" against the same arm without it to separate discovery from effect. `cap forced-prefix --cap skill:NAME --harness kiro-cli|opencode --out DIR`
  writes that instruction for each harness (kiro-cli: the `get_skill` tool of the skills server; opencode: the `skill` tool). Only the first turn of the entry agent sees it; a subagent does not.
  Give it to the forced arm and its A/A repeat in a run of their own. An arm's A/A identity is its ref, its arm config and the sha256 of its prefix, so a prefixed arm never pairs with the same ref without one; an arm without a prefix keeps the identity it had. An arm whose runs disagree on the prefix, or carry one without a hash, is never paired. `--arm-agent name=AGENT` starts an arm in
  another agent. `--stop-on first-capability|first-load|end_turn` and `--max-tool-calls N` stop a run early and mark it `earlyStopped`.
- Audit lint and baseline: `cap audit` also checks names, third-person descriptions, SKILL.md length, links, orphan and too-deep reference
  files, frontmatter keys, redundant When to Use sections and copied blocks. `capabilities/audit-baseline.json` lists tolerated findings by id: a new
  finding fails, and so does a listed one that no longer occurs. `cap audit --update-baseline` writes it (only removals once it exists; `--force`
  to add) and is never run for you. Registry `class: preference` marks a capability tested for fidelity, not lift; `cap plan --mode lift` refuses it.
- Judge bundles keep up to 60000 characters per file and 150000 per bundle (was 16000 and 48000, and before that 6000 and 24000); a cut keeps the head of a file, so
  a long deliverable lost its later sections. A task can set `bundleLimits`. Prompts may reach 400000 bytes on the opencode backend (stdin) and stay at 120000 on
  the kiro backend (argv). Records written under the old limits keep the limits they carry. `cap plan` sizes
  the budget as the largest of 1.5x the estimate, estimate plus the largest observed run, and a pass with one such run before the last cell.

## How to read results
- Tokens are not exposed by kiro-cli; credits are the cost measure. `estTokens` is characters / 4.
- Efficiency cells are `median [95% bootstrap CI of the median]` over clean passes only: status success,
  no `infraError`, no `modelMismatch`, every check passed. Failures are rates beside every cost
  figure (timeout, error, infra, model mismatch, checks failed, budget-skipped). "credits per successful
  run" is all charged credits over clean passes, so failures raise it.
- Under 3 replicates per task is anecdotal (flagged), as are judges differing by over 0.2. Redaction
  hides names, not style; check calibration first.
- `compare` uses the same series. It refuses runs that differ in model, effort, task set, judge set,
  content hash, kiro-cli version, isolation mode or agent engine (exit 2, `--force` overrides) and exits 1 on any
  regression: worse by at least `--min-rel` (default 15%) and, with 3+ runs per side, disjoint CIs
  (`--rule any`: either).

## Reports, scores and the diligence scorecard
`report`, `contrast` and `cap prune-report` take `--detail quick|full` (default full) and `--format md|html|both` (default both). Files: `report.md`,
`report.html` (one file: inline CSS and SVG, no script, no external resource, prints), `report.json` and `charts/*.svg` (linked from the markdown, so it renders on GitHub).
`contrast` names them `contrast.md`, `contrast.html` and `contrast.json`; `cap prune-report` writes `prune-report.md`, `prune-report.html` and `prune-report.json`, plus `charts/` (also with `--format md`).
`--run DIR,DIR` merges several run directories read-only (a taken replicate number moves to the next free one) and needs `--out`; `contrast --out DIR` keeps the run directory unwritten.
- quick: scorecard, three flags, one headline table (quality, reliability, autonomy, cost ratio), the cost-vs-quality scatter, the per-task dot plot.
- full: everything in quick, then scores with their components, cost bars with CIs (overall and per class), dot plots, forest plots against the base with the A/A noise band,
  the judge heatmap and pairwise bars, autonomy, skill load, contamination, spend by phase, run durations, provenance, commands to reproduce, and the existing text tables unchanged.
  A run without judgments still renders; the charts that need them are listed under "Not shown". New JSON keys (`scores`, `diligence`, `detail`) are additive.
- Scores (`report/scores.js`; every one has n and a 95% bootstrap CI, and is "anecdotal" below 3 runs; a failed run is never hidden):
  - Quality /100: per run, the weighted mean of the components it has: hidden tests (FAIL_TO_PASS, hiddenTests or intendedTests as passed/total), checks (all pass = 1), rubric
    (mean over judges of the verified score; raw shown beside it). Weights come from `profiles/scoring.json` (0.5, 0.2, 0.3; `--scoring FILE`).
    With no hidden tests the weights renormalise to checks 0.4 and rubric 0.6, so one failed check out of many costs 40 points. `--scoring bench/profiles/scoring-fractional.json` (same weights) scores the checks
    term as passed / total instead, and `profiles/scoring-quality-fractional.json` does the same with the quality pack. A scoring file opts in with `"checks": "fraction"`; the default is `"all"`. The report's weights line and
    quality formula say which mode was used, and the default output is unchanged. A missing component is dropped and the
    others renormalised, never imputed. infraError, modelMismatch and runs with no component are left out and counted. The inputs used are printed beside the score.
  - Reliability /100: 100 minus the share of runs that timed out, errored, hit infraError or had a modelMismatch.
  - Autonomy /100 (autonomy tier only): share of runs completed without help, with interjections per task and the unnecessary-question rate beside it.
  - Efficiency (a ratio, not 0..100): cost per successful run, wall clock, model, work-tool and subagent calls, each as arm / base with a bootstrap CI; "cost per quality point" carries a ceiling caveat at quality 95 or more.
  - Skills (`cap prune-report`): load rate with a Wilson interval and exposure n, size, class and evidence verdict. No composite. Each skill gets a decision card: load rate (not comparable to SkillsBench's skill invocation rate; a direct read of a SKILL.md is not counted), cost, lift (with minus without, not paired, no interval) and Hake normalized gain, or normalized change for a loss
    (evidence rows may carry `withValue` and `withoutValue`, rates 0 to 1; `delta` and `aaSpread` use the same 0 to 1 scale and are rejected above 1), the A/A noise check, and a checklist of what is missing before anyone acts. The decision-board verdict (keep, prune candidate, needs human review, incomplete) is our mapping of the class, not another scale's threshold. A prune candidate needs medium or high confidence, a delta outside the A/A spread and consistent units (HARMS also needs 6 evidence runs); anything weaker reads needs human review.
    Thresholds that are our own, not from an external source: load rate 30%, Jaccard 0.6, size p90, minimum exposure 10, the A/A rule, the 0.95 ceiling, the 600 and 60 character description limits and the 5% leakage limit.
- Diligence scorecard (`report/diligence.js`, top of every report): PASS, WARN, FAIL or N/A per criterion with the measured value and the threshold. Unknown data is WARN "not recorded", never PASS. Key criteria: replicates per cell
  (3+ PASS, 2 WARN, 1 FAIL), A/A arm or same-ref repeat, known-answer controls (capability studies; a task field `control: positive|negative`), judge coverage, judge families (3+, no Claude), judge agreement (within-one 0.9+ and exact 0.6+ PASS; under 0.75 FAIL),
  hidden tests on every task, headroom (base at 95+ on at most 25% of tasks), model pin, provenance. Others: failures, censored credits, contamination, parse failures, both orderings, truncation, calibration (kappa 0.6+ from `calibrate score --save FILE` to `DIR/calibration/result.json`), recheck, isolation, budget, drift, task validation.
- Rating: `anecdotal` if any key criterion FAILs; `supported` only if every applicable key criterion PASSes and nothing FAILs; otherwise `indicative`. Thresholds are in `THRESHOLDS` in `report/diligence.js`.

## Profiles, credit ledger and platform verdict
Two profiles set how much evidence a study collects. `--profile quick|detailed` is accepted by `run`, `judge`, `report`, `cap plan` and `cap trigger`; the files are `profiles/quick.json` and `profiles/detailed.json`.
A profile changes what is collected, not how it is scored (`profiles/scoring.json` still holds the weights).

| | quick | detailed |
| --- | --- | --- |
| replicates per cell | 1 to 3 (default 2); more is refused | at least 5 (default 5); fewer is refused |
| A/A arm | none | added by `run`: the first konductor arm repeated at its exact commit (`v1.2.0-b` for `v1.2.0`); skipped when the arm list already has a pair with the same ref, arm config and prompt prefix |
| skill studies | no controls | known-answer keep and prune controls (`cap controls`), at least 8 scenarios per skill (`cap scenarios`); `cap plan` warns when it has fewer tasks |
| judging | rubric, pairwise | rubric, pairwise and graded, each pair in both answer orders |
| human calibration | none | `calibration-sample.json` and `.md` written to the results directory (the draw `calibrate export --n 25 --seed 1` makes) |
| report | `--detail quick`; a result under 3 runs is labelled anecdotal | `--detail full`; a "Profile check" lists what the run still lacks |

`--detail` still wins over the profile. With a profile, `cap plan` prints no default budget and `cap trigger --mode live` does not require one.

Credit ledger: `run` and `judge` append one JSON line per agent run and per judge call to `credit-ledger.jsonl` in the results directory (`kind`, arm, task, replicate, `credits`, `charged`, `cached`; `backfill` lines correct earlier runs) and print
`credits: this command X (no cap), study total Y (runs R, judge J)` after each one and at the end. A censored run is totalled at its charge. `--budget-credits X` is optional: at 90% of X
(counted for the command, not the whole directory) no new run or call starts; a command that ends past 100% exits 3. `report` prints the ledger total.

Platform verdict: `report --run DIR[,DIR...] --verdict platform [--baseline vanilla] [--out DIR] [--format md|html|both]` writes `verdict.md`, `verdict.html`, `verdict.json` and `charts/verdict-quality.svg`
instead of the normal report. Each run directory keeps its own refs; one arm in several directories is pooled by exact ref, so `main@7428dd9` and `main@f031534` are two arms and are never merged.
For each arm against the baseline, on the tasks both ran: quality /100 and the difference with its paired 95% interval, reliability /100, autonomy /100 where present, cost ratio (credits per successful run),
latency ratio (mean wall clock), run counts, replicates in the smallest cell, the A/A noise, the lowest diligence rating over its directories, graded-judge figures and failed-run counts.
Efficiency is a ratio and never a 0 to 100 number. A failed run with nothing to score counts as quality 0; infra errors and model mismatches are listed and left out of quality.
- KEEP: quality up by more than the A/A noise, paired 95% interval above 0, reliability not clearly lower, cost at most 2.0x vanilla per successful run. DISCARD: the same for a loss (its cost is not weighed).
- The interval is paired by cell, one task in one run directory: each cell gives the arm's mean score minus the baseline's, and the interval is a t interval on those differences. Runs of one task are not independent, so a bootstrap over pooled runs is printed only as a descriptive column. With no true effect, 5 to 12 cells of 5 replicates, a task spread of 20 points and a run spread of 12, the paired interval excluded 0 in 4.1% to 6.5% of trials; the pooled bootstrap excluded 0 in about 20% of trials at 3 runs a side (`node bench/scripts/sim-interval-size.js`).
- NOT ENOUGH EVIDENCE otherwise. It is forced by: fewer than 3 runs on a side, fewer than 5 paired task cells, a difference inside the A/A noise, an anecdotal diligence rating. It also follows from: no A/A noise measured,
  fewer than 3 replicates in a cell, an interval that includes 0, a quality gain with clearly lower reliability or a cost over 2.0x, more than a fifth of the runs on a side without a score (infra error, model mismatch, nothing to score), or the arm and the baseline scored on different components (for example the rubric present for one and missing for the other) in any cell. The A/A noise is pooled over every paired task cell of an arm and its repeat: the larger end of the 95% interval of the per-cell differences, never under 5 points, and unavailable below two paired cells.
- Every reason that applies is printed. A directory without the baseline arm is listed and skipped.

## Orchestrator study: cells, gates, metrics and the pass rule
This is how to compare a test branch against vanilla and against main, across models and harnesses, and read the answer. Nothing here needs a cap.

Cells. A cell is one (harness, model) pair. Run each cell into its own directory (one cell per directory) with the same arms, tasks, seed and profile, then give every directory to one report:
- Kiro v3 with Claude Sonnet 5.5: `--agent-engine v3 --model claude-sonnet-5.5`.
- Kiro v3 with GPT: `--agent-engine v3 --model gpt-5.6-sol`. The runner passes the model to `kiro-cli` and fails a run whose session ran on another model (`modelMismatch`). `judge` drops any judge from the subject's own family from a default or suite panel and takes the next one from deepseek-3.2, glm-5, qwen3-coder-next, minimax-m2.5, so a GPT subject is judged by deepseek-3.2, glm-5 and qwen3-coder-next. Judges named with `--judges` are never rewritten.
- Claude Code cell: `cc-vanilla`, `cc-main` and `cc-name=<git ref>` arms run through `claude -p` on Amazon Bedrock and cost USD, not credits. See "Claude Code harness". Run each cell into its own directory like the Kiro cells.

Arms. `--arms vanilla,orch-all=dir:PATH,main,orch-coord=dir:PATH` with `--arm-config orch-coord=orchestration.mode=coordinator`. `--arm-config name=key.path=value[;key.path=value]` writes those keys into that arm's scratch `~/.konductor/config.yml` after the install, so the arm starts its session with them. `orchestration.mode` takes `auto` or `coordinator`; a misspelled orchestration key is refused, because the CLI would otherwise fall back to `auto` without saying so. Vanilla refuses the flag, `run-config.json` and `result.json` record it, and two arms at one ref with different configs are two arms: only an arm with the same ref and the same config counts as an A/A repeat. With `--profile detailed` the first konductor arm in the list is repeated automatically (put the arm under test first), which gives the A/A sentinel.

Isolation gates. Both fail loudly and keep the runs.
- The real `~/.konductor/installs` (of every real home of the account, by resolved path) is hashed before and after each run and each batch. A run whose window saw a change becomes an error with the flag `installsChanged`, its spend kept. The batch writes `isolation-gate.json`, and `summary.json` records the gate and, when any run was flagged, `installsChangedRuns: [{arm, task, rep}]`. The batch alarm follows the runs: `run` prints `ISOLATION FAILURE` with the flagged runs and the runs that saw no change, and ends with exit code 4, only when at least one run window saw the change. A change outside every run window (between runs, before the first, after the last) is a `WARNING` with the batch time window and exit code 0; `isolation-gate.json` then has `ok: true`, `outsideRuns: true`, `window` and `warning`, and no run is marked. `--gate-strict` restores the old rule: any change at batch level is `ISOLATION FAILURE`, exit code 4. A batch with no change writes the same files as before. A scratch HOME never needs this directory, so any change means a command ran against the real one. The gate cannot tell a leaking run from your own `konductor install` or `update` in another terminal on the same account, so do not run those while a batch is going.
- A Claude Code run gets a scratch `CLAUDE_CONFIG_DIR` with `rules/empty.md`, 0 bytes, and nothing else under `rules/`, so the host's `~/.claude/rules` is not read. `ensureEmptyClaudeRules` refuses the real `~/.claude`. The Kiro cells do not use it.

Metrics. Each run's `result.json` has an `orch` record, read from `stream.jsonl` and the workspace snapshot; `report` and `contrast` backfill older run directories from those files. `report` has an Orchestration table; `contrast` has the rows below, and `--phases ID,ID|all` adds the phase-document rows (leave it off for tasks that do not run the SDLC, where it would read 0%).
- spawns: agents handed work through the subagent tool, one per stage. max spawn depth: how many spawns deep the deepest sits (1 is a spawn by the main agent).
- review rounds: spawns recognised as a review. reworks after a pass: fix spawns issued while the latest review before them had passed. Both come from text rules in `profiles/orch-metrics.json` (patterns over the brief and the returned text, an explicit `Verdict: WORD` first). They are heuristics: read a sample of runs when you change a pattern, and treat an `unknown` verdict as unknown, never as a pass.
- phase documents: whether each phase's files exist and are not empty, from `profiles/phase-documents.json` (taken from the full-SDLC SOP's artifact layout). A phase with a `*` is complete only when every feature that has any of its documents has all of them. The shipped tasks do not ask for the whole SDLC; use `--extra-tasks` for a task that does.

Pass rule. `report --run DIR[,DIR...] --verdict orchestrator-pass [--baseline vanilla] [--test-arms ARM,ARM] [--changed-skills NAME,NAME] [--phases ID,ID|all] --out DIR` writes `orchestrator-pass.md`, `.html` and `.json`, one call per test arm per cell: PASS, FAIL or NOT ENOUGH EVIDENCE.
- Cost: the arm costs at most 2.0x vanilla, both as mean credits per executed run and as credits per successful run, on the cells (run directory and task) both ran. A run with no metered cost (killed before its last metering event) is charged only a lower bound by the ledger; when counting such runs of the arm at the largest metered cost of their task would push a ratio over 2.0x, the cell is NOT ENOUGH EVIDENCE and the page says how many runs are involved.
- Quality: paired by cell (one task in one run directory), the arm's mean quality minus vanilla's, with a t interval on the per-cell differences. The tolerance is the pooled within-cell standard deviation of vanilla's scores (how much a vanilla run varies on one task, not across tasks), never under 5 points. The arm meets it when the lower end of the interval is at least minus the tolerance. A difference below minus the tolerance fails; one above it whose interval reaches below it is NOT ENOUGH EVIDENCE. A gain meets it.
- A/A sentinel: the quality drift is pooled over every paired task cell of an arm and its repeat (the larger end of the 95% interval of the per-cell differences, in quality points; at least two paired cells); the cost drift is the largest cost ratio gap. A criterion whose effect is not larger than the drift is uncertain. A clear failure on the other criterion still gives FAIL; otherwise the cell is NOT ENOUGH EVIDENCE. This means an arm that is simply as good as vanilla is NOT ENOUGH EVIDENCE rather than PASS: the study cannot tell it from drift. The page also prints whether the raw thresholds were met.
- Also NOT ENOUGH EVIDENCE: fewer than 3 scored runs on a side, fewer than 5 paired task cells, no A/A repeat in the cell, no vanilla task with two scored runs, more than a fifth of the runs on a side without a score, the arm and vanilla scored on different components in any cell, and a change that lives only in skills (the arm records the skills its diff touches, or pass `--changed-skills`) when none of those skills loaded in any run of the arm, or no load data was recorded. A mixed change only gets a note.
- Failed and timed-out runs stay in: a run with nothing to score counts as quality 0 and its cost counts. Infra errors and model mismatches are left out of quality, listed, and capped at a fifth of the runs on a side. The drift used by the sentinel is at least 5 quality points.
- GPT cell: judged on its own ratios to vanilla. The Claude cell on the same harness is printed beside it as ratios, per run and per successful run, and their quotient. Raw credits are never compared.
- Cells are keyed `harness engine / model`, for example `kiro-cli v3 / gpt-5.6-sol`; directories of one cell are pooled by exact ref.

Commands (replace PATH with the worktree of the test branch and V with a results directory):
```
node bench/runner/bench.js run --suite lite --arms vanilla,orch-all=dir:PATH,main,orch-coord=dir:PATH --arm-config orch-coord=orchestration.mode=coordinator --agent-engine v3 --model claude-sonnet-5.5 --profile detailed --seed 20261101 --out V/claude
node bench/runner/bench.js run --suite lite --arms vanilla,orch-all=dir:PATH,main,orch-coord=dir:PATH --arm-config orch-coord=orchestration.mode=coordinator --agent-engine v3 --model gpt-5.6-sol --profile detailed --seed 20261101 --out V/gpt
node bench/runner/bench.js judge --run V/claude --profile detailed
node bench/runner/bench.js judge --run V/gpt --profile detailed
node bench/runner/bench.js contrast --run V/claude --base vanilla --out V/contrast-claude
node bench/runner/bench.js report --run V/claude,V/gpt --verdict orchestrator-pass --out V/pass
```
Free checks before spending: `run ... --prepare-only` builds and trial-installs every arm (v3 arms with `konductor install --harness kiro-v3 --no-telemetry`) and starts no agent.

## Running a study unattended
`bench/scripts/` holds the scripts for long studies: `run-real-pilot.sh` (capability study), `run-after-capability.sh` (judging, the skill bench and a summary, chained after it), `run-judging.sh`, `run-skill-bench.sh` and the read-only dashboard `monitor.sh`. Setup, commands, credentials, what each phase does and how to read the monitor are in [RUNBOOK.md](RUNBOOK.md).
