# Capability playbook: evaluate skills, then keep, fix, trim, relocate or prune

This is the how-to for the `cap` family in [README.md](README.md). It answers three questions: how to run the benchmark, how to
evaluate a skill, and whether a skill should be pruned. Everything marked free spends no credits and calls no model.

## What each tool answers

| Tool | Question | Cost |
| --- | --- | --- |
| `cap audit --base REF` | Can any agent reach the skill? Is the description well formed? How big is it? Does a near duplicate exist? Does a task cover it? | free |
| `skills --run DIR` | Which skills did this run load? | free |
| `cap prune-report --base REF --runs-glob 'DIR/*'` | Across all finished runs: how often was each skill offered and loaded, and what do the audit and the evidence file say? One recommendation per skill and harness. | free |
| `cap trigger --mode proxy` | Would a model pick this skill for a query? Retrieval misses and judgment misses are counted apart. Generous: a hit is not proof. | about 0.09 credits per call |
| `cap trigger --mode live` | Does a real agent load it, or delegate first? Stops at the first load. Spend is not metered. | unobserved, cap it |
| `cap plan --mode lift`, then `run`, `judge`, `contrast` | Does having the skill change cost, speed or quality? Needs an A/A arm to read the result. | tens of credits |
| `cap scenarios --cap ID --dry-run` | Which 8 or more tasks would test this skill? The dry run writes the prompt only. | free (the live call is one model call per skill) |
| `cap controls --out DIR`, then `--check RUN` | Does this study find a lift that was planted and none for a decoy? | free to write and check; the run is a few credits per run |
| `report --verdict platform` | Is the platform worth keeping against vanilla? One page, one call per arm. | free |
| `cap skill-plan --base REF --runs DIR` | Which skills get a lift study, on which tasks, with how many runs and at what estimated cost? | free |
| `cap skill-study --study DIR`, then `cap decide --study DIR` | For each skill: delete, prune (which sections, which lines, move or remove) or keep? | tens to hundreds of credits per skill |

The prune report is a recommendation, never a deletion. A person decides, with the checklist at the end.

## Harness differences that change the answer

- **kiro-cli** loads a skill on demand through `get_skill`. A skill nobody loads costs nothing per session. Each agent can load only
  the skills its spec lists (`--skill-name-filter`), so a skill listed by no agent is unreachable. SOPs are prompts a user invokes; `get_skill` does not return them.
- **opencode** puts the name and description of every skill into each session at startup (parent-session loads only are visible in
  its stream). Every description is paid for on every session, so size and wording matter more. Claude Code works the same way by design; this bench does not run it.
- **The orchestrator picks skills by name from its own prompt.** In the live checks it asked for skills by name and never used `find_skills`.
  Editing a description alone may therefore change nothing on kiro-cli. Change the prompt or the routing text, or test it.
- A skill that no kiro agent lists may still be wired for Claude Code (`clientConfig.claudeCli.skills`). That is RELOCATE, not PRUNE.

## Decision table

Rules apply in this order per skill and harness. TRIM is a separate flag beside the class.

| Class | Rule | Do this | Never |
| --- | --- | --- | --- |
| HARMS | Evidence verdict `hurts` on rows that add up to at least 6 runs (fewer is NEEDS DATA) | Look at it first. Rerun with more replicates before acting. | Act on a delta inside the A/A spread |
| RELOCATE | Unreachable on every assessed harness, and its text, owner or Claude Code list says another harness | Keep it where it is listed | Prune it |
| PRUNE | Unreachable on every assessed harness, no sign of another | Open a prune review (checklist below) | Prune because it is unreachable on one harness only |
| FIX | Reachable, offered in at least `--min-exposure` runs (default 10, minimum 3; under 10 prints a note), loaded 0 times. Confidence is low under 5 exposed runs and never high under 30 | Check discovery: routing text, description, prompt. Run `cap trigger` queries that should load it. | Delete it |
| KEEP | Evidence verdict `helps`; or registry class `preference` with loads; or loaded in 30% or more of exposed runs with a behavior change in the evidence file | Leave it | Treat a load rate alone as proof |
| KEEP (provisional) | Loaded in 30% or more of exposed runs, no evidence of effect | Leave it, plan a controlled run | Cite it as a measured benefit |
| NEEDS DATA | Everything else, including exposure below the minimum | Gather runs or evidence | Decide on it |
| TRIM | Bytes above the 90th percentile of skills, or a near duplicate with Jaccard above 0.6 | Move detail into reference files or merge with the neighbour | Delete the content |

