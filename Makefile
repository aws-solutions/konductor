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
#   test-rust         Run Rust unit tests (cargo test) in cli/, mcp/, and shared/
#   test-schema-dump  Smoke-check __dump_schema produces valid JSON
#                     (cli/ only -- mcp/ and shared/ have no equivalent target)
#   test              Run the full test target in cli/, mcp/, and shared/ (each
#                     subdirectory's own test target preserves its internal
#                     dependency ordering, e.g. cli's test-schema-dump depends
#                     on cli's build)
#   clean             Remove build artifacts in cli/, mcp/, and shared/
#   help              Show this usage summary

.PHONY: all build fmt lint install link synth test test-rust test-schema-dump clean help \
        guide guide-check guide-sync guide-html guide-record

all: build

# ── help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Konductor (root) — Makefile targets"
	@echo ""
	@echo "  make build              Compile cli/ and mcp/ (release)"
	@echo "  make lint               Rust lint (clippy + cargo fmt --check), cli/mcp/shared"
	@echo "  make fmt                Rust fmt, cli/mcp/shared"
	@echo "  make install            Install cli + mcp binaries to ~/.cargo/bin"
	@echo "  make link               Symlink cli binary into ~/.local/bin (cli only)"
	@echo "  make synth              Build the konductor CLI and run 'konductor synth',"
	@echo "                          producing per-harness output under dist/ (cli only)"
	@echo "  make test               Run test in cli/, mcp/, and shared/"
	@echo "  make test-rust          Run Rust unit tests, cli/mcp/shared (no internet required)"
	@echo "  make test-schema-dump   Smoke-check __dump_schema (cli only)"
	@echo "  make clean              Remove build artifacts in cli/, mcp/, and shared/"
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
synth:
	$(MAKE) -C cli build TARGET=$(TARGET)
	@test -x "$(KONDUCTOR_BIN)" || { echo "error: $(KONDUCTOR_BIN) not found — run 'make build' first" >&2; exit 1; }
	@echo "=== [konductor] Running konductor synth ==="
	$(KONDUCTOR_BIN) synth
	@echo "=== [konductor] Synth complete -- output in dist/ ==="

# ── test-rust ─────────────────────────────────────────────────────────────────
test-rust:
	$(MAKE) -C cli test-rust
	$(MAKE) -C mcp test-rust
	$(MAKE) -C shared test-rust

# ── test-schema-dump ──────────────────────────────────────────────────────────
# cli/ only -- mcp/ and shared/ have no equivalent target.
test-schema-dump:
	$(MAKE) -C cli test-schema-dump

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
