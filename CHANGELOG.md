# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [Unreleased]

### Added

- `aws-mcp-usage` skill: confirmation rules for AWS MCP tools that act on an account, and which
  AWS guidance to load for common development tasks. Extracted from the removed architect and
  developer agent prompts.
- The `verification` skill now names the checker for each kind of artifact and when to run
  `design-impact-review`. Extracted from the removed architect, developer and product manager
  agent prompts.
- Research note `docs/research/2026-09-26-orchestration-skills-and-sops.md` on which skills and
  SOPs only route work to subagents.

### Changed

- `konductor install --harness kiro-cli-v2|kiro-v3` installs skills under `.kiro/skills/`
  instead of `.konductor/skills/` when the synthesized output contains no agents, so a plain
  Kiro CLI session discovers them. Output that contains agents is unchanged. A skill named like
  a SOP's `sop-<name>` conversion is refused in that layout.
- fuse-flow also looks for skills in `.kiro/skills/` and `~/.kiro/skills/`, before
  `.konductor/skills/`, so a copy an older install left there does not shadow the current one.
- The `persistent-memory` and `legacy-to-agentic-estimate` script lookups also try
  `.kiro/skills/` and `.claude/skills/`, in the project and in `$HOME`.
- `konductor install` and `konductor update` now remove files the previous install of the same
  harness wrote that the new source no longer contains, such as a removed agent or skill, or a
  skill that moved to a different directory. Only files that are unchanged since that install,
  were created or replaced by it, and are not named by any current manifest entry are removed;
  edited and foreign files stay.

### Upgrading

Installing this version over an earlier one removes the old agents, the routing context and the
removed skills automatically, as described above. Files you edited after the earlier install are
kept, untracked; delete them by hand if you no longer want them.

### Removed

- All 11 agent specs in `agents/`, including the three orchestrators.
- The routing and dispatch layer that only served them: the `delegation-protocol`,
  `claude-teams-behavior`, `mux-dispatch` and `cmux-dispatch` skills, the `k-delegate` SOP, and
  `context/k-orchestrator-routing-rules.md`, with the dispatch scripts' tests.
- The agent benchmark harness (`scripts/benchmark.js`, `scripts/run-claude-subset.js`,
  `scripts/generate-agent-files.js`, `tests/judges/`, the benchmark datasets and registry, and
  `docs/guides/benchmarking.md`) and the agent-spec regression test.

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