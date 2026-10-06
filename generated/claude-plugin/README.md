<!-- SPDX-License-Identifier: Apache-2.0 -->

# Claude plugin build output

`generated/claude-plugin/` is local build output. Do not edit its generated
agents, skills, `.mcp.json`, or `.claude-plugin/plugin.json`. The source of
truth is `agents/`, `skills/`, and `agent-sops/` at the repository root.

## Generate and validate

```bash
make claude-plugin
make claude-plugin-check
```

The first command renders the plugin output. The second also assembles the
flat tree that Claude Code installs and validates both shapes.

## Published plugin

The marketplace in `main` points to the `claude-plugin` branch. Before the
first release, administrators must create and protect that branch. The release
workflow builds the flat plugin tree, validates it, and atomically publishes
that branch with its immutable `claude-plugin-vX.Y.Z` tag.

To correct a bad release, publish a fixed version. Do not move an existing
plugin tag. If necessary, update the marketplace reference through a normal
pull request.

## MCP servers

MCP servers are user-configured unless they appear in
`scripts/claude-plugin-mcp-servers.json`. Today, only `aws-mcp` is bundled for
Claude Code. The bundled definition pins
`mcp-proxy-for-aws-cli==1.7.0`; the managed AWS MCP endpoint still supplies
current documentation and skills at request time.

The plugin writes `.mcp.json` because plugin agent frontmatter cannot launch an
MCP server. For bundled servers, generated agent tool grants are rewritten to
the plugin-scoped name Claude Code resolves. Bring-your-own servers, including
`playwright-mcp`, keep their bare names and must be configured by the user.

Kiro CLI does not configure `dependencies.mcpRegistry` automatically. Add MCP
servers in Kiro configuration as described in the user guide.

For implementation details, see the generator scripts and
`.github/workflows/release.yml`.
