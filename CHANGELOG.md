# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [Unreleased]

### Added

- A Claude Code plugin marketplace install path, alongside the existing `konductor` CLI
  install: `/plugin marketplace add aws-solutions/konductor` then `/plugin install
  konductor@konductor`. See [Install via the Claude Code plugin
  marketplace](docs/user-guide/tasks/install-claude-plugin-marketplace.md).
- `.github/workflows/release.yml`'s `publish-claude-plugin` job now tags each release's
  `claude-plugin` branch commit with an immutable `claude-plugin-vX.Y.Z` tag, so a
  `marketplace.json` plugin entry can pin `ref` to a specific permanent release instead of
  the branch's own moving HEAD. The job fails closed if the tag already exists rather than
  moving it, and skips tagging entirely under a dry-run dispatch. See
  [`generated/claude-plugin/README.md`](generated/claude-plugin/README.md)'s "Rollback"
  section for the runbook.

### Changed

- `make synth` (and `konductor synth` run through the root `Makefile`) now passes
  `--claude-bundled-mcp-servers`, pre-wiring AWS MCP (`aws-mcp`) into `dist/claude/agents/*.md`
  for the standalone Claude Code install, matching the Claude Code plugin build. Everything
  else, including Playwright (`playwright-mcp`), stays bring-your-own on every harness. The
  bundled-server list lives in `scripts/claude-plugin-mcp-servers.json`; run `konductor synth`
  directly (without the flag, or via `konductor install --harness claude` against
  already-synthed output) to opt out and get bare tool grants with no server pre-wired.
- The plugin and standalone Claude Code builds now launch `aws-mcp` with the [Agent Toolkit
  for AWS](https://github.com/aws/agent-toolkit-for-aws)'s own recommended command --
  `uvx mcp-proxy-for-aws-cli@latest https://aws-mcp.us-east-1.api.aws/mcp --metadata
  AWS_REGION=us-east-1` -- sourced from `scripts/claude-plugin-mcp-servers.json`'s own
  `"bundled"` object via new `--bundled-mcp-config` (`render-claude-plugin-json.py`) and
  `--claude-bundled-mcp-config` (`konductor synth`) flags. This OVERRIDES whatever
  `agents/k-architect.agent-spec.json`/`agents/k-developer.agent-spec.json`'s own
  `dependencies.mcpRegistry.aws-mcp` entry says (still the loosely-pinned
  `mcp-proxy-for-aws@latest`, unchanged) for the two rendered install shapes only -- the agent
  specs themselves are untouched. `mcp-proxy-for-aws-cli` is the toolkit's thin,
  version-pinned CLI distribution: every transitive dependency locked to tested versions, so
  `@latest` still gets a frozen, tested set rather than an unvetted newer release. The server
  key stays `aws-mcp` (matching AWS's own getting-started docs, its OAuth-direct-connect
  command examples, and every existing user config and internal agent already using that name
  -- the toolkit repo's own README example uses the key `aws` instead for the same server, but
  Konductor keeps `aws-mcp` for that continuity). One residual trade-off: the server auto-starts
  as soon as the plugin (or standalone install) is enabled, launching whatever
  `mcp-proxy-for-aws-cli@latest` resolves to at synth time.

### Security

- `k-architect`/`k-developer` continue to grant the AWS MCP Server's entire tool surface --
  all eight tools, including the three AWS-API-acting ones (`aws___run_script`,
  `aws___get_presigned_url`, `aws___get_tasks`), unchanged from before. On Kiro CLI the five
  knowledge/documentation tools stay auto-approved via the existing `allowedTools` entries; the
  three API-acting tools still prompt for confirmation on each call, same as before. Use the
  `aws:ViaAWSMCPService`/`aws:CalledViaAWSMCP` IAM condition keys to scope or audit what an
  agent-originated call can do through the server under your own credentials; see
  [Understanding IAM for managed AWS MCP
  servers](https://aws.amazon.com/blogs/security/understanding-iam-for-managed-aws-mcp-servers/).

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