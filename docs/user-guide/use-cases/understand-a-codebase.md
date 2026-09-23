<!-- SPDX-License-Identifier: Apache-2.0 -->

# Use case: understand a codebase

[← Use cases](README.md) · [Guide index](../README.md)

Two SOPs cover this at very different depths. Both are owned by **`k-developer`**.

| SOP | Depth | Setup | Modifies anything? |
| --- | --- | --- | --- |
| [`k-pre-cr-critique`](../sop-workflows/code-review.md#k-pre-cr-critique) | A local diff, across six review dimensions | None | No — strictly read-only |
| [`k-codebase-analysis`](../sop-workflows/testing-and-specs.md#k-codebase-analysis) | The whole repository, a ten-step architecture report | None | No — static analysis only |

Just cloned something and want a fast read before touching it? Start with `k-pre-cr-critique` on a
small change. Want the full picture before changing anything? Go straight to
`k-codebase-analysis`.

---

## Prerequisites

- The target repository checked out locally, with git history if you want `k-pre-cr-critique` to
  diff against commits or branches.
- **Start the session from inside that repository.** Neither SOP asks you for a target: both
  default to the working directory your runtime was launched in — `k-pre-cr-critique` critiques the
  uncommitted changes there, `k-codebase-analysis` reads the current directory. To point either at
  somewhere else, name the path in your request, and it becomes the SOP's `critique_scope` or
  `codebase_path` parameter.

Both SOPs default every other parameter and need no config files, environment variables, or
network access.

---

## How to invoke

Through the orchestrator, in plain language:

```text
Critique my uncommitted changes.
```

```text
Run a codebase analysis on this repo.
```

The orchestrator routes both to `k-developer`, which owns both SOPs. To skip the routing hop,
start a session with the developer agent directly: `k-developer`, on either runtime.

---

## Worked example: onboarding onto `csvtrim`

You have just been handed a small open-source CLI tool, `csvtrim` — it trims whitespace, dedupes
rows, and validates headers in CSV files. You have never seen the code.

### Step 1 — Fast read with `k-pre-cr-critique`

You made a one-line fix to try things out and want a sanity check before anyone reviews it.

```text
Critique my uncommitted changes.
```

What happens:

1. **Resolve parameters** — defaults `critique_scope` to uncommitted changes, `output_dir` to
   `.agents/scratchpad`, `mode` to `auto`. It will not prompt you, because every parameter has a
   default.
2. **Gather changes** — runs `git diff` and `git diff --cached`, excluding lock files and build
   artifacts. If the diff is empty it says so and stops.
3. **Critique** — analyses across six dimensions: correctness, performance, security,
   maintainability, architecture, testing. Every finding gets a severity (Critical / Important /
   Minor) and a dimension tag.
4. **Resolve issues** — in `auto` mode it picks `fix` / `won't fix` / `defer` per finding with a
   one-line rationale. Ask for `interactive` mode to be walked through each finding yourself —
   that is the only point where this SOP pauses.
5. **Finalise** — writes the full write-up to `.agents/scratchpad/critique-NNN.md`, auto-numbered
   so repeat runs do not overwrite each other.
6. **Present** — a summary only: the file path, counts by severity, one line per Critical finding.
   It will not paste the document into the conversation.

**What you get:** `.agents/scratchpad/critique-001.md`, or the next free number.

> **This SOP is strictly read-only.** It never modifies **source** files, runs your build, or
> creates commits — the critique document above is the only thing it writes. Treat a `fix` resolution as a suggestion you still have to apply yourself — and the SOP
> will remind you of exactly that.

### Step 2 — Deep read with `k-codebase-analysis`

Now the real picture: architecture, SOLID adherence, design patterns, dependencies, technical debt.

```text
Run a codebase analysis on csvtrim, focus on architecture, dependencies, and debt.
```

Or say nothing after "analysis" and it defaults to `all` — every section.

Ten steps, all static analysis, no code execution:

1. Resolves `codebase_path` (default: current directory) and `output_file` (default:
   `codebase-analysis.md`), then creates the file with a header immediately so writes accumulate.
2. **Codebase map** — languages, frameworks, entry points, build system, plus a Mermaid `graph TD`
   of the directory structure. *First diagram.*
3. **Architecture** — style, layer boundaries, dependency direction, plus a Mermaid `graph LR`
   dependency graph. *Second diagram.*
4. **SOLID** — all five principles rated ✅ / ⚠️ / ❌ with a concrete code example each. It will not
   fabricate examples.
5. **Design patterns** — Gang-of-Four and architectural patterns with file paths, reported only
   where clearly present. No force-fitting.
6. **Dependencies and integrations** — external and internal catalogue, flagged circular
   dependencies and outdated packages, plus a Mermaid integration diagram. *Third diagram.*
7. **Code quality** — error handling, logging, test-to-source ratio.
8. **Security and performance** — input validation, auth, hardcoded secrets, N+1 queries, missing
   pagination.
9. **Technical debt** — TODO/FIXME/HACK/XXX scan, dead code, duplication, each rated CRITICAL /
   IMPORTANT / SUGGESTION.
10. **Final report** — a 3–5 sentence executive summary plus a P0/P1/P2 prioritised
    recommendations list.

There is no pause anywhere in this SOP. It runs end to end and reports the file path plus the top
three recommendations.

**What you get:** `codebase-analysis.md` with three Mermaid diagrams and the SOLID, patterns,
quality, security, and debt sections.

---

## Checkpoint

- [ ] `.agents/scratchpad/critique-001.md` exists and lists findings with severities.
- [ ] `codebase-analysis.md` exists and contains three Mermaid diagrams.
- [ ] Neither run modified a single source file.

That last point is the one to verify — `git status` should show no changes beyond whatever you had
before. Both SOPs on this page are read-only; if either edited your code, something is wrong.

---

## If the codebase is too large

`k-codebase-analysis` writes incrementally, which is the basis of its own remedy: re-run with
a narrower `focus_areas` and let the file accumulate across runs.

```text
Run k-codebase-analysis with focus_areas=architecture,dependencies
```

Valid values are `architecture`, `solid`, `patterns`, `dependencies`, `security`, `performance`,
`testing`, `debt`, and `all`. Note `security` and `performance` map to the same step, and `testing`
maps to the Code Quality step — the full mapping is in the
[SOP reference](../sop-workflows/testing-and-specs.md#focus_areas-to-step-mapping).

For `k-pre-cr-critique`, narrow with `focus_areas` (which reorders rather than filters — all six
dimensions are still analysed) or set `critique_scope` to specific files.

---

## Runtime differences

None. Both SOPs behave identically once the developer agent is in context. The only difference is
how you reach `k-developer` — through the orchestrator's routing, which works in both runtimes,
or by targeting the agent directly with `--agent`.

---

## Where to go next

- Found architecture-level debt, or a decision that needs a real trade-off analysis?
  → [Design a system](design-a-system.md)
- About to change the code you just analysed? → [Plan and verify work](plan-and-verify-work.md)
- Ready to submit a change? → [Review code and tests](review-code-and-tests.md)

---

[← Use cases](README.md) · [Next: Design a system →](design-a-system.md)
