<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install via the Claude Code plugin marketplace

[← Task guides](README.md) · [Guide index](../README.md)

Use this path to install Konductor without the `konductor` CLI. It is
available after the first plugin release merges into `release/plugins`.

## Prerequisites

| Requirement | Verify with |
| --- | --- |
| Claude Code 2.1.178 or later | `claude --version` |
| Git on your `PATH` | `git --version` |

## Install

Add the marketplace:

```bash
/plugin marketplace add aws-solutions/konductor
```

Install the plugin:

```bash
/plugin install konductor@konductor
```

Start the orchestrator:

```bash
claude --agent konductor:konductor
```

Specialists use the same namespace, for example:

```bash
claude --agent konductor:k-architect
```

Plugin agent names use the `konductor:` prefix. Standalone installs use bare
agent names such as `konductor` and `k-architect`.

## Required Claude Code settings

Plugin agents need agent-teams mode and tool permissions. Follow [Install for
Claude Code, steps 2-3](install-claude-code.md#2-enable-agent-teams-mode).

## Update or remove

```bash
/plugin update konductor@konductor
/plugin uninstall konductor@konductor
```

`/plugin update` fetches the current plugin release. `konductor update` only
manages CLI-tracked installs.

## AWS MCP

The plugin bundles `aws-mcp` for `k-architect` and `k-developer`. Install
`uvx` and configure AWS credentials before using AWS API tools. The proxy is
pinned; AWS documentation and skills still come from the managed endpoint at
request time.

The plugin build selects `aws-mcp` for bundling by passing `synth
--claude-bundled-mcp-servers` (see the [CLI
reference](../reference.md#per-command-flags-and-arguments)).

A plugin-level MCP server starts for the whole plugin session once the
plugin is enabled, not only while `k-architect` or `k-developer` is active,
and it runs under your own AWS credentials for that entire session. Use the
`aws:ViaAWSMCPService` and `aws:CalledViaAWSMCP` IAM condition keys to scope
or audit what the server can do, regardless of which agent triggered the
call. See [Install for Claude Code](install-claude-code.md#optional-integrations)
for AWS setup and other MCP integrations.

A plugin agent's tool grant uses the plugin-scoped name
`mcp__plugin_konductor_aws-mcp__*`, not the standalone `mcp__aws-mcp__*`.
Grant that exact glob in `permissions.allow` (or `ask`/`deny`) if you set
Claude Code permissions for this install path; the standalone name has no
effect on a plugin agent.

`k-browser`'s Playwright MCP server is not bundled. Configure it separately:

```bash
claude mcp add playwright-mcp -- npx -y @playwright/mcp@latest
npx playwright install chromium
```

Add `--scope user` to make that server available across projects.

## Telemetry

The plugin sends usage telemetry to AWS by default. A hook runs when a
session starts with a Konductor agent and when a Konductor agent is
delegated to. Each event carries the agent name, the delegating Konductor
agent's name when Claude Code exposes it, the plugin version, a hashed
session ID, and `claude-plugin` as the harness so plugin events can be told
apart from CLI ones. Your own agents and Claude Code's built-in agents are never
reported. Prompts, file paths, and tool inputs are never sent.

Events also carry the machine ID stored in `~/.konductor/telemetry.json`.
The plugin creates that file if it is missing. The Konductor CLI uses the
same file, so plugin and CLI events from one machine share one ID.

To opt out, do any one of these:

- Turn off the plugin's `telemetry_enabled` option in `/config`.
- Set `KONDUCTOR_TELEMETRY=off` in your environment.
- Set `telemetry.enabled: false` in `.konductor/config.yml` in the project,
  any directory above it, or `$HOME`.
- Set `"telemetry_consent": false` in `~/.konductor/telemetry.json`. This
  also stops the CLI from reporting on this machine.

The plugin sends to the default endpoint unless `KONDUCTOR_METRICS_ENDPOINT`
is set. It does not read `telemetry.endpoint` from `.konductor/config.yml`.

See [Data Collection](../../../README.md#data-collection) for the full
details and the event schema.

## Related

- [Install for Claude Code](install-claude-code.md)
- [Install for Kiro CLI](install-kiro-cli.md)
- [Install via Kiro Power](install-kiro-power.md)
- [Plugin build output](../../../generated/claude-plugin/README.md)
- <https://aws-solutions.github.io/konductor/>

[← Install for Claude Code](install-claude-code.md) · [Task guides](README.md)
