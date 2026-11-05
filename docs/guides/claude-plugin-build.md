<!-- SPDX-License-Identifier: Apache-2.0 -->

# Claude Code plugin: build and release

This guide is for maintainers. It covers how the Claude Code plugin is
generated, assembled, validated and published. To install the plugin, see
[Install via the Claude Code plugin marketplace](../user-guide/tasks/install-claude-plugin-marketplace.md).

The source of truth is `agents/`, `skills/`, and `agent-sops/` at the
repository root. `main` never carries generated plugin output.

## What is generated

`scripts/generate-claude-plugin.sh --out <dir>` writes two directories:

```text
<dir>/
├── agents/   Rendered Claude Code agent files
└── skills/   SOP-derived Claude Code skills
```

`agents/` comes from `konductor synth`. `skills/` contains only converted
SOPs. Native skills stay under the repository's `skills/` directory; assembly
copies both sets into the release tree's `skills/`, which Claude Code scans by
default.

`scripts/assemble-claude-plugin-branch.sh` runs the generator into a
temporary directory and removes it when it exits. `make claude-plugin` runs
the generator into `dist/claude-plugin/`, which is gitignored, so you can
inspect the output.

## Generate and validate

```bash
make claude-plugin
make claude-plugin-check
```

`make claude-plugin` builds the CLI, synthesizes Claude agents, and performs
the SOP-to-skill conversion in a temporary install. `make claude-plugin-check`
additionally assembles the flat release tree (the only plugin layout this
repository ships) into a scratch directory and validates it, plus the
committed `marketplace.json`.

The generator uses temporary `HOME` and install directories. It does not
write to the developer's real Claude Code or Konductor state.

## Published plugin

The marketplace in `main` points to the `release/plugins` branch. Before the
first release, repository administrators must create and protect that
branch, and protect the `claude-plugin-v*` tag pattern.

The release workflow assembles the flat plugin tree
(`scripts/assemble-claude-plugin-branch.sh`), validates it, pushes it to a
fresh, collision-resistant candidate branch, and opens a draft pull request
into `release/plugins`. It never writes to `release/plugins` directly. The
`plugins` branch ruleset blocks creation, update, deletion, and
non-fast-forward there with no bypass actors, and the org-wide ruleset
requires two approvals before any PR merges.

After a human merges that PR, a repository admin runs
`tag-claude-plugin-release.yml` manually (Actions, then Tag Claude Code
plugin release, then Run workflow), supplying the merged PR's number. This is
a manual, post-merge step, not an automatic trigger. `release/plugins` is
artifact-only (no `.github/`, no `VERSION`, no `scripts/`), and GitHub runs a
`pull_request`-triggered workflow only from a copy of the workflow file on
the PR's base branch, so such a workflow would never find a copy of itself
there to run. The workflow instead verifies the supplied PR through the
GitHub API (merged, base is `release/plugins`, head starts with the real
`plugin-candidate/` prefix), checks out the merge commit, reads the version
from the published `.claude-plugin/plugin.json`, and creates the immutable
`claude-plugin-vX.Y.Z` tag on that commit.

The published branch contains:

```text
.claude-plugin/plugin.json
.claude-plugin/icon.png
.mcp.json
agents/
skills/
hooks/hooks.json
hooks/konductor-telemetry.js
hooks/konductor-dispatch-env.sh
docs/telemetry-schema.json
README.md
LICENSE.txt
NOTICE.txt
```

`plugin.json` and `.mcp.json` are rendered only at that flat tree's own
root, by `scripts/assemble-claude-plugin-branch.sh`. There is no separate
repository-root copy of either file.

`.claude-plugin/icon.png` is copied from `docs/assets/konductor-icon.png`, a
1024 by 1024 PNG render of `docs/assets/konductor-logo.svg`. If the logo
changes, render the SVG again at that size and replace the PNG. The plugin
directory takes the listing icon only the first time the plugin is saved or
submitted, so a later change does not update an existing listing.

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

## Telemetry

The plugin ships a telemetry hook. It is on by default and has no npm
dependencies; Claude Code runs it with `node`.

- `scripts/claude-plugin-telemetry-hook.js` is copied to
  `hooks/konductor-telemetry.js`. It reports `agent_invocation` on
  `SessionStart` (`startup|clear`) and `subagent_invocation` on
  `SubagentStart`, only for Konductor's own agents, in the same format as
  `konductor __telemetry-hook` (`docs/telemetry-schema.json`, also copied
  into the tree). It prints nothing and always exits 0.
