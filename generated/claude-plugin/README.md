<!-- SPDX-License-Identifier: Apache-2.0 -->

# Claude plugin build output

`generated/claude-plugin/` is local build output. Do not edit generated
agents or skills. The source of truth is `agents/`, `skills/`, and
`agent-sops/` at the repository root.

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

## Generate and validate

```bash
make claude-plugin
make claude-plugin-check
```

`make claude-plugin` builds the CLI, synthesizes Claude agents, and performs
the SOP-to-skill conversion in a temporary install. `make claude-plugin-check`
additionally assembles the flat release tree (the only plugin layout this
repository ships) and validates it, plus the committed `marketplace.json`.

The generator uses temporary `HOME` and install directories. It does not
write to the developer's real Claude Code or Konductor state.

## Published plugin

The marketplace in `main` points to the `release/plugins` branch. Before the
first release, repository administrators must create and protect that
branch, and protect the `claude-plugin-v*` tag pattern.

The release workflow assembles the flat plugin tree
(`scripts/assemble-claude-plugin-branch.sh`), validates it, pushes it to a
fresh, collision-resistant candidate branch, and opens a draft pull request
into `release/plugins`. It never writes to `release/plugins` directly --
the `plugins` branch ruleset blocks creation, update, deletion, and
non-fast-forward there with no bypass actors, and the org-wide ruleset
requires two approvals before any PR merges. After a human merges that PR,
a separate workflow (`tag-claude-plugin-release.yml`) creates the immutable
`claude-plugin-vX.Y.Z` tag on the merge commit.

The published branch contains:

```text
.claude-plugin/plugin.json
.mcp.json
agents/
skills/
README.md
LICENSE.txt
```

`plugin.json` and `.mcp.json` are rendered only at that flat tree's own
root, by `scripts/assemble-claude-plugin-branch.sh`. There is no separate
repository-root copy of either file.

To correct a bad release, publish a fixed version through the same
candidate-branch and draft-PR flow. Do not move an existing plugin tag. If
the marketplace must stop tracking a bad release, update its reference
through a normal pull request.

## MCP servers

MCP servers are user-configured unless they appear in
`scripts/claude-plugin-mcp-servers.json`. Today, only `aws-mcp` is bundled for
Claude Code. The bundled definition pins
`mcp-proxy-for-aws-cli==1.7.0`; the managed AWS MCP endpoint still supplies
current documentation and skills at request time.

Plugin agent frontmatter cannot launch MCP servers, so
`scripts/assemble-claude-plugin-branch.sh` writes a plugin-level
`.mcp.json` at the flat tree's root. It derives the bundled server set
from agent specs, rejects conflicting definitions, and uses the bundled
configuration as the launch source.

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

- `scripts/generate-claude-plugin.sh` generates this directory's
  agents/skills output.
- `scripts/assemble-claude-plugin-branch.sh` builds the flat release tree,
  calling the generator above first, then rendering `plugin.json` and
  `.mcp.json` at the flat tree's own root.
- `scripts/render-claude-plugin-json.py` renders plugin and MCP metadata.
- `scripts/rewrite-claude-plugin-mcp-tool-names.py` rewrites bundled tool
  grants for plugin namespacing.
- `.github/workflows/release.yml` publishes the release tree.
