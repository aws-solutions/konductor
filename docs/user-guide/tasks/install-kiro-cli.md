<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install for Kiro CLI

[← Task guides](README.md) · [Guide index](../README.md)

Registers the 11 agents, 82 skills, 19 SOPs, and the orchestrator routing rules with `kiro-cli`.

**Time required:** about 2 minutes.

---

## Prerequisites

| Requirement | Verify with |
| --- | --- |
| Kiro CLI installed | `kiro-cli --version` |
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

The orchestrator routes this to `k-developer`, which is the agent that declares that SOP.

---

## What success looks like

- [ ] `konductor doctor` reports all checks ok and exits `0`.
- [ ] `kiro-cli chat --agent konductor` starts a session without an "agent not found" error.
- [ ] Asking "what agents do you have available?" lists `k-*` specialists.
- [ ] Giving it implementation work produces a **delegation** to a specialist, not the orchestrator
      doing the work itself.

That last point is the real signal. In Kiro CLI the orchestrator pre-approves `fs_read` alone, so
a write or a shell command surfaces a permission prompt instead of happening quietly — it is not
refused, because `@builtin` grants both. (In Claude Code it is granted `Write` and `Bash` with no
prompt gate of its own; only its routing rules stop it using them.) If it starts editing files
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

Start with `konductor` and let it route. That is the default for everything in this guide: it is
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

MCP servers are bring-your-own on Kiro CLI — `dependencies.mcpRegistry` in the agent specs
documents how each one is meant to be configured, but neither Kiro transformer reads it yet
(`kiro_cli_v2.rs`/`kiro_cli_v3.rs`), so nothing is wired up automatically for you, including
AWS MCP (which Claude Code ships pre-wired — see [Install for Claude
Code](install-claude-code.md#optional-integrations) — but this build does not carry that over
to Kiro CLI). Add both servers yourself under `mcpServers` in `~/.kiro/settings/mcp.json` (or
the project-level equivalent) — the `aws-mcp` block below carries the same package and args
as the [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws)'s own recommended
Kiro config (that repo's own example uses the key `aws`; Konductor keeps `aws-mcp` for
continuity with AWS's docs, OAuth commands, and existing configs),
the upstream source of truth for this server's key, package, and args:

```json
{
  "mcpServers": {
    "aws-mcp": {
      "command": "uvx",
      "args": [
        "mcp-proxy-for-aws-cli@latest",
        "https://aws-mcp.us-east-1.api.aws/mcp",
        "--metadata",
        "AWS_REGION=us-east-1"
      ]
    },
    "playwright-mcp": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp@latest"]
    }
  }
}
```

**AWS documentation lookups** — `k-architect` and `k-developer` request the whole `aws-mcp`
server via a bare `@aws-mcp` collection grant in `clientConfig.kiroCli.tools`, so every tool it
exposes loads. After adding the `aws-mcp` entry above, install `uvx` and configure AWS
credentials in `~/.aws/credentials` or environment variables. Both agents work without
credentials, just without AWS lookups.

**Tool grant: five tools auto-approved, the rest prompt.** `k-architect`/`k-developer`'s own
`clientConfig.kiroCli.allowedTools` lists only the five AWS knowledge tools —
`aws___search_documentation`, `aws___retrieve_skill`, `aws___read_documentation`,
`aws___list_regions`, `aws___get_regional_availability` — as explicit `@aws-mcp/<tool>` entries,
so those five run without a confirmation prompt. The AWS-API-acting tools (`aws___run_script`,
`aws___get_presigned_url`, `aws___get_tasks`) are still loaded (the bare `@aws-mcp` grant above
covers them too), so an agent can call them, but each call prompts you for confirmation since
they are not in `allowedTools`. Use the `aws:ViaAWSMCPService` (boolean) and
`aws:CalledViaAWSMCP` (string, `aws-mcp.amazonaws.com` for this server) global IAM condition keys
to scope or audit what an agent can do through the MCP server specifically; see [Understanding
IAM for managed AWS MCP servers](https://aws.amazon.com/blogs/security/understanding-iam-for-managed-aws-mcp-servers/).

**Browser automation** — `k-browser` requests `mcp__playwright-mcp__*`. After adding the
`playwright-mcp` entry above, install the browser binary:

```bash
npx playwright install chromium
```

**Alternative for Kiro CLI 2.11+:** `kiro-cli mcp add --name aws-mcp --url
https://aws-mcp.us-east-1.api.aws/mcp` connects directly over OAuth, with no local `uvx`
process — see the toolkit's [Setting up the AWS MCP
Server](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html)
guide (also covers `npx skills add aws/agent-toolkit-for-aws/skills` for the toolkit's own
skills, and the Claude-Code-specific alternatives in [Install for Claude
Code](install-claude-code.md#optional-integrations)).

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
