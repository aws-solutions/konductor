# SPDX-License-Identifier: Apache-2.0
#
# Aggregates the cli/, mcp/, and shared/ Makefiles into one root-level build
# entry point. Every target here delegates to the same-named target in
# cli/, mcp/, and/or shared/ via `$(MAKE) -C <dir> <target>` -- no build
# logic is duplicated here. Works standalone for any developer or OSS
# consumer with cargo and make installed. No internal build tooling
# required.
#
# ── Targets ───────────────────────────────────────────────────────────────────
#   build             Compile cli/ and mcp/ (cargo build --release, both;
#                     shared/ has no binaries, so it has no build target)
#   fmt               Auto-format: cargo fmt in cli/, mcp/, and shared/
#   lint              Check formatting/linting: clippy + cargo fmt --check,
#                     in cli/, mcp/, and shared/
#   install           Install all binaries (cli + mcp servers) to ~/.cargo/bin
#   link              Symlink the built cli binary into ~/.local/bin/konductor
#                     (cli/ only -- mcp/ and shared/ have no equivalent target)
#   synth             Build the konductor CLI (cli/ only -- mcp/ and shared/
#                     are not part of what gets synthesized) and run
#                     `konductor synth` against this package's own source
#                     tree, producing per-harness output under dist/. Used
#                     by the GitHub Actions release workflow
#                     (.github/workflows/release.yml).
#   claude-plugin       Regenerate generated/claude-plugin/{agents,skills}/
#                     from agents/*.agent-spec.json, skills/*/SKILL.md, and
#                     agent-sops/*.sop.md, via `konductor synth` and
#                     `konductor install --harness claude` against a
#                     throwaway scratch HOME/target -- see
#                     generated/claude-plugin/README.md and
#                     scripts/generate-claude-plugin.sh for the full
#                     procedure. Output is gitignored -- see .gitignore --
#                     so this is a local/CI build step, never something to
#                     commit on main. The published plugin is built and
#                     pushed to a candidate branch, then merged into
#                     `release/plugins` via a draft pull request, by
#                     .github/workflows/release.yml's
#                     `publish-claude-plugin` job (scripts/
#                     assemble-claude-plugin-branch.sh), which calls this
#                     target's own script first and renders plugin.json/
#                     .mcp.json at the flat tree's root afterward -- there
#                     is no separate repo-root plugin layout.
#   claude-plugin-check PR-time smoke test: runs the plugin telemetry hook's
#                     node tests, assembles the flat branch tree
#                     (scripts/assemble-claude-plugin-branch.sh, which
#                     calls claude-plugin's own generation first) into a
#                     scratch directory, then validates it (--strict) when
#                     the CLI is on PATH. Not a drift check -- nothing
#                     generated is committed on main to diff against; this
#                     only confirms the pipeline still produces a valid
#                     plugin after a source change.
#   test-rust         Run Rust unit tests (cargo test) in cli/, mcp/, and shared/
#   test-schema-dump  Smoke-check __dump_schema produces valid JSON
#                     (cli/ only -- mcp/ and shared/ have no equivalent target)
#   test              Run the full test target in cli/, mcp/, and shared/ (each
#                     subdirectory's own test target preserves its internal
#                     dependency ordering, e.g. cli's test-schema-dump depends
#                     on cli's build)
#   clean             Remove build artifacts in cli/, mcp/, and shared/
#   help              Show this usage summary
#
#   kiro-power-check  Check VERSION/plugin.json for drift and that every
#                     committed import URL names the matching release tag,
#                     then validate the COMMITTED powers/konductor/ tree in
#                     place: plugin.json against the Agent Plugins v1.0.0
#                     schema, every skill's SKILL.md frontmatter, the
#                     pytest suite pinning those two checkers
#                     (tests/test_validate_kiro_power_*.py), shellcheck
#                     across konductor-setup's scripts/, and the full
#                     tests/kiro-power/ suite (each test's own default
#                     KONDUCTOR_SETUP_SCRIPTS_DIR already resolves to
#                     powers/konductor/skills/konductor-setup/scripts, so no
#                     override is needed here). No commits, no push.

