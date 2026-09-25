---
name: cmux-dispatch
description: Use when the user asks to delegate, spawn, or run a task in a separate cmux surface with a specific agent, or wants parallel agent sessions under cmux. Creates the surface, waits for readiness, delivers the prompt, and reports completion. For tmux or zellij, use mux-dispatch.
---

# cmux Dispatch

## Runtime Selection

The orchestrator always dispatches via panes. The dispatch script selects the CLI automatically:

- **Claude Code** (`$CLAUDECODE` is set): runs `claude --agent <PREFIX><agent-name> --dangerously-skip-permissions -p "<prompt>"` in the pane, where `<agent-name>` is the exact value passed via `--agent` (e.g. `k-developer`). This script never adds or strips a role prefix. `<PREFIX>` is the package-install prefix (e.g. `local-ASDLCCoreAICapabilities-`), derived by searching `~/.claude/agents/` for any installed agent file ending in `-<agent-name>.md` (local- installs preferred over registry installs, checked as separate tiers). No package name is hardcoded, so this resolves correctly for any installed package. **`--agent` must be a fully-qualified name.** If it matches 2+ installed agent files within the same tier (e.g. a partial name like `orchestrator` matching both `konductor-mux-orchestrator` and `konductor-cmux-orchestrator`), the script errors and lists the candidates rather than guessing. `--agent` values are also restricted to `[a-z0-9-]+` before any of this runs. Completion is detected via process exit (claude -p exits on task completion); the script then writes the `.done` marker file.
- **kiro-cli** (default): runs `kiro-cli chat --agent <agent-name> ...` in the pane, using the exact `--agent` value passed in. No prefix is added or stripped. Completion is detected via the kiro-cli `stop` hook writing the `.done` file.

## Overview

Spawn agent sessions in cmux surfaces so delegated work is visible, interactive, and course-correctable in real time.

## Usage

Use this skill when:

- User asks you to do ANY implementation, design, QA, documentation, or operations work
- User says "delegate", "spawn", "run this in a new tab/pane", "have X agent investigate"
- User wants parallel work visible in cmux rather than hidden sub-agents
- **NEVER** use `use_subagent` when cmux is available. Always use this skill instead

**You MUST immediately run the dispatch script without pre-checking the environment.** The script handles all validation (cmux availability, CMUX_WORKSPACE_ID) and exits with a clear error if anything is missing.

## Deterministic Script

### cmux-dispatch.sh

Spawns a agent session in a cmux tab, split, or workspace.

**Parameters:**

| Flag                  | Required | Description                                                                                                              |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `--agent`             | Yes      | Fully-qualified agent name, passed through verbatim (e.g. `k-developer`, `k-architect`); no prefix is added or stripped |
| `--task`              | Yes      | Task prompt to send to the agent                                                                                         |
| `--cwd`               | Yes      | Absolute path to project root; agent starts here                                                                        |
| `--name`              | No       | Tab/workspace title (defaults to agent + task summary)                                                                   |
| `--split right\|down` | No       | Split direction (default: right)                                                                                         |
| `--tab`               | No       | Create a new tab instead of a split                                                                                      |
| `--workspace`         | No       | Create a full workspace instead of a tab                                                                                 |
| `--close`             | No       | Auto-close the tab when the agent finishes                                                                               |
| `--interactive`       | No       | Keep kiro-cli open for human interaction (default: non-interactive)                                                      |

**Examples:**

```bash
# Delegate implementation to developer (split right, default)
bash skills/cmux-dispatch/cmux-dispatch.sh \
  --agent k-developer \
  --cwd /path/to/project \
  --task "Implement the user authentication API endpoint"

# Side-by-side split for architecture review
bash skills/cmux-dispatch/cmux-dispatch.sh \
  --agent k-architect \
  --cwd /path/to/project \
  --split right \
  --task "Review the DynamoDB table design"

# Auto-close tab when done
bash skills/cmux-dispatch/cmux-dispatch.sh \
  --agent k-quality-assurance \
  --cwd /path/to/project \
  --task "Run the full test suite" --close
```

## Completion Detection

Each agent's kiro-cli `stop` hook writes a done file:

- Path: `/tmp/konductor-cmux/<done-key>.done`. `<done-key>` is the surface-derived dispatch key (`DONE_KEY`, from `SURFACE_ID`), not the workspace id. In split/tab mode there is no workspace id at all; in `--workspace` mode the workspace id is recorded inside the file's `workspace_id` field, but the filename itself always uses `DONE_KEY`.
- Format: `{"workspace_id": "...", "status": "done|error", "summary": "..."}`

Poll (glob-free: an unmatched `*.done` glob is a hard error under zsh, which
aborts the whole compound command before `2>/dev/null` can apply):
`find /tmp/konductor-cmux -maxdepth 1 -name '*.done' 2>/dev/null`

The `summary` field in the `.done` payload is a short status string (and is
literally `"shell fallback"` / `"claude exit"` when the completion hook didn't
run), not a substitute for the deliverable. Dispatch prompts SHOULD instruct
the child agent to write its full deliverable to a file (e.g.
`/tmp/konductor-cmux/result-<slug>.md`) for the orchestrator to read; use
`cmux read-screen` only as a fallback.

## Worktree Provisioning for Write Agents

