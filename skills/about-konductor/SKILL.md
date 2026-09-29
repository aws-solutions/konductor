---
name: about-konductor
description: Use when a user is new to Konductor or asks what it is, how to install it, what they can ask it, or how skills and workflows differ, even if they only say "how do I get started". Walks from installing the skills to using them.
version: 5.0.0
tags: [skill, help, onboarding, model, install]
---

# About Konductor

Five steps from nothing to installed skills and workflows: install, check the install, start a normal session, give it real work, and read the model. Everything past that is reference material.

## 1. Install

```bash
git clone -b fuse https://github.com/aws-solutions/konductor.git fuse-konductor
cd fuse-konductor
./install.sh --project <your-project>     # or: ./install.sh --global ~/.claude/CLAUDE.md
```

`--project` copies the skills and the always-on block into one project, which commits them. `--global` takes the user-level instruction file of each harness (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, `~/.config/opencode/AGENTS.md`, `~/.kiro/steering/AGENTS.md`) and copies the skills next to it (with `--link`, it links them to the clone instead, for editing skills in the clone). `INSTALL.md` in the clone has the details.

## 2. Check the install

Confirm that the skills are present in your harness's skills directory, for example `.agents/skills/` in the project or `~/.claude/skills/`.

## 3. Start a session

Start the runtime normally:

```bash
kiro-cli chat
```

or:

```bash
claude
```

A plain session discovers the installed skills: Claude Code reads `.claude/skills/`, Kiro CLI reads `.kiro/skills/`, and Codex, Cursor and OpenCode read `.agents/skills/`.

## 4. Give the session real work

Describe the outcome and name the relevant skill when needed:

```text
Use the system-design-patterns skill to design a service that ingests IoT sensor events and alerts on anomalies.
```

```text
Use the user-story-writing skill to write user stories for a self-service password reset flow.
```

For a complete multi-phase pass in one agent session, use fuse-flow. Run the script by its path, `<konductor-checkout>/fuse/flow/fuse-flow`; the commands below abbreviate it, and the follow-up commands fuse-flow prints carry the full path:

```bash
fuse-flow start <slug> --workflow _k-full-sdlc
fuse-flow next <slug>
fuse-flow done <slug> <step> --artifact <path>
fuse-flow gate <slug> <step> --owner-approved
fuse-flow status <slug>
```

Use `--workflow _k-phase-chain` for the lighter six-phase chain. A successful `done` or `gate` prints the next step, so `next` is only needed to resume. fuse-flow resolves step skills from `FUSE_SKILLS_DIR`, the repository's `skills/`, `.kiro/skills`, `.konductor/skills`, `.claude/skills` and `.agents/skills`, then `SKILLS_HOME` and the same directories under the home directory plus `~/.codex/skills` and `~/.config/opencode/skills`.

## 5. The model, in one paragraph

Konductor packages reusable skills and fuse-flow workflow definitions. Your existing harness session runs the skills; fuse-flow adds deterministic phase and artifact tracking when one task spans a complete workflow.

## What the package can take on

The installed content covers the software development lifecycle, from requirements and design through implementation, testing, review, and operational diagnosis. Use one skill for focused guidance, or use fuse-flow to chain phases and enforce artifact handoffs in one session.

## The skill / workflow model, in more detail

- **Skill**: reusable guidance for one capability. Read its `SKILL.md` before applying it.
- **Workflow**: an ordered set of skill-backed steps, artifacts, dependencies, and gates run by fuse-flow inside one agent session.

The practical difference: skills answer "what guidance applies," and workflows preserve state across a phase chain. The SOPs in `agent-sops/` are not installed; fuse-flow workflows replace them.

## Checking what's actually installed

- **Skills:** `<skills directory>/<name>/SKILL.md`, available through native skill discovery.
- **fuse-flow workflows:** `fuse/flow/workflows/` in the clone, including `_k-full-sdlc.yml` and `_k-phase-chain.yml`.

## Getting unstuck

- If you do not know which focused capability applies, use `sdlc-navigator` or inspect the installed skill directories.
- If you want the complete lifecycle in one session, start one of the fuse-flow workflows and follow `next`, `done`, `gate`, and `status`.
- If the install looks broken, run the same `install.sh` command again; it reports what it skipped and why.
