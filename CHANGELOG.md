# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [1.1.0] - 2026-09-30

### Added

- The Konductor Kiro Power (`powers/konductor/`), an [Agent Plugins](https://agent-plugins.org)
  format Power for Kiro CLI v3 / the unified Kiro IDE, imported directly from
  `github.com/aws-solutions/konductor/tree/main/powers/konductor` — that directory is already the
  flat, importable shape Kiro's GitHub import expects (`plugin.json` at its own root, `skills/`
  alongside it), so there is no separate publish branch or assembly step. Ships two skills:
  `konductor-setup`, which onboards a project end to end (detect platform, fetch and
  checksum-verify the pinned CLI release or build it from source on Intel Mac, link it onto
  `PATH`, run `konductor install`/`doctor`, with an explicit `--confirmed` consent backstop and
  `--use-github-token` pass-through for GitHub API rate limits), and `konductor-help`, which
  answers CLI/`doctor`/SOP questions against an existing install.
- Per-target CLI-binary tracking (`<target>/.konductor/power-cli.json`), separate from the CLI's
  own `install-info.json`, so `update`/`uninstall` always resolve the exact binary that installed
  or last updated a given target instead of assuming the shared `~/.local/bin/konductor` symlink
  is still current; falls back to that target's own cached binary, or fails closed, with every
  candidate resolved through one shared trust-boundary check that also rejects a candidate whose
  resolved path escapes the trusted `~/.konductor/cli-releases`/`~/.local/bin/konductor` locations.
- Hardening against source-redirection risks: a non-default `--repo`, or a resolved tag differing
  from `plugin.json`'s own version (whether from `--tag` or `KONDUCTOR_POWER_VERSION`), is
  refused unless `--allow-non-default-repo` is explicitly passed, with a mandatory Step 0
  disclosure of the exact repo+tag on every run.
- The `PATH` symlink step fails closed instead of writing inside an existing directory (or a
  symlink resolving to one) or over a foreign file, and replaces atomically with cleanup on every
  failure path; uninstalling for real requires `--confirmed` (a `--dry-run` preview stays
  unguarded, and a real uninstall also removes that target's `power-cli.json`); and installing
  discloses that usage telemetry is on by default, with `--no-telemetry` to opt out and
  `KONDUCTOR_TELEMETRY=off`/`.konductor/config.yml`/`~/.konductor/telemetry.json` documented for
  switching it off later.
- Thirteen Power activation keywords in `powers/konductor/plugin.json`, in two deliberate tiers:
  nine `konductor`-qualified exact-action phrases (`konductor`, `install konductor`,
  `set up konductor`, `update konductor`, `uninstall konductor`, `konductor doctor`,
  `konductor sop`, `konductor skill`, `konductor agent`) that avoid colliding with a bare generic
  word some other Power might also claim, plus four broader, product-name-independent discovery
  phrases (`multi agent orchestration`, `sdlc workflow`, `ai sdlc workflow`,
  `end to end development`) meant to surface this Power by category/intent.
- `make kiro-power` / `make kiro-power-check` targets: `kiro-power` renders
  `powers/konductor/plugin.json` in place from `scripts/kiro-power.template.json` and the
  repo-root `VERSION` file; `kiro-power-check` checks `VERSION` against that checked-in
  `plugin.json` for drift, validates it against the Agent Plugins v1.0.0 schema, validates both
  skills' frontmatter, shellchecks `konductor-setup`'s scripts, and runs the `tests/kiro-power/`
  suite — all directly against the committed `powers/konductor/` tree, since that tree is the
  published artifact itself. Wired into `.github/workflows/validate-pr.yml` so every PR validates
  the Power the same way.
- Manual "bring your own MCP server" documentation for `k-architect`/`k-developer`'s AWS
  documentation-lookup tools and `k-browser`'s Playwright tools, none of which `konductor synth`'s
  Kiro output wires up automatically: the exact `aws-mcp` entry for `.kiro/settings/mcp.json`
  (the [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws)'s own recommended
  `mcp-proxy-for-aws-cli` command), confirmation that the agent specs already grant the whole
  server (all eight tools reachable, five pre-approved by name, three prompting for confirmation
  on first use), the `aws:ViaAWSMCPService`/`aws:CalledViaAWSMCP` IAM guardrails, the Kiro CLI
  2.11+ OAuth alternative, and Playwright as bring-your-own by design.
- A "Installing via a Kiro Power" section in `README.md`, under Quick Start.

## [1.0.2] - 2026-09-28

### Security

- Upgraded the `rmcp` dependency of the `skill-lookup` MCP server (`mcp/servers/skill-lookup`)
  from 0.1.5 to 2.1.0, closing four Dependabot alerts against `rmcp`'s Streamable HTTP
  transport: [GHSA-9g45-5xwm-f3wc](https://github.com/advisories/GHSA-9g45-5xwm-f3wc) (missing
  OAuth resource validation), [GHSA-9pj6-vhgr-3mwh](https://github.com/advisories/GHSA-9pj6-vhgr-3mwh)
  (session-table denial-of-service leak), [GHSA-33f5-2c5q-wgwj](https://github.com/advisories/GHSA-33f5-2c5q-wgwj)
  (cross-origin redirect header leak), and [GHSA-89vp-x53w-74fx](https://github.com/advisories/GHSA-89vp-x53w-74fx)
  (DNS rebinding via unvalidated Streamable HTTP requests). `skill-lookup-mcp` only uses `rmcp`'s
  stdio transport, so none of these four issues were reachable through this server's own
  deployment, but the fixed version is required to clear the Dependabot alerts regardless.

### Testing

- Added shakedown test coverage for the `skill-lookup` MCP server's handshake, `find_skills`,
  `get_skill`, and `reload_skills` handlers, plus full-tool-surface coverage, exercising the
  upgraded `rmcp` 2.1.0 integration.

## [1.0.0] - 2026-09-23

### Added

- 8 specialist agents (product manager, architect, developer, QA, researcher, technical program
  manager, browser, media analyzer) plus three orchestrators (`konductor`,
  `konductor-mux-orchestrator`, `konductor-cmux-orchestrator`) that coordinate them across the
  SDLC, delegating work, tracking progress, and enforcing a maker-checker quality gate on every
  handoff.
- 82 skills across 8 capability areas: architecture and design, planning and tracking,
  architecture and development review, testing and QA, orchestration and delegation, Kiro spec
  generation, documentation and writing, and research and security.
- 19 agent-sops, invoked as `/prompts` entries in Kiro CLI and as `/sop-<name>` skills in Claude
  Code, covering design doc creation, code review, E2E test
  generation, and a full end-to-end SDLC pass (`k-full-sdlc`).
- Persistent memory: a local, cross-session scratchpad under `.konductor/memory/` that needs no
  setup, with a validator enforcing size limits and an optional URL allowlist.
- Multi-runtime support for Kiro CLI v2, Kiro CLI v3, Kiro IDE, and Claude Code.
- The `konductor` CLI with `install`, `update`, `uninstall`, `synth`, `init`, and `doctor`  
  subcommands.
- A `skill-lookup` MCP server that works with Kiro CLI v2, Kiro CLI v3, and Kiro IDE.