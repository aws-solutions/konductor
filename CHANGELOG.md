# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [Unreleased]

### Removed

- `konductor metrics` from the supported command surface: it returns a usage error
  (exit `64`) on direct invocation, the same as an unknown subcommand, unless an
  escape hatch is set. Withheld from the v1 customer-visible surface rather than
  removed.
- `init`'s dead `--preset <solo|team|org>` flag: every invocation wrote the same
  fixed starter config regardless of the flag's value, so it accepted a choice it
  never acted on. Passing `--preset` is now an unrecognized-flag usage error.

### Changed

- `konductor init` is visible and ungated again, reversing an earlier decision in
  this same unreleased window to hide it. It is the only command that scaffolds
  `.konductor/config.yml`, and `.konductor/config.yml` has a genuine runtime
  consumer (`telemetry/report.rs` reads `telemetry.enabled`/`telemetry.endpoint`
  independently of the hidden `config` command) -- hiding `init` left no supported
  way to ever create the file. Its documentation now frames it as optional ("not
  necessary, only provides some configuration options") rather than a required
  setup step.
- `cli/gate-config/config.yml` (the preset `init` scaffolds and `config`'s loader
  merges a project's own file against) is trimmed to the two fields with a real
  runtime consumer today: `version` and `telemetry.enabled`. `severities_source`,
  `tiers_source`, `tier`, `default_severity`, and `fail_on_severity_at_or_above`
  are no longer shipped in the preset -- they still load correctly from an
  existing project config that sets them (the `Config`/`RawConfig` schema is
  unchanged), and now fall back to a built-in default when absent everywhere,
  rather than the preset file. `telemetry.endpoint` is deliberately not shipped
  in the preset even as an empty string: the config-driven endpoint path does not
  treat an empty string the same as an absent key the way the environment-variable
  override path does.
- `konductor doctor`'s `config` check no longer runs live: nothing in the CLI acts on
  `.konductor/config.yml`'s resolved values for a real decision, so the check was
  decorative. It stays implemented and unit-tested, dormant until something consumes
  those values. `doctor` now runs 8 checks instead of 9.

### Fixed

- `konductor doctor`'s config-load-failure remediation no longer recommends
  `konductor config list` -- that command is hidden and would fail with a usage
  error for an ordinary user. It now points to the schema in the CLI reference and
  hand-editing the file instead.
- `cli/README.md`'s `--all` section no longer says "all six checks above" -- the check
  count moved to 8 in an earlier change and this line was never updated.
- `reference.md`'s `update` flag table now documents `--cli`, `--version <v>`, and
  `--force`, which were missing since the v1.0.0 flag reference was first written.
- `install` command's `--from` flag doc comment no longer claims installing from a
  published release is unavailable -- it now describes the real GitHub-release /
  main-branch-dist fallback chain that exists today.

### Documentation

- Restored `konductor init`'s dedicated task page (`docs/user-guide/tasks/initialize-a-project.md`),
  rewritten from scratch with the "optional, here's what it gives you" framing rather
  than the required-setup-step framing the earlier, deleted version used. Restored
  `init` to `cli/README.md`'s command table and status callout, `skills/about-konductor/SKILL.md`'s
  command table, `docs/user-guide/reference.md`'s command table and configuration-file
  section, and `concepts.md`/`glossary.md`'s command lists. `metrics` stays withdrawn
  from all of these; `config` is untouched.
- Removed all teaching references to `metrics` from the user guide, consistent with it
  being withdrawn from the documented command surface. Every remediation step that used
  to recommend running `init` now correctly describes it again, since `init` is no
  longer withdrawn.
- Corrected `cli/README.md`'s command table, status callout, and "Current state"
  section to reflect the above.

## [1.0.3] - 2026-10-01

### Fixed

- Telemetry now works on Kiro CLI v2 and v3. Before, only Claude Code sent agent usage events.
- `konductor install --harness claude` now sets up telemetry, so Claude-Code-only installs
  report too.
- Each agent run is counted once, even with both a global install (in `$HOME`) and a project
  install. Before, Kiro v3 and Claude Code counted it twice. If your global install is from an
  older version, `konductor install` warns you to run `konductor update --target ~`.
- `--no-telemetry` now turns telemetry off for a project completely: also when the project was
  installed with telemetry on before, and when a global install is present.
- `konductor uninstall` now removes Konductor's Claude Code telemetry hooks. Before, they stayed
  in `.claude/settings.json`.
- Sessions started in a project directory now report when Konductor is installed globally, the
  default. Before, they sent nothing.

### Changed

- A project install now writes its Claude Code telemetry hooks to `.claude/settings.local.json`
  instead of the shared `.claude/settings.json`, and moves any hooks an earlier version put there.
  The hooks carry this machine's paths, so they no longer get committed for teammates. If the
  repository doesn't already ignore the file, it is added to `.git/info/exclude`. A global install
  keeps its hooks in `~/.claude/settings.json`.
- Telemetry now covers only Konductor's own agents (the orchestrators and `k-*` specialists). Your
  own agents, a harness's built-in agents, and sessions with no named agent send nothing.
- Delegations to Konductor agents are reported on every harness, including the name of the
  delegating Konductor agent when the harness provides it.

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