.PHONY: all build fmt lint install link synth claude-plugin claude-plugin-check notice-check \
        test test-rust test-schema-dump test-py test-skills-sh clean help \
        guide guide-check guide-sync guide-html guide-record kiro-power-check

all: build

# ── help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Konductor (root): Makefile targets"
	@echo ""
	@echo "  make build              Compile cli/ and mcp/ (release)"
	@echo "  make lint               Rust lint (clippy + cargo fmt --check), cli/mcp/shared"
	@echo "  make fmt                Rust fmt, cli/mcp/shared"
	@echo "  make install            Install cli + mcp binaries to ~/.cargo/bin"
	@echo "  make link               Symlink cli binary into ~/.local/bin (cli only)"
	@echo "  make synth              Build the konductor CLI and run 'konductor synth',"
	@echo "                          producing per-harness output under dist/ (cli only)"
	@echo "  make claude-plugin      Regenerate generated/claude-plugin/ (gitignored)"
	@echo "  make claude-plugin-check  Regenerate + validate the flat plugin tree (no commits, no push)"
	@echo "  make test               Run test in cli/, mcp/, and shared/"
	@echo "  make test-rust          Run Rust unit tests, cli/mcp/shared (no internet required)"
	@echo "  make test-schema-dump   Smoke-check __dump_schema (cli only)"
	@echo "  make test-py            Run the pytest suite under tests/"
	@echo "  make notice-check       Fail if NOTICE.txt is out of date with the shipped crates"
	@echo "  make test-skills-sh     Run every tests/skills/*/*.sh regression test"
	@echo "  make clean              Remove build artifacts in cli/, mcp/, and shared/"
	@echo ""
	@echo "  Konductor Kiro Power (powers/konductor/, imported by users directly from main)"
	@echo "  make kiro-power-check   Drift check + validate the committed tree in place"
	@echo "                          (schema, skill frontmatter, shellcheck, full test"
	@echo "                          suite) -- no commits, no push"
	@echo ""
	@echo "  User guide (docs/user-guide/ + docs/site/, docs/index.html)"
	@echo "  make guide-check        Report drift between the guide and the source tree"
	@echo "  make guide-sync         Apply retired-name renames to Markdown + HTML"
	@echo "  make guide-html         Apply source-derived content updates to the HTML"
	@echo "  make guide-record       Record the current md+html pair as built"
	@echo "  make guide              sync, html, check, then record"
	@echo ""

# ── build ─────────────────────────────────────────────────────────────────────
build:
	$(MAKE) -C cli build
	$(MAKE) -C mcp build

# ── fmt ───────────────────────────────────────────────────────────────────────
fmt:
	$(MAKE) -C cli fmt
	$(MAKE) -C mcp fmt
	$(MAKE) -C shared fmt

# ── lint ──────────────────────────────────────────────────────────────────────
lint:
	$(MAKE) -C cli lint
	$(MAKE) -C mcp lint
	$(MAKE) -C shared lint

# ── install ───────────────────────────────────────────────────────────────────
install:
	$(MAKE) -C cli install
	$(MAKE) -C mcp install

# ── link ──────────────────────────────────────────────────────────────────────
# cli/ only -- mcp/ has no equivalent target.
link:
	$(MAKE) -C cli link

# ── synth ─────────────────────────────────────────────────────────────────────
# cli/ only -- mcp/ is not part of what gets synthesized. Depends on cli's
# own `build` target (not the aggregate root `build` above) so `make synth`
# never forces an unrelated mcp/ rebuild.
#
# `konductor synth` (no `--from`) defaults its source tree to the current
# working directory, so this target must be invoked from the directory
# containing this Makefile for `dist/` to land in the right place.
#
# Invokes the staged binary at build/cli/konductor, not the plain cargo
# output path: cli's `build` target always stages a copy there via `cargo
# metadata`, so it's the only path guaranteed to exist regardless of
# whether cargo's target-dir has been redirected.
KONDUCTOR_BIN := build/cli/konductor

