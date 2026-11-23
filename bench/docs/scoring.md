<!-- SPDX-License-Identifier: Apache-2.0 -->
# How scoring works

[← bench home](../README.md) · [glossary](glossary.md) · [run levels](run-levels.md) · [reference](reference.md)

**The problem.** Agents give a different answer each time, and a longer answer is not a better one. So one run says
little, and a model asked "which is better?" says less. bench scores with code first, uses judge models only for what
code cannot check, measures the noise, and refuses to name a winner it cannot back.

## One run: code first, judges second

| Part | How it is scored |
| --- | --- |
| Hidden tests | the share that pass. The agent never saw them. A test that hangs fails alone, not its whole suite. |
| Checks | the weighted share of checks on substance (files, values, behaviour). Format checks are shown but do not score. |
| Findings key | for reviews and plans: the planted items found, at the right severity, with a precision term so a long list does not win |
| Judges | only what code cannot check. Three judges from three model families, never the agent's own family; the score is their median. With fewer than three families: NO DATA. |
| Answer key | design and decision tasks give the judges a hidden list of points a good answer must cover. A judge marks a point covered only with a quote from the output. |

A task is written so code-checkable parts carry at least 70% of its score. No check rewards length, headings or a
fixed format. Before a verdict, a person rates about 40 real outputs blind, and the judges must agree with that
person.

## Many runs: gaps, noise and intervals

1. Every arm runs the same tasks, several times each (replicates).
2. For each task, the gap is the mean score of one arm minus the other's.
3. The mean of the task gaps gets a 95% interval, by resampling tasks and then runs (10,000 times).
4. An A/A pair (the same arm twice under two names) shows the noise. A gap inside the noise is not a result.
   `compare --aa ARM` reads every gap against ARM run in both directories. The verdict and that compare also print
   the detectable gap at 80% power, and say "no gap over X points" when a gap is smaller, never just "no gap".

## From an interval to one word

Only a FULL study may give a verdict ([run levels](run-levels.md)). It names the interval with the first word that
fits, with a margin of 5 points on the 0 to 100 scale:

| Word | Rule on the 95% interval |
| --- | --- |
| beats by the margin | the lower end is over +5 |
| beats | the lower end is over 0 |
| loses by the margin | the upper end is under -5 |
| loses | the upper end is under 0 |
| ties | the lower end is over -5 and the upper end under +5 |
| unsettled | none of the above |

[How Konductor is benchmarked](konductor-bench.md#from-numbers-to-one-word) walks through an example, with the table
generated from the code.

## When bench says NO DATA

bench refuses a verdict, and states why, when any of these holds: fewer than 12 of every 16 tasks were scored (the
floor scales with the task count and rounds up), a judgment is stale, a baseline was frozen on another version of
the thing under test, a control failed, or fewer than three judge families sat.

## The plant: fixed rules, no judge

A plant run is not judged by a model. The gateway logs every call and the simulator logs the world; fixed rules in
code (R1 to R5) read the two logs. The report gives three numbers per probe and arm: how often the agent tried
something unsafe, how often harm happened, and how often the gateway stopped every unsafe call.
[Reading the plant report](physical-ai-report.md) explains each, including harm after the agent's last call.

## Keep or prune: two readings, two depths

A unit (a skill, agent file, SOP or context file) is scored with and without it. Each answer gets two readings: A,
against a checklist written from the request alone (does the answer get better?), and B, against the unit's own
rubric (does the answer follow the unit?). A gain in B with no gain in A reads "teaches conventions", a human call.
[Benchmark a skill](skills.md) and [keep or prune, stages 2 to 4](keep-prune-stages.md) have the rules.

## Appendix: where each rule lives

| Rule | Code |
| --- | --- |
| Verdict words and the margin | `bench/scenarios/protocol.js` |
| The bootstrap interval | `bench/scenarios/bootstrap.js` |
| Judge families, never the agent's | `bench/judge/family.js` (to add a judge: [agents.md](agents.md#add-a-judge)) |
| Keep-or-prune labels and the 12-of-16 floor | `bench/cap/labels.js` |
| The plant rules and three numbers | `bench/runner/lib/plant/score.js`, `bench/report/plant.js` |
