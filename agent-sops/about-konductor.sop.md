# About Konductor

## Overview

Onboards a new or lost user: install with `install.sh`, start a normal harness session, and use the installed skills or fuse-flow workflows. Use when a user asks "what is this", "how do I install it", "what can I ask it", or wants a tour before starting real work.

## Parameters

- **question** (optional): The user's specific question, if any (for example, "how do I install this" or "what can this package take on"). If omitted, give the general orientation below.

## Steps

### 1. Identify runtime

**Constraints:**

- You MUST determine which harness the session runs in (Claude Code, Codex, Cursor, OpenCode or Kiro CLI) before answering install or discovery questions. Each reads skills from its own directory.
- If unclear, ask.

**Expected Output:** Harness identified.

### 2. Lead with the available entry points

**Constraints:**

- You MUST describe Konductor as a package of skills and fuse-flow workflows, not as an agent session.
- If `question` is about installing, give the steps from `about-konductor`'s "1. Install" section.
- Explain where the harness finds the installed skills: `.claude/skills/` for Claude Code, `.kiro/skills/` for Kiro CLI, and `.agents/skills/` for Codex, Cursor and OpenCode in a project install, or `skills/` next to the harness's user-level instruction file in a global install.
- If `question` is about what to ask, give 2-3 examples from `about-konductor`'s "4. Give the session real work" section, matched to the user's likely task.
- If `question` is conceptual, answer from `about-konductor`'s skill / workflow model.

**Expected Output:** A direct answer to `question` if provided, otherwise the general orientation.

### 3. Answer from the live sources, not from memory

**Constraints:**

- You MUST NOT recite a remembered list of installed skills. Inspect the skills directory when exact availability matters.
- For "what should I use next", use `sdlc-navigator` to preserve phase and artifact handoffs.
- For a focused phase, name the applicable skill and explain how the active harness loads it.
- For a complete lifecycle pass, offer fuse-flow with `fuse/flow/workflows/_k-full-sdlc.yml` or the lighter `fuse/flow/workflows/_k-phase-chain.yml`.
- State the fuse-flow command sequence accurately: `fuse-flow start <slug> --workflow <name or path>` prints the current step; `fuse-flow continue <slug>` records it finished and prints the next one; `fuse-flow continue <slug> --owner-approved` records the owner's approval of a waiting step; `fuse-flow status <slug>` lists every step.
- State that fuse-flow searches `FUSE_SKILLS_DIR`, the repository's `skills/`, `.kiro/skills`, `.konductor/skills`, `.claude/skills` and `.agents/skills`, then `SKILLS_HOME` and the same directories under the home directory plus `~/.codex/skills` and `~/.config/opencode/skills`.

**Expected Output:** The correct skill invocation or workflow command, sourced from the live install and repository.

### 4. Hand off if the user is ready to work

**Constraints:**

- If the user names a concrete task, tell them which focused skill to load in their current session.
- If the user wants a full lifecycle pass, give the appropriate fuse-flow `start` command and explain that subsequent `continue` calls advance the same workstream, and `status` shows where it stands.
- If the install looks broken, tell the user to run the same `install.sh` command again; it reports what it skipped and why.

**Expected Output:** A focused skill invocation, a fuse-flow start command, or the `install.sh` command to run again.
