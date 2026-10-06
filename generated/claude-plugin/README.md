<!-- SPDX-License-Identifier: Apache-2.0 -->

# generated/claude-plugin/

This directory is a local build output location, not a source of truth and
not something `main` tracks. `agents/` and `skills/` (see below) are
`.gitignore`d and only ever exist on disk after running `make claude-plugin`.
This README is the one file here that stays committed, as a breadcrumb
for anyone who lands in this otherwise-empty directory.

The actual source of truth is `agents/*.agent-spec.json`, `skills/*/SKILL.md`,
and `agent-sops/*.sop.md` at the repo root. Never hand-edit anything under
`generated/claude-plugin/`. It's regenerated wholesale on every
`make claude-plugin` run, and any edit here is silently discarded the next
time that runs.

## Where the published plugin actually lives

Users install this project's Claude Code plugin from the **`claude-plugin`**
branch, not from `main`. Before the first release, repository administrators
must create and protect that branch. `.github/workflows/release.yml`'s
`publish-claude-plugin` job then updates it for each tagged release. See that job, and
`scripts/assemble-claude-plugin-branch.sh`, for exactly what ends up on that
branch: a flat tree (`.claude-plugin/plugin.json`, `.mcp.json`, `agents/`,
`skills/`, `README.md`, `LICENSE.txt`, all at the tree root, with no
`generated/` nesting). `main`'s own `.claude-plugin/marketplace.json` points
its plugin entry's `source` at that branch by `ref`.

## What ends up here locally

```
generated/claude-plugin/
├── README.md          # this file, the only tracked thing in this directory
├── agents/            # gitignored, 11 files, one per agents/*.agent-spec.json,
│                       # rendered as Claude Code agent Markdown by
│                       # `konductor synth --from .`
└── skills/            # gitignored, 19 directories, one per agent-sops/*.sop.md,
                        # rendered as `sop-<name>/SKILL.md` (with
                        # `disable-model-invocation: true`) by
                        # `konductor install --harness claude`
```

`.claude-plugin/plugin.json` (also gitignored, see `.gitignore`) is
generated alongside these two directories. Its own `skills` field only adds
this directory's 19 `sop-*` entries on top of a default scan of the repo's
native `skills/*/SKILL.md` (82 skills). The flat tree published to the
`claude-plugin` branch instead merges both sets into one real `skills/`
directory, since there's no `generated/` subtree there to scan separately.
See `scripts/assemble-claude-plugin-branch.sh`.

`.mcp.json` (also gitignored, at the repo root next to `.claude-plugin/`) is
generated alongside `plugin.json`: the plugin-level MCP server declaration
Claude Code reads for a plugin install. See "MCP servers: bring-your-own,
with one packaged exception" below for why this file exists at all,
distinct from the `mcpServers:` frontmatter each agent's own `.md` file
already carries.

## Why two different tools produced this

- **`agents/`**: `konductor synth --from .` writes `dist/claude/agents/*.md`
  directly. `dist/` is gitignored (a build artifact), so these 11 files are
  copied out of it into this directory.
- **`skills/`**: `konductor synth` alone does **not** perform the
  SOP-to-skill conversion. It only stages `dist/claude/sops/*.sop.md`.
  The actual `<name>.sop.md` to `sop-<name>/SKILL.md` conversion (with the
  `disable-model-invocation: true` frontmatter key, so Claude Code never
  auto-invokes a converted SOP as an ordinary skill) happens inside
  `konductor install --harness claude`, as part of writing a full
  installation tree. There is no standalone CLI subcommand that performs
  just this one conversion step without also writing an
  agents/skills/manifest tree, so producing this directory's `skills/sop-*/`
  content requires running a full `install` to a scratch target and then
  copying `.claude/skills/sop-*/` back out of it. One skill in that scratch
  tree, `sop-state-management`, is a **native** skill whose name happens to
  start with `sop-` (it is not a SOP-derived skill). It is excluded from
  this copy because it is already covered by the native `skills/` scan.

## How to regenerate locally

Run from the repo root, whenever you want to test a change to
`agents/*.agent-spec.json`, `skills/*/SKILL.md`, or `agent-sops/*.sop.md`
before it reaches a release:

```bash
make claude-plugin
```

See `scripts/generate-claude-plugin.sh` (called from the root `Makefile`'s
`claude-plugin` target) for exactly what it does:

1. Builds the CLI (`make -C cli build`, the same target `make build` and
   `make synth` use).
