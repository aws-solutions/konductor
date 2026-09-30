# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [1.0.3] - 2026-09-28

### Fixed

- Kiro CLI installs (v2 and v3/KAS) had no telemetry hook wiring at all, so `agent_invocation`
  events never fired for either runtime — only Claude Code's install path had this. `konductor
  install` now wires a session-start hook: for v2, one entry per installed agent under that
  agent's own `hooks.agentSpawn`; for v3, a single standalone `.kiro/hooks/konductor-telemetry-hooks.json`
  file for the whole install target. Gated on `!no_telemetry`, and degrades to a non-fatal
  warning (instead of failing the install) when the running binary's own path can't be resolved.
  A `--no-telemetry` install or update removes a hook a prior telemetry-enabled run wrote (the v3
  file, or the v2 `agentSpawn` entry), and `uninstall` removes it too.
- A standalone Claude-Code-only install (`ClaudeInstallStrategy`, no pre-existing Kiro CLI
  marker) never wired the `SessionStart`/`SubagentStart` telemetry hooks into
  `.claude/settings.json`, unlike the Kiro CLI v2/v3 dual-marker install paths. `konductor
  install --harness claude` now wires those hooks too, gated on the same `!no_telemetry`
  convention the Kiro CLI paths already use.
- A global install in `$HOME` and a project install each wired their own telemetry hook, and
  Kiro v3 and Claude Code load both, so one invocation was reported twice. Each hook now carries
  the install that wrote it, and only the nearest install that owns the agent reports. A project
  install warns when the global install's hooks are from an older version, since those still
  double-count until the global install is updated.
- `konductor install --no-telemetry` over a target that was installed with telemetry on left the
  opt-in record (`.konductor/install-info.json`) in place, so that target kept reporting. It is
  now removed.

### Changed

- Agent telemetry now reports only Konductor agents (the orchestrators and `k-*` specialists),
  on Kiro CLI v2, v3, and Claude Code. The hook resolves the agent from what each harness sends
  and drops anything not in the install manifest, so a user's own agents, built-in sub-agents,
  and sessions with no named agent no longer produce events. Kiro v3 now reports delegations
  too. `subagent_invocation` events carry a new `parentAgentName` field when the delegating agent
  is a Konductor agent.
- The hook now finds its install from the nearest project install up the session's directory
  tree, falling back to the global install in `$HOME`. Before, it only looked in the session's
  own working directory, so a default `$HOME` install sent nothing from sessions started in a
  project directory.

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