<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install for Claude Code

[← Task guides](README.md) · [Guide index](../README.md)

Registers the agent team with `claude`, and configures the two settings Claude Code requires before a
team of agents can actually do anything.

**Time required:** about 5 minutes — longer than Kiro CLI, because agent teams are an experimental
Claude Code feature that has to be switched on and given tool permissions.

## Prerequisites

| Requirement | Verify with | Notes |
| --- | --- | --- |
| Claude Code installed and authenticated | `claude --version` | Agent teams need **v2.1.178 or later** |
| Git on your `PATH` | `git --version` | |
| The Konductor CLI | `konductor --version` | See [Quick Start step 1](../quick-start.md#step-1--download-the-cli) |

---

## Steps

### 1. Install

```bash
konductor install --harness claude
```

On success it reports a per-content-type count — agents, skills, SOPs and context files — and
says that two more settings are required before teammates can run. Both are below.

Agent files land in `~/.claude/agents/`:

```bash
ls ~/.claude/agents
```

Each agent's Claude Code configuration comes from its spec's `clientConfig.claudeCli` block, which
declares the Claude Code tool names it may use and the skills it may load.


Neither of the next two settings is on by default, and **each fails quietly without the other**.
Configure both.

### 2. Enable agent-teams mode

Without this, the orchestrator cannot spawn specialists at all.

```bash
claude settings set env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS 1
```

Or edit `~/.claude/settings.json` by hand:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Start a **new** session afterwards — it is read at startup.

### 3. Grant tool permissions

This step is not optional. Background subagents cannot prompt you interactively, so **any tool not
in `permissions.allow` is silently auto-denied** — no error, no prompt, the specialist simply
cannot do its job.

Add a `permissions.allow` block to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Edit",
      "Write",
      "Glob",
      "Grep",
      "TodoWrite",
      "Bash(git status*)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git blame*)",
      "Bash(git show*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(git branch*)",
      "Bash(git checkout*)",
      "Bash(git switch*)",
      "Bash(git stash*)",
      "Bash(git fetch*)",
      "Bash(git rebase*)",
      "Bash(npm *)",
      "Bash(ls *)",
      "Bash(find *)",
      "Bash(grep *)"
    ]
  }
}
```

Permissions are **team-level**: they apply to every agent in the team, not per agent. A subagent
runs inside its parent's permission context, so the parent has to hold a tool before any specialist
it dispatches can use it.

`allow` is one of three verdicts this file supports — `ask` prompts you, `deny` refuses outright.
For an interactive session `ask` is a reasonable middle ground, but a background subagent has no
way to answer a prompt, so in team mode `ask` lands as a silent denial. That is why this step is an
allowlist rather than a mix.

What is deliberately *absent*, and why:

| Not allowed | Reason |
| --- | --- |
| `git push`, `git reset`, `git clean` | Agents commit locally. Pushing to remotes and destructive history rewrites should require a human action. |
| `rm`, `sudo`, `curl`, unscoped `sh` / `bash` | Arbitrary destructive or network commands. |
| `aws` | Cloud mutations. |

Two entries in the allowlist deserve a second look before you accept them: `Bash(npm *)` runs
arbitrary package lifecycle scripts, and `Bash(find *)` supports `-exec`. Neither is read-only.
Trim them if that is not a trade you want to make.

---

### 4. Start a session

Agents install under their own names:

```bash
claude --agent konductor
```

Or for a single non-interactive request:

```bash
claude --agent konductor -p "Create a threat model for a public REST API backed by DynamoDB."
```

That request routes to `k-architect`, which owns threat modeling via its `threat-modeling`
skill.

The same agent names work on Kiro CLI — see [Install for Kiro CLI](install-kiro-cli.md).

---

## Behaviour differs by state

| State | What happens |
| --- | --- |
| **Both settings configured** | The orchestrator spawns specialists, and they have the allowlisted tools. |
| **Env var set, no `permissions.allow`** | Team mode silently degrades. Specialists spawn and then auto-deny every tool. Nothing errors — work just does not happen. |
| **`permissions.allow` set, no env var** | Specialists never spawn. The orchestrator has no one to delegate to. |
| **Claude Code older than v2.1.178** | Team mode is unavailable regardless of settings. |

**Diagnosis shortcut:** specialists spawning but idle → permissions. Specialists never spawning →
environment variable. Neither produces an error message, so this is how you tell them apart.

---

## What success looks like

Verify with the CLI first:

```bash
konductor doctor
```

It runs six checks — `source`, `runtime`, `manifest`, `config`, `container_runtime` and
`index_status` — and prints a status per check plus remediation for anything that is not `ok`.
Exit code `0` when nothing failed. Full status vocabulary in
[Diagnose problems](diagnose-problems.md).

Then in a session:

- [ ] `claude --agent konductor` starts without an "agent not
      found" error.
- [ ] A task needing implementation causes a **specialist to spawn**, visible in your session.
- [ ] The specialist can actually read and edit files, rather than silently doing nothing.

If the first works but the second does not, revisit setting 1. If the second works but the third
does not, revisit setting 2. See
[Troubleshooting #4](../troubleshooting.md#4-claude-code-specialists-spawn-but-do-nothing).

---

## Optional: split-pane display

By default teammates render in your main terminal (`in-process`). For one pane per teammate, set
this in `~/.claude/settings.json`:

```json
{
  "teammateMode": "auto"
}
```

This is no longer the default as of Claude Code v2.1.179 and requires tmux or iTerm2 (with the
`it2` CLI). It is display polish only — team mode itself needs just the environment variable above.

---

## Optional integrations

MCP servers are bring-your-own on Claude Code, with one packaged exception: AWS MCP.
Everything else you configure yourself, the same way you would for any other MCP server.
Konductor's AWS MCP setup follows the [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws),
the upstream source of truth for the package (`mcp-proxy-for-aws-cli`) and args. Konductor keeps
its own `aws-mcp` server key rather than the toolkit README's `aws` key, for continuity with
AWS's own getting-started docs, OAuth commands, and existing configs.

**AWS documentation lookups** — `k-architect` and `k-developer` request the whole `aws-mcp`
server via the `mcp__aws-mcp__*` glob, so every tool it exposes is granted, including the
AWS-API-acting ones (see Tool grant below). Each agent's rendered `.md` file carries an
`mcpServers:` entry (built from `dependencies.mcpRegistry`, filtered to just this server,
launched via `uvx mcp-proxy-for-aws-cli==1.7.0`), so this `konductor install --harness claude`
install launches the server itself — no separate MCP server configuration needed. This is also
true if you installed via the [Claude Code plugin marketplace](install-claude-plugin-marketplace.md)
instead: the plugin ships a plugin-level `.mcp.json` for the same server, with the granted
tool rewritten to its real plugin-scoped name Claude Code resolves for a plugin subagent. The
server auto-starts as soon as the plugin (or standalone install) is enabled, launching
`mcp-proxy-for-aws-cli==1.7.0`. The proxy is pinned for repeatable client behavior; AWS
service documentation and skills still come from the managed endpoint at request time. Install `uvx`
and configure AWS credentials (`~/.aws/credentials` or environment variables) so the agent has
something to authenticate with; it degrades gracefully if credentials are absent.

**Tool grant: the whole server.** `k-architect`/`k-developer` grant every tool the server
exposes — the five AWS knowledge/documentation tools (`aws___search_documentation`,
`aws___retrieve_skill`, `aws___read_documentation`, `aws___list_regions`,
`aws___get_regional_availability`) and the three AWS-API-acting tools (`aws___run_script`,
which runs sandboxed Python with AWS API access; `aws___get_presigned_url`; `aws___get_tasks`).
Once a tool call runs, it runs under your own IAM credentials — use the `aws:ViaAWSMCPService`
(boolean) and `aws:CalledViaAWSMCP` (string, `aws-mcp.amazonaws.com` for this server) global IAM
condition keys to scope or audit what an agent can do through the MCP server specifically; see
[Understanding IAM for managed AWS MCP servers](https://aws.amazon.com/blogs/security/understanding-iam-for-managed-aws-mcp-servers/).

**Alternatives the toolkit documents** (not what Konductor's own `.mcp.json`/`mcpServers:` uses,
but valid ways to reach the same server): `claude mcp add aws-mcp
https://aws-mcp.us-east-1.api.aws/mcp --transport http` connects directly over OAuth with no
local `uvx` process at all (requires the `AWSMCPSignInOAuthAccessPolicy` managed policy).
`/plugin install aws-core@claude-plugins-official` installs AWS's own official plugin, which
bundles the server config and the toolkit's agent skills together, maintained by AWS rather
than by this repo. `npx skills add aws/agent-toolkit-for-aws/skills` installs the toolkit's own
skills independently of Konductor's `aws-service-validator`.

**Browser automation** — `k-browser` requests `mcp__playwright-mcp__*`, but nothing installs
or launches `playwright-mcp` for you — it is bring-your-own on every harness, standalone
install or plugin alike. Register it yourself:

```bash
claude mcp add playwright-mcp -- npx -y @playwright/mcp@latest
```

Add `--scope user` if you want it available across every project rather than just the
current one (the default `local` scope). Also install the browser binary:

```bash
npx playwright install chromium
```

**Slack search** for `k-researcher` is one command in Claude Code:

```bash
claude plugin install slack
```

See [docs/guides/slack-integration.md](../../guides/slack-integration.md) for detail, and
[docs/guides/asana-integration.md](../../guides/asana-integration.md) for Asana.

---

## Related

- [Install via the Claude Code plugin marketplace](install-claude-plugin-marketplace.md) — an
  alternative to the steps above, once the first release publishes the `claude-plugin` branch
- [Install for Kiro CLI](install-kiro-cli.md) — the other runtime

---

[← Install for Kiro CLI](install-kiro-cli.md) · [Next: Initialize a project →](initialize-a-project.md)