- `scripts/render-claude-plugin-hooks-json.py` writes `hooks/hooks.json`.
  The `SubagentStart` matcher lists every file in the assembled `agents/`,
  as `konductor:<agent>` only. Bare names come from a CLI install, whose own
  hook reports them, so an agent is never counted twice.
- The machine ID is shared with the CLI through `~/.konductor/telemetry.json`.

Users opt out with the plugin's `telemetry_enabled` option,
`KONDUCTOR_TELEMETRY=off`, `telemetry.enabled: false` in
`.konductor/config.yml`, or `"telemetry_consent": false` in
`~/.konductor/telemetry.json`. See the
[install guide](../user-guide/tasks/install-claude-plugin-marketplace.md#telemetry)
and the root README's [Data Collection](../../README.md#data-collection)
section. Tests: `node --test tests/scripts/claude-plugin-telemetry-hook.test.js`,
also run by `make claude-plugin-check`.

## Dispatch permission mode

The plugin's `dispatch_permission_mode` option (`userConfig`, type `string`,
default `interactive`) sets how the mux and cmux orchestrators start each
child Claude Code session: `interactive`, `headless`, or `bypass`. The value
is case-sensitive. The template declares no `options` list, because that
field breaks plugin loading on older Claude Code releases; the scripts check
the value instead.

- `scripts/claude-plugin-dispatch-env-hook.sh` is copied to
  `hooks/konductor-dispatch-env.sh`. `hooks/hooks.json` runs it as a second,
  synchronous `SessionStart` entry with matcher
  `startup|resume|clear|compact`, so the environment file is written before
  the session can dispatch.
- It appends `export KONDUCTOR_DISPATCH_PERMISSION_MODE=<value>` to
  `$CLAUDE_ENV_FILE` for a valid value, and the fixed word `invalid` for
  any other non-empty value, so a typo makes dispatch fail instead of
  quietly running `interactive`. It never writes the user's own text.
- A `KONDUCTOR_DISPATCH_PERMISSION_MODE` the user already exported wins: the
  hook then writes nothing. It also does nothing without `CLAUDE_ENV_FILE`.
- It prints nothing and always exits 0.
- A changed option takes effect in a new session, not a resumed one. In a
  check with Claude Code 2.1.318, a hook's export reached the Bash tool, and
  on `--resume` the hook ran again but did not see the earlier export, while
  the Bash tool kept the value written at startup.
- Tests: `tests/test_claude_plugin_dispatch_env_hook.py`, and the hooks.json
  checks in `tests/scripts/claude-plugin-telemetry-hook.test.js` and
  `tests/test_assemble_claude_plugin_branch_mcp_rewrite.py`.

## Kiro CLI

Kiro CLI renders `clientConfig.kiroCli.mcpServers`, not an agent's
`dependencies.mcpRegistry`. The bundled `aws-mcp` definition is therefore not
copied into Kiro configuration automatically. Add MCP servers in Kiro
configuration as described in the user guide. The agent spec grants AWS MCP
tools once the server is configured; API tools still prompt for confirmation.

## Implementation references

- `scripts/generate-claude-plugin.sh` generates the agents and skills
  output into the directory passed with `--out`.
- `scripts/assemble-claude-plugin-branch.sh` builds the flat release tree,
  calling the generator above into a temporary directory first, then
  rendering `plugin.json` and `.mcp.json` at the flat tree's own root.
- `scripts/render-claude-plugin-json.py` renders plugin and MCP metadata.
- `scripts/rewrite-claude-plugin-mcp-tool-names.py` rewrites bundled tool
  grants for plugin namespacing and drops each agent's `mcpServers` block,
  which plugin agents ignore.
- `.github/workflows/release.yml` publishes the release tree.
- `.github/workflows/tag-claude-plugin-release.yml` is a manually dispatched
  workflow that creates the immutable `claude-plugin-vX.Y.Z` tag after a
  human merges a candidate PR into `release/plugins`. It uses
  `scripts/compute-plugin-release-tag.sh` for the same base, head and version
  guards `scripts/validate-plugin-publish-preconditions.sh` applies before
  publishing.
