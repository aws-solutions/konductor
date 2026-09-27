## Description

<!--
Use bullet points grouped by category. Each item should state WHAT changed and WHY (rationale).
Avoid prose paragraphs — reviewers scan, not read.

Example format:
**Skills:**
- Added `skills/foo/` — provides X capability needed for Y workflow
- Removed `skills/bar/` — superseded by `skills/baz/`, which covers the same case more simply

**SOPs / Workflows:**
- `k-plan`: added a dependency check step — catches cycles before estimation
- `fuse/flow/workflows/_k-phase-chain.yml`: renamed skill reference `bar` → `baz` — avoids a naming collision

**CLI / Docs / Other:**
- Updated `cli/README.md` — documents the new `--flag` option
- Added `docs/guides/foo-integration.md` — walkthrough for the new opt-in integration
-->

Fixes # (issue)

## Type of Change

<!-- Delete lines that don't apply -->

- New skill
- Modify existing skill
- New or updated agent SOP
- New or updated fuse-flow workflow
- Design document
- Dependency change (`package.json`, `Cargo.toml`, or CLI dependency)
- CLI (`cli/`) change — Rust or Python
- Infrastructure / pipeline
- Documentation
- Other (describe below)

## Testing

- [ ] `npm test` passes (runs `tests/scripts/**/*.test.js`)
- [ ] If `cli/` changed: `cd cli && make test` passes (Rust + Python + conformance suites)
- [ ] If a skill or SOP changed: built and installed via `cli/README.md`'s `synth`/`install`
      steps, then exercised the changed skill or SOP in Kiro CLI or Claude Code
- [ ] If how skills are installed for Kiro changed: `bash tests/integration/kiro-agentless-discovery.sh`
      passes (needs an authenticated `kiro-cli`; not run in CI)
- [ ] New or changed code files carry the required SPDX header (see AGENTS.md's License headers
      rule); formats without comment syntax (e.g. JSON) are exempt

## Checklist

- [ ] My code follows the style guidelines of this project (see AGENTS.md's Code Style & Conventions)
- [ ] I have performed a self-review of my own changes
- [ ] I have commented my code where necessary
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings — build is clean, and for `cli/` changes,
      `cd cli && make lint` passes (`cargo clippy -- -D warnings` + `cargo fmt --check`)
- [ ] I have added or updated tests that prove my change works (see Testing above for the exact commands)

## Skills, SOPs and Workflows Affected

<!-- List the skills, SOPs and workflows whose behavior changes. Delete if not applicable. -->

## Notes for Reviewers

<!-- Anything the reviewer should know: tradeoffs, follow-up work, known limitations. -->
