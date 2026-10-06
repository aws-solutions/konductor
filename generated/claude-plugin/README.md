<!-- SPDX-License-Identifier: Apache-2.0 -->

# Claude plugin build output

`generated/claude-plugin/` is local build output. Do not edit generated
agents, skills, `.mcp.json`, or `.claude-plugin/plugin.json`. The source of
truth is `agents/`, `skills/`, and `agent-sops/` at the repository root.

## What is generated

```text
generated/claude-plugin/
├── agents/   Rendered Claude Code agent files
├── skills/   SOP-derived Claude Code skills
└── README.md This guide
```

`agents/` comes from `konductor synth`. `skills/` contains only converted
SOPs. Native skills stay under the repository's `skills/` directory and are
included separately by the plugin manifest.

The generator also writes two gitignored files at the repository root:

- `.claude-plugin/plugin.json` describes the repository-tree plugin.
- `.mcp.json` declares bundled plugin MCP servers.

## Generate and validate

```bash
make claude-plugin
make claude-plugin-check
```

`make claude-plugin` builds the CLI, synthesizes Claude agents, performs the
SOP-to-skill conversion in a temporary install, and renders plugin metadata.
`make claude-plugin-check` also builds the flat release tree and validates
both plugin shapes.

The generator uses temporary `HOME` and install directories. It does not
write to the developer's real Claude Code or Konductor state.

## Published plugin

The marketplace in `main` points to the `claude-plugin` branch. Before the
first release, repository administrators must create and protect that branch.
The release workflow validates a flat plugin tree, then atomically updates the
branch and its immutable `claude-plugin-vX.Y.Z` tag.

The published branch contains:

```text
.claude-plugin/plugin.json
.mcp.json
agents/
skills/
README.md
LICENSE.txt
```

To correct a bad release, publish a fixed version. Do not move an existing
plugin tag. If the marketplace must stop tracking a bad release, update its
reference through a normal pull request.

## MCP servers

MCP servers are user-configured unless they appear in
`scripts/claude-plugin-mcp-servers.json`. Today, only `aws-mcp` is bundled for
Claude Code. The bundled definition pins
`mcp-proxy-for-aws-cli==1.7.0`; the managed AWS MCP endpoint still supplies
current documentation and skills at request time.

Plugin agent frontmatter cannot launch MCP servers, so the generator writes a
plugin-level `.mcp.json`. It derives the bundled server set from agent specs,
rejects conflicting definitions, and uses the bundled configuration as the
launch source.

Claude Code namespaces tools from a plugin MCP server. The generator rewrites
bundled grants such as:

```text
mcp__aws-mcp__*
```

to the plugin-scoped form:

```text
mcp__plugin_konductor_aws-mcp__*
```

Bring-your-own servers, including `playwright-mcp`, keep their bare grants and
must be configured by the user.

## Kiro CLI

Kiro CLI renders `clientConfig.kiroCli.mcpServers`, not an agent's
`dependencies.mcpRegistry`. The bundled `aws-mcp` definition is therefore not
copied into Kiro configuration automatically. Add MCP servers in Kiro
configuration as described in the user guide. The agent spec grants AWS MCP
tools once the server is configured; API tools still prompt for confirmation.

## Implementation references

- `scripts/generate-claude-plugin.sh` generates repository-tree output.
- `scripts/assemble-claude-plugin-branch.sh` builds the flat release tree.
- `scripts/render-claude-plugin-json.py` renders plugin and MCP metadata.
- `scripts/rewrite-claude-plugin-mcp-tool-names.py` rewrites bundled tool
  grants for plugin namespacing.
- `.github/workflows/release.yml` publishes the release tree.