Thresholds that are our own, not from an external source: the 30% load rate, Jaccard 0.6 for near duplicates, the p90 size cut, the minimum
exposure of 10 runs, evidence of at least 6 runs, the A/A rule, the 0.95 ceiling, the 600 and 60 character description limits, the 5% leakage
limit, and the mapping from classes to keep, prune candidate, needs human review and incomplete. Use them as prompts to look, not as findings.
Only the 1024 and 64 character limits come from the Agent Skills specification.

Exposure means an agent in the run could load the skill, not that the task needed it. Runs that were not built around a skill
will show zero loads for it. FIX is a prompt to check, and the report lowers its confidence when no task is linked to the skill.

## Order of work

1. Free: `cap audit`, then `cap prune-report` over every run directory you have.
2. `cap trigger --mode proxy` on skills in FIX or with a stored query set. Read recall first; treat hits with suspicion.
3. `cap trigger --mode live` on a handful of queries to cross-check the proxy (kappa below 0.6 or under 12 queries means "proxy not validated").
4. Lift run: `cap plan --mode lift --profile detailed` (pass `--tasks id,id` when the registry links no lift task), with a base arm and an A/A copy of it, on tasks with headroom. Judge before you read lift.
   The detailed profile asks for at least 5 replicates and at least 8 scenarios (`cap scenarios`, then review and turn the good ones into tasks), and prints the controls step.
   Run the controls first (`cap controls --out DIR`, run what it prints, `cap controls --check`). If the check exits 1, do not read any skill verdict from the study.
5. Write the result into the evidence file, rerun `prune-report`, then decide.

## Reading the results

- `cap prune-report --detail quick|full` opens with a scorecard for the report itself (is there enough data behind the classes?), then class bars, load-rate bars and a size-against-load scatter.
- Each skill has a decision card (full): load rate with a Wilson interval, cost when loaded, lift and normalized gain from the evidence file, whether the effect clears the A/A noise, and a checklist of what is missing.
- Load rate is runs that loaded the skill through a skill tool call over runs where an agent could. It is not comparable to SkillsBench's skill invocation rate (task-matched trials, reads or invokes). A direct read of a SKILL.md is not counted as a load here.
- Lift on the card is `withValue` minus `withoutValue` from the evidence file, in points. It is not paired by task and has no interval; the evidence file holds no per-task pairs to build one.
- Normalized gain is `(with - without) / (1 - without)`. For a loss it is `(with - without) / without`, which stays between -1 and 0. When `without` is 0.95 or more the card warns that the gain can overstate small differences.
- The decision-board verdict says prune candidate only for HARMS or PRUNE with medium or high confidence, a delta outside the A/A spread and consistent units; a HARMS class also needs 6 evidence runs. Otherwise it says needs human review.
- Trigger precision, recall and F1 are per query by majority vote over repeats. skill-creator counts per run. F1 and its interval are our own.
- Read the card before the class. A bar of zeros is exposure, not need. A `helps` row inside its A/A spread is flagged and does not count.
- For a lift run, `report` and `contrast` (`--detail full`) show the forest plot with the noise band; trust a delta only outside it, and look at the scorecard rating first.

## Add a capability and its tasks

1. `cap list --init --cap skill:NAME` prints a registry skeleton. Save it under `capabilities/skill/`, fill in `owner`, run `cap audit`.
2. Tasks need hidden tests or a judged rubric, not regex checks alone (`cap plan` refuses those without `--allow-regex`).
3. Record headroom: a calibration pass where the arm without the skill scores under 70%. At ceiling, no skill can show lift.
4. The prompt must not name the skill or copy its text. `cap audit` fails above 5% shared 8-word shingles.
5. Draft trigger queries with `cap draft`, then review them by hand: about half should-not, and at least half of those near misses.
6. `class: preference` marks a skill tested for fidelity (it makes the agent follow a house rule), not for lift.