2. Runs `konductor synth --from .` to regenerate `dist/claude/agents/*.md`.
3. Runs `konductor install --harness claude` into a `mktemp` scratch
   `--target`/`HOME`, never your real `~/.claude` or `~/.konductor`,
   to produce the `sop-<name>/SKILL.md` conversions.
4. Wipes and regenerates this directory's `agents/*.md` and
   `skills/sop-*/SKILL.md` from that output, skipping `sop-state-management`
   for the reason given above. This is fully deterministic: re-running with
   no source changes produces byte-identical output.
5. Regenerates `.claude-plugin/plugin.json` via `render-claude-plugin-json.py
   --template scripts/claude-plugin.template.json`: `version` comes from the
   repo's root `VERSION` file (this repo's single source of truth for the
   released version, see `.github/workflows/release.yml`'s
   `check-version` job), and the `agents` list is the sorted set of `.md`
   files this run just wrote to `agents/`. Every other field in
   `plugin.json` (description, author, keywords, `metadata.sourceRepo`,
   etc.) is carried through unchanged from `scripts/claude-plugin.template.json`,
   which IS committed to `main` (unlike the generated `plugin.json` itself,
   which is gitignored, see above). Because the template is real,
   committed source, a fresh clone works out of the box: there is no seed
   copy to fetch and nothing to ask a maintainer for. The
   same script call also writes `.mcp.json` at the repo root, as the
   deduplicated union of every `agents/*.agent-spec.json`'s
   `dependencies.mcpRegistry` entries, sorted by server name for
   determinism, filtered to `scripts/claude-plugin-mcp-servers.json`'s
   `"bundled"` allowlist (today: just `aws-mcp`; see "MCP servers:
   bring-your-own, with one packaged exception" below for why
   `playwright-mcp` is deliberately excluded), with the launch definition
   for each allowlisted name overridden by that same file's own `"bundled"`
   object rather than left as whatever an individual agent spec's own
   `dependencies.mcpRegistry` entry says
   (`render-claude-plugin-json.py --agent-specs-dir agents --mcp-output
   .mcp.json --bundled-mcp-servers <list> --bundled-mcp-config
   scripts/claude-plugin-mcp-servers.json`). It errors out if two agents
   declare the same server name with conflicting definitions, rather than
   silently picking one, even for a server the allowlist will go on to
   filter out. `konductor synth`'s own `--claude-bundled-mcp-config` flag
   applies the identical override to `dist/claude/agents/*.md`'s
   `mcpServers:` frontmatter for the standalone install, so both shapes
   launch the exact same pinned command regardless of what the agent
   spec's own entry happens to say.
6. Rewrites the bundled server(s)' tool grant in `agents/*.md`'s `tools:`
   frontmatter from the bare standalone-install form (`mcp__aws-mcp__*`)
   to the real plugin-scoped tool name Claude Code actually resolves for a
   plugin subagent (`mcp__plugin_konductor_aws-mcp__*`; see
   "Plugin-scoped MCP tool names: resolved for bundled servers" below for
   how that exact form was confirmed) via
   `scripts/rewrite-claude-plugin-mcp-tool-names.py`, a plain prefix
   substring replace, so it applies identically whether the grant is a
   `*` wildcard (the whole server, which is what `k-architect`/
   `k-developer` actually grant today) or a specific tool name. The
   plugin name comes from the just-rendered `plugin.json`'s own `"name"`
   field, never a hardcoded string. `playwright-mcp`'s grant is left bare
   on every agent since it is bring-your-own, so there is no real
   plugin-scoped connection for it to point at.
