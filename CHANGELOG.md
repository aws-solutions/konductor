# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

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