## Evidence file

A JSON list, passed with `--evidence FILE`. Copy [capabilities/evidence.example.json](capabilities/evidence.example.json) and edit it.
Fields: `capId`, `harness` (`kiro-cli` or `opencode`), `kind` (`lift`, `trigger`, `ablation`), `task`, `n`, `delta`
(with the skill minus without, higher is better), `aaSpread`, `verdict` (`helps`, `hurts`, `none`, `unmeasurable`), `runId`, `note`,
and optional `behaviorChange`, `withValue` and `withoutValue` (pass or mean rates, 0 to 1).
`delta`, `aaSpread`, `withValue` and `withoutValue` share one 0 to 1 scale, not percentage points. A `delta` or `aaSpread` outside that range is rejected,
and a `delta` that differs from `withValue - withoutValue` by more than 0.02 gets a warning and keeps the card at needs human review. A `helps` or `hurts` verdict whose delta sits inside the A/A spread is flagged and capped at low confidence.
The file is kept by hand; the report reads it and never writes it.

## Pitfalls

- **Ceiling effects.** If the arm without the skill already passes nearly everything, lift cannot show.
- **n=3 is anecdotal.** Three replicates of one task say what happened, not what will happen.
- **A/A spread.** Run the same ref twice as separate arms. A delta smaller than the gap between them is noise.
- **Regex-only scoring** rewards phrasing, not quality. Prefer hidden tests or a rubric judged by several judges.
- **Truncated judge bundles.** Files cut at a character cap hide content; check the limits before reading a rubric score.
- **Rubric ceiling.** Raw rubric scores near 1.0 everywhere leave nothing to separate; verified scores then mostly track length.
- **Early-stop credit censoring.** A run killed at the first load has no metered credits. Do not compare its cost with a full run.
- **Proxy generosity.** The proxy shows the model the skill-related prompt text, so it over-triggers. Misses are informative, hits are not.
- **Mixed refs.** The report keeps usage per ref. Do not read an overall rate across refs that differ in what they list.

## Worked example: `delegation-protocol` (one pilot, n=3)

The skill tells the orchestrator how to build a delegation prompt with eight labelled sections. A variant of v1.2.0 without it
ran against two copies of v1.2.0 (the A/A pair) on one design task, three replicates each.

- Cost, speed, tool calls and pass rate: the dropped-skill delta stayed inside the A/A spread on every metric. The rubric mean was 0.08 higher with the skill, against a spread of 0.09.
  Verdict: **unmeasurable**, an uninformative result and not a null.
- Behavior: when the skill loaded, all five delegation prompts carried the eight labelled sections; in the six runs without a load, none did (5 to 7 of 8 present).
- Loading was a coin flip: 3 of 6 base-arm runs loaded it. Across all 31 offered runs on file it loaded in 9, about 29%.
- Read together: the report gives it NEEDS DATA, one run short of the 30% line, even with the behavior change recorded. That is the honest reading.
  The next step is a forced-load arm (a fixed first instruction to load it) against the dropped variant, on a task that needs a multi-agent handoff.

## Credit guide (observed, a guide and not a forecast)

One pass, n=1 per cell, claude-sonnet-5.5, from the README table: lite suite (5 tasks) 6.78 credits vanilla, 23.31 on v1.2.0; real suite (7 tasks) 14.22 and 61.32.
In the pilot above: a typical design run cost about 4.4 credits, the largest 11.07, and judging added about 0.5 per run, so 9 runs plus judging came to about 52.
Proxy calls cost about 0.09 each and draft calls 0.7 to 0.9. Free steps (audit, prune-report, skills, plan) cost nothing.
A cap is optional. Without `--budget-credits` nothing stops a run, and every run and judge call is a line in `credit-ledger.jsonl` in the results directory, with a running total printed.
With `--budget-credits X`, `run` stops launching at 90% of X (and when charged credits plus the largest run so far would pass X); a command that ends past 100% exits 3.
Judging graded mode adds two calls per pair per judge, so a detailed study judges about three times as many calls as a rubric-only one.

