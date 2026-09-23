<!-- SPDX-License-Identifier: Apache-2.0 -->

# Quick Start

[← Back to guide index](README.md)

From nothing to a working agent team, in five steps.

**Time required:** about 5 minutes.

**What you need:** either [Kiro CLI](https://kiro.dev) or
[Claude Code](https://claude.ai/download) installed, and `git` on your `PATH`. Full list in
[Prerequisites](prerequisites.md).

---

## Step 1 — Build the CLI

Build `konductor` from a clone of the repository. You need a Rust toolchain;
[rustup](https://rustup.rs) is the usual way to get one.

```bash
git clone https://github.com/aws-solutions/konductor.git
cd konductor
make build
make link
```

`make link` symlinks the binary into `~/.local/bin`. If that is not on your `PATH`, add it —
or pick any directory that already is. No administrator privileges are needed.

**Checkpoint:**

```bash
konductor --version
```

```text
konductor 1.0.0
```

If you get `command not found`, the binary is not on your `PATH` — see
[Troubleshooting](troubleshooting.md#1-konductor-command-not-found).

---

## Step 2 — Install the agents

`install` registers the agents, skills, SOPs, and context files with the runtime you name.
`--harness` is required — there is no auto-detection.

```bash
konductor install --harness kiro-cli-v2
```

It reports a count per content type and the command to start a session with, and exits `0`.

`install` runs five phases — skills, MCP, SOPs, context, agents — and writes:

| Content | Destination |
| --- | --- |
| Agents | `<target>/.kiro/agents/` (Kiro CLI) or `<target>/.claude/agents/` (Claude Code, copied verbatim) |
| Skills | `<target>/.konductor/skills/<name>/` |
| SOPs | `<target>/.konductor/sops/<name>.sop.md`, verbatim |
| Context | `<target>/.kiro/context/` |
| Manifest | `<target>/.konductor/manifest` |

On Claude Code, each SOP is **additionally** converted into its own slash-invokable skill at
`<target>/.claude/skills/sop-<name>/SKILL.md` — Claude Code has no way to serve a `.sop.md`
directly, so `/sop-<name>` is how you reach one there.

If you have Claude Code instead, pass `--harness claude`. Claude Code also needs two settings
before a team of agents can run. See [Install for Claude Code](tasks/install-claude-code.md).

**Checkpoint:**

```bash
konductor doctor
```

Six checks — `source`, `runtime`, `manifest`, `config`, `container_runtime` and `index_status` —
each with a status. Exit code `0` when nothing failed. Anything reported as not ok is explained in
[Diagnose problems](tasks/diagnose-problems.md).

---

## Step 3 — Start a session with the orchestrator

```bash
kiro-cli chat --agent konductor
```

You are now talking to the coordinator. It never implements anything itself — it routes each piece of
work to the specialist that owns it, checks what comes back, and re-delegates if a check fails.

**Checkpoint.** Ask it a question about itself. Questions about orchestration are answered directly
rather than delegated:

```text
What agents do you have available?
```

You should get a list of `k-*` specialists — developer, architect, quality-assurance, researcher,
product-manager, tpm, browser, media-analyzer.

---

## Step 4 — Give it real work

Describe what you want in plain language. You do not need to name an agent or a workflow.

```text
Run a codebase analysis on this repo.
```

The orchestrator routes this to `k-developer`, which owns the `k-codebase-analysis` workflow.
It produces `codebase-analysis.md` — architecture, SOLID evaluation, design patterns, dependencies,
and technical debt, with three diagrams — then reports the file path and its top three
recommendations.

Something larger, spanning several specialists:

```text
Design and implement a service that ingests IoT sensor events and alerts on anomalies.
```

Here the orchestrator routes the design to `k-architect`, implementation to `k-developer`,
and test coverage to `k-quality-assurance`, verifying each handoff before moving on.

**Checkpoint.** Watch what happens after you ask for implementation work. You should see the
orchestrator **delegate** to a specialist rather than start editing files itself. That is the whole
design, and it is a *rule* rather than a wall in both runtimes. In Kiro CLI `konductor`
pre-approves `fs_read` alone, so a write or a command stops to ask you rather than being refused;
in Claude Code it holds `Write` and `Bash` outright. Either way what keeps it delegating is its
routing rules — and, in Kiro CLI, your answer to the prompt. If it starts editing
directly, see
[Troubleshooting](troubleshooting.md#3-the-orchestrator-does-the-work-itself-instead-of-delegating).

---

## Step 5 — Configure the project (optional)

Most work needs no configuration. If you want project-local settings, scaffold them:

```bash
konductor init
```

```text
Initialized Konductor project at /Users/you/your-project/.konductor
Wrote starter config: /Users/you/your-project/.konductor/config.yml
```

```bash
cat .konductor/config.yml
```

```yaml
version: 1

severities_source: severity-schema.yml
tiers_source: scope-table.yml

tier: minor

default_severity: MEDIUM

fail_on_severity_at_or_above: CRITICAL
```

`init` writes a verbatim copy of the CLI's own preset defaults, comments included, so the file
documents its own fields. Field meanings are in the
[CLI reference](reference.md#configuration-file).

---

## You are set up

You have the CLI installed, the agent team registered, and a verified session with the orchestrator.

Where to go next:

| You want to… | Go to |
| --- | --- |
| Follow a complete worked example | [Use cases](use-cases/README.md) |
| Understand the vocabulary — agent, skill, SOP, runtime | [Core concepts](concepts.md) |
| See what each agent can do and access | [Agents reference](agents.md) |
| Browse all 82 skills and when to use them | [Skills catalog](skills.md) |
| See every workflow, step by step | [SOP workflows](sop-workflows/README.md) |
| Look up a command, flag, or config key | [CLI reference](reference.md) |
| Fix something that went wrong | [Troubleshooting](troubleshooting.md) |
| Change how the agents behave, or build the CLI yourself | [Contributing and customizing](appendix/contributing.md) |

---

[← Prerequisites](prerequisites.md) · [Back to guide index](README.md) · [Next: Task guides →](tasks/README.md)
