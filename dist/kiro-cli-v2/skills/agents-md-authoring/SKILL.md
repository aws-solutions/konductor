---
name: agents-md-authoring
description: Create and maintain AGENTS.md files that bootstrap AI agent context. Use when a project lacks an AGENTS.md, when onboarding a repo for AI agents, or when updating project conventions agents should follow. Covers the agents.md standard, the context-loading instruction block, and the CLAUDE.md bridge for Claude Code.
tags: [skill, agents-md, onboarding, context, documentation]
---

# AGENTS.md Authoring

`AGENTS.md` is a README for AI agents — a predictable place at the repo root for project context and
instructions. It is part of the open [agents.md](https://agents.md) standard, read by many agentic tools.

## When to create or update

- A repository has no `AGENTS.md` and agents are working in it
- Project conventions, build commands, or structure changed
- A durable learning should be promoted from session memory into permanent project guidance

## Critical: how AGENTS.md is loaded (differs by runtime)

| | Kiro CLI custom agents | Claude Code custom agents |
|---|---|---|
| `AGENTS.md` | NOT auto-read — must be in the agent's `clientConfig.kiroCli.resources` as `file://AGENTS.md` | NOT auto-read — Claude Code only reads `CLAUDE.md` |
| `CLAUDE.md` | NOT auto-read | Auto-read at session start (all hierarchy levels) |

**Implication:** AGENTS.md does NOT support import directives (`@path` or `#[[file:]]`) when loaded by Kiro.
To make agents load steering/memory/skills, use **instructions** inside AGENTS.md (see below), not imports.

### Bootstrap requirements

1. **Kiro:** the agent spec must list `"file://AGENTS.md"` in `clientConfig.kiroCli.resources`.
2. **Claude Code:** the repo must have a `CLAUDE.md` containing `@AGENTS.md` (import) so Claude Code loads
   AGENTS.md content. Chain further imports there if needed (e.g., `@.konductor/memory/MEMORY.md`).

## Required structure

Author AGENTS.md with these sections (adapt to the project):

1. **Context Loading (MUST follow at session start)** — instruction block (see template below)
2. **Project Overview** — what the project is, in 2-3 sentences
3. **Project Structure** — directory map
4. **Setup & Commands** — build, test, install commands
5. **Code Style & Conventions** — formatting, naming, language rules
6. **Testing** — how to run tests
7. **Workflow** — git/PR/CR conventions
8. **Domain Knowledge** (optional) — durable project-specific facts

## Context-loading instruction block (always include)

Because Kiro does not expand import directives in AGENTS.md, use explicit MUST-read instructions so the
agent loads adjacent context via its own file-read tools:

```markdown
## Context Loading (MUST follow at session start)

Before starting work, load available project context:

- You MUST read `.kiro/steering/**/*.md` if present — workspace steering rules.
- You MUST read `<workspace>/memory/*.md` if present — persistent facts and preferences.
- Workspace-specific skills may exist at `.kiro/skills/**/ws-*.md` — be aware and load when relevant.

If a path does not exist, skip it silently and continue.
```

Replace `<workspace>` with the project root (e.g., `.konductor`), so `<workspace>/memory/*.md` -> `.konductor/memory/*.md`.

## Rules

- AGENTS.md is **developer-written instructions**, NOT agent memory. Do not dump session memory or
  timestamped facts here — that belongs in the memory files. Promote only durable, reviewed learnings.
- Keep it concise and scannable — bullets and short sections, not prose.
- For public packages, keep content generic — no internal tools, domains, or credentials.
- When asked to edit `CLAUDE.md`, edit `AGENTS.md` instead (CLAUDE.md should just `@AGENTS.md`).

## Procedure

1. Check whether `AGENTS.md` exists at the repo root. If it does, read it and patch rather than replace.
2. Draft/update the sections above, always including the Context Loading block.
3. Ensure a `CLAUDE.md` exists with `@AGENTS.md` (create it if missing) for Claude Code compatibility.
4. Confirm the relevant agent specs list `file://AGENTS.md` in `clientConfig.kiroCli.resources`.
5. Show the proposed content to the user and confirm before writing.
