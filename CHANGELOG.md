# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [0.1.0] - 2026-09-16

### Added

- `VERSION` file at the repo root; `release.yml` treats it as the authoritative release version.
- `release.yml`: publishes a GitHub Release on every merge to `main`, building `konductor` and
  `skill-lookup-mcp` natively for both `x86_64` and `aarch64` under distinct, collision-free asset
  names, with idempotency checks that republish automatically on any asset name or content mismatch.
- `validate-pr.yml`: requires a `CHANGELOG.md` entry alongside any `VERSION` bump.
