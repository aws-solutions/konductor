---
name: delegation-protocol
description: Use when spawning any subagent, deciding which agent should handle a piece of work, coordinating parallel or sequential agent execution, or handing off artifacts between agents. Defines the mandatory 8-field delegation prompt format, agent registry, and handoff patterns.
version: 1.4.0
tags: [skill, behavioral, orchestration, delegation, multi-agent]
---

# Delegation Protocol

## Overview

Defines how the orchestrator delegates work to specialist agents. Every subagent spawn MUST use the 8-field prompt format: an explicit target agent plus the 7 sections. It MUST NOT omit the target agent. This ensures tasks are atomic, outcomes are verifiable, agents stay within scope, and spawns never fail outright from a missing `subagent_type`.

## Usage

Use this skill when:

- Spawning any subagent for a delegated task
- Deciding which agent handles a piece of work
- Coordinating parallel or sequential agent execution
- Handing off artifacts between agents

## Delegation Prompt Format

Every delegation MUST include all 8 fields, the 7 sections below plus an explicit `TARGET AGENT` preamble line:

```
TARGET AGENT: <Exact subagent_type value — see "Never Omit the Target Agent" below. Never leave blank.>

TASK: <Atomic, specific goal — one verb, one outcome>

EXPECTED OUTCOME: <Concrete deliverables with success criteria>

REQUIRED SKILLS: <Relevant expertise the subagent needs>

REQUIRED TOOLS: <Explicit tool allowlist — only these tools may be used>

MUST DO:
- <Exhaustive requirements list>
- Preserve existing comments and JSDoc blocks
- Preserve existing logging statements
- Add inline comments for complex logic

MUST NOT DO:
- <Forbidden actions list>
- Do NOT remove comments or documentation
- Do NOT strip logging statements
- Do NOT silently reduce scope

CONTEXT: <File paths, patterns, constraints, handoff file references>
```

If a section is not applicable, write `N/A`; never omit the section. `TARGET AGENT` is the one exception: it is never `N/A`, because every delegation targets exactly one agent.

### Never Omit the Target Agent

**Every subagent spawn, meaning every `Agent()` call (Claude Code), every `subagent` tool invocation (Kiro CLI), and every `agent()` call inside a `Workflow` tool script (`.claude/workflows/*.js`), MUST include an explicit target agent drawn from the Agent Registry below. Never omit it.** For `Agent()` and `subagent`, the tool's own default when the target is omitted is `general-purpose`. This fleet registers no agent by that name, and the spawn fails outright ("Agent type 'general-purpose' not found"). For `agent()` inside a `Workflow` script, the equivalent field is the `agentType` option in the call's options object (the second argument). Set it explicitly on every call; never leave it to default.

Resolve the exact identifier from the runtime's own available-agents list for the current session. Do not guess or hardcode a single form, since the correct literal string is install-dependent:

- **Claude Code:** use the agent name exactly as it appears in your own tool definitions / available-agent list for this session (e.g. `ASDLCCoreAICapabilities-k-architect` for a published-plugin install, `local-ASDLCCoreAICapabilities-k-architect` for a local/dev install).
- **Kiro CLI:** use the bare name from `toolsSettings.subagent.availableAgents` (e.g. `k-architect`).
- **`Workflow` `agent()` calls:** set the `agentType` option using the same Claude Code naming form as above (e.g. `agentType: "local-ASDLCCoreAICapabilities-k-researcher"`). The `Workflow` tool is a Claude Code-only feature, so there is no Kiro CLI equivalent to resolve.

This is distinct from spawning the wrong agent for the task (an IMPORTANT-tier Quality Gate issue below); this rule guards against spawning _no_ agent at all.

**Deliberate exception for `Workflow` `agent()` calls:** a call may omit `agentType` only when the step is pure reasoning over data already inlined into the prompt (decomposition, classification, or synthesis with no need to read files, run commands, or use any other tool). In that case the session's default reasoning agent is a legitimate choice, not an oversight. Every such omission MUST carry an inline comment immediately above the call explaining why no specialist is needed, so the omission is never mistaken for the bug this rule exists to prevent. A call that needs file/tool access (reading a file, listing a directory, running a command, web search, etc.) always needs an explicit `agentType`. Omitting it there is the CRITICAL defect below, not a deliberate exception.

> **Format ownership rule**: MUST DO / MUST NOT DO sections should not contradict the receiving agent's skills or system prompt. If a specialist agent has a skill that defines how output is produced (e.g., `cloudscape-mock-ui` uses a CDN bundle), do not add constraints that override that skill's behavior. Format guidance from the user's request (e.g., "output as a single file") is acceptable to pass through.

## Agent Registry

### SDLC Specialists

