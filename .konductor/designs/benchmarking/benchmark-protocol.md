# Benchmark Protocol

Back to [index.md](./index.md).

## Table of Contents

- [Scenarios](#scenarios)
- [Judge Panel](#judge-panel)
- [Verdict Rules and Thresholds](#verdict-rules-and-thresholds)
- [Data Handling](#data-handling)
- [Trace Normalization Layer](#trace-normalization-layer)
- [Run ID and Panel Manifest](#run-id-and-panel-manifest)
- [Objective 2: The Three Arms](#objective-2-the-three-arms)
- [Tool Bridge](#tool-bridge)
- [Metrics and Output Shape](#metrics-and-output-shape)
- [Prior Art Evaluated](#prior-art-evaluated)

## Scenarios

A scenario is a prompt plus fixtures plus judge notes, not just a prompt: `code-review` needs a diff
to review, `threat-modeling` needs a system description. Judge notes are drafted blind, from a plain
description of the task before the generator reads the skill's own body, then reconciled against
what the skill claims to do. Drafting blind stops the notes from scoring "looks like this skill's
output" over "actually solves the task." Judges themselves only see each skill's name and
description up front; the full body loads on demand, to control judge cost (adopted from Strands
Harness Optimizer).

Two scenario sets:

| Set | Size | Built | Runs against |
| --- | --- | --- | --- |
| Core | 3 scenarios (trigger, variation, near-miss) | Up front, for every skill | Screen |
| Coverage | Floor of 5, no cap, enumerating distinct capabilities, modes, and edge cases | Only once a skill becomes a candidate | Ablation |

A Coverage scenario presents a skill's success and failure samples side by side for contrastive
judging (adopted from Strands Harness Optimizer), and judgment runs at three levels: final output,
single turn, and whole session, so a per-turn check can catch a skill that loads but is then ignored
(adopted from Strands Evals SDK; see [Trace Normalization Layer](#trace-normalization-layer) for the
typed-step record that makes turn- and session-level judging possible).

### Near-miss scenarios

Near-miss scenarios check that an unrelated skill doesn't fire when it shouldn't. They are borrowed
from a neighboring skill's own approved trigger scenario where one exists, since a borrowed
near-miss is already reviewed and is the confusion most likely to come up in real use. A skill with
no neighbor gets no near-miss by default, and the report says "near-miss untested," not
"well-scoped." Those are different claims; conflating them would overstate confidence in a skill
never actually checked for over-triggering. See [Verdict Rules and
Thresholds](#verdict-rules-and-thresholds) for how an untested near-miss gates a verdict.

### Coverage-scenario generation failure modes

Coverage-scenario generation can fail outright, not just run short. "Synth failed" means
specifically one of three things: the generation step errors, it times out before producing output,
or it returns output that fails to parse into the expected scenario-record schema (missing required
fields, malformed JSON, or a shape the ablation stage can't consume). Any of these leaves the skill
with no usable Coverage set to ablate against, treated the same as an incomplete Coverage set.

## Judge Panel

An LLM-judge council, not a single model, decides every pair's verdict.

### Seats and routing

| Seat | Model | Routing path | Credential source | Notes |
| --- | --- | --- | --- | --- |
| Anthropic (anchor) | Claude Opus 5.5 | Amazon Bedrock | AWS credentials with Bedrock access | Same-family fallback also via Bedrock |
| Seat 2 primary | Grok 4.7 | OpenCode's direct xAI provider access, not Bedrock | Separate xAI API credentials in OpenCode | Reliability-confirmed on this exact path in prior work |
| Seat 2 fallback | Meta Llama 4 Maverick 17B Instruct | Amazon Bedrock | AWS credentials with Bedrock access | Independent lineage, zero Marketplace friction, not yet reliability-tested |
| Seat 3 primary | GPT-6 Astra | Amazon Bedrock | AWS credentials with Bedrock access | Not yet reliability-tested |
| Seat 3 fallback 1 | Cohere Command R+ | Amazon Bedrock | AWS credentials with Bedrock access | Requires a Marketplace subscribe step; not yet reliability-tested |
| Seat 3 fallback 2 (last resort) | Amazon Nova Pro | Amazon Bedrock | AWS credentials with Bedrock access | Zero friction; 5K max-output-token ceiling (a rationale truncated mid-output counts as unresolved, not a valid vote); not yet reliability-tested |

The base panel is 3 judges (Claude Opus 5.5, Grok 4.7, GPT-6 Astra). On disagreement, the panel
escalates to 5 by adding 2 more judges chosen by rule, not from a fixed roster. Each escalation
candidate must come from a model family with no significant training lineage overlap with the models
or skills under evaluation, and must pass the reliability check below. Meta Llama 4 Maverick and
Cohere Command R+ are the two most likely candidates to satisfy the rule, and both are already named
as seat fallbacks above, but naming them does not pre-approve either; each still has to pass its own
reliability check.

This tiering is deliberately thorough for independence and reliability reasons; a real minimal pilot
should still start with just the primary 3 and only invoke a fallback on an actual failure, not
pre-build every tier before running anything. Reliability and agreement rate are two different
things: a seat's reliability-check status (pass or fail, verified once) is separate from how often
judges disagree and trigger escalation during real runs. Fallback activation rate specifically is
unmeasured until the pilot actually runs (see [index.md Open Questions](./index.md#open-questions)).

A single harness, OpenCode CLI, reaches every required provider (Bedrock, plus direct xAI, OpenAI,
and Anthropic access) from one place, so no single provider's Bedrock-only reach limits panel
composition. Whether OpenCode's headless mode (`opencode run --format json --auto`) actually retains
full tool access, as opposed to just being documented to, is unconfirmed and needs a smoke test (see
[index.md Open Questions](./index.md#open-questions) and Implementation Plan Phase 1's contingency
for this smoke test failing).

Reasoning-effort tiers below the top act as a ceiling on how much a call may reason: they cap
worst-case reasoning without forcing a call to reason more than a task needs. Judging is a
comparison task, so it runs at a high, non-top effort tier for consistency. The top tier would act
as a floor instead of a ceiling, forcing reasoning even on trivial sub-steps and raising realized
cost with no reliability payoff, so top-tier settings are avoided across the harness.

### Independence and reliability rules

A judge candidate must pass both an independence screen and a basic reliability check before joining
any seat; neither is assumed from a model's general capability.

**Reliability check:** at least 5 of 5 trials on the same held-out prompt, each run at the model's
lowest, most deterministic sampling setting available (temperature 0 or the closest equivalent),
producing mutually consistent, independently parseable verdicts. "Consistent" means the final
verdict label matches across all 5 trials, not that the rationale text matches word for word;
rationale wording varies across trials even when the label is stable. A trial that fails to parse,
or whose label disagrees with the other four, counts as a failure. A candidate that fails is
excluded, not swapped in for an untested alternative by default.

**Independence screen:** DeepSeek, Mistral Large 3, and an unverified-independence cluster (Qwen,
Kimi/Moonshot, GLM/Z.AI, MiniMax) are excluded from every seat and from the escalation pool.
DeepSeek is excluded on widely reported concerns about its training data sourcing from Claude
outputs, a bias concern this project has not independently verified. Mistral Large 3 failed its
reliability check 3 of 3 times, with no newer Bedrock-listed version to substitute. The remaining
four have unverified independence.

**Precondition for full-agreement resolution:** all three base-panel seats, not just Grok 4.7, must
independently pass their own reliability check before an ablation run depends on 3-of-3 agreement.
GPT-6 Astra and Claude Opus 5.5 are not yet reliability-tested on this harness; until they are,
ablation runs track reliability-check status per seat rather than assuming full-agreement resolution
is meaningful.

### The Anthropic seat's exclusion rule

Claude Opus 5.5's vote is excluded from a pair's resolution, or down-weighted to non-deciding, when
the skill or scenario content under evaluation carries an `[origin:agent]`-style provenance tag
marking it as Claude-model-generated, the same provenance-tagging convention this project applies
elsewhere to agent-created memory and skill content. The tag is applied by the skill/scenario
generation pipeline at creation time, whenever the generating run used a Claude-model agent. Absent
the tag, Claude Opus 5.5 votes as a full seat. A same-family fallback is permitted on this seat
specifically because the tag-based exclusion rule, not family diversity, is what controls
same-system bias here.

This exclusion rule is design intent, not yet an enforced mechanism: a checker that verifies tag
presence and correctness is an Implementation Plan Phase 1 deliverable. **Fail-closed rule:** if
that checker is not yet built, or not yet passing its own validation, the Anthropic seat defaults to
excluded from voting entirely, not to the full-voting-seat case. Once the checker is built and
passing, the seat reverts to voting under the tag-based rule.

**Panel math when the seat is excluded.** When the Anthropic seat is excluded, under either the
tag-based rule or the fail-closed default above, it is filled by Meta Llama 4 Maverick on Amazon
Bedrock. If Llama 4 Maverick already holds Seat 2 as that seat's fallback, Cohere Command R+ on
Bedrock fills the Anthropic seat instead, so no model holds two seats. Neither replacement may be
Claude-family, since that would carry the same self-bias that triggered the exclusion. The
replacement must still pass the same 5-of-5 reliability check as every seat (see Independence and
reliability rules above). Only if no named replacement passes are the affected ablation pairs
recorded unresolved.

This rule has a named, unresolved gap: it only screens content-authorship lineage, not
execution-substrate lineage. It fires when the content under evaluation was generated by a
Claude-model agent, not when the system producing that content is itself running on a Claude model.
Objective 1's ablation stage judges output from the real konductor orchestrator and its specialist
agents, the same orchestrator Arm C invokes through Claude Code; if those agents run on Claude
models, Claude Opus 5.5 judging their output carries a same-family bias risk this tag rule does not
catch, since the rule screens the artifact's authorship, not the executing agent's model family.
Closing that second gap is a residual, named open item (see [index.md Open
Questions](./index.md#open-questions)).

### Escalation and resolution rules

| Stage | Resolution rule | Escalation |
| --- | --- | --- |
| Screen | 2-of-3 agreement | Never escalates; cheap and only narrows candidates |
| Ablation | Full agreement at 3 judges | Any disagreement or abstention escalates to 2 additional judges, resolving on 3-of-5 agreement; if that still doesn't produce a majority, the pair is unresolved |

### Clear-loss veto

A pair counts as a clear loss, and triggers the veto in the Prune row of [Verdict Rules and
Thresholds](#verdict-rules-and-thresholds), only when the resolving judges reached full agreement
that the original beat the ablated variant: full 3-of-3 agreement if the pair resolved at the base
panel, or full 5-of-5 agreement if it escalated and resolved at 5. A pair that escalates and
resolves on a 3-of-5 majority, not full 5-of-5 agreement, does not meet this bar: it counts toward
the 90% ratio as an ordinary resolved pair, but a 3-of-5 majority-only resolve never triggers the
veto on its own.

An unresolved pair does not, on its own, trigger the veto. "Unresolved" means the judge panel never
reached a majority verdict, not that a judge majority actively and strongly preferred the original;
a pair that simply failed to resolve gives no basis for calling it a clear loss.

## Verdict Rules and Thresholds

| Verdict | Condition |
| --- | --- |
| Prune | Ablated variant not worse in at least 90% of all own/overlap pairs attempted (an unresolved pair counts as a worst-case "not better than original" contribution to this ratio, never excluded from the denominator); of the remaining up to 10%, none may be a clear loss, only a marginal non-improvement; and the near-miss condition holds |
| Trim | Same bar, scoped to the specific sections a Coverage scenario named and the direct arm showed unneeded |
| Keep | Neither bar is met |
| Needs human review | More than 20% of pairs are unresolved or failed, Coverage-scenario generation is incomplete or synth-failed, there's a routing regression, or the skill would otherwise clear the Prune or Trim bar but its near-miss condition is untested |

### Why unresolved pairs count against the ratio

Scoring the 90% bar only against resolved pairs would reward pushing hard cases into the unresolved
bucket to shrink the denominator, since an excluded pair can't drag the ratio down. Counting every
attempted pair, with an unresolved one scored as a worst-case non-improvement, removes that
incentive. This closes only that one gaming vector: a scenario author could still bias the Coverage
set itself toward easy cases so every pair resolves favorably in the first place, and nothing in the
denominator rule catches that (see [index.md Open Questions](./index.md#open-questions)).

A pair that never ran at all, a pre-execution skip from resource exhaustion (a judge API rate limit
or quota hit before the pair's prompt was even sent), is a different case and does not count toward
the attempted-pairs denominator at all: it never reached judgment, unlike an unresolved pair that
ran and produced disagreement. Track skipped pairs separately; if they accumulate past a visible
threshold, that is a signal to retry the run, not a reason to let them shrink the denominator.

### The 30% systemic-failure threshold

The 20% threshold above triggers human review for a single ablation run, but it doesn't distinguish
an occasional unresolved pair from a judging mechanism that is systemically broken. If more than 30%
of all pairs attempted across a full ablation run land unresolved, treat the panel composition
itself as suspect and escalate to human review before trusting any verdict from that run,
independent of whether any individual skill's own pairs cross the 20% line.

### Arm mismatch and routing regression

The direct and routed arms can disagree. Both landing on prune, or both on trim, lets that action
enter the plan. One saying prune and the other trim forces human review ("arm mismatch"). The routed
arm coming back keep, or staying unresolved, after the direct arm already resolved to prune or trim
also forces human review ("routing regression"). Agreement between the two arms is corroborating
evidence, not proof of independence: both sit downstream of the same judge-council source of noise,
so a shared judge-council quirk could make both arms agree for the wrong reason.

### The near-miss condition

The near-miss condition is undefined, not satisfied, for a skill with no near-miss scenario
available (see [Scenarios](#scenarios)). For Prune and Trim gating, "untested" counts as the
condition not holding, the conservative, fail-closed reading consistent with this document's other
fail-closed defaults. An untested near-miss therefore blocks an automatic Prune or Trim verdict and
resolves to "Needs human review" instead of "Keep," so a human can make the near-miss call directly
rather than the pipeline misrepresenting a signal it never checked.

### Needs-human-review dispositions

Each trigger condition calls for a different next action:

| Trigger | Maintainer action |
| --- | --- |
| More than 20% of pairs unresolved or failed | Re-run the affected pairs once judge availability recovers; only escalate further if the re-run still lands above 20% |
| Coverage-scenario generation incomplete or synth-failed | Treat the skill as unablated and fix the generation step before retrying; never substitute a partial Coverage set or guess at a verdict |
| Routing regression | Inspect why real orchestrator routing diverged from the isolated direct-arm result before trusting either arm's verdict |
| Untested near-miss on a skill that otherwise clears the Prune or Trim bar | Make the near-miss call directly, by hand; no neighboring skill exists to borrow one from, and none should be fabricated |

### Output

A human-readable report, plus a prose implementation plan, not a JSON file, with one entry per
ablation-confirmed prune or trim. The report also carries one entry per "Needs human review"
verdict, naming which trigger condition fired and the corresponding follow-up action above, so a
reader never has to cross-reference this table.

Each report entry carries a `usage-signal: measured | not measured` field, the same pattern as the
near-miss label above. Every verdict ships today labeled `not measured`, since no usage-telemetry
mechanism exists yet to tell whether a skill's measured capability is also what users reach for day
to day (see [index.md Open Questions](./index.md#open-questions)).

The dry-run plan represents each proposed change as a skill diff, not a bare instruction: kept,
retired, revised, or added sections (adopted from Strands Harness Optimizer). Any agent consuming
the plan defaults to dry-run, printing the proposed change without touching disk and requiring
explicit confirmation before executing anything. A confirmed prune or trim action is itself
revertible after execution: keep the removed content recoverable, in version control, in case a
later finding shows the verdict was wrong.

If a skill-under-test invocation produces an empty submission, the pipeline retries once or flags
the pair rather than scoring it as a wrong answer (adopted from the Strands benchmark-harnesses
project): "produced nothing" and "got it wrong" are different failure modes and should not be
conflated in the verdict.

## Data Handling

OpenCode's judge harness sends scenario content, prompts, fixtures, and skill-under-test output to
direct third-party model APIs (xAI, OpenAI, Anthropic) outside Bedrock, since that is how the
harness reaches those providers at all. Scenario fixtures must not contain customer data,
credentials, or anything proprietary beyond what's already in konductor's own public skill content,
because that content leaves konductor's system boundary the moment it is sent to a judge model.

**Enforcement:** before any Coverage scenario fixture is used in a real ablation run, it must have a
corresponding `<fixture-id>.signoff.json` artifact on disk, carrying these fields:

| Field | Meaning |
| --- | --- |
| `reviewer` | Self-reported name or alias at signoff time; not bound to any authenticated identity system |
| `date` | Signoff date |
| `fixture-content-hash` | A hash of the fixture's actual content, computed and recorded at the moment of signoff |
| `confirms-no-customer-data` | Boolean |
| `confirms-no-credentials` | Boolean |
| `confirms-no-proprietary-content` | Boolean |

A pre-run checker script (an Implementation Plan Phase 1 deliverable) verifies the file exists, that
all three `confirms-*` fields are true, and that the fixture's current content hash matches the
recorded `fixture-content-hash`, before that fixture's content is sent to a judge model. A fixture
edited after signoff fails this check rather than silently passing on a stale approval.

**Fail-closed rule:** if this checker is not yet built, or not yet passing its own validation, when
Phase 1 concludes, no fixture may be sent to third-party judge APIs for that skill; the ablation
stage cannot run until the checker is built and passing.

The `reviewer` field's lack of authenticated-identity binding is a named, acknowledged limitation of
the mechanism, not a solved problem.

## Trace Normalization Layer

Each CLI under test emits a step-by-step JSON event stream: `claude ... --output-format
stream-json`, `kiro-cli ... --output-format stream-json`, `opencode run --format json`. A normalizer
converts each stream into one common session record with typed steps: agent invocation, model call,
tool call, skill load. The session record itself describes the agent-under-test session only; judge
output (votes, scores, reasons) is not part of this record and is instead carried in the panel
manifest, a separate per-run artifact keyed to the run ID (see [Run ID and Panel
Manifest](#run-id-and-panel-manifest)).

A skill-load step carries its own `source: dedicated-event | path-heuristic` field, so a step
produced by Kiro's path-glob heuristic is distinguishable from one backed by a CLI's own dedicated
skill-load event (for example Claude Code's `Skill` tool-call). The session record also carries a
session-level `available_tools` field, populated from the CLI's own initialization event when one
exists (for example Claude Code's stream-json `init` event, which lists available tools); when no
such event exists for a CLI, `available_tools` is recorded as `unknown`, never inferred from which
tools happened to be used. This keeps tool *availability* (what the session's init event reports)
distinct from tool *usage* (what the tool-call steps actually show).

That one record feeds four consumers:

| Consumer | What it reads from the record |
| --- | --- |
| Skill-load detection | A deterministic skill-loaded evaluator, keyed on each step's `source` field: for Kiro CLI this field is always `path-heuristic`, since Kiro has no dedicated skill-load event (see [`implementation-plan.md`'s Kiro skill-load detection](./implementation-plan.md#kiro-skill-load-detection) for the full caveat), adopted from Strands Evals SDK as a check separate from quality judging |
| Per-turn and session-level judging | The typed steps let a judge check a single turn or the whole session, not only the final output (see [Scenarios](#scenarios)) |
| Panel manifest | The panel manifest is a separate per-run artifact, not part of the trace record itself: it records each judge seat's vote (score, pass/fail, reason) alongside the metadata in [Run ID and Panel Manifest](#run-id-and-panel-manifest), keyed to the trace record's run ID, including each skill-load step's `source` field so a reviewer can tell which skill-load signal backed a given judgment (adopted from Strands Evals SDK) |
| Arm C's tool-availability check | The record's `available_tools` field shows which tools were actually available during a run, separate from the tool-call steps that show which tools were actually used, closing the "which tools did Arm C actually have" question from [Objective 2: The Three Arms](#objective-2-the-three-arms) |

Whether the normalized record can be shaped to match the Strands Evals SDK's own session format
closely enough to reuse its trace-level evaluators is untested (see [index.md Open
Questions](./index.md#open-questions)).

## Run ID and Panel Manifest

Every ablation run persists a panel manifest recording, per judge seat:

- The exact model ID and version used for that seat, including whichever model actually filled an
  escalation slot if escalation occurred.
- That seat's provider and routing path (Bedrock, or direct xAI, OpenAI, or Anthropic access).
- The sampling settings used (temperature, or the closest determinism setting, per the
  reliability-check protocol above).
- That run's own reliability-check outcome for that seat.
- That seat's independence-screening outcome, including which content, if any, triggered the Anthropic
  seat's tag-based exclusion for that run.
- That seat's vote for each pair judged in the run: score, pass/fail, and reason, alongside the
  skill-load step's `source` field from the trace record the vote was judging (see [Trace
  Normalization Layer](#trace-normalization-layer)).

A provider-side model update changes the panel manifest's recorded version for that seat. Trend
comparisons across runs whose manifests record different versions should be treated as comparing
against a changed fixture, not assumed directly comparable, the same way model-configuration drift
could otherwise be mistaken for a real skill regression.

Each benchmark run is identified by a run ID of the form `<ISO-8601 UTC timestamp>-<short hash of
that run's panel manifest and scenario-set version>`, generated when the run starts and included in
that run's own output, panel manifest, and metrics. Cross-run trend comparisons key on this run ID,
not on a calendar period.

## Objective 2: The Three Arms

| Arm | Invocation | Notes |
| --- | --- | --- |
| A: vanilla Kiro CLI | `kiro-cli chat --no-interactive --trust-tools=<bridge-tool-names>`, `KIRO_API_KEY` set, no konductor agent-spec or skills | Only the benchmark's own narrow toolset is exposed |
| B: vanilla Claude Code | `claude -p --allowedTools "<bridge-tool-names>"`, no konductor `--agent` flag, no konductor skills | Same narrow toolset as Arm A |
| C: konductor-orchestrated | The real konductor orchestrator agent-spec, invoked headlessly through Claude Code, with `--allowedTools` naming the bridge tools plus `Skill`, `Agent`, `Read`, `Glob`, `Grep` | Routes live to specialist subagents and skills, restricted to a read-only-plus-orchestration allowlist |

An adapter boundary separates what an arm is from how it is invoked, so a new arm plugs in without
changing the runner (adopted from Strands Harness Optimizer; see [implementation-plan.md's CLI
invocations per arm](./implementation-plan.md#cli-invocations-per-arm) for the concrete invocation
shapes). Each case runs in a parallel pool of fresh agent instances with no state shared between
cases (adopted from Strands Harness Optimizer; see [implementation-plan.md's Testing and
CI](./implementation-plan.md#testing-and-ci)).

### Isolation

Each arm's tool allowlist, and the mechanism that enforces it, is specified once in
[implementation-plan.md's Isolation and Sandbox
Requirements](./implementation-plan.md#isolation-and-sandbox-requirements). In summary: the
SOP-Bench bridge tools for every arm, plus `Skill`, `Agent`, and read-only tools (`Read`, `Glob`,
`Grep`) for Arm C only; no arm's allowlist includes Bash, a file-write tool, or a network tool.

### Arm C's dropped tools

Arm C's tool allowlist carries the SOP-Bench bridge tools plus `Skill`, `Agent` (subagent
delegation), and read-only tools (`Read`, `Glob`, `Grep`); it excludes `WebSearch`, `TodoWrite`,
Bash, any file-write tool, and any network tool, regardless of what the agent's own frontmatter
declares. Headless test runs confirm that a subagent spawned through the `Agent` tool inherits the
parent's `--tools` set exactly: the dispatched subagent held only the parent's allowlisted tools and
made no Bash call, verifying that Arm C's restriction holds through at least one level of
delegation (see [implementation-plan.md's CLI invocations per
arm](./implementation-plan.md#cli-invocations-per-arm) for the full invocation pattern). Write and
Edit tool access inside a spawned subagent was not separately exercised in these runs (see
[index.md Open Questions](./index.md#open-questions)). The practical impact falls on Arm C alone: Arm
B's own definition never required `WebSearch` or `TodoWrite` in the first place, since it runs
against the benchmark's narrow toolset by design. Objective 2 therefore benchmarks a konductor
restricted to a read-only-plus-orchestration tool allowlist, not a konductor stripped of its ability
to route or delegate.

### Arm C's sample floor

A single SOP-Bench task can fan out into one or more subagent spawns, multiplying latency and cost
against a single-shot vanilla call. That's a sampling-size constraint on Arm C by design, so Arm C
runs at a smaller sample than Arms A and B on purpose. That smaller sample still needs a floor: at
least 10-15 tasks per domain for Arm C, even at pilot scale, below which a result is too noisy to
carry a verdict. This reduced power relative to Arms A and B is a stated, scoped limitation of the
pilot phase; a wider Arm C sample is a later-phase consideration once pilot cost data makes a
realistic budget trade-off possible.

### The hypothesis and its confound

Per a related finding in the SOP-Bench paper (arXiv:2506.08119, KDD 2026), not independently
re-verified as a controlled ablation matching this exact framing, padding a 6-tool kit with 20
irrelevant tools nearly halved task success rate. If a vanilla CLI were exposed to konductor's full
tool and skill surface instead of just the benchmark's own toolset, that finding predicts a real
clutter penalty. Konductor's orchestrator is built to route each task to a narrower specialist tool
subset specifically to avoid that clutter. Arms A and B run in isolated environments with no access
to konductor's skill catalog at all, so they are never exposed to that broader surface by
construction; no fourth arm and no dual-toolset-config variant are planned, so this pilot cannot
surface the clutter-penalty effect itself.

Arm C's definition bundles the orchestrator's routing decision together with the specialist content
it routes to, so a pilot win for Arm C cannot be attributed to routing specifically rather than to
having more domain content available, and no fourth arm is currently planned to separate those two
explanations. What the comparison contrasts is konductor's bundled orchestrator-plus-skill-catalog
system against a narrow single-shot baseline: informative, but not a strict single-variable clutter
test.

### The methodology-transfer caveat

The transfer this whole comparison relies on, from SOP-Bench's own single-agent tool-calling
benchmark to judging the value-add of an orchestration layer, is itself assumed, not proven.
SOP-Bench was built to measure a single agent's tool-selection behavior under clutter, not
multi-agent routing. **Falsification criterion:** if the pilot's two-arm comparison shows no
measurable signal in either direction once stated attrition and power limits are accounted for,
treat the methodology-transfer hypothesis itself as falsified for this approach, not merely a
threshold needing adjustment. This bar is distinct from the low-clutter ambiguity noted under
Minimal pilot below: a null result in this pilot's own low-clutter domain is ambiguous about
clutter specifically, since there is nothing to route around either way, but it does not by itself
falsify the methodology-transfer hypothesis; that bar is only met once a higher-clutter domain has
also been tested and shown no signal.

### Minimal pilot

Start with 1-2 of SOP-Bench's real domains, picking the ones with the smallest toolsets (lowest
clutter risk, cheapest tool bridge; `content_flagging` is a reasonable first pick). Domain and task
counts vary by source: the SOP-Bench paper (arXiv:2506.08119, KDD 2026) reports 12 domains and over
2,000 tasks; its README table advertises 10; the public repository, at the time of writing, contains
14 domain folders and 2,153 tasks, with some domains carrying versioned variants. This low-clutter
choice is good engineering convenience, but it has a direct consequence: this pilot cannot surface
the clutter-penalty effect, and a null result (no measurable difference between arms) is genuinely
ambiguous, since a low-clutter domain gives routing nothing to route around either way (see The
methodology-transfer caveat above for how this differs from falsifying the methodology-transfer
hypothesis itself). Run a small task sample, not a full domain and not the repository's full task
count.

The first pilot is genuinely two-arm, not three. Arm B and Arm C both already run on the proven
Claude Code wrapper (`tests/judges/claude-code-agent-runner.js`): Arm C runs it with a konductor
agent attached, Arm B runs the identical wrapper with no agent and no skills. Arm A is vanilla Kiro
CLI by definition and cannot run on the Claude Code wrapper, so it is excluded from this first
pilot, not merely deferred within it; it joins once its own wrapper is built, sequenced after the
two-arm pilot validates the harness.

## Tool Bridge

All three arms need one thing built first: a bridge that translates SOP-Bench's mock tools into
something each CLI's wrapper can actually call. This is one build, amortized across all three arms.
See [implementation-plan.md's `AgentResult`
contract](./implementation-plan.md#the-agentresult-contract) for the exact contract shape.

Two options, in increasing fidelity:

| Option | Effort | Fidelity | Trade-off |
| --- | --- | --- | --- |
| Text-parsed loop | Lower | Lower | Parses an intended tool call out of the model's text response, calls it directly in Python, and starts a new CLI turn with the result appended. Duplicates logic SOP-Bench's own Bedrock-based agents already have, and loses native tool-call telemetry |
| MCP bridge | Higher | Higher | A small MCP server dynamically imports a benchmark's `tools.py` manager class and exposes each `toolspecs.json` entry as one MCP tool |

Default recommendation, scoped to the pilot: start with the text-parsed loop for the minimal pilot,
since it needs no new MCP server infrastructure. The upgrade trigger is concrete: move to the MCP
bridge once the pilot shows degraded `tool_calls` telemetry is actually a problem for SOP-Bench's
evaluator, which does direct attribute access on that field. If `tool_calls` comes back with fewer
than half the number of calls the task's own ground truth expects, or empty when at least one call
was expected, the evaluator treats that run as a partial or degraded result, not a fabricated one.

## Metrics and Output Shape

Track five numbers side by side, per arm, per domain: TSR (Task Success Rate, the headline number),
ECR (Execution Completion Rate), and C-TSR (Conditional Task Success Rate), all three scored
straight from SOP-Bench's own ground truth, plus wall-clock latency per task and dollar cost per
task. Correctness alone isn't the question: a TSR win at four times the cost is a different
conclusion from a TSR win at parity.

### Decision rule

A TSR difference favors the leading arm only if that arm's cost-per-task and latency-per-task are
both within 2x of the comparison baseline; otherwise report both results without a decisive verdict
and flag for human judgment. This is a one-sided ceiling, not a symmetric band: the leading arm's
cost and latency must not exceed 2x the baseline's, and an arm that is cheaper or faster than the
baseline always passes this check, however much cheaper or faster it is. This is a starting point to
revise once real pilot data exists (Implementation Plan Phase 5b).

### Output shape

A lightweight JSON shape: top-level `arms` and `domains` arrays, plus a `results` array of:

```json
{
  "arm": "...",
  "domain": "...",
  "metrics": { "tsr": 0, "ecr": 0, "c_tsr": 0, "latency_ms": 0, "cost_usd": 0 },
  "verdict": "decisive | flagged",
  "flag_reason": null
}
```

`verdict` is computed directly from the decision rule above: `"flagged"` whenever either the
cost-per-task or latency-per-task ratio against the comparison baseline exceeds the 2x ceiling,
`"decisive"` otherwise. `flag_reason` names which metric(s) exceeded the ceiling and by how much,
for example `"cost 2.75x baseline, latency 2.4x baseline"`; it is `null` when `verdict` is
`"decisive"`. Both fields are pure arithmetic on numbers the pipeline already computes. `decisive`
describes only the cost/latency rule above, applied to konductor's bundled
orchestrator-plus-skill-catalog system as a whole; it is never evidence that routing specifically,
rather than the specialist content Arm C routes to, drove the result (see [The hypothesis and its
confound](#the-hypothesis-and-its-confound)).

Promptfoo and lm-evaluation-harness are both open source and MIT-licensed, cited here as prior art
rather than adopted as dependencies: this shape borrows a convention from each, it does not take on
either as a dependency. It sits closest to Promptfoo's provider-keyed comparison output, with
provider mapping to arm, and borrows lm-evaluation-harness's convention of keying per-task metrics
by name (see
[ADR-2](./index.md#adr-2-bespoke-json-metrics-schema-over-promptfoo-or-lm-evaluation-harness)). The
schema has no full versioning policy yet; as an interim safeguard, the top-level shape carries a
`schema_version` field (for example `"schema_version": 1`) starting the moment this schema is first
emitted, in Phase 2, so a shape change later is still detectable before Phase 5b defines the full
policy.

Objective 1's output (prune, trim, or keep verdicts plus a prose dry-run plan; see [Verdict Rules
and Thresholds](#verdict-rules-and-thresholds)) stays bespoke prose, with no change: no candidate
reporting platform has a native concept of a decision-document output.

## Prior Art Evaluated

Each external tool below was evaluated against this design's own needs, not adopted wholesale. See
[index.md's Prior Art and Lessons](./index.md#prior-art-and-lessons) for what each contributed to
the design and where it landed.

| Source | What it is | Why it wasn't adopted as a dependency |
| --- | --- | --- |
| Strands Evals SDK | Output/code evaluators work against a non-Strands agent; trace- and session-level evaluators do not, since the SDK only captures traces from Strands agents | Its own trace- and session-level evaluators don't work against this design's non-Strands CLI arms; only the judgment-level taxonomy and the general evaluator pattern transfer |
| Strands Harness Optimizer | Single-LLM reflective prompt/skill rewriting; its docs state it never toggles a skill off to measure impact | No ablation evidence: it rewrites skills reflectively but never measures the effect of removing one, which is this design's core Objective 1 question |
| Strands benchmark-harnesses | In-process scaffold for SWE-bench/Terminal-Bench/ARC-AGI-3; no external-CLI support, no SOP-Bench, no judges | Wrong shape for direct reuse: this design needs to shell out to external CLIs and SOP-Bench, and run an LLM-judge council, none of which the scaffold supports. Two narrower ideas carried over anyway: retry-or-flag-on-empty-submission (see Verdict Rules), and the environment-abstraction concept, serving as the interface for optional container/network-namespace hardening rather than the primary isolation mechanism (see Isolation and Sandbox Requirements) |
| Strands Decider | A single small classifier for routing, no multi-model mechanism | Not used for judging: Objective 1's verdicts need a multi-model council, not a single classifier |
| Promptfoo, lm-evaluation-harness | Open source, MIT-licensed; each is built around its own evaluation model | Neither publishes a schema for N arms by M metrics by K domains without adaptation (see [ADR-2](./index.md#adr-2-bespoke-json-metrics-schema-over-promptfoo-or-lm-evaluation-harness)) |