## Judge backends

Judging goes through kiro-cli by default. kiro-cli adds about 7.2k to 11.4k tokens of its own agent prompt and tool definitions to every judge call, and a replay of cached prompts through a bare model path differed from the kiro answers for gpt-5.6-luna pairwise ties and for deepseek-3.2 rubric severity. `--judge-backend opencode` asks the same panel through `opencode run` on Amazon Bedrock with the tools off and a one-line system prompt. Details, the panel-to-Bedrock map and the limits are in `README.md`, section "Judge backends".

- One backend per results directory, and per panel in a study. Do not judge half a study on each; the command refuses it and `report` flags pooled directories judged on different backends.
- Costs are in USD (`--budget-usd`), read from opencode's session database; credits stay 0.
- gpt-5.6-luna cannot run at temperature 0 on Bedrock, so a luna verdict is not a temperature-0 verdict on this backend.
- The Bedrock model behind a name may not be what kiro serves under that name. Treat a kiro-versus-opencode difference as "the setups differ", not as proof the wrapper caused it.
- Cross-check by judging a copy of a finished directory on the other backend, then compare the two `judgments.json` files; never merge them.

```
node bench/runner/bench.js judge --run V/claude --judge-backend opencode --aws-creds-file CREDS --aws-profile bench --aws-region us-east-1 --profile detailed --budget-usd 25
node bench/runner/bench.js judge --run V/gpt --judge-backend opencode --aws-creds-file CREDS --profile detailed --budget-usd 25
```

## Per-skill study: delete, prune or keep

The platform report says whether konductor beats vanilla. This study asks the other question, skill by skill: should this skill be deleted, pruned (and which sections, which lines, moved or removed) or kept.

1. `cap skill-plan --base REF --runs 'DIR' --out PLAN` (free). Read the tier table first. A lift study needs the skill to load, so skills that never loaded in the runs on file stay in the triage tier (the free audit and, where queries exist, a trigger check). Why not all of them: a with-versus-without run of a skill nobody loads measures nothing, and one skill study at the detailed profile is hundreds of credits.
2. Draft and add scenarios where the plan reports a shortfall (`cap scenarios`), review them by hand, add them as tasks. The plan lists the tasks it found: registry links, tasks that name the skill, tasks where it loaded.
3. `bench/scripts/run-skill-bench.sh --dry-run`, then the real run. The script refuses while any other bench study is active and checks the credentials file path first. Controls run before any skill; if they fail, stop and fix the pipeline. To run it unattended after a capability study and watch it, see `bench/RUNBOOK.md` (`run-after-capability.sh`, `monitor.sh`).
4. `cap decide --study DIR` (the study runs it at the end). Read `decisions.md`; open the patch only for DELETE and PRUNE calls.
5. `cap criteria --study DIR` (free, no model call, advisory). Read `criteria/criteria.md` before planning the next study: a rubric criterion or check that always passes, always fails or sits inside the margin in every arm (NON-DISCRIMINATING, SATURATED) gave the study no information, and one the judges or replicates disagree on (HIGH-VARIANCE) adds noise. Reword, replace or drop those items in the task files; the report never changes a call.

How a call is made, in order: controls passed; an A/A arm; scores on a 0 to 1 scale; at least 15 runs per side; the skill loaded in at least 30% of control runs. Then the delete arm against the control: removing it improved quality outside the A/A spread (DELETE as a harm call); removing it stayed inside the 0.10 margin with an interval that excludes a larger loss and an A/A spread under the margin (DELETE as no effect); removing it lost quality outside the spread (the skill is needed, so test its sections). For a needed skill, a section whose removal is within the margin is removed; one whose removal lost quality but whose move to `references/` is within the margin is moved; the rest is kept. Several cuts cap the confidence at medium because they were tested one at a time: run the combined cut as one arm before merging. Anything weaker is NEEDS DATA with the reason.

What it cannot show: a section moved to references may never be opened (the move arm counts the runs that opened the file; zero means the move behaved like a removal); the quality score covers the study tasks only; kiro-cli loads skills by name through the skills server, so a changed description or index entry changes whether the skill loads at all, which this study holds fixed. Small effects need more runs than a pilot has: the earlier delegation-protocol lift run was unmeasurable at n=3 for this reason.