# TARGET (optional): cargo `--target` triple, forwarded to `cli build` --
# see cli/Makefile's TARGET comment for the full rationale. Passed
# explicitly as `TARGET=$(TARGET)`, not left to sub-make's environment
# inheritance: make does not export a command-line override
# (`make synth TARGET=...`) to child `$(MAKE)` invocations on its own, only
# an actual environment variable (`TARGET=... make synth`) does. This makes
# both invocation styles behave the same.
# --claude-bundled-mcp-servers pre-wires AWS MCP into dist/claude/agents/*.md
# for the STANDALONE Claude Code install too, not just the plugin path --
# see scripts/claude-plugin-mcp-servers.json (the single source of truth
# scripts/read-bundled-mcp-servers.sh reads) and cli/konductor-rs/src/cli.rs's
# own doc comment on this flag. The launch command/args baked into
# dist/claude's frontmatter come straight from the allowlisted agent spec's
# own dependencies.mcpRegistry entry (k-architect/k-developer declare the
# pinned aws-mcp command directly). Everything else (e.g. k-browser's
# playwright-mcp) stays bring-your-own.
synth:
	$(MAKE) -C cli build TARGET=$(TARGET)
	@test -x "$(KONDUCTOR_BIN)" || { echo "error: $(KONDUCTOR_BIN) not found; run 'make build' first" >&2; exit 1; }
	@echo "=== [konductor] Running konductor synth ==="
	$(KONDUCTOR_BIN) synth --claude-bundled-mcp-servers "$$(scripts/read-bundled-mcp-servers.sh)"
	@echo "=== [konductor] Synth complete -- output in dist/ ==="

# ── claude-plugin ───────────────────────────────────────────────────────────
# Builds the CLI and regenerates local plugin output.
claude-plugin:
	$(MAKE) -C cli build TARGET=$(TARGET)
	@test -x "$(KONDUCTOR_BIN)" || { echo "error: $(KONDUCTOR_BIN) not found; run 'make -C cli build' first" >&2; exit 1; }
	KONDUCTOR_BIN=$(KONDUCTOR_BIN) scripts/generate-claude-plugin.sh

# ── claude-plugin-check ──────────────────────────────────────────────────────
# Validates the committed marketplace.json, then assembles and validates the
# flat release plugin layout -- the only generated shape this repo ships
# (see assemble-claude-plugin-branch.sh and claude-plugin's own comment
# above).
claude-plugin-check:
	@echo "=== [claude-plugin-check] Running the plugin telemetry hook tests ==="
	node --test tests/scripts/claude-plugin-telemetry-hook.test.js
	$(MAKE) -C cli build TARGET=$(TARGET)
	@test -x "$(KONDUCTOR_BIN)" || { echo "error: $(KONDUCTOR_BIN) not found; run 'make -C cli build' first" >&2; exit 1; }
	@validated=1; \
	if command -v claude >/dev/null 2>&1; then \
		echo "=== [claude-plugin-check] Validating marketplace.json ==="; \
		claude plugin validate .claude-plugin/marketplace.json --strict || exit 1; \
	else \
		echo "notice: [claude-plugin-check] 'claude' CLI not found on PATH -- skipping validation" >&2; \
		validated=0; \
	fi; \
	scratch=$$(mktemp -d)/claude-plugin-branch; \
	status=0; \
	KONDUCTOR_BIN=$(KONDUCTOR_BIN) scripts/assemble-claude-plugin-branch.sh --out "$$scratch" || status=1; \
	if [ "$$status" -eq 0 ]; then \
		scripts/check-claude-plugin-tree.sh "$$scratch" || status=1; \
	fi; \
	if [ "$$status" -eq 0 ] && command -v claude >/dev/null 2>&1; then \
		echo "=== [claude-plugin-check] Validating flat branch plugin shape ==="; \
		claude plugin validate "$$scratch" --strict || status=1; \
	elif [ "$$status" -eq 0 ]; then \
		echo "notice: [claude-plugin-check] 'claude' CLI not found on PATH -- skipping validation" >&2; \
		validated=0; \
	fi; \
	rm -rf "$$(dirname "$$scratch")"; \
	if [ "$$status" -ne 0 ]; then \
		echo "=== [claude-plugin-check] FAILED: the flat branch plugin tree did not assemble or validate ===" >&2; \
		exit 1; \
	fi; \
	if [ "$$validated" -eq 1 ]; then \
		echo "=== [claude-plugin-check] marketplace.json and the flat plugin tree validated successfully ==="; \
	else \
		echo "notice: [claude-plugin-check] validation skipped: claude CLI not found" >&2; \
	fi

