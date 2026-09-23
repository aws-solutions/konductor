<!-- SPDX-License-Identifier: Apache-2.0 -->

# Use case: plan and verify work

[← Use cases](README.md) · [Guide index](../README.md)

The most explicitly-chained sequence in the package:
[`k-context-gathering`](../sop-workflows/planning-and-analysis.md#k-context-gathering) →
[`k-plan`](../sop-workflows/planning-and-analysis.md#k-plan) →
[`k-verify`](../sop-workflows/planning-and-analysis.md#k-verify). Every handoff is written
into the SOP text itself rather than left implicit.

All three are declared by all three orchestrators. This page uses the plain
**`konductor`**.

---

## What "owned by the orchestrator" actually means

The orchestrators are dispatchers by design — but no runtime enforces it. In Kiro CLI
`konductor`'s `allowedTools` is `fs_read` alone, which pre-approves reads and nothing else; a write
or a shell command still reaches you as a permission prompt, because `@builtin` grants both. In
**Claude Code it is granted `Bash` and `Write`** with no prompt of its own, alongside `Read`, `Glob`, `Grep`,
`WebFetch`, `WebSearch`, `TodoWrite`, `Workflow`, `Skill`, `SendMessage`, and an `Agent(...)` tool
scoped to the eight specialists. Only its routing rules stop it using them, so the dispatcher
behaviour you see there is a convention rather than a wall.

`k-context-gathering` says this out loud:

> **Execution context:** Steps below run shell commands and may write files. An agent without those
> tools delegates them to specialist agents per its routing rules.

So when you run this chain "via the orchestrator", the orchestrator reads, synthesises, and routes.
The file writes, `git diff` calls, and build and test commands execute through whichever specialist
it delegates to — `k-developer` for implementation and shell work, `k-researcher` for
parallel research, `k-architect` for escalations.

That is the point of running it through the orchestrator rather than a single specialist: it is the
one agent built to coordinate across all three SOPs in one pass, and the one with the widest
delegation reach — an explicit allowlist naming all eight specialists. See [Who can delegate to whom](../agents.md#who-can-delegate-to-whom).

---

## Prerequisites

- A task or feature area. `k-context-gathering` requires `target`, `k-plan` requires `objective`,
  `k-verify` requires `source_dir`. In an orchestrated run you generally state the goal once and
  the orchestrator carries it through.
- A working build and test setup if you want `k-verify` to run anything real. It auto-detects
  from `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml` / `setup.py`,
  `build.gradle(.kts)`, or `pom.xml`.

---

## How to invoke

Start a session with `konductor` (or `konductor` in Claude
Code) and state the goal.

Prefer a pane-per-agent view? `konductor-mux-orchestrator` (tmux/zellij) and
`konductor-cmux-orchestrator` (cmux) declare the same three SOPs and dispatch specialists into separate
panes instead of using a subagent tool. They have **no** `subagent` or `Agent(...)` tool at all —
they shell out to their dispatch scripts and poll for a `.done` marker. Useful when you want to
watch each specialist work.

---

## Worked example: adding recurring reminders to "Roster", a shift-scheduling SaaS

Roster is a small app where managers build weekly shift schedules for retail teams. You have been
asked to email a manager 24 hours before an unfilled shift starts. You have never touched Roster's
notification code.

### Step 1 — `k-context-gathering`

```text
I need to understand how to add a 24-hour-before reminder for unfilled shifts in Roster — analyze before we implement.
```

1. **Gather context** — the orchestrator spawns one or two `k-researcher` instances in parallel
   to search for existing notification and scheduling patterns, plus another for external library
   docs if the mail path uses a third-party mailer. Direct `grep` / `rg` / `ast-grep` searches run
   alongside, scoped to whatever `scope` you gave (`src/notifications/`, say).
2. **Define analysis questions** — answers at minimum the five standard ones: how the system works,
   patterns in use, dependencies, integration points, existing tests. Plus any you add.
3. **Assess complexity** — checks a fixed table of escalation triggers: architecture decision
   required, 3+ component coordination, 2+ failed debugging attempts, security implications. A
   shift-reminder touching the mailer, the scheduler, and the shift-status model would likely trip
   "multi-system coordination (3+ components)" and get flagged for architect consultation.
4. **Synthesise findings** — Current State / Patterns Identified / Dependencies / Constraints /
   Recommended Approach. If this exceeds roughly 100 lines it is written to
   `.konductor/handoff/<analysis-name>.md` and the path returned instead of the full text.
5. **Proceed to implementation** — the SOP is explicit about the handoff: *"You MUST create an
   implementation plan (using the plan SOP) based on the analysis summary."* If step 3 flagged an
   escalation that has not happened, **the SOP will not let you past this point.**

**What you get:** an Analysis Summary in the conversation, or at
`.konductor/handoff/<analysis-name>.md` if long — plus a mandatory handoff into `k-plan`.

### Step 2 — `k-plan`

The orchestrator carries the analysis forward. This SOP produces its output in the response; no file
write is mandated.

1. **Success criteria** — Functional / Observable / Pass-Fail. For example: "manager receives
   exactly one email per unfilled shift, sent 22–26 hours before shift start."
2. **Task breakdown** — specific, estimated, prioritised High / Medium / Low. Never vague tasks.
3. **Dependency map** — "write the reminder-scheduling job" depends on "add a `remindAt` field to
   the shift model". No circular dependencies.
4. **Agent assignment** — from the SOP's own table: codebase and doc search → `k-researcher`;
   implementation, tests, docs → `k-developer`; architecture review → `k-architect`; plan
   review and estimation → `k-tpm`.
5. **Timeline estimate** — a buffered baseline (20% floor for well-understood work, 40% for novel or
   uncertain) is the **authoritative** number. The orchestrator then delegates an *Agentic
   Projection* to `k-tpm`, which owns `legacy-to-agentic-estimate` and its
   `convert_estimates.py` script, as an informational low/mid/high band alongside the baseline.
6. **Execution plan** — phases in dependency order, parallel tasks marked, and — load-bearing —
   *"You MUST include a Verification phase using the verify SOP."*

> **On the estimate:** the projection is informational, never the commitment. Its tier presets are
> uncalibrated defaults pending team telemetry, and the SOP requires presenting the full low–high
> band rather than the mid point. Treat differences finer than about 15 minutes as noise. If
> `k-tpm` is unreachable the SOP self-computes using the skill's documented formula and says it
> was not script-verified; if even that is impossible it skips the projection and says why. A skip
> is not a failure — the baseline stands alone.

**What you get:** a structured Execution Plan — Success Criteria → TODOs → Dependencies → Agent
Assignments → Timeline → Phased Plan — with an explicit Verification phase pointing at step 3.

### Step 3 — `k-verify`

Once `k-developer` has implemented the reminder job:

```text
Verify the shift-reminder feature is done.
```

1. **Pre-check** — confirms success criteria exist (from step 2) and all TODOs are complete. Will
   not proceed to build otherwise.
2. **Run build** — auto-detects the build system, captures the exit code. **Stops on failure.**
3. **Run tests** — runs the detected test command plus any separate integration suite or CI job,
   captures pass/fail counts. **Stops on failure.**
4. **Run lint** — captures error and warning counts. Warnings are acceptable; errors block.
5. **CDK verification** — skipped for Roster unless it has CDK infrastructure code.
6. **Manual verification** — the SOP is explicit: *"You MUST NOT skip this step — automated tests
   alone are insufficient."* Someone actually triggers an unfilled shift 24 hours out and confirms
   the email arrives.
7. **Collect evidence** — one report combining Build / Tests / Lint / Manual Verification plus a
   final seven-item checklist.

**What you get:** a Verification Evidence report in the conversation with a status per checklist
item. There is no default file path for this one — it is presented inline unless you ask for it to
be saved.

---

## Checkpoint

The final checklist is all-or-nothing. The task is not complete unless every line passes:

- [ ] All success criteria met
- [ ] Build passes
- [ ] Tests pass
- [ ] Lint passes
- [ ] Manual verification complete
- [ ] No regressions
- [ ] Documentation updated, if applicable

Automated green alone does not equal done — that is the whole point of steps 6 and 7.

---

## Runtime differences

The chain itself is runtime-agnostic. What differs is dispatch mechanics:

| | Dispatch mechanism |
| --- | --- |
| `konductor` | Kiro CLI's `subagent` tool or Claude Code's `Agent(...)` tool, spawning specialists inline |
| `konductor-mux-orchestrator` | `skills/mux-dispatch/` shell scripts — a pane per specialist, polling `/tmp/konductor-mux/*.done` |
| `konductor-cmux-orchestrator` | `skills/cmux-dispatch/cmux-dispatch.sh` — a surface per specialist, polling `/tmp/konductor-cmux/*.done` |

Functionally the same three SOPs run either way.

One caveat worth knowing: **specialist-to-specialist handoff is narrower in Claude Code**. There,
only `k-architect` (→ developer, QA) and `k-quality-assurance` (→ developer, browser) carry
`Agent(...)` tools of their own; `k-developer` and `k-tpm` have Kiro CLI targets but no `Agent(...)`
tool at all. The multiplexer variants shell out instead, so they work either way.

---

## Where to go next

- New codebase and step 1 feels like a cold start? Run
  [Understand a codebase](understand-a-codebase.md) first — both its SOPs are lighter than a full
  `k-context-gathering` pass.
- Step 1 flagged an architecture escalation? → [Design a system](design-a-system.md)
- Implemented and verified — now get it reviewed before opening a CR?
  → [Review code and tests](review-code-and-tests.md)

---

[← Design a system](design-a-system.md) · [Next: Review code and tests →](review-code-and-tests.md)
