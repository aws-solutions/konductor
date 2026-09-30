<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install via the Claude Code plugin marketplace

[← Task guides](README.md) · [Guide index](../README.md)

An alternative to [Install for Claude Code](install-claude-code.md) that uses Claude Code's own
plugin marketplace mechanism instead of the `konductor` CLI. Registers the same 11 agents and 82
skills, packaged as a Claude Code plugin.

**Time required:** about 2 minutes.

**Only available after the first tagged release.** The plugin is published to this repository's
dedicated `claude-plugin` branch by `.github/workflows/release.yml`'s `publish-claude-plugin`
job, which runs after every successful release. Before that first release ships, the marketplace
add below has nothing to fetch.

---

## Prerequisites

| Requirement | Verify with |
| --- | --- |
| Claude Code installed and authenticated | `claude --version`. Agent teams need **v2.1.178 or later**, same as [Install for Claude Code](install-claude-code.md) |
| Git on your `PATH` | `git --version` |

You do **not** need the `konductor` CLI for this path. The plugin marketplace mechanism
downloads and registers everything directly from GitHub.

---

## Steps

### 1. Add the marketplace

```bash
/plugin marketplace add aws-solutions/konductor
```

This reads `.claude-plugin/marketplace.json` from the `main` branch of
[aws-solutions/konductor](https://github.com/aws-solutions/konductor) and registers a
marketplace named `konductor`. That manifest lists one plugin, also named `konductor`, whose
actual content is fetched from this repository's separate `claude-plugin` branch (a flat tree
with no `generated/` nesting; see
[`generated/claude-plugin/README.md`](../../../generated/claude-plugin/README.md) for how that
branch gets built).

### 2. Install the plugin

```bash
/plugin install konductor@konductor
```

The `konductor@konductor` form is `<plugin-name>@<marketplace-name>`. Both happen to be named
`konductor` here, since the marketplace has exactly one plugin. On success, Claude Code reports
the plugin as installed and lists its agents.

### 3. Start a session

Agents install under the same `konductor:` namespace prefix every plugin agent gets, to avoid
colliding with a same-named agent from another plugin or a project-level one:

```bash
claude --agent konductor:konductor
```

Or for a single non-interactive request, routed through the orchestrator:

```bash
claude --agent konductor:konductor -p "Create a threat model for a public REST API backed by DynamoDB."
```

Every specialist is reachable the same way: `konductor:k-architect`, `konductor:k-developer`,
`konductor:k-browser`, and so on.

### 4. Enable agent-teams mode and grant tool permissions

Plugin agents are ordinary Claude Code subagents once installed, so they need the same two
settings a standalone install does. See
[Install for Claude Code, steps 2-3](install-claude-code.md#2-enable-agent-teams-mode) for the
exact environment variable and the `permissions.allow` block. Nothing about installing via the
plugin marketplace changes what those two settings need to contain.

---

## Updating

```bash
/plugin update konductor@konductor
```

Re-fetches the `claude-plugin` branch's current content. There is no separate `konductor update`
step to run. That CLI command only manages a CLI-tracked install (`~/.konductor/installs`),
which a plugin-marketplace install never creates an entry in.

To remove it:

```bash
/plugin uninstall konductor@konductor
```

---

## Agent names differ from the standalone install

| Install path | Orchestrator name | Specialist example |
| --- | --- | --- |
| Plugin marketplace (this page) | `konductor:konductor` | `konductor:k-architect` |
| Standalone (`konductor install --harness claude`) | `konductor` | `k-architect` |

The `konductor:` prefix is Claude Code's own plugin-namespacing convention. Every agent a plugin
ships is addressed as `<plugin-name>:<agent-name>`, whether or not the plugin name and the agent
name happen to collide (as they do for the orchestrator here). If you have documentation, scripts,
or muscle memory built around the bare `konductor`/`k-architect` names from a standalone install,
budget a moment to adjust them.

---

## MCP servers: mostly bring-your-own, one exception

The plugin ships a plugin-level `.mcp.json` declaring **AWS MCP** (`aws-mcp`), Konductor's one
packaged MCP server, because `k-architect` and `k-developer` depend on it closely enough to ship
pre-wired. The package (`mcp-proxy-for-aws-cli`) and args match the [Agent Toolkit
for AWS](https://github.com/aws/agent-toolkit-for-aws)'s own recommended config; Konductor keeps
its own `aws-mcp` server key rather than the toolkit README's `aws`, for continuity with AWS's
getting-started docs, OAuth commands, and existing configs. This repo does
not invent its own. It launches automatically once you've installed the plugin; install `uvx`
and configure AWS credentials (`~/.aws/credentials` or environment variables) so it has
something to authenticate with. Both agents work without credentials, just without AWS
lookups. The whole server is granted (`mcp__aws-mcp__*`), every tool it exposes, including the
AWS-API-acting ones (`aws___run_script`, `aws___get_presigned_url`, `aws___get_tasks`). Use the
`aws:ViaAWSMCPService`/`aws:CalledViaAWSMCP` IAM condition keys (see [Install for Claude
Code's Optional integrations](install-claude-code.md#optional-integrations)) to scope what an
agent-initiated call can do under your own credentials. The plugin build also rewrites the
granted tool to its real plugin-scoped name Claude Code resolves for a plugin
subagent (`mcp__plugin_konductor_aws-mcp__*`, not the bare
`mcp__aws-mcp__*` a standalone install uses). See
[`generated/claude-plugin/README.md`](../../../generated/claude-plugin/README.md#plugin-scoped-mcp-tool-names-resolved-for-bundled-servers)
for how that was confirmed.

**Alternatives the toolkit documents:** `claude mcp add aws-mcp
https://aws-mcp.us-east-1.api.aws/mcp --transport http` connects directly over OAuth with no
local proxy (requires the `AWSMCPSignInOAuthAccessPolicy` managed policy).
`/plugin install aws-core@claude-plugins-official` installs AWS's own official plugin instead of
Konductor's `aws-mcp` entry, maintained directly by AWS. `npx skills add
aws/agent-toolkit-for-aws/skills` installs the toolkit's own skills.

Everything else is bring-your-own, the same as every other harness. In particular,
**`k-browser`'s Playwright integration is not packaged**: its `mcp__playwright-mcp__*` tool
grant names the server, but nothing installs or launches it for you. Register it yourself:

```bash
claude mcp add playwright-mcp -- npx -y @playwright/mcp@latest
```

Add `--scope user` if you want it available across every project. Also install the browser
binary: `npx playwright install chromium`. See
[Install for Claude Code's Optional integrations](install-claude-code.md#optional-integrations)
for the full per-agent breakdown, and the root
[README's Optional Integrations table](https://github.com/aws-solutions/konductor#optional-integrations)
for the equivalent Kiro CLI setup.

---

## Related

- [Install for Claude Code](install-claude-code.md): the CLI-driven standalone install path
- [Install for Kiro CLI](install-kiro-cli.md): the other runtime
- [`generated/claude-plugin/README.md`](../../../generated/claude-plugin/README.md): how the
  `claude-plugin` branch this page installs from actually gets built
- Project docs site: <https://aws-solutions.github.io/konductor/>

---

[← Install for Claude Code](install-claude-code.md) · [Task guides](README.md)