# ── test-rust ─────────────────────────────────────────────────────────────────
test-rust:
	$(MAKE) -C cli test-rust
	$(MAKE) -C mcp test-rust
	$(MAKE) -C shared test-rust

# ── test-schema-dump ──────────────────────────────────────────────────────────
# cli/ only -- mcp/ and shared/ have no equivalent target.
test-schema-dump:
	$(MAKE) -C cli test-schema-dump

# ── notice-check ──────────────────────────────────────────────────────────────
# Regenerates NOTICE.txt and fails if that changed it. Fix with
# `npm run generate-notice` and commit the result.
notice-check:
	node scripts/generate-notice.js
	@git diff --exit-code -- NOTICE.txt || { echo "FATAL: NOTICE.txt is out of date. Run 'npm run generate-notice' and commit the result." >&2; exit 1; }

# ── test-py ───────────────────────────────────────────────────────────────────
# A few tests skip unless build/cli/konductor exists, so run `make synth` or
# `make -C cli build` first to cover them all.
test-py:
	python3 -m pytest -q tests/

# ── test-skills-sh ────────────────────────────────────────────────────────────
# Globbed so new tests are picked up. SKILLS_SH_EXCLUDE lists tests known to
# fail on main; remove an entry once its test passes.
#   persistent-memory/test-nonbullet-injection.sh writes its URL allowlist to
#   .asdlc/memory-config.json, but memory-validator.sh reads
#   .konductor/memory-config.json, so the two disallowed-URL cases pass through.
SKILLS_SH_EXCLUDE := tests/skills/persistent-memory/test-nonbullet-injection.sh
test-skills-sh:
	@failed=""; \
	for f in tests/skills/*/*.sh; do \
		case " $(SKILLS_SH_EXCLUDE) " in *" $$f "*) echo "=== SKIP $$f (SKILLS_SH_EXCLUDE) ==="; continue ;; esac; \
		echo "=== $$f ==="; \
		bash "$$f" || failed="$$failed $$f"; \
	done; \
	if [ -n "$$failed" ]; then echo "FAILED:$$failed" >&2; exit 1; fi

# ── test ──────────────────────────────────────────────────────────────────────
# Delegates to each subdirectory's own `test` target, which already encodes
# that subdirectory's dependency ordering (e.g. cli's test-schema-dump depends
# on cli's build) -- no need to duplicate that ordering here.
test:
	$(MAKE) -C cli test
	$(MAKE) -C mcp test
	$(MAKE) -C shared test

# ── clean ─────────────────────────────────────────────────────────────────────
clean:
	$(MAKE) -C cli clean
	$(MAKE) -C mcp clean
	$(MAKE) -C shared clean

# ── kiro-power-check ──────────────────────────────────────────────────────────
# PR-time smoke test: VERSION/plugin.json drift, import URLs name the
# matching release tag, plugin.json against the Agent Plugins v1.0.0
# schema, every skill's SKILL.md frontmatter, the pytest suite pinning
# those two checkers, shellcheck, and the full tests/kiro-power/ suite.
# No commits, no push -- read-only validation of the tree that ships on main.
#
# The shellcheck step `cd`s into the scripts directory first: `-x`
# resolves a `source "$(dirname ...)/lib.sh"` line relative to the
# current directory, not the checked file's own directory, so a bare
# `./*.sh` glob run from inside it is what makes `-x` actually follow it.
#
# KONDUCTOR_SETUP_SCRIPTS_DIR is left unset: every test-*.sh file's own
# default already resolves to the committed, in-place tree.
#
# KIRO_POWER_SHELLCHECK_VERSION pins what GitHub-hosted ubuntu-latest
# ships: 0.9.0 and a newer ShellCheck (confirmed on 0.11.0) can disagree
# on SC2119/SC2120 for a function whose only parameter has a
# `${1:-default}` fallback and no bare call in the same file -- there is
# no flag that restores the old behavior, so a mismatch only warns here
# rather than being forced.
KIRO_POWER_SHELLCHECK_VERSION := 0.9.0
kiro-power-check:
	@echo "=== [kiro-power-check] Checking VERSION/plugin.json for drift ==="; \
	scripts/check-plugin-json-version-drift.sh || exit 1; \
	echo "=== [kiro-power-check] Checking import URLs name the current release tag ==="; \
	scripts/check-kiro-power-import-url-version.sh || exit 1; \
	echo "=== [kiro-power-check] Validating plugin.json against the Agent Plugins v1.0.0 schema ==="; \
	python3 scripts/validate-kiro-power-plugin-json.py powers/konductor/plugin.json || exit 1; \
	echo "=== [kiro-power-check] Validating skill frontmatter ==="; \
	python3 scripts/validate-kiro-power-skill-frontmatter.py powers/konductor || exit 1; \
	echo "=== [kiro-power-check] Running the plugin.json schema-sync and skill-frontmatter Python tests ==="; \
	python3 -m pytest -q tests/test_validate_kiro_power_plugin_json_schema_sync.py tests/test_validate_kiro_power_skill_frontmatter.py || exit 1; \
	echo "=== [kiro-power-check] Shellchecking konductor-setup's scripts/ and tests/kiro-power/ ==="; \
	shellcheck_skipped=0; \
	if command -v shellcheck >/dev/null 2>&1; then \
		installed_ver="$$(shellcheck --version | awk '/^version:/{print $$2}')"; \
		if [ "$$installed_ver" != "$(KIRO_POWER_SHELLCHECK_VERSION)" ]; then \
			echo "warning: [kiro-power-check] shellcheck $$installed_ver is on PATH; CI runs $(KIRO_POWER_SHELLCHECK_VERSION). A newer ShellCheck has been observed to miss an SC2119/SC2120 case that 0.9.0 still flags -- a function param with a default-value fallback, never otherwise called with an argument in the same file -- so a clean run here is not a guarantee CI will also pass." >&2; \
		fi; \
		(cd powers/konductor/skills/konductor-setup/scripts && shellcheck -x ./*.sh) || exit 1; \
		(cd tests/kiro-power && shellcheck -x ./*.sh) || exit 1; \
	else \
		shellcheck_skipped=1; \
		echo "notice: [kiro-power-check] 'shellcheck' not found on PATH -- skipping" >&2; \
	fi; \
	echo "=== [kiro-power-check] Running tests/kiro-power/ against the committed tree ==="; \
	bash tests/kiro-power/run-all.sh || exit 1; \
	if [ "$$shellcheck_skipped" -eq 1 ]; then \
		echo "=== [kiro-power-check] All checks passed (shellcheck skipped) ==="; \
	else \
		echo "=== [kiro-power-check] All checks passed ==="; \
	fi

# ── user guide ────────────────────────────────────────────────────────────────
# The guide is authored, not compiled, so these keep the FACTS in step with the
# source tree; prose still needs a human or the agent pass in
# tools/build-user-guide/. guide-check is standard-library Python plus `node`,
# which it needs only to parse the published bundle's inline JavaScript, and is
# safe to gate every pull request on.
guide-check:
	python3 tools/user-guide-sync/check-guide-facts.py

guide-sync:
	python3 tools/user-guide-sync/apply-renames.py --apply

guide-html:
	python3 tools/build-user-guide/sync-html-content.py --apply

guide-record:
	bash tools/build-user-guide/build-user-guide.sh --record

# Sequenced in the recipe body, not as prerequisites: the four steps mutate the
# same files in a fixed order, and `make -j` is free to build prerequisites
# concurrently -- which would let guide-record snapshot a half-patched guide.
guide:
	$(MAKE) guide-sync
	$(MAKE) guide-html
	$(MAKE) guide-check
	$(MAKE) guide-record
