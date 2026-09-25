<!-- SPDX-License-Identifier: Apache-2.0 -->

# Quick Start

[← Back to guide index](README.md)

From nothing to a working agent team.

**Time required:** about 5 minutes.

**What you need:** either [Kiro CLI](https://kiro.dev) or
[Claude Code](https://claude.ai/download) installed. Full list in
[Prerequisites](prerequisites.md).

---

## Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/aws-solutions/konductor/refs/heads/main/scripts/konductor-bootstrap.sh | bash
```

This fetches the published `konductor` release for your platform. The script downloads the small bootstrap script, verifies it against
the checksum GitHub's own Contents API reports for that file, and runs the real
installer. It needs `jq` to read that checksum out of the API's JSON response.

The installer detects your OS and architecture, downloads the matching `konductor`
binary plus its `.sha256` checksum sidecar, verifies the checksum, and symlinks the
verified binary into `~/.local/bin`. It then runs `konductor install` with no `--from`
flag against `$HOME`, which fetches the rest of what it needs — the agent/skill/SOP
content and the platform's `skill-lookup-mcp` server binary — from the same release. It
installs for `kiro-cli-v2` by default; set `KONDUCTOR_HARNESS=claude` (or `kiro-v3`)
first to target a different runtime.

> **Piping a remote script into `bash` runs code you have not read.** Read the bootstrap
> and install scripts yourself first if you want to audit what you are running.

Supported platforms are Linux (`x86_64` or `aarch64`) and macOS on Apple Silicon
(`arm64`) — the three the release build matrix publishes binaries for. On any other
platform (Intel macOS, Windows), the script fails with a clear error naming the three it
supports — use [Installing from source](#installing-from-source) below instead.

If `~/.local/bin` is not already on your `PATH`, the script prints a note telling you to
add it, for example `export PATH="$HOME/.local/bin:$PATH"` in your shell profile.

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

## How installing Konductor works

The quick install above runs a single `install` with no `--from` flag. Without `--from`,
`install` never runs `synth` itself — it fetches a tarball that is already the
runtime-ready output `synth` would produce, from a GitHub Release asset or, if none is
available, the same tarball straight from `main`'s `dist/` directory. Either way it then
unpacks and copies that pre-built content into your runtime's config directories and
records a manifest so a later `update` or `uninstall` knows what it is responsible for.

`synth` only comes into play if you build from source instead (see
[Installing from source](#installing-from-source) below): there, nobody has pre-built
the output for you, so you run `synth` yourself first. It reads Konductor's
agent/skill/SOP source and renders it into that same runtime-ready output tree, which
you then pass to `install --from .`.

`--harness` is required on every `install` — there is no destination-marker
auto-detection and no default:

```bash
konductor install --harness kiro-cli-v2
```

`--harness kiro-cli-v2` installs agents under `.kiro/agents/` and skills under
`.konductor/skills/<name>/` — kept separate from `.kiro/skills/` so Kiro CLI does not
expose every installed skill to every agent. `--harness claude` installs agents and
skills under `.claude/agents/` and `.claude/skills/`. `--harness kiro-v3` installs for
Kiro CLI's V3 (KAS) engine.

It writes:

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

Nine checks — `source`, `runtime`, `manifest`, `config`, `container_runtime`, `index_status`,
`cli_version`, `telemetry_state`, and `content_version` — each with a status. Exit code `0` when
nothing failed. Anything reported as not ok is explained in
[Diagnose problems](tasks/diagnose-problems.md).

---

## Installing from source

Choose this instead of the quick install above when you want a pinned commit rather than
the latest release, need a platform the release build matrix does not publish a binary
for (Intel macOS, Windows), or want to build or audit the source before installing it.
It needs a Rust toolchain; [rustup](https://rustup.rs) is the usual way to get one.

```bash
git clone https://github.com/aws-solutions/konductor.git
cd konductor
make build
make link
konductor synth --from .
```

`make link` symlinks the binary into `~/.local/bin`. If that is not on your `PATH`, add it —
or pick any directory that already is. No administrator privileges are needed.

### Kiro CLI

No `--target` is needed against a fresh, empty target:

```bash
konductor install --from . --harness kiro-cli-v2
kiro-cli chat --agent konductor
```

### Claude Code

Pass `--target` at a directory that already has a `.claude/` marker (Claude Code itself
creates one on first run in a project):

```bash
konductor install --from . --harness claude --target <dir-with-.claude-marker>
claude --agent konductor
```

Claude Code also needs two settings before a team of agents can run — see
[Install for Claude Code](tasks/install-claude-code.md).

---

## Start a session with the orchestrator

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

## Give it real work

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