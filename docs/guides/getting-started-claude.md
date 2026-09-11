# Getting Started with Claude Code

> **Publication pending:** The release artifact for this package is not yet published to GitHub. Until the release is available, this guide describes the intended install and usage.

This guide covers how to install and use the ASDLC Core AI Capabilities agent team with Claude Code.

## Prerequisites

- [Claude Code](https://claude.ai/download) installed and authenticated
- Git available on your `PATH`

## Installation

```bash
aim plugins install ASDLCCoreAICapabilities --namespaces standalone
```

`aim plugins install` installs the package as a Claude Code plugin under `~/.claude/plugins/` — it does not copy individual agent, skill, or SOP files into `~/.claude/` directly. No cloud infrastructure or additional dependencies beyond the `aim` CLI are required.

## Invoking an Agent

Installing as a plugin namespaces agent names by package, so the orchestrator's name is prefixed: `ASDLCCoreAICapabilities-konductor`, not the bare `konductor`.

```bash
claude --agent ASDLCCoreAICapabilities-konductor
```

The orchestrator coordinates the rest of the team — you do not need to invoke specialist agents directly for most tasks.

## Skills: How They Load and Who Can Invoke Them

Every agent in this package ships with domain skills (`skills/<name>/SKILL.md` files). This section describes how Claude Code itself loads and gates skill content — standard Claude Code behavior, not anything specific to this package's install tooling. It's useful if you add your own project skills under `.claude/skills/`, want to understand why an agent did or didn't use a skill, or need to debug a skill that never triggers.

Each claim below is labeled by how it was checked: **[Documented]** (quoted from `code.claude.com/docs`), **[Measured]** (directly observed in a live session), or **[Inferred]** (reasoned from two separately documented statements, not observed directly).

### Two independent ways a skill's content reaches an agent — [Documented]

Claude Code has two separate mechanisms for getting a skill's body into an agent's context. Confusing them is the most common configuration mistake:

1. **Frontmatter `skills:` preload.** Listing a skill in a subagent's `skills:` frontmatter field injects its **full content** into that subagent's context at startup — no tool call involved. Per the docs: "The full skill content is injected, not only the description."
2. **The native `Skill` tool, on demand.** In a regular session, only a skill's name and description load into context at session start. The full body loads only when the skill is actually invoked — either by typing `/skill-name` or by Claude calling the `Skill` tool.

The docs warn against conflating the two, in both directions. On the `tools:` field: "To preload Skills into context, use the `skills` field rather than listing `Skill` here." And on `skills:`: it "controls which skills are preloaded, not which skills the subagent can access: without it, the subagent can still discover and invoke project, user, and plugin skills through the `Skill` tool during execution."

Each misconfiguration fails differently: an agent with no `Skill` grant and no preload for a given skill genuinely cannot see it and will say something like "I don't have a `<skill>` skill available." A skill that's only reachable through the `Skill` tool — not preloaded via `skills:` — does not get its content injected at startup; it loads on demand only, when actually invoked.

### `tools:` is a restrictive allowlist — [Documented]

If a subagent's frontmatter declares an explicit `tools:` list, anything **not** listed is unavailable — including `Skill`. From the docs: an explicit `tools:` allowlist means "the subagent can't edit files, write files, or use any MCP tools" for anything omitted from that list. The same applies to `Skill`: an agent with an explicit `tools:` list that omits `Skill` cannot invoke any skill on demand, regardless of what it declares in `skills:`. Omitting the `tools:` field entirely, by contrast, inherits every tool available to subagents — including `Skill`.

### Where skills live — [Documented]

| Location   | Path                                     | Applies to                    |
| ---------- | ----------------------------------------- | ------------------------------ |
| Enterprise | Managed settings directory                | All users in an organization   |
| Personal   | `~/.claude/skills/<skill-name>/SKILL.md`  | All of your projects           |
| Project    | `.claude/skills/<skill-name>/SKILL.md`    | This project only              |
| Plugin     | `<plugin>/skills/<skill-name>/SKILL.md`   | Wherever the plugin is enabled |

Two further categories sit outside that table: **bundled skills** (e.g. `/code-review`, `/doctor`) ship with Claude Code itself and are available in every session, and **claude.ai-synced skills** download into the reserved `~/.claude/skills/synced/` folder when you opt in via `CLAUDE_CODE_SYNC_SKILLS`.

Two specific built-in commands, `/init` and `/security-review`, are reachable through the `Skill` tool. Others, such as `/compact`, are not — the docs draw this line explicitly.

### Who can invoke a skill — [Documented]

By default, both you and Claude can invoke any skill. Three independent controls narrow that:

- **Per-skill, in the skill's own frontmatter.** `disable-model-invocation: true` means only you can invoke it — Claude never will, and its description is dropped from context entirely. `user-invocable: false` means only Claude can invoke it (hidden from the `/` menu, but still description-matchable).
- **Per-skill, from your settings, without editing the file.** `skillOverrides` in `settings.json` takes a skill name and one of four values: `"on"` (default — name and description listed, in the `/` menu), `"name-only"` (name only, no description, still in the `/` menu), `"user-invocable-only"` (hidden from Claude, still runnable by name), or `"off"` (hidden everywhere). **`skillOverrides` does not affect plugin skills** — manage those through `/plugin` instead.
- **Via permission rules.** `Skill(name)` allows or denies an exact skill by name; `Skill(name *)` does the same as a prefix match against arguments. Denying the bare `Skill` tool disables skill invocation entirely.

Model-invocability and whether a description is loaded into context move together: the same documented control that blocks Claude's invocation (`disable-model-invocation: true`) also removes the description from context — the two aren't independent settings.

### Malformed or missing frontmatter — [Documented]

A `SKILL.md` with malformed YAML frontmatter is **not excluded**. Claude Code loads the body anyway, with empty metadata: `/skill-name` still works, but Claude has no `description` to match against, so the skill becomes invisible to automatic (model-driven) invocation. All frontmatter fields are optional; only `description` is recommended, specifically so Claude knows when to use the skill.

### The description-listing budget — [Documented]

Every session loads a listing of every discoverable skill's name and description so Claude knows what exists. That listing has a budget — **1% of the model's context window** by default (`skillListingBudgetFraction`), with each skill's combined `description` + `when_to_use` text capped at 1,536 characters (`skillListingMaxDescChars`). When the total listing exceeds the budget, Claude Code drops descriptions starting with the **least-invoked** skills, keeping full text for the skills you use most. Run `/doctor` for an estimate of the listing's context cost; a debug-log warning fires on overflow (visible with `--debug`).

### Directory and naming rules — [Documented]

- A skill is `<dir>/SKILL.md`; a single-skill plugin can instead put `SKILL.md` at its own root.
- For personal and project skills, frontmatter `name` sets only the **display label** in skill listings — the invocable command still comes from the directory name.
- For plugin skills, frontmatter `name` replaces the **last segment** of the namespaced command (e.g. `my-plugin/skills/review/SKILL.md` with `name: fancy` becomes `/my-plugin:fancy`); for a plugin-root `SKILL.md`, `name` supplies the whole final segment, falling back to the plugin's directory name.
- Skill directories can be symlinks; Claude Code follows them and reads `SKILL.md` from the target. If the same target is reachable from more than one location, it loads once.

### Running a skill in isolation: `context: fork` — [Documented]

Setting `context: fork` in a skill's frontmatter runs that skill in its own forked subagent, regardless of who or what invoked it — it's a property of the invoked skill, not of the caller. The skill's own content becomes the forked subagent's task prompt; that subagent does not inherit the calling conversation's history.

### No version gate on the `Skill` tool's existence — [Documented]

The tools reference lists specific minimum versions for individual tools (e.g. `EndConversation` requires v2.1.213+) but states none for `Skill` itself. Version gates that do exist attach to specific frontmatter *features* — for example, the `background` field on a forked skill requires v2.1.218+, and the `${CLAUDE_PROJECT_DIR}` substitution requires v2.1.196+ — not to the `Skill` tool's existence.

### A skill's `allowed-tools` doesn't override the agent's own `tools:` grant — [Inferred]

A skill's own `allowed-tools` frontmatter field pre-approves specific tools **for the turn that invokes it** — it removes an approval prompt; it does not add a tool the agent doesn't otherwise have. This connects two separately documented statements (what `allowed-tools` grants, and what an explicit `tools:` allowlist restricts) rather than resting on one sentence that states the interaction directly. **What would settle it directly:** grant an agent `Skill` but omit some other tool (e.g. `Bash`) from its `tools:` list, invoke a skill whose body calls for that tool, and observe whether the call is blocked.

## Agent Team (Optional)

The ASDLC package ships a coordinated hub-and-spoke team:

| Agent                        | Role                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `konductor`                  | Hub — coordinates all specialists, delegates tasks, tracks progress |
| `k-developer`                | Implements code, reviews changes, manages git, validates builds     |
| `k-architect`                | System designs, API specs, data models, threat models               |
| `k-researcher`               | External docs, web research, open-source codebase search            |
| `k-product-manager`          | Requirements, user stories, investment narratives                   |
| `k-quality-assurance`        | Test coverage, E2E strategy, security tests                         |
| `k-tpm`                      | Program plans, status reports, risk tracking                        |
| `k-media-analyzer`           | Interprets PDFs, images, diagrams                                   |
| `k-browser`                  | Browser automation, form filling, screenshots, E2E                  |
| `konductor-mux-orchestrator` | Parallel dispatch via tmux/zellij panes                             |
| `konductor-cmux-orchestrator`| Parallel dispatch via cmux                                          |

> **Note:** All 11 agents in the roster above are first-party agents in the current base release.

### Hub-and-spoke model

The orchestrator is the sole coordinator. Specialists never message each other — all task routing flows through the orchestrator. When you start a session with `konductor`, it spawns the appropriate specialists as background subagents and aggregates their results.

### Enabling Agent Teams mode

Agent Teams is an experimental feature gated behind an environment variable. It is **not** enabled by default — you must opt in.

> **Requires Claude Code v2.1.178 or later** (the modern agent-team runtime). Check your version with `claude --version`.

Set it via the Claude settings CLI:

```bash
claude settings set env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 1
```

Or edit `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Start a new session after changing this setting.

> **Split-pane display (optional):** By default, teammates render in your main terminal (`in-process`). For split-pane display — one pane per teammate — set `"teammateMode": "auto"` in `~/.claude/settings.json`. This is no longer the default as of Claude Code v2.1.179 and requires tmux or iTerm2 (with the `it2` CLI). Team mode itself requires only the env var above; `teammateMode` is display polish.

### Permissions

When agents run as background subagents, they cannot prompt interactively. Any tool not in the `permissions.allow` list is silently auto-denied. Configure team-level permissions in `~/.claude/settings.json` (permissions are shared across all teammates):

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Edit",
      "Write",
      "Glob",
      "Grep",
      "TodoWrite",
      "Bash(git status*)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git blame*)",
      "Bash(git show*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(git branch*)",
      "Bash(git checkout*)",
      "Bash(git switch*)",
      "Bash(git stash*)",
      "Bash(git fetch*)",
      "Bash(git rebase*)",
      "Bash(npm *)",
      "Bash(ls *)",
      "Bash(find *)",
      "Bash(grep *)"
    ]
  }
}
```

Tools that require explicit confirmation (and should NOT be in `allow` for safety): `rm`, `aws`, `sudo`, `curl`, `sh`, `bash` (unscoped). Note: `git push`, `git reset`, and `git clean` are intentionally absent — agents commit locally; pushing to remotes and destructive history rewrites require explicit human action. `Bash(npm *)` runs arbitrary lifecycle scripts; `Bash(find *)` supports `-exec` — neither is read-only.

Permissions are team-level — they apply to every agent in the team, not per-agent.

## Troubleshooting

**Agent not found:** Verify the install completed without errors. Check that `~/.claude/agents/` contains the agent files.

**Tools silently denied:** Add the required tool to `permissions.allow` in `~/.claude/settings.json`.

**Specialists not spawning:** Confirm `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` is set (via `claude settings set` or the settings.json `env` block) and start a new session.

**Team mode silently degraded:** Team mode requires BOTH the env var AND a `permissions.allow` block — one without the other silently degrades (teammates auto-deny every unlisted tool).
