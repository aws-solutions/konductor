---
name: claude-teams-behavior
description: 'Use when orchestrating an agent team in Claude Code: spawning background agents, deciding whether to SendMessage, or resolving agent names. Defines the hub-and-spoke contract between the orchestrator and its specialists.'
version: 1.1.0
tags: [skill, claude-code, agent-teams, orchestration]
---

# Claude Code Agent Teams

This skill is loaded only in Claude Code. It provides the orchestrator with the hub-and-spoke contract and decision rules for Agent Teams features (background agents, SendMessage).

## Hub-and-Spoke Contract

You (the orchestrator) are the sole hub. The rules below are MANDATORY:

- **SendMessage targets ONLY agents you spawned via `Agent()`.** You never message agents you did not spawn.
- **Specialists never message each other.** All coordination flows through you. A specialist that completes its work reports back to you; you decide what happens next.
- **You are the single point of coordination.** Do not instruct specialists to spawn further specialists or to relay messages to peers.

This constraint keeps multi-agent behavior portable across runtimes. This skill and Claude's `SendMessage`/`Agent()` tools are scoped to Claude Code only (via `claudeCli.skills` / `claudeCli.tools`); the same specialists also run as Kiro CLI subagents, which are one-shot with no peer-messaging channel — the orchestrator spawns a specialist, it runs to completion in isolation, and returns its result. Peer-to-peer coordination therefore cannot be relied on cross-runtime, so all coordination flows through the orchestrator. This also matches the documented orchestrator-only dispatch design: native dispatch belongs solely to the orchestrator, and nested subagent spawning is unsupported in both runtimes.

## Tool Usage: Glob and Grep

Your system prompt instructs you to delegate shell commands (`Bash`) to specialist agents. However, `Glob` and `Grep` are **built-in tools, not shell commands**. You have them in your tool list and should use them directly for lightweight file discovery and pattern matching:

- **`Glob`** — find files by pattern (e.g., `**/*.json`). Use instead of delegating `find` or `ls`.
- **`Grep`** — search file contents by regex. Use instead of delegating `grep` or `Bash(grep ...)`.

Use `Glob`/`Grep` directly when:

- You need to locate a file or check if a pattern exists (quick lookup)
- You are within your 3-file read budget

Delegate to a subagent when:

- The search is part of a larger implementation task
- You need to read/modify many files based on search results

## Tool Usage: `git worktree list` (narrow Bash exception)

The Bash-delegation rule above is otherwise unconditional for shell commands.
`git worktree list` is one narrow, explicit exception: run it directly via
your `Bash` tool to check existing worktree state before dispatching a write
agent (see Worktree Scoping below). This exception covers only that one
read-only listing command, plus reading `.wt-ledger.json` with your file-read
tool — it does not cover `git worktree add`, `git worktree remove`, or any
other git/Bash command, which stay delegated to the write agent.

## Worktree Scoping

`Agent()` has no `cwd` parameter — a spawned Claude Code subagent starts in
the orchestrator's own working directory. Working-tree isolation is
established by prompt, not by parameter.

**The rule: every write-agent dispatch prompt must explicitly name the
exact target — never let the agent infer or default.** A silent default is
the actual collision mechanism: two agents (from the same task or from
different tasks) can each independently default into the same location and
step on each other, even when neither dispatch looked "concurrent" from the
orchestrator's own point of view. The named target is one of three
legitimate forms:

1. A new dedicated worktree — `wt-<id>` on branch `wt-<id>` (worktree and
   branch share one flat name), for the agent to create.
2. An existing worktree to reuse — `wt-<id>` at `<path>` on branch `wt-<id>`.
3. The shared primary tree, on a named feature branch `<branch>` — a
   deliberate, explicit choice, only for a single sequential write agent
   with no concurrent writer sharing that tree.

**Read-only agents** (research, investigation, review) need no worktree
decision at all — they share the primary working tree by default, and the
dispatch prompt does not need to name a target.

**Before dispatch (orchestrator — read-only):** using the narrow exception
above, check current worktree state (`.wt-ledger.json` and `git worktree
list` — treat `git worktree list` as ground truth over the ledger, which can
go stale) and decide which of the three forms applies for this task. This is
a read plus a naming decision, not a mutation — it needs no exception to the
orchestrator's zero-mutation rule, and the `git worktree list` call itself is
covered by the narrow Bash exception above.

**State the decision in the dispatch prompt:**

```text
Agent(
  subagent_type: "<prefix>k-developer",
  prompt: "Worktree wt-<id> already exists at <path> — cd in, do not create
           a new one.
           [OR: No worktree exists for this task — create wt-<id> before
           touching any file.]
           [OR: Work directly on branch <branch> in the shared working tree
           at <path> — no worktree for this task.]

           TASK: <task description>
           ..."
)
```

