# About Konductor

## Overview

Onboards a new or lost user: install the CLI, talk to the orchestrator in
plain language, and let it delegate. Use when a user asks "what is this",
"how do I install it", "what can I ask it", or wants a tour before starting
real work.

## Parameters

- **question** (optional): The user's specific question, if any (e.g. "how do I install this", "what can you take on"). If omitted, give the general orientation below.

## Steps

### 1. Identify runtime

**Constraints:**

- You MUST determine whether the session is Kiro CLI or Claude Code before answering install or discovery questions — the two runtimes surface SOPs and skills differently (`/prompts` vs `/help`, `/agent-sop:<name>` vs `/sop-<name>`), so the answer differs by runtime, not just the command to start a session.
- If unclear, ask.

**Expected Output:** Runtime identified (Kiro CLI or Claude Code).

### 2. Lead with the orchestrator, not the model

**Constraints:**

- You MUST frame the orchestrator as the entry point: the user describes work in plain language, and the orchestrator delegates to whichever specialist agent handles it. You MUST NOT imply the user should identify or invoke a specialist agent themselves.
- If `question` is about installing, give the steps from `about-konductor`'s "1. Install the CLI" and "2. Install the agent content" sections, ending at "3. Start a session". `konductor install` targets both Kiro CLI and Claude Code, but `--harness <kiro-cli-v2|kiro-v3|claude>` is a REQUIRED flag — there is no runtime auto-detection at the target, so the user must say explicitly which one they mean (`kiro-cli-v2`, `kiro-v3`, or `claude`) — on Claude Code, the user starts the same orchestrator via the `claude` CLI's own `--agent` flag instead of `kiro-cli chat --agent`.
- If `question` is about what to ask, give 2-3 example prompts from `about-konductor`'s "4. Give it real work" section, matched to the user's likely task if one is apparent.
- If `question` is conceptual ("what's a SOP", "why isn't my skill showing up on this agent"), answer from `about-konductor`'s "5. The model, in one paragraph" section, or its fuller "agent / skill / SOP model" reference section for follow-up detail.
- If omitted, give the one-paragraph orientation: talk to the orchestrator, describe the work, it delegates and verifies.

**Expected Output:** A direct answer to `question` if provided, otherwise the general orientation.

### 3. Answer from the live sources, not from memory

**Constraints:**

- You MUST NOT recite a hardcoded list of agents, skills, or SOPs from training data — every one of those sets is install-dependent and changes over time.
- For "which agent should I use" → answer directly: use `konductor`. It
  selects the SOP and delegates to the right specialist agent(s) itself —
  the user does not pick an agent.
- For "what SOPs/workflows exist" → point to the live discovery command for
  the active runtime instead of naming any SOP: on Kiro CLI, run `/prompts`
  to list available SOPs and invoke a known one as `/agent-sop:<sop-name>`
  (not a bare `/<sop-name>`); on Claude Code, run `/help` to list slash
  commands, where SOPs appear as `/sop-<name>`. Never substitute a
  remembered SOP name for this.
- For "what skills exist" → explain that skills are not exclusively
  ambient: they activate automatically based on the task description, or
  on direct request. There is no dedicated list command for skills
  specifically, but on Claude Code an ordinary skill is also
  slash-invocable directly as `/<skill-name>`.
- For CLI subcommands specifically → these ARE safe to name (they're
  compiled into the binary, not an installable content set); point to
  `about-konductor`'s CLI table and tell the user to confirm with
  `konductor --help` / `konductor <subcommand> --help` on their own build.

**Expected Output:** The correct discovery command or answer for the active runtime and question, sourced from the live install rather than a remembered list.

### 4. Hand off if the user is ready to work

**Constraints:**

- If the user names a concrete task, You MUST hand off to `konductor` and let it delegate to the matching specialist agent — do not name or pick the specialist agent yourself.
- If the user wants a full lifecycle pass, describe the full-lifecycle
  outcome you want to the orchestrator and let it delegate — don't name a
  specific SOP yourself; if the user wants to see what's available first,
  point them to `/prompts` (Kiro CLI) or `/help` (Claude Code).
- If the install or checkout looks broken, point to `konductor doctor` rather than diagnosing it inline here.

**Expected Output:** Either a handoff to a specialist agent, a pointer to `konductor doctor` for a broken install, or a pointer to the correct live discovery command — never a stale hand-typed list.
