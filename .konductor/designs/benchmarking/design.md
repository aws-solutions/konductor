---
name: Skill Benchmarking Framework
description: An A/B output-quality benchmark that determines whether pruning or trimming a skill would change output quality
tags:
  - benchmarking
  - quality-gate
  - skill-management
---

# Skill Benchmarking Framework Design

**Status:** Proposed
**Date:** 2026-09-29

## Problem

Konductor ships 82 skills under `skills/`. Nothing measures whether a skill earns its token cost. Three concrete gaps:

- **No output-quality signal.** A skill might change what an agent knows, but nothing measures whether it changes what the agent produces. `dynamodb-design` and `dynamodb-validation`, or `code-review` and `adversarial-code-review`, could overlap in effect, and there is no evidence either way.
- **No activation signal.** A skill's `description` states an activation condition, but nothing checks whether it actually loads when a matching request comes in.
- **No cost signal.** Every skill loaded into an agent's context costs tokens on every session. There is no per-skill measurement of whether that cost buys better output.

The existing harness under `tests/` (`scripts/benchmark.js` at the repo root, `tests/judges/claude-code-agent-runner.js`, `tests/registry.json`, per-agent scenario sets in `tests/asdlc-*/`) benchmarks two agents end-to-end against hand-written scenarios with a single subject model. It answers "does this agent pass its scenarios," not "does removing this skill change the output." This design replaces it: the run matrix, the A/B comparison, and the council-based judgment are different enough that adapting the existing harness in place would leave two half-compatible schemas.

Design target: konductor's `skills/` (82 skills).

Out of scope: implementation code (`scripts/` ships as placeholders only), specific scenario content, council-model orchestration internals.

## Requirements

**Functional**
- Scriptable benchmark run on a configurable cadence (default monthly; see Non-functional), with no manual scenario curation per run.
- Every scenario runs in two environments per (harness, model): **A (konductor)**, an isolated HOME/target with the full Konductor install invoked through the `konductor` orchestrator agent, and **B (vanilla)**, an isolated HOME with no Konductor install invoked through the harness's own default agent. Same prompt, same model, same harness, fresh session per run, in both environments.
- A council of 5 models judges each (scenario, harness, model) pair by comparing A's output against B's, blind and pairwise, and decides per skill whether it improves output quality.
- Skills are scored against generated scenarios derived from the skill corpus itself.
- Output is a human-readable report and a machine-readable implementation plan.

