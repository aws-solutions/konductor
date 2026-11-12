<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install for Kiro CLI

[← Task guides](README.md) · [Guide index](../README.md)

Registers the 11 agents, 82 skills, 19 SOPs, the core rules, and the orchestrator routing rules with `kiro-cli`.

**Time required:** about 2 minutes.

---

## Prerequisites

| Requirement | Verify with |
| --- | --- |
| Kiro CLI (checked: 2.36.0, 3.0.0) | `kiro-cli --version` |
| Git on your `PATH` | `git --version` |
| The Konductor CLI | `konductor --version` — see [Quick Start step 1](../quick-start.md#step-1--download-the-cli) |

---

## Steps

### 1. Install

```bash
konductor install --harness kiro-cli-v2
```

On success it reports a per-content-type count — agents, skills, SOPs and context files — and
the command to start a session with. Exit code `0`.

Install also wires a session-start hook for `konductor`: `.kiro/hooks/konductor-orchestration-hooks.json` on Kiro CLI v3, an `agentSpawn` entry in `.kiro/agents/konductor.json` on Kiro CLI v2. `orchestration.mode: coordinator` relies on it, and `uninstall` removes it.

`--harness` is **required**. There is no default and no auto-detection from the destination:
every `install` says explicitly which synthed harness output it means. `--target` is the
**destination**, and defaults to `$HOME`.

To install somewhere other than `$HOME`:

```bash
konductor install --harness kiro-cli-v2 --target /path/to/your-project
```

The content comes from a GitHub Release — `konductor-v<version>.tar.gz` and its `.sha256`
sidecar, checksum-verified before anything is written — falling back to `main`'s `dist/` tarball
if no release is published. Both sources are verified the same way.

### 2. Verify

```bash
konductor doctor
```

It runs six checks — `source`, `runtime`, `manifest`, `config`, `container_runtime` and
`index_status` — and prints a status per check plus remediation for anything that is not `ok`.
Exit code `0` when nothing failed. Full status vocabulary in
[Diagnose problems](diagnose-problems.md).

### 3. Start a session

```bash
kiro-cli chat --agent konductor
```

The same agent name works on Claude Code — see
[Install for Claude Code](install-claude-code.md).

### 4. Confirm the agent is really the orchestrator

Ask a question about orchestration itself. Those are answered directly rather than delegated:

```text
What agents do you have available?
```

You should get a list of `k-*` specialists: `k-developer`, `k-architect`,
`k-quality-assurance`, `k-researcher`, `k-tpm`, `k-product-manager`,
`k-browser`, `k-media-analyzer`.

### 5. Give it a real task

```text
Run the k-code-review-workflow SOP against my current branch.
```

`konductor` spawns `k-developer`, the agent that declares that SOP, to run it.

---

## What success looks like

- [ ] `konductor doctor` reports all checks ok and exits `0`.
- [ ] `kiro-cli chat --agent konductor` starts a session without an "agent not found" error.
- [ ] Asking "what agents do you have available?" lists `k-*` specialists.
- [ ] Giving it implementation work has `konductor` edit files itself, each write asking you first,
      then spawn a `k-*` **reviewer** when the phase closes.

That last point is the real signal. In Kiro CLI the orchestrator pre-approves `fs_read` alone, so
a write or a shell command surfaces a permission prompt instead of happening quietly — it is not
refused, because `@builtin` grants both. (In Claude Code it is granted `Write` and `Bash` with no
prompt gate of its own; the reviewer at each phase gate is the check.) If you use
`konductor-mux-orchestrator` or `konductor-cmux-orchestrator` and it starts editing files
directly, its routing rules did not load — see
[Troubleshooting](../troubleshooting.md#3-the-orchestrator-does-the-work-itself-instead-of-delegating).

---

## Behaviour differs by state

| State | What happens |
| --- | --- |
| **Fresh install** | Registers all 11 agents and their dependencies, and reports the counts. |
| **Already installed** | Overwrites the tracked files. `install` does no version comparison — it has no notion of "same" or "older" version. |
| **Locally modified content** | Left untouched by `install`. `update`, by contrast, **overwrites it** — run `konductor update --dry-run` to see what would be lost. |

---

## Which agent to invoke

Start with `konductor` and ask in plain language; it does the work itself (in `coordinator` mode it
hands every change to a specialist) or spawns the agent that declares the SOP you need. That is the default for everything in this guide: it is
the only entry point that verifies a handoff before moving on, and it does not require you to know
who owns which workflow.

```bash
kiro-cli chat --agent konductor
```

Starting a specialist directly is supported and occasionally what you want — scoping a session to
one agent, or skipping the routing hop for a workflow you already know the owner of. See
[which agent owns which SOP](../sop-workflows/README.md#which-agent-owns-which-sop), then:

```bash
kiro-cli chat --agent k-architect
```

Choosing among the three orchestrators:

| Variant | When |
| --- | --- |
| `konductor` | Default. Specialists run as background subagents in your session. |
| `konductor-mux-orchestrator` | You want each specialist in its own visible terminal pane, and you use tmux or zellij. It auto-detects which is active. |
| `konductor-cmux-orchestrator` | You use [cmux](https://github.com/manaflow-ai/cmux) and want specialists in parallel cmux surfaces. |

---

## Optional integrations

Two are pre-configured in the agent specs and need only their local dependency.

**AWS documentation lookups** for `k-architect` and `k-developer`. Their agent files carry an
`aws-mcp` entry in `mcpServers`, launched via `uvx mcp-proxy-for-aws-cli==1.7.0`, so you do not
add it to your own MCP config. Install `uvx` and configure AWS credentials in `~/.aws/credentials`
or environment variables. Without them the server fails to start and both agents still work,
just without AWS lookups. Knowledge tools are pre-approved; AWS API tools ask first. Use the
`aws:ViaAWSMCPService` and `aws:CalledViaAWSMCP` IAM condition keys to limit agent-initiated
calls.

**Browser automation** — `k-browser`. Install the browser binary:

```bash
npx playwright install chromium
```

Two more are opt-in:

- Slack search for `k-researcher` — [Slack integration](../../guides/slack-integration.md)
- Asana sprint planning for `k-product-manager` — [Asana integration](../../guides/asana-integration.md)

---

## Related

- [Install for Claude Code](install-claude-code.md) — the other runtime
- [Diagnose problems](diagnose-problems.md) — when `doctor` reports something not ok
- [Update an installation](update.md) · [Uninstall](uninstall.md)
- [Use cases](../use-cases/README.md) — worked examples now that you are set up

---

[← Task guides](README.md) · [Next: Install for Claude Code →](install-claude-code.md)
