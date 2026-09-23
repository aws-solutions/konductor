<!-- SPDX-License-Identifier: Apache-2.0 -->

# Use case: review code and tests

[← Use cases](README.md) · [Guide index](../README.md)

Four SOPs, three different owners:

| SOP | Owner(s) | Modifies source? |
| --- | --- | --- |
| [`k-code-review-workflow`](../sop-workflows/code-review.md#k-code-review-workflow) | `k-developer` | No |
| [`k-test-coverage-review`](../sop-workflows/testing-and-specs.md#k-test-coverage-review) | `k-quality-assurance` | No |
| [`k-code-cleanup`](../sop-workflows/code-review.md#k-code-cleanup) | `k-developer` | **Yes** |
| [`k-adversarial-pull-request-review`](../sop-workflows/code-review.md#k-adversarial-pull-request-review) | `k-architect` | No |

`k-code-cleanup` is the only SOP **on this page** that changes your source files in place;
everything else here writes report files next to your code. Elsewhere in the package,
`k-full-sdlc` implements and commits per feature, and `k-e2e-test-generation` commits the suite
it generates.

---

## Known limitation: the adversarial handoff never fires

`k-code-review-workflow` step 6 says:

> If an adversarial CR-review step is available, spawn `k-architect` in adversarial mode with it,
> passing the same diff used in Step 1 as `diff_input`, to surface gaps missed by standard review.

**`k-developer`, the SOP's only owner, cannot do that spawn**, verified against the agent specs:

- In **Claude Code**, `k-developer` has no `Agent(...)` tool at all. (`k-architect` and
  `k-quality-assurance` do hold `Agent(...)` tools there — delegation in Claude Code is not
  orchestrator-only — but the agent that owns this SOP is not one of them.)
- In **Kiro CLI**, delegation goes through `toolsSettings.subagent.availableAgents`, and
  `k-developer`'s is `["k-quality-assurance"]` — no architect.

Step 6's own constraints anticipate this — *"You MUST skip this step if no adversarial CR-review
capability is available"* — so the workflow degrades gracefully rather than erroring. In practice
**step 6 silently no-ops and you get standard review only.**

**Routing through `konductor` does not fix it.** `k-code-review-workflow` is not among the ten
SOPs the orchestrator declares, so it delegates the whole SOP to the developer, which hits the
same wall.

**The workaround that does work:** run `k-adversarial-pull-request-review` yourself against
`k-architect`, which owns it. That is step 4 below.

---

## Prerequisites

- A `source_dir` with changes — required for `k-code-review-workflow` and `k-code-cleanup`.
- For `k-test-coverage-review`: **both** `source_dir` and `test_dir`. It will not proceed if
  either is missing.
- For `k-adversarial-pull-request-review`: `diff_input` (git diff output, file paths, or raw PR
  diff) — **always required**. `pr_url` is optional and context-only; it never supplies the diff.
- Git history, if you want any of these to diff against `main` / `mainline` rather than scanning the
  whole directory.

---

## How to invoke

Through the orchestrator in plain language, or straight to the owning agent:

| You want | Talk to |
| --- | --- |
| Code review, cleanup | `k-developer` |
| Test coverage review | `k-quality-assurance` |
| Adversarial security review | `k-architect` |

The same names work on both runtimes.

---

## Worked example: shipping a "recipe box" feature

You have implemented tag-based search for a small personal recipe manager. Before opening a CR you
want it reviewed, its tests checked, cleaned of AI-generated cruft, and given a security-focused
second look.

### 1. `k-code-review-workflow` — multi-skill review

```text
Run the k-code-review-workflow SOP against my current branch.
```

1. **Discover changed files** — tries `git diff main...HEAD` (or `mainline`) for full diff content;
   falls back to scanning `source_dir` if not in a git repo. Excludes `node_modules/`, `build/`,
   `dist/`, `cdk.out/`, lock files, `.js.map`.
2. **Categorise files** — backend (`.ts`/`.js` under `**/handler*`, `**/service*`,
   `**/repository*`, `**/lambda*`, `**/util*`, `**/middleware*`), frontend (`.tsx`/`.jsx`, and `.ts`
   under `**/component*`, `**/page*`, `**/hook*`), infra (`.ts` under `**/cdk*`, `**/stack*`,
   `**/construct*`, `**/infra*`). Multi-match priority is **infra > frontend > backend**.
3. **Run review skills** — `backend-review`, `frontend-review`, `infra-validation` on their
   respective buckets; skips a skill entirely if no matching files.
4. **Consolidate** — sorts and dedupes into CRITICAL → IMPORTANT → SUGGESTION with `file:line`
   references.
5. **Critique findings** — actively rejects false positives: praise, speculation about unseen code,
   style-only nits, linter duplicates, vague suggestions with no concrete fix. *"When in doubt,
   reject — false positives erode trust."*
6. **Adversarial review** — attempts the architect spawn. **Always no-ops today** (see above), and is
   skipped by design when `review_type` is `frontend` only.
7. **Generate report** — writes `code-review-report.md` with a verdict: **READY FOR CR** or **NEEDS
   FIXES**.

**What you get:** `code-review-report.md` with a binary verdict and `file:line` for every surviving
finding.

### 2. `k-test-coverage-review` — the one with a hard pause

```text
Run the k-test-coverage-review SOP on src/ against test/.
```

1. **Discover files** — reports source count, test count, test-to-source ratio; flags source files
   with no matching test.
2. **Coverage analysis** (`test-coverage-analysis`) — writes
   `test-coverage-review/test-gap-analysis.md`, gaps categorised CRITICAL (untested core journeys) /
   IMPORTANT (untested error paths) / SUGGESTION (edge cases).
3. **Confirm scope** — **`Plan E2E tests for these gaps? [y/n]`**. The one pause in this chain.
   Answering `n` skips **only** step 4 — the security pass, the report and the verdict still run.
   Pass `dry_run: true` up front to stop here deliberately and just see the summary, or
   `scope_confirmed: true` to skip the prompt entirely (an unattended run must).
4. **E2E strategy** (`e2e-test-strategy`) — writes `test-coverage-review/e2e-test-strategy.md`, tests
   prioritised P0–P3 with a recommended execution strategy.
5. **Security tests** (`security-test-generation`) — writes **its own** files under
   `test-coverage-review/`: `tasks.md` on Kiro, or per-category files plus
   `security-test-overview.md` and `best-practices-reference.md` elsewhere. There is no
   `security-test-plan.md`. Covers all 7 domains (authentication, input validation, API security,
   data protection, session management, error handling, infrastructure) by layer.
6. **Consolidated report** — writes `test-coverage-review/test-coverage-review-report.md` with a
   **READY FOR RELEASE** / **NOT READY** verdict. It is NOT READY on critical gaps in either the
   coverage analysis or the security plan, **or** if the security plan came back `NOT EVALUATED` —
   which is what Kiro stub mode produces, and which must not be read as a clean pass.

**What you get:** three named files under `test-coverage-review/`, plus whatever the security
skill wrote — so the count varies by runtime.

> Supply `design_file` if you have one. Without it, the security test generator infers services from
> code rather than the real architecture and may reference services that do not exist — the SOP's own
> troubleshooting says so.

### 3. `k-code-cleanup` — the one that touches your source

```text
Run k-code-cleanup on my branch before I submit.
```

> **Commit or stash first.** This SOP edits files in place. That is not a bug — it is the one SOP
> designed to.

1. **Get changed files** — diffs `branch` against `main` / `mainline`, limited to `source_dir`,
   skipping binaries, lock files, and build artifacts.
2. **Identify AI slop** — flags comments that restate code, defensive checks duplicating existing
   validation, `as any` casts, style inconsistent with surroundings, and no-value wrapper
   abstractions. Explicitly does **not** flag TODOs, error handling and catch blocks, or comments
   explaining *why*.
3. **Apply cleanup** — the modification step. Removes only what step 2 flagged; never touches control
   flow, return values, or function signatures.
4. **Run review skills** — re-runs `backend-review` / `frontend-review` on the cleaned files.
5. **Present summary** — writes `cleanup-report.md` (Removed Items / Preserved Items / Review
   Findings) with counts removed per category.

**What you get:** your source files edited in place, plus `cleanup-report.md`. Run `git diff`
afterwards — this is the one SOP here where "review" means "changed your code".

### 4. `k-adversarial-pull-request-review` — the security second opinion

Ask **`k-architect`** directly. This is the workaround for the step 6 gap.

```text
Run k-adversarial-pull-request-review against my current diff.
```

0. **Context ramp-up** — reads linked issues and design docs referenced in the diff or commit
   message (max 3 each) and searches the codebase for existing error-mapping layers, transaction
   helpers, validation middleware, and pagination utilities relevant to the changed files. One pass
   per source, no recursive link-following, never blocks on missing context.
1. **Ingest diff** — accepts git diff output, file paths, or raw diff content; excludes binaries,
   lock files, build artifacts. Stops if the diff is empty.
2. **Parallel review passes** — spawns `k-developer` **three times concurrently**, each loading
   exactly one pass skill and receiving the diff plus the step 0 summary. Findings are never shared
   between them.
   - *Security* (`adversarial-code-review-pass-security`) — information disclosure, authorization,
     injection, secrets. CRITICAL if stack traces, internal IDs, or raw exception messages reach a
     caller, or unvalidated input reaches a query.
   - *Data integrity* (`adversarial-code-review-pass-integrity`) — multi-item mutations, atomicity,
     ordering, idempotency. CRITICAL for a multi-item mutation with no transaction, or an
     unconditional overwrite on a contested resource. Single-item writes are not flagged.
   - *Schema / contract* (`adversarial-code-review-pass-schema`) — API, schema and type changes,
     backward compatibility, validation completeness. IMPORTANT for ordering violations and wiring
     gaps. Test files are not flagged.
3. **Reuse pass** — a **fourth** `k-developer` spawn, looking only for cross-pass reuse: an
   existing utility the diff reimplements or bypasses, or one that would resolve two or more of the
   findings above. IMPORTANT when it flags a bypassed shared utility, transaction helper,
   validation middleware, error-mapping layer, or pagination utility.
4. **Checker phase** — `k-architect` switches roles and runs `adversarial-code-review` in Validator
   Mode **itself**, tagging every finding `KEEP` or `REJECT` with a reason and dropping the
   REJECTs. It proposes nothing new; it is a filter. Independence holds because the coordinator
   never ran a generator pass.
5. **Historical filter** — **always skipped here.** So is step 0.5 before it. Both are permanent
   no-ops on this package, reported as *"historical filtering unavailable"* rather than *"no prior
   revisions"*.
6. **Verdict** — dedupes by `file:line` and root cause keeping the highest severity, then: any
   CRITICAL → **REQUEST CHANGES**; no CRITICAL but ≥1 IMPORTANT → **APPROVE WITH COMMENTS**; neither
   → **APPROVE**.

**What you get:** `adversarial-review-report.md` with the verdict and per-severity counts.

> Across all three technical passes the instruction is the same: check whether the utility already
> exists **before** flagging its absence — and flag *bypassing* it instead. This is not a replacement
> for `k-code-review-workflow`; it runs after standard review to catch what style and quality reviewers
> miss.

---

## Checkpoint

- [ ] `code-review-report.md` exists with a READY FOR CR / NEEDS FIXES verdict.
- [ ] `test-gap-analysis.md`, `e2e-test-strategy.md` and `test-coverage-review-report.md` exist
      under `test-coverage-review/`, alongside the security skill's own output.
- [ ] `cleanup-report.md` exists, and `git diff` shows only slop removals — no logic changes.
- [ ] `adversarial-review-report.md` exists with an APPROVE / APPROVE WITH COMMENTS / REQUEST CHANGES
      verdict.

Any CRITICAL finding in the adversarial report forces REQUEST CHANGES regardless of the other counts
— that is its stated quality gate.

---

## Runtime differences

Mechanics are identical across runtimes for all four SOPs. The only runtime-relevant fact is the
step 6 delegation gap above, and that is about which *agent* has a spawn capability rather than about
Kiro CLI versus Claude Code behaviour once you are inside the right agent.

---

## Where to go next

- Verdict came back NEEDS FIXES or NOT READY? → [Plan and verify work](plan-and-verify-work.md) to
  re-run `k-verify` after the fixes land.
- Findings point at a design flaw rather than a code bug? → [Design a system](design-a-system.md)
- Never looked at this repository's architecture before changing it?
  → [Understand a codebase](understand-a-codebase.md)

---

[← Plan and verify work](plan-and-verify-work.md) · [Use cases](README.md)