**The rule: every write-agent dispatch task must explicitly name the exact
target. Never let the agent infer or default.** A silent default is the
actual collision mechanism: two write agents (any agent that edits, creates,
or deletes files), from the same task or from different tasks, can each
independently default into the same working tree and step on each other:
half-applied edits, index contention, build contamination. This can happen
even when neither dispatch looks "concurrent" on its own. The named target
is one of three legitimate forms:

1. A new dedicated worktree: `wt-<id>` on branch `wt-<id>` (worktree and
   branch share one flat name), for the agent to create.
2. An existing worktree to reuse: `wt-<id>` at `<path>` on branch `wt-<id>`.
3. The shared primary tree, on a named feature branch `<branch>`, a
   deliberate, explicit choice, only for a single sequential write agent
   with no concurrent writer sharing that tree.

**Before dispatch (read-only):** check `.wt-ledger.json` and `git worktree
list` (ground truth over the ledger, which can go stale) and decide which of
the three forms applies for this task.

**`--cwd` points at the shared primary working tree** for every write-agent
dispatch, regardless of which of the three forms is named. A worktree named
under forms 1 or 2 may not exist yet at surface-launch time, and the primary
tree is guaranteed to already be a git repository, so `git worktree
list`/`git worktree add` work there with no extra `cd`. Pass the named
target in the dispatched task instead:

```bash
bash skills/cmux-dispatch/cmux-dispatch.sh \
  --agent k-developer \
  --cwd <primary-working-tree> \
  --task "Worktree wt-<id> already exists at <path> — cd in, do not create
          a new one. [OR: No worktree exists for this task — create wt-<id>
          before touching any file.]
          [OR: Work directly on branch <branch> in this shared working tree
          — no worktree for this task.]
          Implement the feature; commit and push the branch you're on; open
          a draft CR to mainline."
```

**Read-only agents** (research, investigation, review) need no worktree
decision at all. They share the primary working tree by default, and
`--cwd` points directly at the shared tree with no target to name.

**Write agent's first action, before touching any file:** if a worktree was
named (forms 1 or 2), independently re-run `git worktree list` (the
orchestrator's read could be stale by dispatch time), then either `cd` into
the existing worktree or provision it: running `$WORKTREE_PROVISION_CMD
wt-<id>` if that variable is set in its environment, otherwise `git worktree
add` (see Provisioning command below). If the shared tree was named (form
3), check out the named branch there.

### Provisioning command

The write agent provisions generically via `git worktree add`, but any
environment that has a more specific worktree tool can override this with
the `WORKTREE_PROVISION_CMD` environment variable. Set it in the
orchestrator's shell before dispatching. `cmux-dispatch.sh` forwards it
automatically into the dispatched surface's command, so no extra flag is
needed:

```bash
# Default (no WORKTREE_PROVISION_CMD set): plain git worktree, landed under
# a worktrees/ folder at the repo root.
# `git rev-parse --show-toplevel` returns the repo root
# (<workspace-root>/<repo>), 1 level below <workspace-root>, so `/..` reaches
# <workspace-root>.
git worktree add -b wt-<id> "$(git rev-parse --show-toplevel)/../worktrees/wt-<id>"

# Override point — set WORKTREE_PROVISION_CMD to substitute a
# project-specific provisioning command. It is invoked as:
#   $WORKTREE_PROVISION_CMD <wt-id>
# and must create (or otherwise make ready) a worktree whose directory
# name / return path corresponds to <wt-id>, landed at
# <workspace-root>/worktrees/wt-<id>.
export WORKTREE_PROVISION_CMD="<your-provisioning-command> --name"
```

This skill documents the hook generically; it does not prescribe what
`WORKTREE_PROVISION_CMD` should be set to in any specific environment.
Environment-specific documentation (outside this package) covers that.

**Naming.** Worktree and branch share one flat name, `wt-<id>` (hyphens
only, no slashes). Slashes in a worktree identifier can cause
directory-nesting problems in some worktree tooling (a parent path segment
getting registered as a single entry, masking children).

`git worktree add` checks out at exactly the path given, creating any
missing intermediate directories.

**Sequential handoff** is the reuse case (form 2) above, or continuing on the
same named shared-tree branch (form 3), a second write agent continuing the
same task gets the same named target in its task, and resumes there.
**Concurrent collaboration on one target is not supported, by design.**
Whether that target is a worktree or the shared tree, a maker/checker pair
never shares it; a checker gets its own separate read-only checkout, never
the maker's tree.

This is a **best-effort guardrail, not a hard boundary**. The agent
dispatched into the surface could in principle ignore the named target. Two
things provide harder enforcement after the fact:

- The pre-commit hook (husky/lint-staged, or the equivalent for this
  project) runs inside the tree the agent actually committed from. Edits
  made outside the named target simply will not surface in that commit.
- The CR diff at review time shows exactly which files changed; a human
  reviewer catches any file that should not have been touched before merge.

Cleanup (removing the worktree and branch) happens only after the agent's
draft CR has merged, and only with explicit user confirmation. This skill
does not perform cleanup itself.

## Best Practices

1. **`--cwd` is always the shared primary working tree for write-agent
   dispatch.** The dispatched agent acts on whichever target (new worktree,
   existing worktree, or the shared tree itself) is explicitly named in the
   task, as its first action from there; the surface launch never depends
   on a named worktree already existing. Read-only agents also use `--cwd`
   pointed at this same shared primary tree, with no target to name.
2. **Default to non-interactive**: agent processes task and exits
3. **Use --interactive** for tasks needing human review (specs, design review)
4. **Use --split right** for co-visible agents alongside the orchestrator