7. Runs `claude plugin validate .claude-plugin/plugin.json` when the
   `claude` CLI is on `PATH`, and prints a notice and skips it otherwise.
   This targets the plugin manifest FILE directly, not the repo-root
   directory (`claude plugin validate .`): per Claude Code's own CLI
   reference, given a directory, `claude plugin validate` picks
   `.claude-plugin/marketplace.json` over `.claude-plugin/plugin.json` when
   both exist in the same directory (as they do here, since `main`'s own
   marketplace manifest lives at the repo root), so `claude plugin
   validate .` only ever validated the marketplace shape and never opened
   the plugin's own agent/skill/MCP files at all. Deliberately without
   `--strict`: this repo's own top-level `CLAUDE.md` makes `claude plugin
   validate` permanently warn `CLAUDE.md at the plugin root is not loaded
   as project context` whenever the plugin root and the repo root are the
   same directory, regardless of this plugin's own content, and `--strict`
   would turn that permanent, environment-driven warning into a permanent
   failure. The flat tree actually published to the `claude-plugin` branch
   has no top-level `CLAUDE.md` and is validated with `--strict` (see
   below).

Scratch directories are always cleaned up, including on failure, via a
shell `trap`.

`make claude-plugin-check` is the PR-time companion: it re-runs the full
generation above, then also assembles the flat branch tree
(`scripts/assemble-claude-plugin-branch.sh`) into a scratch directory and
validates the repo-root `.claude-plugin/marketplace.json` (`--strict`) and
`.claude-plugin/plugin.json` (plain, see step 7's own explanation above)
as separate explicit file targets, plus the flat branch tree (`--strict`),
when the CLI is available. It confirms the generation pipeline still
produces a valid plugin. It is not a drift check against any committed
file, since nothing generated is committed on `main` anymore. See the root
`Makefile`'s own comment on that target, and
`.github/workflows/validate-pr.yml`, for where it runs in CI.

`scripts/assemble-claude-plugin-branch.sh --out <dir>` builds the exact flat
tree `publish-claude-plugin` publishes to the `claude-plugin` branch, for
testing that shape specifically without pushing anything.

## MCP servers: bring-your-own, with one packaged exception

MCP servers are **bring-your-own** by default. Konductor does not launch a
user's MCP server for them. `dependencies.mcpRegistry` on an agent spec
documents how a user would wire that server up themselves (command, args,
or URL); it does not, on its own, mean Konductor packages it.

**AWS MCP (`aws-mcp`) is the one exception**, packaged because
`k-architect`/`k-developer` depend on it closely enough to ship pre-wired
for Claude Code. `scripts/claude-plugin-mcp-servers.json`'s `"bundled"`
list is the single source of truth for which server names get this
treatment, read by both `konductor synth --claude-bundled-mcp-servers`
(`cli/konductor-rs/src/cli.rs`) and `render-claude-plugin-json.py
--bundled-mcp-servers` (via `scripts/read-bundled-mcp-servers.sh`, so the
two never disagree). `k-browser`'s `playwright-mcp` is deliberately left
out: it stays bring-your-own on every harness and every install shape, the
same as it always was.

**The package and args come from the
[Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws)**.
Konductor does not invent its own AWS MCP configuration there. The server
**key stays `aws-mcp`**, though: it matches AWS's own getting-started docs page
(`docs.aws.amazon.com/agent-toolkit/latest/userguide/getting-started-aws-mcp-server.html`)
and its OAuth-direct-connect command examples, plus every existing user config and
internal agent that already refers to this server as `aws-mcp`. The toolkit repo's
own README example uses the key `aws` instead for the same server, but Konductor
keeps `aws-mcp` for that continuity rather than switching to match the repo.

**The actual launch command is NOT read from the agent spec.**
`agents/k-architect.agent-spec.json` and `agents/k-developer.agent-spec.json`'s own
`dependencies.mcpRegistry.aws-mcp` entry still says `command: uvx`, args
`mcp-proxy-for-aws@latest`, the loosely-pinned library package, kept there
unchanged so the agent specs stay byte-identical to what a user would write
themselves for a bring-your-own server. What actually gets launched, for
both the plugin (this `.mcp.json`) and the standalone
`dist/claude/agents/*.md` frontmatter, comes from
`scripts/claude-plugin-mcp-servers.json`'s own `"bundled"` object instead,
which overrides the spec's entry: `command: uvx`, args
`mcp-proxy-for-aws-cli@latest`, `https://aws-mcp.us-east-1.api.aws/mcp`,
`--metadata`, `AWS_REGION=us-east-1`. That's `mcp-proxy-for-aws-cli`, not the
spec's own `mcp-proxy-for-aws`, because the toolkit describes the `-cli`
distribution as "thin, version-pinned": every transitive dependency locked
to tested versions, so `@latest` still gets a frozen, tested set rather
than an unvetted newer release. See `render-claude-plugin-json.py
--bundled-mcp-config` and `konductor synth --claude-bundled-mcp-config` in
step 5 above for the mechanics.

## Tool grant: the whole server

`k-architect`/`k-developer` grant the AWS MCP Server's entire tool surface.
Both agents request the server via a `mcp__aws-mcp__*` glob in Claude
Code (a bare `@aws-mcp` collection grant in `tools` on Kiro CLI), so every
tool the server exposes is available, including the five
**knowledge/documentation** tools,
`aws___search_documentation`, `aws___retrieve_skill`,
`aws___read_documentation`, `aws___list_regions`,
`aws___get_regional_availability`, and the three **AWS-API-acting** tools
the same server exposes: `aws___run_script` (sandboxed Python execution
with AWS API access), `aws___get_presigned_url`, and `aws___get_tasks`.
(There is no `call_aws`/`aws___call_aws` tool on the current, unified AWS
MCP Server; that name belonged to the older, now-superseded standalone
"AWS API MCP Server" the toolkit's own docs say to migrate away from.) On
Kiro CLI, `clientConfig.kiroCli.allowedTools` still narrows AUTO-APPROVAL
(not availability) to the five knowledge tools, as explicit `@aws-mcp/<tool>`
entries. The three API-acting tools remain loaded via the bare `@aws-mcp`
grant in `tools`, so an agent can still call them, but each call prompts
for confirmation since they are absent from `allowedTools`. Claude Code has
no equivalent auto-approval concept, so its `mcp__aws-mcp__*` grant is
simply the whole server, unconditionally.

Once a tool call actually runs, it runs under the caller's own IAM
credentials. AWS MCP Server adds two global IAM condition context keys
to every downstream request it forwards, which you can use to scope or
audit agent-originated calls specifically:

- **`aws:ViaAWSMCPService`** (Boolean): `true` for any request that
  passed through *any* AWS managed MCP server.
- **`aws:CalledViaAWSMCP`** (String): the calling MCP server's service
  principal; `aws-mcp.amazonaws.com` for this one.

See [Understanding IAM for managed AWS MCP
servers](https://aws.amazon.com/blogs/security/understanding-iam-for-managed-aws-mcp-servers/)
for the full mechanism and policy examples.

For a bundled server, both install shapes end up with the granted tools
actually launchable:

- **Standalone (non-plugin) `konductor install --harness claude`**:
  `cli/konductor-rs/src/cli/synth/claude.rs` merges the (now-filtered, and
  `--claude-bundled-mcp-config`-overridden) `dependencies.mcpRegistry` into
  each rendered agent's own `mcpServers:` frontmatter. Claude Code's
  subagent frontmatter reference documents `mcpServers` as a supported
  field there, so this alone is enough; each agent's own `mcp__aws-mcp__*`
  grant is already correct as written and needs no rewriting for this
  shape.
- **The packaged plugin** (this directory, and the flat tree
  `scripts/assemble-claude-plugin-branch.sh` publishes): Claude Code
  ignores `mcpServers` (along with `hooks` and `permissionMode`) on a
  plugin-loaded subagent file, for security reasons, so the plugin instead
  needs the plugin-level `.mcp.json` at the repo root (see
  `scripts/render-claude-plugin-json.py --mcp-output`), generated from the
  same, now-filtered `dependencies.mcpRegistry` source.

For everything NOT in the bundled allowlist (`playwright-mcp` today), no
`.mcp.json` entry and no standalone `mcpServers:` entry is ever generated,
on either install shape. The agent's own `mcp__playwright-mcp__*` tool
grant still names the server, but the user configures and launches it
themselves (`claude mcp add playwright-mcp -- npx -y
@playwright/mcp@latest` for Claude Code; a manual `~/.kiro/settings/
mcp.json` entry for Kiro CLI). See the root `README.md`'s "Optional
Integrations" table and `docs/user-guide/tasks/install-claude-code.md` /
`docs/user-guide/tasks/install-kiro-cli.md` for per-harness setup steps,
and the toolkit's own OAuth-direct-connect and official-plugin
alternatives.

`.mcp.json` is gitignored on `main` the same way `.claude-plugin/
plugin.json` is (see `.gitignore`).

## Plugin-scoped MCP tool names: resolved for bundled servers

Verified directly with `claude --debug mcp` against a real, offline,
zero-network scratch install of this repo's own generated plugin content:
once `.mcp.json` declares a server, Claude Code connects it under the name
`plugin:konductor:<server>` and exposes its tools as `mcp__plugin_konductor_
<server>__<tool>` (e.g. `mcp__plugin_konductor_aws-mcp__<tool>`), with hyphens in
both the plugin name and the server name
preserved literally: not the bare `mcp__<server>__<tool>` form, and not
normalized to underscores. (`konductor` here is whatever `plugin.json`'s
own `"name"` field says; `scripts/rewrite-claude-plugin-mcp-tool-names.py`
reads it from that file rather than assuming it.)

For a bundled server (`aws-mcp`), this rewrite step (step 6 above) closes the
gap for the granted tool: `k-architect`'s and `k-developer`'s `agents/*.md`
`tools:` entries are rewritten from `mcp__aws-mcp__*` to
`mcp__plugin_konductor_aws-mcp__*` in the generated plugin output, so the
granting agent's allowlist matches its real (plugin-prefixed) tool name.
The rewrite is a plain prefix substring replace
(`mcp__aws-mcp__` -> `mcp__plugin_konductor_aws-mcp__`), so it applies
identically whether the grant carries a `*` wildcard (what `k-architect`/
`k-developer` actually grant) or a specific tool name after that prefix.
Confirmed live: installing the generated plugin tree into a scratch `HOME`
and invoking `claude --agent konductor:k-architect --debug mcp -p "..."`
against a mock, zero-network `aws-mcp` stdio server exposing both
knowledge and API-acting tool names reports all eight of them under their
rewritten, plugin-scoped names (e.g.
`mcp__plugin_konductor_aws-mcp__aws___search_documentation`,
`mcp__plugin_konductor_aws-mcp__aws___run_script`), confirming the
wildcard rewrite covers the whole server under the plugin path too, not
just the knowledge tools.

`playwright-mcp`'s grant (`k-browser`'s `mcp__playwright-mcp__*`) is left
BARE on the plugin path, deliberately: it is bring-your-own, so there is no
real plugin-scoped MCP connection for a rewritten name to point at until
the user configures one themselves (and when they do, they configure it as
a standalone, non-plugin server under the bare name Claude Code already
resolves without any plugin prefix; the same live check above, run
against `konductor:k-browser` with no `playwright-mcp` entry in `.mcp.json`,
confirms it currently has zero real `mcp__`-prefixed tools).

The standalone (non-plugin) `konductor install --harness claude` path never
needed this rewrite: an inline `mcpServers:` entry on a standalone agent
file is not plugin-scoped, so its tools keep the bare
`mcp__<server>__<tool>` name the existing grants already expect.

## Kiro CLI

`dependencies.mcpRegistry` is parsed (`cli/konductor-rs/src/cli/synth/
parser.rs`) but not yet read by either Kiro transformer
(`kiro_cli_v2.rs`/`kiro_cli_v3.rs`). A real installed Kiro agent's own
`mcpServers` field renders as `{}` today regardless of what
`dependencies.mcpRegistry` declares, for EVERY server including `aws-mcp`.
This is a pre-existing, Kiro-side gap, out of scope for the Claude-harness
work above, and tracked separately. Set both servers up manually under
`~/.kiro/settings/mcp.json` in the meantime; `docs/user-guide/tasks/
install-kiro-cli.md` does not yet spell out the exact block for either
server, so ask a maintainer or check an existing config if you need one.
The agent's own `clientConfig.kiroCli.tools` already carries a bare `@aws-mcp`
collection grant, so all eight tools load once you've configured the
server; `allowedTools` narrows only AUTO-APPROVAL to the five explicit
`@aws-mcp/<tool>` knowledge entries, so the three API-acting tools still
prompt for confirmation on each call, same as documented above for Kiro
CLI generally.

## Rollback: removing a bad `claude-plugin-v*` release tag

See `.github/workflows/release.yml`'s `publish-claude-plugin` job for how
the `claude-plugin-vX.Y.Z` tag is created (immutable, one per release, on
the same commit as that release's force-pushed `claude-plugin` branch
content). If a release ships broken plugin content and needs to be pulled:

1. **Never move or re-push the tag.** A moved tag silently changes what
   every existing `marketplace.json` `ref: "claude-plugin-vX.Y.Z"` pin
   resolves to, for anyone who already installed at that version. The
   whole point of an immutable tag is that it never does that. Cut a new
   release with the fix and a new tag instead.
2. **To stop new installs from reaching the bad content**, update `main`'s
   `.claude-plugin/marketplace.json` plugin entry's `source.ref` to point
   at the last known-good tag (or back to the `claude-plugin` branch, if
   you want new installs tracking the branch HEAD again instead of a
   pinned tag) and cut a normal PR. This repo's own marketplace
   consumers re-resolve `ref` the next time they run `/plugin marketplace
   update`, per `claude plugin marketplace update`'s own documented
   behavior of updating "to the latest commit of that ref."
3. **If the bad tag must be deleted outright** (e.g. it references content
   with a genuine security issue), delete the remote tag directly
   (`git push origin :refs/tags/claude-plugin-vX.Y.Z`) and note the
   deletion plus the reason in this repo's `CHANGELOG.md`. Deleting a tag
   does not retroactively fix an install that already resolved it to a
   commit; anyone who installed at that exact tag keeps the content they
   fetched until they update or reinstall against a different `ref`.
4. **The underlying `claude-plugin` branch itself is unaffected** by any
   of the above. It keeps moving forward with every release
   (`publish-claude-plugin` force-pushes it every time), so a
   `marketplace.json` `ref` pointing at the branch (rather than a pinned
   tag) always tracks the latest content regardless of what happens to
   any individual release tag.