**Write agent's first action, before touching any file:** if a worktree was
named, independently re-run `git worktree list` (the orchestrator's read
could be stale by dispatch time), then either `cd` into the existing
worktree or provision it — running `$WORKTREE_PROVISION_CMD wt-<id>` if that
variable is set in its environment, otherwise `git worktree add` (see
`mux-dispatch`/`cmux-dispatch`'s Provisioning command section for the same
hook). If the shared tree was named, check out the named branch there. The
write agent was always going to mutate — this is an explicit first step, not
new authority.

This is a **best-effort guardrail, not a hard boundary** — the subagent could
in principle ignore the instruction. Two things provide harder enforcement
after the fact:

- The pre-commit hook (husky/lint-staged, or the equivalent for this
  project) runs inside the tree the agent actually committed from — edits
  made outside the named target simply will not surface in that commit.
- The CR diff at review time shows exactly which files changed; a human
  reviewer catches any file that should not have been touched before merge.

**Sequential handoff** is the reuse case above, not a special case — a
second write agent continuing the same task gets the same named target
(worktree or shared-tree branch) in its prompt and resumes there.

**Concurrent collaboration on one target is not supported, by design** —
that is the exact collision this mechanism exists to prevent, whether the
target is a worktree or the shared tree. A maker/checker pair never shares a
target; a checker gets its own separate read-only checkout (e.g.
`CrCheckout`), never the maker's tree. Only sequential reuse of a named
target is legitimate; two write agents on the same target at the same time
is always wrong.

## Agent Name Resolution

When spawning subagents via `Agent()`, use the **full installed agent name** — short names do not resolve. Derive the correct prefix from your own agent name:

- Your agent name contains the package prefix (e.g., `ASDLCCoreAICapabilities-konductor` or `local-ASDLCCoreAICapabilities-konductor`)
- Replace your role suffix with the target specialist's role to get the full name
- Example: if you are `ASDLCCoreAICapabilities-konductor`, spawn `ASDLCCoreAICapabilities-k-developer`
- Example: if you are `local-ASDLCCoreAICapabilities-konductor`, spawn `local-ASDLCCoreAICapabilities-k-developer`

The prefix varies by install type (registry vs local). Always match your own prefix.

## SendMessage / Background Agents

### How to Achieve Parallel Execution

Both fire-and-wait (multiple `Agent()` calls in one message) and `run_in_background: true` achieve true parallelism — agents run concurrently in both cases. The difference is:

- **Fire-and-wait:** orchestrator blocks until all complete, receives all results in one response turn. Best for short, independent lookups where you need all results before proceeding.
- **Background agents (`run_in_background: true`):** orchestrator continues working while agents run, receives notifications individually as each completes, and can inject context mid-run via `SendMessage`. Best for long-running work, maker-checker patterns, and tasks where findings from one agent should feed another.

When `SendMessage` is in your tool list, **prefer `run_in_background: true`** for parallel work — it unlocks mid-run communication that fire-and-wait cannot provide. See the Decision Rule below for when each is appropriate.

### Detection

Check your tool list for `SendMessage`:

- **Present** → use the Teams patterns below
- **Absent** → use standard `Agent()` fire-and-wait calls

### Decision Rule

Use background agents (`run_in_background: true`) when:

- You have 2+ independent subtasks that can run concurrently
- Tasks do NOT depend on each other's output
- You want to inject findings from one agent into another mid-run
- Tasks are long-running and you want to continue working while waiting

Do NOT use background agents when:

- Task B depends on Task A's output (use sequential `Agent()` calls)
- There is only one subtask
- The task is simple enough for a single agent (short lookups — fire-and-wait is fine)

### Full Pattern

```text
# Step 1 — spawn independent agents simultaneously
researcher_id = Agent(subagent_type: "ASDLCCoreAICapabilities-k-researcher", run_in_background: true, prompt: "Research X")
developer_id = Agent(subagent_type: "ASDLCCoreAICapabilities-k-developer", run_in_background: true, prompt: "Implement Y")

# Step 2 — inject follow-up context mid-run if needed (hub only — never specialist-to-specialist)
SendMessage(to: researcher_id, message: "Also check Z")
SendMessage(to: developer_id, message: "Use the pattern from file W")

# Step 3 — wait for completion notifications (runtime notifies you — do NOT poll)

# Step 4 — aggregate results and report to user
```

### Resume Over Re-spawn

**Same-task follow-up → `SendMessage`.** When a subagent returns and needs follow-up on that same task, use `SendMessage` (retains session context) instead of a new `Agent()` (starts from zero).

**Independent work → new `Agent()`.** Spawn fresh for genuinely new tasks, even while another session is active. Don't serialize unrelated work behind one session — that defeats concurrency.

### Primitives

| Primitive                                    | What it does                                                        |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `Agent(run_in_background: true, ...)`        | Spawns a background agent, returns `agentId`                        |
| `SendMessage(to: <agentId>, message: "...")` | Resumes an existing agent's session — does NOT spawn new agents     |
| `Agent()` (no `run_in_background`)           | Fire-and-wait — use when Teams is unavailable or task is sequential |
