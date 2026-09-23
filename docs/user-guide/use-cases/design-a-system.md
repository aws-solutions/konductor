<!-- SPDX-License-Identifier: Apache-2.0 -->

# Use case: design a system

[← Use cases](README.md) · [Guide index](../README.md)

The package's deepest single workflow:
[`k-design-doc-creation`](../sop-workflows/design.md#k-design-doc-creation) — five phases turning a
problem statement into a document meant to survive principal-engineer review. A second SOP,
[`k-existing-design-review`](../sop-workflows/design.md#k-existing-design-review), evaluates design
artifacts that already exist. A third, [`k-principal-engineer-design-review`](../sop-workflows/design.md#k-principal-engineer-design-review),
gates a finished document before a human reviewer sees it. All three are owned by
**`k-architect`**, which carries 38 of the package's 82 skills — the largest share of any agent.

**Read this before you pick one.** `k-existing-design-review` is explicitly deprecated for authoring;
its own header says so:

> **Deprecated for design doc review.** Use `k-design-doc-creation.sop.md` for authoring new design
> documents. This SOP reviews existing artifacts before implementation.

So: `k-design-doc-creation` to write a new design. `k-existing-design-review` only to sanity-check a
package someone already wrote.

There is no SOP that chains the architect's individual design skills together. A `system-design.md`
+ `threat-model.md` package comes either from `k-design-doc-creation` producing the equivalent
directly, or from running skills one at a time — `system-design-patterns`, `threat-modeling`,
`smithy-modeling`, `dynamodb-design`, `iam-policy-design`,
`architecture-diagram-generation`.

---

## Prerequisites

**For `k-design-doc-creation`:** a problem statement or a set of user stories. `topic` is required —
the agent asks once and waits. It will **not** ask for `output_path` or `elicitation_depth`; it uses
the defaults.

**For `k-existing-design-review`:** an existing `design_dir` containing at least `system-design.md` —
the SOP refuses to evaluate without it. It also looks for these, all optional, but each missing one
narrows what can be scored:

| Artifact | Filename patterns matched |
| --- | --- |
| Threat model | `threat-model.md` |
| API specification | `smithy-model/` or `api-specs/` |
| Data model | `dynamodb-*.md` or `data-model.md` |
| Security policy | `security-policy*.md` or `iam-policies.md` |
| Architecture diagram | `*.drawio.xml` or `architecture-diagram*` |

These patterns are matched **literally**. A file named `design.md` will not fill
`system-design.md`'s slot — rename or symlink first.

---

## How to invoke

Through the orchestrator, which routes design requests to `k-architect`:

```text
Design a system for X
```

Or start with the architect directly — `k-architect` on either runtime.
`k-design-doc-creation`'s own overview
names the triggering phrasings: "Design a system for X", "I need a design doc for Y".

---

## Worked example: designing "Pennywise", a personal expense tracker

You want a design doc for a small web app where a user logs expenses, tags them by category, and
sees a monthly summary.

```text
I need a design doc for a personal expense tracker — users log expenses, tag categories, and see monthly summaries.
```

### Phase 1 — Requirements elicitation *(pauses repeatedly)*

The architect loads `socratic-elicitation` and asks questions **one at a time, waiting for your
answer before the next** — up to `elicitation_depth` questions. Default is `standard` (10); ask for
`quick` (5) or `deep` (15), or say "skip elicitation" / "I have clear requirements" to bypass the
phase entirely.

Questions are drawn from five dimensions — business value, technical feasibility and dependencies,
timeline and coordination, auth and data protection, observability and failure modes — and the agent
follows your answers rather than a script, skipping dimensions the topic already covers. For
Pennywise, expect things like "Is this single-user or multi-user?", "Does it need to survive a lost
password?", "What happens if the monthly-summary calculation fails partway through?"

The phase ends with a Requirements Summary — Functional Requirements, Constraints, Non-Functional
Requirements, Open Items — that you confirm before Phase 2 begins.

### Phase 2 — Draft generation *(no pause)*

The architect drafts using the outside-in structure: Problem → Requirements → Solution Overview →
How It Works → Implementation Details → Implementation Plan. Mermaid diagrams are generated
**before** the prose for each major section. Every significant decision — "DynamoDB single-table
versus relational", say — gets an inline ADR via `adr-generator`: Context, Decision, Alternatives
Considered table, Consequences.

The draft then goes through a `design-doc-guidelines` maker-checker pass. Any CRITICAL finding is
fixed and the pass re-run before Phase 3. This can loop a few times without asking you anything.

### Phase 3 — Quality gates *(no pause, by design)*

Three automated passes, with no user interaction permitted:

- **`doc-accuracy-analyzer`** checks every technical claim against the codebase. INCORRECT and
  UNVERIFIED findings get inline `> ⚠️` callouts but do not block.
- **`aws-service-validator`** checks every AWS service and feature claim against live AWS
  documentation, classifying each CONFIRMED / UNVERIFIED / INCORRECT, and writes the full report to
  `docs/design/pennywise-aws-validation.md`.
- **`trade-off-evaluator`** scores every multi-option decision 1–5 across cost, latency,
  complexity, scalability, and operability, embeds the table in the relevant ADR, and writes
  `docs/design/pennywise-tradeoffs.md`.

### Phase 4 — Adversarial review loop *(can pause once)*

The architect challenges its own design across up to 5 rounds, classifying findings CRITICAL
(architectural or factual) / IMPORTANT / MINOR.

**If a CRITICAL architectural finding survives past round 2, the loop stops immediately** and you
are asked whether to redesign or override. That is the one hard pause in Phases 2–4.

Otherwise it exits early once a round produces 0 CRITICAL, 0 IMPORTANT, and fewer than 3 MINOR
findings, applying corrections and re-running the guidelines check between rounds. No finding is
silently dropped — each is either fixed or recorded as an engineer override.

> If an adversarial-review subagent is available the architect delegates to it (Path A); otherwise
> it self-reviews using the `adversarial-design-review` skill (Path B). Either way the loop runs.

### Phase 5 — Final output

The architect applies every correction from Phases 3 and 4, runs `design-evaluation` for a
confidence score (the average of 10 dimension scores, 1–5 each; anything below 3 is flagged),
writes the final file, and reports the path, the score, and any open issues — without pasting the
document into the chat.

**What you get:**

| File | Contents |
| --- | --- |
| `docs/design/pennywise.md` | The design document |
| `docs/design/pennywise-aws-validation.md` | AWS claim validation report |
| `docs/design/pennywise-tradeoffs.md` | Trade-off scoring report |

---

## Checkpoint: is it actually ready?

The SOP will not claim the doc is ready for principal-engineer review unless **all four** hold:

- [ ] `design-doc-guidelines` maker-checker: **0 CRITICAL**
- [ ] `doc-accuracy-analyzer`: **0 INCORRECT** (UNVERIFIED is acceptable with callouts)
- [ ] Adversarial review: **0 CRITICAL, 0 IMPORTANT, fewer than 3 MINOR**
- [ ] `design-evaluation` confidence score: **≥ 3.0 average**

If any fails, it presents what is left and asks: `Fix these before submission? [y/n]`.

---

## Worked example: reviewing an existing design package

A teammate already wrote `system-design.md` and `threat-model.md` for Pennywise under
`design/pennywise/` and you want a second opinion before implementation.

```text
Review the design package in design/pennywise/.
```

1. **Discover artifacts** — scans `design_dir` for the six patterns above, reports found and
   missing, and warns if `system-design.md` or `threat-model.md` is absent. It **refuses to
   evaluate** if `system-design.md` is missing.
2. **Confirm scope** — shows the list and asks `Proceed with review of these artifacts? [y/n]`. A
   hard pause; it will not continue without an answer.
3. **Read all artifacts** — in order: system design → threat model → API specs → data models →
   security policies → diagrams.
4. **Run `design-evaluation`** — scores all 10 dimensions 1–5: template adherence, scalability,
   security and threat coverage, maintainability, resilience, testability, operational readiness,
   cost, API quality, data model quality. Below 3 is flagged for revision.
5. **Generate report** — writes `design-review-report.md` (or your `output_file`) with dimension
   scores and Critical / Important / Suggestion findings.
6. **Present recommendation** — **READY FOR IMPLEMENTATION** or **NOT READY**, plus the blockers if
   not ready.

**What you get:** `design-review-report.md`. Pass `dry_run: true` to see what would be reviewed
without writing anything — the run stops at step 2.

A design with only IMPORTANT issues is still READY; the SOP's own troubleshooting says so.

---

## Runtime differences

None specific to these SOPs — both behave the same in Kiro CLI and Claude Code once you are talking
to `k-architect`.

One thing to know about Phase 3: the AWS validation step uses the architect's `aws-mcp` server. In
Kiro CLI that server is declared and launched from the agent spec. **In Claude Code the agent only
requests the tools via the `mcp__aws-mcp__*` glob — you must configure an `aws-mcp` server
yourself** or those tools will not resolve. Either way, with no AWS credentials the step degrades to
UNVERIFIED findings rather than failing.

---

## Where to go next

- Design ready and validated? → [Plan and verify work](plan-and-verify-work.md)
- Want a lighter look at an existing codebase before designing changes to it?
  → [Understand a codebase](understand-a-codebase.md)
- Implementation done and you want a security-focused second look?
  → [Review code and tests](review-code-and-tests.md) — `k-adversarial-pull-request-review` is
  architect-owned too

---

[← Understand a codebase](understand-a-codebase.md) · [Next: Plan and verify work →](plan-and-verify-work.md)