| Agent                         | Purpose                              | When to Spawn                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `k-product-manager`           | Requirements & planning              | User stories, requirements extraction, document formatting, sprint planning, deliberation on PM-domain tradeoffs (deliberation-panel)                                                                                                                                                                            |
| `k-architect`                 | Design & architecture                | System design, threat modeling, design documentation, requirements extraction, decision research, multi-option deliberation (deliberation-panel)                                                                                                                                                                 |
| `k-developer`                 | Implementation                       | Backend/frontend code, code review, infra validation, git workflow, Kiro spec generation (requirements.md, design.md, tasks.md)                                                                                                                                                                                  |
| `k-quality-assurance`         | Testing                              | Test coverage analysis, E2E test strategy, Cypress test implementation, DOM inspection for functional test generation, security test generation                                                                                                                                                                  |
| `k-researcher`                | Research                             | External docs, web research, deliberation on research-options/feasibility (deliberation-panel)                                                                                                                                                                                                                   |
| `k-tpm`                       | Program management                   | Program plans, status reports, risk tracking, decision docs, plan review, sprint planning                                                                                                                                                                                                                        |
| `k-browser`                   | Browser automation                   | Web scraping, E2E test execution via Playwright, form automation, screenshots                                                                                                                                                                                                                                    |
| `konductor-mux-orchestrator`  | Parallel orchestration (tmux/zellij) | Use when running on a platform with tmux or zellij active. Dispatches specialist agents to visible, interactive tmux/zellij panes for parallel execution. Auto-detects multiplexer from `$TMUX` / `$ZELLIJ`. Requires tmux or zellij; errors if neither is detected and directs the user to `konductor` instead. |
| `konductor-cmux-orchestrator` | Parallel orchestration (cmux, macOS) | Use on macOS with cmux available. Dispatches specialist agents to cmux surfaces (tabs, splits, or workspaces) for parallel execution with human interaction. Errors when cmux is not available and directs the user to `konductor` instead.                                                                      |

### Meta-Agents (Quality & Planning)

| Agent              | Purpose        | When to Spawn                                                                                                              |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `k-media-analyzer` | Media analysis | PDFs, images, diagrams that need interpretation beyond raw text; web content requiring visual or structural interpretation |

When uncertain which agent to use, check the agent's skill list in the README or invoke `sdlc-navigator`.

### Tool-to-Agent Routing

> **Authoritative source**: This table is the detailed routing reference. `context/k-orchestrator-routing-rules.md` is a quick-reference summary loaded at startup; when the two conflict, this file wins. Update both when adding new tool domains.

| Tool Domain              | Primary Agent  | Other Agents with Access                                                                              |
| ------------------------ | -------------- | ----------------------------------------------------------------------------------------------------- |
| **Web** (external pages) | `k-researcher` | `k-browser` (automation/scraping); `k-media-analyzer` (extract/interpret content from a specific URL) |

For web content, prefer `k-researcher` for information retrieval. Delegate to `k-browser` for interactive automation or scraping, and to `k-media-analyzer` when the page content requires visual or structural interpretation.

## Per-Agent SOP Registrations

Which SOPs each agent declares in its own `dependencies.agentSops.agentSopNames`, read directly from `agents/*.agent-spec.json`. This is the authoritative source for which agent a SOP dispatches to when it names another SOP by identifier. A referencing SOP should look up the owning agent here rather than stating or assuming one independently.

| Agent                                                                         | Registered SOPs (own `agentSopNames`)                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `k-architect`                                                                 | `k-design-doc-creation`, `k-existing-design-review`, `k-principal-engineer-design-review`, `k-adversarial-pull-request-review`                                                             |
| `k-developer`                                                                 | `k-code-cleanup`, `k-pre-cr-critique`, `k-codebase-analysis`, `k-code-review-workflow`                                                                                                     |
| `k-quality-assurance`                                                         | `k-test-coverage-review`                                                                                                                                                                   |
| `konductor`                                                                   | `kiro-spec-workflow`, `k-delegate`, `k-plan`, `k-context-gathering`, `k-verify`, `k-light-ui-testing`, `k-comprehensive-search`, `k-full-sdlc`, `k-e2e-test-generation`, `about-konductor` |
| `konductor-mux-orchestrator`                                                  | `kiro-spec-workflow`, `k-plan`, `k-context-gathering`, `k-verify`, `k-comprehensive-search`, `k-full-sdlc`, `k-e2e-test-generation`, `k-light-ui-testing`, `about-konductor`               |
| `konductor-cmux-orchestrator`                                                 | `kiro-spec-workflow`, `k-plan`, `k-context-gathering`, `k-verify`, `k-comprehensive-search`, `k-full-sdlc`, `k-e2e-test-generation`, `k-light-ui-testing`, `about-konductor`               |
| `k-product-manager`, `k-researcher`, `k-tpm`, `k-browser`, `k-media-analyzer` | None declared. These agents execute delegated tasks; they do not select their own SOPs                                                                                                    |

