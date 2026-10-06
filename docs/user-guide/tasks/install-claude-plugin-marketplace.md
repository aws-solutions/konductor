<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install via the Claude Code plugin marketplace

[← Task guides](README.md) · [Guide index](../README.md)

Use this path to install Konductor without the `konductor` CLI. It is
available after the first plugin release.

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

These agents can use the full AWS MCP tool surface. Use the
`aws:ViaAWSMCPService` and `aws:CalledViaAWSMCP` IAM condition keys to limit
agent-initiated calls. See [Install for Claude Code](install-claude-code.md#optional-integrations)
for AWS setup and other MCP integrations.

`k-browser`'s Playwright MCP server is not bundled. Configure it separately:

```bash
claude mcp add playwright-mcp -- npx -y @playwright/mcp@latest
npx playwright install chromium
```

Add `--scope user` to make that server available across projects.

## Related

- [Install for Claude Code](install-claude-code.md)
- [Install for Kiro CLI](install-kiro-cli.md)
- [Plugin build output](../../../generated/claude-plugin/README.md)
- <https://aws-solutions.github.io/konductor/>

[← Install for Claude Code](install-claude-code.md) · [Task guides](README.md)
