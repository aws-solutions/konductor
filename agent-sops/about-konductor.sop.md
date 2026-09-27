# About Konductor

## Overview

Onboards a new or lost user: install the CLI, start a normal Kiro CLI or Claude Code session, and use the installed skills, SOPs, or fuse-flow workflows. Use when a user asks "what is this", "how do I install it", "what can I ask it", or wants a tour before starting real work.

## Parameters

- **question** (optional): The user's specific question, if any (for example, "how do I install this" or "what can this package take on"). If omitted, give the general orientation below.

## Steps

### 1. Identify runtime

**Constraints:**

- You MUST determine whether the session is Kiro CLI or Claude Code before answering install or discovery questions. The two runtimes install and surface skills and SOPs differently.
- If unclear, ask.

**Expected Output:** Runtime identified (Kiro CLI or Claude Code).

### 2. Lead with the available entry points

**Constraints:**

- You MUST describe Konductor as a package of 79 skills, 18 SOPs, and fuse-flow workflows, not as an agent session.
- If `question` is about installing, give the steps from `about-konductor`'s "1. Install the CLI" and "2. Install the content" sections. `konductor install` requires `--harness <kiro-cli-v2|kiro-v3|claude>`; there is no runtime auto-detection.
- On Claude Code, explain that all content lands under `.claude/skills/`, SOPs use `sop-<name>`, and a plain `claude` session invokes one as `/sop-<name>`.
- On Kiro CLI, explain that ordinary skills and the `sop-<name>` SOP conversions both land under `.kiro/skills/`, where a plain `kiro-cli chat` session discovers them natively.
- If `question` is about what to ask, give 2-3 examples from `about-konductor`'s "4. Give the session real work" section, matched to the user's likely task.
- If `question` is conceptual, answer from `about-konductor`'s skill / SOP / workflow model.

**Expected Output:** A direct answer to `question` if provided, otherwise the general orientation.

### 3. Answer from the live sources, not from memory

**Constraints:**

- You MUST NOT recite a remembered list of installed skills or SOPs. Inspect the target layout when exact availability matters.
- For "what should I use next", use `sdlc-navigator` to preserve phase and artifact handoffs.
- For a focused phase, name the applicable skill or SOP and explain how the active runtime loads it.
- For a complete lifecycle pass, offer fuse-flow with `fuse/flow/workflows/_k-full-sdlc.yml` or the lighter `fuse/flow/workflows/_k-phase-chain.yml`.
- State the fuse-flow command sequence accurately: `fuse-flow start <slug> --workflow <path>`, followed by `next`, `done`, `gate`, and `status` commands that include the workstream slug.
- State that fuse-flow searches `FUSE_SKILLS_DIR`, `skills/`, `.kiro/skills`, `.konductor/skills`, `.claude/skills`, `~/.kiro/skills`, `~/.konductor/skills`, and `~/.claude/skills`.
- For CLI subcommands, point to `about-konductor`'s CLI table and tell the user to confirm with `konductor --help` or `konductor <subcommand> --help` on their build.

**Expected Output:** The correct runtime-specific invocation or workflow command, sourced from the live install and repository.

### 4. Hand off if the user is ready to work

**Constraints:**

- If the user names a concrete task, tell them which focused skill or SOP to load in their current session.
- If the user wants a full lifecycle pass, give the appropriate fuse-flow `start` command and explain that subsequent `next`, `done`, `gate`, and `status` calls advance the same workstream.
- If the install or checkout looks broken, point to `konductor doctor` rather than inventing missing registration behavior.

**Expected Output:** A focused skill or SOP invocation, a fuse-flow start command, or a pointer to `konductor doctor`.