## Pruning pull request checklist

- [ ] The prune-report row quoted with class, confidence and the "what would change this" text, and the report's base ref and date.
- [ ] Harness stated. For a skill unreachable on one harness, the other harnesses are named and checked.
- [ ] Run directories listed with counts per ref, exposure, loads and the minimum used.
- [ ] Evidence rows added to the evidence file, each with `runId`, `n`, `delta`, `aaSpread` and a verdict.
- [ ] No inbound references broken (`cap audit` lists skills, SOPs, context files and prompts that name it).
- [ ] No agent spec, claudeCli list or SOP still lists it.
- [ ] What would reverse the decision, written down (for example: any load in the next N runs, a task that needs it).
- [ ] A person other than the author has read the evidence rows.

## Keep or discard the platform

After a detailed run per suite, `report --run DIR1,DIR2,DIR3 --verdict platform --out OUT` gives one call per arm against vanilla, named by exact ref (`main@f031534`).
Read the verdict column, then the reason. NOT ENOUGH EVIDENCE is not "no better": it means this study cannot say. The usual fixes are more replicates, an A/A arm and judged output.
If the answer is KEEP, the next questions are which skills to trim and where the latency goes. `cap audit` and `cap prune-report` answer the static half for free; a trim is
confirmed only by a lift run (`cap plan --mode improve --candidate FILE`) on the trimmed text.

Move or remove: a section that tells the agent how to act belongs in the skill. Worked examples, long tables, templates and checklists the agent reads only sometimes belong in a
reference file next to the skill (`references/NAME.md`, linked from `SKILL.md`), so they cost nothing until opened. Text that repeats the description, repeats another skill, or
restates what the base prompt already says is removed. Keep the removed text in the commit message, not in a file.

## Orchestrator study
Use this when the question is whether a branch that changes how the orchestrator works (spawning, review, modes, preloaded skills) is worth keeping against vanilla and against main. The full rules and flags are in `README.md`, section "Orchestrator study".
1. One cell per directory. A cell is a (harness, model) pair: Kiro v3 with Claude, Kiro v3 with GPT. Same arms, tasks, seed and `--profile detailed` in each. Put the arm under test first so the automatic A/A repeat repeats it.
2. Free first: `--prepare-only` on each cell, then `node --test "bench/runner/test/*.test.js"` if the bench itself changed.
3. Run, then judge, then read the verdict. A GPT cell is read as ratios to vanilla next to the Claude cell, never as raw credits.
4. A coordinator-mode arm is the same ref with `--arm-config NAME=orchestration.mode=coordinator`; it is a second arm, not an A/A repeat.

```
node bench/runner/bench.js run --suite lite --arms vanilla,orch-all=dir:PATH,main --agent-engine v3 --model claude-sonnet-5.5 --profile detailed --prepare-only
node bench/runner/bench.js run --suite lite --arms vanilla,orch-all=dir:PATH,main --agent-engine v3 --model claude-sonnet-5.5 --profile detailed --out V/claude
node bench/runner/bench.js judge --run V/claude --profile detailed
node bench/runner/bench.js contrast --run V/claude --base vanilla --out V/contrast
node bench/runner/bench.js report --run V/claude,V/gpt --verdict orchestrator-pass --out V/pass
```

What goes wrong, and what catches it:
- The host's `~/.claude/rules` read by a Claude Code run: every scratch `CLAUDE_CONFIG_DIR` gets a 0-byte `rules/empty.md` and nothing else.
- A probe or install writing to the real `~/.konductor/installs`: hashed before and after every run and batch; a change fails the run (`installsChanged`) and the batch (exit code 4).
- Same-day drift as large as the effect: the A/A repeat measures it; the pass rule calls a cell NOT ENOUGH EVIDENCE when drift is not smaller than the effect.
- A change that lives only in a skill the agent never loads: the cell is NOT ENOUGH EVIDENCE when none of the changed skills loaded in any run of the arm. Check `skills --run V/claude` as well.
- Review rounds and reworks after a pass come from text heuristics. Read a few runs before quoting them.