`konductor` additionally registers `k-delegate`; `konductor-mux-orchestrator` and `konductor-cmux-orchestrator` do not.

When a SOP is registered on more than one agent, the caller MUST pick the target based on what else the delegating step needs rather than treat the lookup as single-valued.

A SOP registered directly on an orchestrator's own `agentSopNames`, such as `kiro-spec-workflow` on `konductor` above, MUST be invoked directly rather than routed through a specialist-agent lookup, since it delegates to its own agents internally.

## Parallel Execution

- Independent tasks ALWAYS run in parallel (max 4 concurrent subagents)
- Typical pattern: `research + explore` → `synthesize` → `plan` → `implement`
- Never block on one subagent when another independent task can start
- Dependent tasks run sequentially: wait for the upstream handoff file before spawning

Both runtimes support spawning the same agent multiple times in parallel with different tasks (e.g., two `k-developer` instances, one for backend, one for frontend, each in its own worktree), via their native delegation tool: the `subagent` tool (Kiro CLI) or `Agent()` (Claude Code). Each instance runs independently with its own context; the orchestrator waits for all spawned instances to complete before proceeding.

Before spawning any write agent, explicitly name its exact target in the
dispatch prompt: a new dedicated worktree, an existing worktree to reuse,
or (solo sequential dispatch only) the shared working tree. Never let an
agent infer or default to a location: a silent default is what causes two
agents, from the same task or different tasks, to collide in the same tree.
The write agent itself, not the orchestrator, provisions or reuses the named
target using its own shell/file tools on either runtime.

For dispatch into a separate, visible pane or surface rather than an
in-session subagent call, see `claude-teams-behavior` (Claude Code Agent
Teams), `mux-dispatch` (tmux/zellij), or `cmux-dispatch` (cmux) for the
dispatch-method-specific steps. `mux-dispatch` and `cmux-dispatch` each
detect and drive Kiro CLI the same as Claude Code, so Kiro CLI is already
covered there; for a plain in-session `subagent`/`Agent()` call with no
multiplexer, the two paragraphs above are the complete procedure on either
runtime and no separate skill is needed.

Examples of parallelizable work:

- Two `k-developer` instances: one for backend handler, one for frontend component
- Running code review + test coverage analysis on separate modules
- Generating threat model + cost estimation from the same design doc

## Handoff Pattern

Large outputs between agents go through handoff files:

1. Subagent writes output to `.konductor/handoff/<agent>-<task>.md`
2. Subagent returns only the file path to the orchestrator
3. Next subagent reads the handoff file directly as CONTEXT
4. Max ~300 lines per handoff file, split into multiple files if larger

File naming: `<source-agent>-<descriptive-task>.md`
Example: `architect-system-design.md`, `developer-task-breakdown.md`

## Post-Implementation Review

After code changes, run the maker-checker cycle:

1. Get the git diff of all changes
2. Spawn the appropriate reviewer agent (e.g., `k-developer` with `backend-review` or `frontend-review`)
3. Address all CRITICAL findings
4. Re-review, max 2 review cycles total
5. If CRITICAL findings persist after 2 cycles, escalate to the user

## Failure Recovery

- If a subagent fails, retry once with additional CONTEXT explaining the failure
- If the retry fails, escalate to the user with: what was attempted, what failed, and the root cause
- Never retry more than once. The 2-strike circuit breaker applies
- If a subagent times out, check `.konductor/handoff/` for partial output before retrying

## Quality Gate

**CRITICAL (block delegation):**

- Subagent spawned with no explicit target agent (`subagent_type` omitted). The tool defaults to `general-purpose`, which is not registered in this fleet, and the spawn fails outright
- `Workflow` `agent()` call with `agentType` omitted and no inline comment justifying the omission (see "Deliberate exception" above). Treat as an unreviewed omission, not a deliberate one
- Delegation prompt missing any of the 7 required sections (or the `TARGET AGENT` preamble line)
- Subagent spawned without explicit MUST NOT DO constraints
- Dependent task spawned before upstream handoff file exists
- More than 4 concurrent subagents
- Any write agent spawned without an explicitly named target (new worktree / existing worktree to reuse / shared tree) in its dispatch prompt

**IMPORTANT (fix before proceeding):**

- Wrong agent selected for the task domain
- Handoff file exceeds 300 lines without splitting
- Post-implementation review skipped after code changes

**SUGGESTION:**

- Could parallelize independent tasks that are running sequentially
- Could add more specific success criteria to EXPECTED OUTCOME
