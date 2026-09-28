---
name: about-konductor
description: Use when a user is new to Konductor or asks what it is, how to install it, what they can ask it, or how skills, SOPs, and workflows differ, even if they only say "how do I get started". Walks from installing the `konductor` CLI to using the installed content.
version: 4.0.0
tags: [skill, help, onboarding, model, cli, install]
---

# About Konductor

Five steps from nothing to installed skills, SOPs, and workflows: install the CLI, install the content, start a normal session, give it real work, and read the model. Everything past that is reference material.

## 1. Install the CLI

```bash
git clone <this-repository's-URL>
cd <cloned-dir>
make build
make link
command -v konductor && konductor --version
```

Building from a local checkout is how you get the CLI onto your machine.

## 2. Install the content

```bash
konductor synth --from .
konductor install --from . --harness kiro-cli-v2
```

`synth` builds the pipeline/config artifacts from the repo root you cloned; `install` copies the 79 skills and 18 SOPs into a target (`$HOME` unless you pass `--target`). `--harness` is required. Use `kiro-cli-v2` or `kiro-v3` for Kiro CLI, or `claude` for Claude Code; there is no auto-detection. Run `konductor doctor` afterward to confirm the install and get remediation guidance for anything wrong.

See `cli/README.md` for the full walkthrough, prerequisites, and installing into a directory other than `$HOME`.

## 3. Start a session

Start the runtime normally:

```bash
kiro-cli chat
```

or:

```bash
claude
```

On Claude Code, all ordinary skills and converted SOPs land under `.claude/skills/`. A plain `claude` session discovers them, and you invoke a SOP as `/sop-<name>`.

On Kiro CLI, ordinary skills and the converted SOPs (`sop-<name>`) both land under `.kiro/skills/`, where a plain `kiro-cli chat` session discovers them natively. (A package that ships agent specs installs its ordinary skills under `.konductor/skills/` instead, scoped per agent; this package ships none.)

## 4. Give the session real work

Describe the outcome and name the relevant skill or SOP when needed:

```text
Use the system-design-patterns skill to design a service that ingests IoT sensor events and alerts on anomalies.
```

```text
/sop-k-code-review-workflow
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

Use `--workflow _k-phase-chain` for the lighter six-phase chain. A successful `done` or `gate` prints the next step, so `next` is only needed to resume. fuse-flow resolves step skills from `FUSE_SKILLS_DIR`, `skills/`, `.kiro/skills`, `.konductor/skills`, `.claude/skills`, `~/.kiro/skills`, `~/.konductor/skills`, and `~/.claude/skills`.

## 5. The model, in one paragraph

Konductor packages reusable skills, named multi-step SOPs, and fuse-flow workflow definitions. The CLI builds, installs, updates, diagnoses, and removes that content. Your existing Kiro CLI or Claude Code session runs the content; fuse-flow adds deterministic phase and artifact tracking when one task spans a complete workflow.

## What the package can take on

The installed content covers the software development lifecycle, from requirements and design through implementation, testing, review, and operational diagnosis. Use one skill for focused guidance, invoke a SOP for a named procedure, or use fuse-flow to chain phases and enforce artifact handoffs in one session.

## The `konductor` CLI

The CLI installs and manages the package on disk. Verify its exact command surface with `konductor --help` and `konductor <subcommand> --help`; flags and defaults can drift across versions.

| Subcommand  | What it does                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`      | Create `.konductor/config.yml` in the current directory from a preset (`solo`, `team`, or `org`).                                                                                        |
| `install`   | Install Konductor into a target directory from a `--from <repo-root>` source. `--from` (source) and `--target` (destination) are distinct flags; do not conflate them.                   |
| `update`    | Re-run the same file-copy `install` uses against a tracked install, unconditionally overwriting every tracked file. No diffing, no `--force` flag, no protection for a hand-edited file. |
| `uninstall` | Remove a tracked install.                                                                                                                                                                |
| `synth`     | Synthesize pipeline/config artifacts from a repo root without installing anywhere.                                                                                                       |
| `doctor`    | Inspect an install or checkout and print remediation guidance for problems it finds.                                                                                                     |
| `metrics`   | Show usage/run metrics (still a stub as of this writing; verify with `--help`, do not assume it stayed one).                                                                             |

Every subcommand takes `-v`/`--verbose`, `--json`, and `--no-color`; `install`, `update`, `uninstall`, and `doctor` also take `--target` for the destination or tracked install to act on, and all but `install` can act on one tracked target or `--all` of them at once. Use `konductor <subcommand> --help` as the source of truth for exact details.

### Fixing a broken install

Run `konductor doctor` against the target. It checks the installed files and manifest and prints actionable remediation guidance. For a missing skill or SOP, compare the expected runtime layout below with the target and reinstall or update from the source checkout.

## The skill / SOP / workflow model, in more detail

- **Skill**: reusable guidance for one capability. Read its `SKILL.md` before applying it.
- **SOP (Standard Operating Procedure)**: a named, multi-step procedure packaged as a runtime skill. Invoke it deliberately.
- **Workflow**: an ordered set of skill-backed steps, artifacts, dependencies, and gates run by fuse-flow inside one agent session.

The practical difference: skills answer "what guidance applies," SOPs answer "run this specific procedure," and workflows preserve state across a phase chain.

## Checking what's actually installed

The installed content depends on the selected harness:

- **Kiro CLI ordinary skills:** `.kiro/skills/<name>/SKILL.md`, available through native skill discovery.
- **Kiro CLI SOPs:** `.kiro/skills/sop-<name>/SKILL.md`, available through native skill discovery.
- **Claude Code ordinary skills:** `.claude/skills/<name>/SKILL.md`, available in a plain `claude` session.
- **Claude Code SOPs:** `.claude/skills/sop-<name>/SKILL.md`, invoked as `/sop-<name>`.
- **fuse-flow workflows:** `fuse/flow/workflows/`, including `_k-full-sdlc.yml` and `_k-phase-chain.yml`.

## Getting unstuck

- If you do not know which focused capability applies, use `sdlc-navigator` or inspect the installed skill directories.
- If you want a named multi-step procedure, inspect the installed `sop-<name>` skills and invoke the matching SOP.
- If you want the complete lifecycle in one session, start one of the fuse-flow workflows and follow `next`, `done`, `gate`, and `status`.
- If the install or checkout looks broken, run `konductor doctor`.