**Constraints**
- The existing benchmark harness under `tests/` and `scripts/benchmark.js` (repo root) is deleted, not extended. See [Implementation Plan](#implementation-plan) for exact scope.
- The corpus to benchmark is a parameter (`corpus_path`), not hardcoded. It defaults to `skills/`.
- The model list per harness is config (`models.kiro`, `models.claude`), not hardcoded. Default expectation: at least 2 models per harness.

**Non-functional**
- The monthly report is written per the `humanize-writing` skill's conventions: no filler, no hedge words.
- Cadence is configurable (default monthly, supports bi-monthly or ad-hoc via `--frequency` flag); the framework does not run continuously or on every commit.

**Deferred (explicitly out of scope for this design)**
- Token budget threshold value, left as external config; no default proposed.
- Whether council votes should weight real usage/invocation telemetry alongside scenario evidence, scenario-only for now.

## Solution Overview

```mermaid
flowchart LR
    A[skills/ corpus] --> B[Scenario Generator]
    B --> C[scenarios.json]
    C --> D[Run Matrix Runner]
    D --> E["Env A: konductor
    (kiro-cli-v2 / claude)"]
    D --> F["Env B: vanilla
    (kiro-cli-v2 / claude)"]
    E --> G[Model Council: 5 judges]
    F --> G
    G --> H[Report Renderer]
    G --> I[Plan Renderer]
    H --> J[reports/YYYY-MM-report.md]
    I --> K[plans/YYYY-MM-implementation.json]

    style A fill:#64a0dc,color:#fff
    style G fill:#dc9632,color:#fff
    style J fill:#50b464,color:#fff
    style K fill:#50b464,color:#fff
```

Four stages, run on a configurable cadence (default monthly): **generate** scenarios from the skill corpus, **run** each scenario in both environments across the configured harness/model matrix, have a **council** of 5 models judge each A-versus-B pair per skill, and **render** both a report for a person and a plan for an agent to execute. Each stage writes its output to disk before the next stage starts, so a run can be resumed or re-scored without repeating earlier stages.

<a id="scenario-generation"></a>

## How It Works

### Scenario generation

```mermaid
flowchart TD
    A[Parse SKILL.md frontmatter] --> B{Description form?}
    B -->|trigger-clause| C[Lift 'Use when' clause into user request]
    B -->|behavior-summary| D[Synthesize request requiring that behavior]
    C --> E[Scenario prompt]
    D --> E
    E --> F[scenarios.json]

    style A fill:#64a0dc,color:#fff
    style F fill:#50b464,color:#fff
```

Every scenario traces back to one line in one skill's frontmatter, since there is no external scenario bank to validate against otherwise:

1. **Parse.** Extract `name`, `description`, `tags` from every `SKILL.md`.
2. **Seed prompt.** Trigger-clause descriptions ("Use when X") become a first-person request built directly from X. Behavior-summary descriptions ("Does X") get a synthesized request that would plausibly need X, via a template transform, not free generation.
3. **Purpose.** The seed prompt drives the A/B run described below. Judging compares the resulting outputs, not the seed prompt against the description.

`corpus-snapshot.json` records a content hash per skill alongside the generated scenarios, so a scenario can be flagged stale if its source skill changed before the next run.

### Run matrix

```mermaid
sequenceDiagram
    participant S as scenarios.json
    participant A as Env A: konductor
    participant B as Env B: vanilla
    participant Cl as Model Council (5)

    loop each scenario x harness x model
        S->>A: run prompt (konductor install, isolated HOME, fresh session)
        S->>B: run prompt (no install, isolated HOME, fresh session)
        A-->>S: transcript, activated skill(s), tokens, latency
        B-->>S: transcript, tokens, latency
        S->>Cl: A output, B output (relabeled X/Y, order randomized)
        Cl->>Cl: blind pairwise vote per skill
        Cl-->>S: verdict + dissent, aggregated per skill
    end
```

The run matrix is `scenarios x harnesses x models x {A, B}`. Harnesses are `kiro-cli-v2` and `claude`; models come from the config parameters `models.kiro` and `models.claude`, each expected to list at least 2 models by default.

**Environment A (konductor).** An isolated HOME/target directory with the full Konductor install (`konductor install --target <tmp-home> --harness <kiro-cli-v2|claude>`), invoked through the `konductor` orchestrator agent.

**Environment B (vanilla).** An isolated HOME/target with no Konductor install, invoked through the harness's own default agent (`kiro-default` for Kiro CLI, the default agent for Claude Code).

Both environments run the same prompt, same model, same harness, in a fresh session, for every `(scenario, harness, model)` combination. Before each B run, the runner checks that `.kiro/agents/konductor*` and `.claude/agents/konductor*` are absent from B's HOME. A match aborts that run as a setup failure rather than silently contaminating the comparison (see the environment isolation entry in [Threat Model](#threat-model)).

**Skill activation evidence**, captured per A run for diagnostic use (not scored directly):
- **Claude Code:** `Skill` tool-call events in the session transcript.
- **Kiro CLI:** skill-load evidence in the session logs or transcript.

Neither mechanism is independently verified as part of this design; both are asserted based on the harnesses' current logging behavior. See [Open Questions](#open-questions).

### Council judging

```mermaid
flowchart TD
    A["A output, B output
    (same scenario, harness, model)"] --> R[Relabel X/Y, randomize order]
    R --> J1[Judge 1]
    R --> J2[Judge 2]
    R --> J3[Judge 3]
    R --> J4[Judge 4]
    R --> J5[Judge 5]
    J1 --> V[Tally per skill]
    J2 --> V
    J3 --> V
    J4 --> V
    J5 --> V
    V --> M{Majority of 5?}
    M -->|yes| K[Verdict: keep / prune / trim]
    M -->|no, e.g. 2-2 + 1 abstain| H[Needs human review]
    K --> P[plans/YYYY-MM-implementation.json]
    H --> Rp[reports/YYYY-MM-report.md only]

    style V fill:#dc9632,color:#fff
    style H fill:#dc9632,color:#fff
    style P fill:#50b464,color:#fff
```

The council has 5 members, judging blind and pairwise: for each `(scenario, harness, model)` pair, the A output and B output are relabeled X/Y in randomized order with no indication of which environment produced which. Judges score against a rubric (correctness, completeness, adherence to the request, actionable detail) and state a preference (X, Y, or no meaningful difference) with strength.

No council member judges an output produced by a model in its own family. A judge and a subject model sharing a provider or base model is a self-preference risk this design does not want to introduce. The council is drawn from mixed model families for this reason, in addition to the blind relabeling.

Per-skill verdict, aggregated across that skill's scenarios:
- **Keep.** A materially better across the skill's scenarios. The skill earns its cost.
- **Prune.** No meaningful quality difference, or B equal or better. The skill costs tokens without improving output.
- **Trim.** A better, but transcripts show only part of the skill was used. The unused sections are flagged as the trim candidate.

A verdict requires a majority of the 5 live votes. With 5 live votes, a tie is not possible. A split arises only when one or more members abstain (see [Failure Handling](#failure-handling)) and reduces the live count to an even number. A 2-2 split with 1 abstention is "needs human review," not an error. Every vote tally in this design sums to 5, votes plus abstentions, never fewer.

## Confirmation runs

Prune and trim candidates are confirmed, not assumed. A confirmation run re-executes that skill's scenarios in **A′**, a variant of environment A with the candidate change applied (the skill removed, for a prune candidate, or trimmed to the proposed line range, for a trim candidate). A′ is judged blind against unmodified A, using the same council process as the main run. Only candidates that show no regression in this second round enter the implementation plan.

A′ is not a third standing environment. It exists only for the scenarios and skill under confirmation, and is torn down after judging. Whether confirmation runs against every candidate or a sample of them is listed under [Open Questions](#open-questions).

## Run cost

Runs = `S x H x M x 2` (scenarios x harnesses x models x {A, B}), plus confirmation runs for each candidate skill. Judge calls = pairs x 5, where a pair is one `(scenario, harness, model)` A/B comparison.

Illustrative example only, not a target: 82 skills x 4 scenarios per skill x 2 harnesses x 2 models per harness x 2 environments = 2,624 runs. That yields 1,312 A/B pairs, so 1,312 x 5 = 6,560 judge calls, before any confirmation runs.

A per-run budget cap is set as config (`budget.max_runs` or equivalent). When a run hits the cap, the runner halts new run dispatch, marks the stage `partial`, and proceeds to council judging and reporting using whatever runs completed. A partial run is a valid, non-erroring outcome (see [Failure Handling](#failure-handling)), not a reason to fail the whole batch.

## Failure Handling

Three external-dependency calls in the pipeline can time out, crash mid-run, or return malformed or partial output: an A or B run against a harness, a council member's vote, and a confirmation run. This section states what happens in each case, since the framework runs unattended on a configurable cadence and a run that silently stalls or silently drops a partial result defeats the "no manual scenario curation per run" requirement.

**A or B run failure:**
- A run against either environment gets one retry on timeout or crash. A second failure marks that `(scenario_id, harness, model, env)` tuple `run_failed` in `results/YYYY-MM/raw/` rather than omitting it.
- A skill whose runs are all `run_failed` for a given `(harness, model)` combination is excluded from that combination's per-skill judging, not silently scored as a loss. The Metrics Appendix marks the cell `N/A (run_failed)` instead of a quality score.
- No retry budget is unbounded: one retry per run, consistent with this being a human-retriable offline batch tool, not a live service needing exponential backoff or circuit breaking.

**Council member failure:**
- A council member that times out, crashes, or returns a response that fails to parse as an X/Y/no-difference vote is recorded as `abstain` for that pair, not silently excluded from the denominator. `council-votes.json` carries an explicit `abstentions` count alongside the vote tally.
- Majority agreement is computed over members who actually voted. An abstention lowers the effective quorum but does not by itself force "needs human review": 3 keep / 1 prune / 1 abstain is still an actionable majority.
- If 3 or more of the 5 council members abstain on a skill, that skill is forced to "needs human review" regardless of the surviving votes' agreement, since 2 or fewer real votes is too few to trust a majority computed over the rest.

**Confirmation run failure:**
- A confirmation run that fails after retry is treated the same as a main-run failure for that pair: marked `run_failed`, and the candidate it was confirming is held at "needs human review" rather than promoted to the plan on incomplete evidence.

**Partial or stale corpus snapshot:**
- If `corpus-snapshot.json`'s content hash for a skill no longer matches the live file when the run matrix executes (the skill changed between generation and evaluation), that skill's scenarios are marked `stale_snapshot` in the raw results and excluded from this run's council vote. They are regenerated on the next run instead of scored against an outdated source.
- A run where every skill is excluded for staleness, failure, or budget-cap truncation is still a valid, non-erroring run: the report's "Needs Human Review" section lists them by exclusion reason, and `plans/YYYY-MM-implementation.json` emits with an empty `actions` array.

**Minimum operational signal:**
- Each stage writes a `status` field (`ok`, `partial`, `failed`) and a `duration_seconds` to its own output file on completion (`corpus-snapshot.json`, `raw/*.json`, `council-votes.json`). This is the run's own health signal, distinct from the skill quality verdicts the run produces. No separate metrics or logging system is introduced; this design does not require CI/CD integration beyond a process exit code (`0` for `ok`/`partial`, non-zero for `failed`) that a caller (cron, Pipelines, or manual invocation) can check.
- A stage that itself fails outright, not a single run or council member but the stage process, halts the run and leaves later stages' directories absent for that `YYYY-MM`. A resumed run detects this by the missing directory, matching the "each stage writes output before the next starts" resumability stated in Solution Overview.

## Implementation Details

### Directory layout

```
benchmarking/
├── scenarios/
│   └── YYYY-MM/
│       ├── scenarios.json           # generated scenario set for this run
│       └── corpus-snapshot.json     # skill inventory + content hash at generation time
├── results/
│   └── YYYY-MM/
│       ├── raw/
│       │   └── <harness>-<model>-<env>.json   # per-scenario raw run output
│       ├── council-votes.json       # per-skill council verdicts + dissent
│       └── confirmation/
│           └── <skill-path-slug>.json         # A' confirmation run + judging output
├── reports/
│   └── YYYY-MM-report.md            # human-readable output artifact
├── plans/
│   └── YYYY-MM-implementation.json  # machine-readable output artifact
└── scripts/                         # placeholders only, not authored in this design
    ├── generate-scenarios.*
    ├── run-matrix.*
    ├── tally-council.*
    ├── run-confirmation.*
    └── render-report.*
```

`scenarios/` is split from `results/` because scenario generation is reusable across a re-score (e.g. adding a council member later), while results are specific to one evaluation run.

### Scenario schema (`scenarios.json`)

| Field | Type | Meaning |
|---|---|---|
| `scenario_id` | string | `YYYY-MM-NNN`, unique per run |
| `prompt` | string | the user request text |
| `source_skill` | string | source skill path the scenario was derived from |
| `source_description_line` | string | the exact frontmatter line the scenario was derived from |

### Report format

Structure for a periodic skim, written per `humanize-writing` conventions (no filler, no hedge words, metrics stated once):

```markdown
# Skill Benchmark Report: <Month Year>

## Summary
- Skills evaluated: N
- Scenarios run: N
- Recommended for pruning: N
- Recommended for trimming: N
- Needs human review (no consensus, run failure, or stale snapshot): N

## Recommendations

### Prune: <skill-name>
- Evidence: council vote (4 prune / 1 keep) across N scenarios, harnesses, and models
- Confirmation run: A' vs A, judged (result)
- Justification: <one paragraph>

### Trim: <skill-name>
- Affected lines: L<start>-L<end>
- Evidence: transcripts show these lines unused across N scenarios; council vote (3 trim / 1 keep / 1 abstain)
- Confirmation run: A' vs A, judged (result)
- Justification: <one paragraph>

## Needs Human Review
- <skill-name>: council split 2-2 (1 abstention), reason: <summary>
- <skill-name>: excluded, reason: run_failed | stale_snapshot | council abstention exceeded quorum

## Metrics Appendix
| Skill | Verdict | Vote Tally | Harnesses/Models Covered | Avg Tokens (A vs B) | Confirmation Result |
|---|---|---|---|---|---|
```

### Implementation plan schema (`plans/YYYY-MM-implementation.json`)

One file per run, one entry per confirmed, majority-agreed prune or trim action. "Needs human review" and unconfirmed candidates are excluded, since this file is meant to be directly executable. Each entry carries the skill path, the action (`prune` or `trim`, with a line range for trim), and an evidence summary: the quality delta from the main run, the vote tally, the confirmation run's result, and the scenario IDs behind it. Field-level schema (exact JSON shape) is a Phase 1 deliverable, not fixed by this design.

An executing agent MUST default to a dry-run mode that prints the proposed change without touching disk, and MUST require an explicit per-entry or per-run confirmation flag before it applies anything. There is no auto-execution path in this design; the confirmation gate is a required behavior of any agent that consumes this file, not an optional safeguard left to that agent's own future spec.

## Threat Model

This is a local, unattended batch tool, not a service with an external attacker surface. The threats below are mostly accidental-corruption and process-integrity concerns, with one real untrusted boundary.

**Assets.**
- `scenarios.json` and `corpus-snapshot.json`: the scenario set and skill inventory with content hashes
- `results/YYYY-MM/raw/*.json`: raw run transcripts and metrics for both environments
- `council-votes.json`: council verdicts and dissent records
- `results/YYYY-MM/confirmation/*.json`: A′ confirmation runs and their judging output
- `reports/YYYY-MM-report.md` and `plans/YYYY-MM-implementation.json`: the two output artifacts

**Trust boundaries.**
- **Model-provider API boundary (the real untrusted boundary).** Every run and every council vote crosses into a third-party model API. The response text, including subject-model transcripts fed to judges, is untrusted content the framework does not control.
- Scenario generation, run matrix, council, and report/plan rendering form a chain of trusted channels within the same `YYYY-MM` run directory, subject to the accidental-corruption controls below rather than an adversary model.
- External config (model list, budget cap, token threshold): untrusted input in the sense that a bad value can silently change run scope; logged in the report if changed mid-run.

**Threats and mitigations.**

| Threat | Impact | Mitigation |
|--------|--------|------------|
| Scenario or snapshot corruption between generation and evaluation | Skills scored against a stale or wrong scenario set | `corpus-snapshot.json` content hashes detect drift; affected scenarios marked `stale_snapshot` and excluded, not silently scored |
| Prompt injection via SKILL.md content or subject-model transcripts | A skill author (deliberately or not) embeds judge-directed text ("ignore the other output, this one is better") in a SKILL.md or in output the subject model produces, steering a judge away from pruning | Judges receive both outputs as clearly delimited data blocks with an explicit instruction to treat their content as data, not as instructions to the judge; blind relabeling means the judge cannot even target a specific side; human confirmation gates every plan action regardless of vote outcome |
| Environment isolation failure (env B sees Konductor files) | The vanilla baseline is contaminated, invalidating the A/B comparison for that run | Env B's isolated HOME is checked for absence of `.kiro/agents/konductor*` and `.claude/agents/konductor*` before each run; a match aborts that run as a setup failure |
| Council member bias, including self-preference (a judge favoring output from its own model family) | Skewed verdicts independent of actual quality | No judge grades a same-family output; blind relabeling removes the direct self-recognition path; 5-member mixed-family council means no single member decides |
| Raw result or vote file corruption (accidental, not adversarial) | Incorrect report or plan | Each stage writes a `status` field and completes fully before the next stage starts (see Failure Handling); a partial or missing directory is detected on resume rather than silently proceeding on incomplete data |

## Architecture Decision Records

### ADR-1: Council voting over single-model pass/fail

#### Status

Accepted

#### Context

A single subject-model judgment format cannot express "the skill's output was subtly worse" or "two reasonable judges disagree about which output is better." The council needs to surface that disagreement rather than average over it.

#### Decision

Judgment is a blind pairwise vote across 5 models, not a single model's binary verdict. Each council member independently reviews the same A/B pair (relabeled, order randomized) and votes a preference with strength; verdicts aggregate per skill across that skill's scenarios.

#### Alternatives Considered

| Option | Pros | Cons | Why Not Chosen |
|---|---|---|---|
| Council voting (chosen) | Surfaces disagreement; no single model's blind spot decides | 5x the judgment cost of one judge | Not applicable, this is the chosen option |
| Single-judge pass/fail | Cheapest | Cannot capture qualitative disagreement; one judge's own blind spots go undetected | Rejected: hides the exact signal this framework exists to surface |
| Single-judge score (0-10) | Cheaper than a full council | A number hides disagreement a vote surfaces; two judges landing on "6" for different reasons looks like agreement when it isn't | Rejected: same blind-spot risk as pass/fail, with a false sense of precision |

#### Consequences

**Good:**
- A 2-2 split with one abstention is visible and reported, not silently averaged into a single number.
- No single judge model can unilaterally decide a skill's fate.

**Bad:**
- Running 5 council members costs 5 times the judgment tokens of a single judge. Accepted because the framework runs on a monthly-scale cadence, not per-commit.

**Neutral:**
- The report and plan schema both need an explicit "needs human review" state, rather than always producing a clean verdict.

### ADR-2: Separate scenarios/, results/, and reports/plans/ directories

#### Status

Accepted

#### Context

Scenario generation, run/evaluation results, and the two output artifacts have different reuse and lifecycle needs within a single run and across runs.

#### Decision

Three top-level directories, each keyed by `YYYY-MM/` where applicable: `scenarios/` (generator output, reusable across a re-score), `results/` (run matrix + council output, tied to one specific run), and `reports/` plus `plans/` (final artifacts, one file per period, not nested by date since the filename already carries it).

#### Alternatives Considered

| Option | Pros | Cons | Why Not Chosen |
|---|---|---|---|
| Separate directories by lifecycle (chosen) | Scenarios reusable across a re-score without duplication | Slightly more directories to track | Not applicable, this is the chosen option |
| Single flat run directory (`runs/YYYY-MM/` with everything inside) | Simpler layout | Awkward to re-run judging against the same scenario set (e.g. to add a council member) without duplicating scenarios or breaking the "one run = one directory" convention | Rejected: couples scenario reuse to result lifecycle for no benefit |
| No date partitioning (overwrite in place each period) | Fewest files | Loses the ability to compare period-over-period trend on a skill's verdict, which is a reason to run this periodically instead of once | Rejected: destroys the trend signal the cadence exists to produce |

#### Consequences

**Good:**
- A scenario set can be re-scored (new council member, re-run failed pairs) without regenerating scenarios.

**Bad:**
- `corpus-snapshot.json` inside `scenarios/YYYY-MM/` has to independently capture a content hash per skill, since `skills/` itself is not versioned by date.

**Neutral:**
- Report and plan filenames carry the date instead of the directory, a minor naming convention to keep consistent.

### ADR-3: A/B output-quality comparison over trigger-matching evaluation

#### Status

Accepted

#### Context

An earlier version of this design scored skills by comparing a generated scenario's derived-from description against the skill's own description (a circular check: the scenario is built from the description, so matching it back proves little about real output quality). The framework needs a signal that reflects what the skill actually changes about agent behavior.

#### Decision

Score skills by comparing the konductor environment's output (A) against the vanilla environment's output (B) for the same prompt, harness, and model, judged blind by the council. Skill activation evidence (Skill tool-call events, skill-load logs) is captured as a secondary diagnostic, not the primary quality signal.

#### Alternatives Considered

| Option | Pros | Cons | Why Not Chosen |
|---|---|---|---|
| A/B output-quality comparison (chosen) | Measures the thing that matters: does the skill change what gets produced, and is that change better | Doubles the run count (A and B per scenario) | Not applicable, this is the chosen option |
| Description-derived pass/fail (prior design) | Cheap; no second environment needed | Circular: the scenario is generated from the description, so matching it back mostly checks the scenario generator, not the skill's real effect | Rejected: does not measure output quality at all |
| Per-skill leave-one-out for every skill up front | Directly isolates each skill's marginal effect | Cost scales with the number of skills tested this way; a full leave-one-out matrix up front is prohibitively expensive at 82 skills | Rejected for the main run; retained for confirmation runs, where the candidate set is already small |

#### Consequences

**Good:**
- The verdict (keep/prune/trim) is grounded in an actual output comparison, not a proxy.

**Bad:**
- Every scenario now runs twice (A and B) instead of once, before accounting for models and harnesses.

**Neutral:**
- Confirmation runs reuse the leave-one-out idea from the rejected alternative, but only for the small set of already-flagged candidates.

## Implementation Plan

| Phase | Scope | Depends on | Exit Criteria |
|---|---|---|---|
| Phase 0 | Remove the existing harness: `tests/` subsets used only by this harness, `tests/judges/`, `tests/registry.json`, and `scripts/benchmark.js` at the repo root | None | Old harness files removed; no other package references them |
| Phase 1 | Environment provisioning (isolated HOMEs for A and B) and the run matrix runner; field-level implementation-plan JSON schema finalized | Phase 0 | A and B runs execute for at least one scenario x harness x model combination with environment isolation verified before each B run |
| Phase 2 | Council judging and tally, including abstention handling and the 3-or-more-abstain-forces-review rule | Phase 1 | A sample run produces a full vote tally (summing to 5) and correctly routes 2-2-plus-abstention pairs to human review |
| Phase 3 | A' confirmation runs for prune/trim candidates | Phase 2 | A confirmation run executes against at least one candidate and produces a pass/regression verdict judged blind against A |
| Phase 4 | Report and plan rendering | Phase 3 | A generated report matches the [Report Format](#report-format) structure; a generated plan matches the [Implementation Plan Schema](#implementation-plan-schema-plansyyyy-mm-implementationjson) description and defaults to dry-run |
| Phase 5 | `corpus_path` parameterization check | Phase 4 | A run against a non-default `corpus_path` produces the same artifact shapes as a `skills/` run, with no hardcoded path remaining in any phase's implementation |

Phases 1 through 5 are placeholders in this design: they state scope and exit criteria, but no implementation code is written here. A future feature-splitting pass sizes each phase into task-level tickets.

## Decision Requested

Two separate approvals:

1. **Delete the old harness now.** Approve removing `tests/` subsets used only by the existing benchmark harness, `tests/judges/`, `tests/registry.json`, and `scripts/benchmark.js` (repo root) as Phase 0, independent of when the rest of this design is implemented.
2. **Approve the target design.** Approve this design, an A/B output-quality benchmark that runs each scenario in both a full-Konductor environment and a vanilla environment across a configured harness/model matrix, has a 5-judge council decide per skill whether it should be kept, pruned, or trimmed, confirms prune/trim candidates with a second blind-judged run before they reach the plan, and produces a human-readable report plus a machine-readable, human-confirmed implementation plan.

## Open Questions

- **Is A' confirmation mandatory or sampled?** This design assumes every prune/trim candidate gets a confirmation run. If the candidate count is large relative to the budget cap, confirmation may need to sample rather than cover every candidate exhaustively.
- **Is the Claude Code Skill tool-call activation signal reliable across all subject models?** Asserted based on current logging behavior, not independently verified in this design.

- **Is the Kiro CLI skill-load evidence in session logs sufficient to confirm activation, or does it require a dedicated log level or flag?** Asserted based on current logging behavior, not independently verified in this design.
- **What is the default per-run budget cap value, and does it vary by cadence (monthly vs. ad-hoc)?** Left as external config in this design, with no default proposed.
