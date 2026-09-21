# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [0.1.1] - 2026-09-18

### Added

- Kiro CLI install now emits each SOP as a Kiro-discoverable skill
  (`.kiro/skills/sop-<name>/SKILL.md`), for both the Kiro CLI v2 and v3 (KAS)
  install paths.
- An advisory guard now accompanies each installed SOP's Claude Code
  description, noting the SOP is intended for direct Kiro invocation.

### Fixed

- `install/mcp_server.rs` now carries its required SPDX license header.
- Path-safety name-segment validation is consolidated into a single
  `reject_unsafe_name_segment` check, used consistently across the synth
  and install paths.

## [0.1.0] - 2026-09-16

### Added

- `VERSION` file at the repo root; `release.yml` treats it as the authoritative release version.
- `release.yml`: publishes a GitHub Release on every merge to `main`, building `konductor` and
  `skill-lookup-mcp` natively for both `x86_64` and `aarch64` under distinct, collision-free asset
  names, with idempotency checks that republish automatically on any asset name or content mismatch.
- `validate-pr.yml`: requires a `CHANGELOG.md` entry alongside any `VERSION` bump.
