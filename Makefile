# SPDX-License-Identifier: Apache-2.0
#
# Aggregates the cli/ and mcp/ Makefiles into one root-level build entry
# point. Every target here delegates to the same-named target in cli/ and/or
# mcp/ via `$(MAKE) -C <dir> <target>` -- no build logic is duplicated here.
# Works standalone for any developer or OSS consumer with cargo and make
# installed. No internal build tooling required.
#
# ── Targets ───────────────────────────────────────────────────────────────────
#   build             Compile cli/ and mcp/ (cargo build --release, both)
#   fmt               Auto-format: cargo fmt in cli/ and mcp/
#   lint              Check formatting/linting: clippy + cargo fmt --check, both
#   install           Install all binaries (cli + mcp servers) to ~/.cargo/bin
#   link              Symlink the built cli binary into ~/.local/bin/konductor
#                     (cli/ only -- mcp/ has no equivalent target)
#   synth             Build the konductor CLI (cli/ only -- mcp/ is not part of
#                     what gets synthesized) and run `konductor synth` against
#                     this package's own source tree, producing per-harness
#                     output under dist/. Used by the GitHub Actions release
#                     workflow (.github/workflows/release.yml).
#   test-rust         Run Rust unit tests (cargo test) in cli/ and mcp/
#   test-schema-dump  Smoke-check __dump_schema produces valid JSON
#                     (cli/ only -- mcp/ has no equivalent target)
#   test              Run the full test target in cli/ and mcp/ (each
#                     subdirectory's own test target preserves its internal
#                     dependency ordering, e.g. cli's test-schema-dump depends
#                     on cli's build)
#   clean             Remove build artifacts in cli/ and mcp/
#   help              Show this usage summary

.PHONY: all build fmt lint install link synth test test-rust test-schema-dump clean help

all: build

# ── help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Konductor (root) — Makefile targets"
	@echo ""
	@echo "  make build              Compile cli/ and mcp/ (release)"
	@echo "  make lint               Rust lint (clippy + cargo fmt --check), both"
	@echo "  make fmt                Rust fmt, both"
	@echo "  make install            Install cli + mcp binaries to ~/.cargo/bin"
	@echo "  make link               Symlink cli binary into ~/.local/bin (cli only)"
	@echo "  make synth              Build the konductor CLI and run 'konductor synth',"
	@echo "                          producing per-harness output under dist/ (cli only)"
	@echo "  make test               Run test in cli/ and mcp/"
	@echo "  make test-rust          Run Rust unit tests, both (no internet required)"
	@echo "  make test-schema-dump   Smoke-check __dump_schema (cli only)"
	@echo "  make clean              Remove build artifacts in cli/ and mcp/"
	@echo ""

# ── build ─────────────────────────────────────────────────────────────────────
build:
	$(MAKE) -C cli build
	$(MAKE) -C mcp build

# ── fmt ───────────────────────────────────────────────────────────────────────
fmt:
	$(MAKE) -C cli fmt
	$(MAKE) -C mcp fmt

# ── lint ──────────────────────────────────────────────────────────────────────
lint:
	$(MAKE) -C cli lint
	$(MAKE) -C mcp lint

# ── install ───────────────────────────────────────────────────────────────────
install:
	$(MAKE) -C cli install
	$(MAKE) -C mcp install

# ── link ──────────────────────────────────────────────────────────────────────
# cli/ only -- mcp/ has no equivalent target.
link:
	$(MAKE) -C cli link

# ── synth ─────────────────────────────────────────────────────────────────────
# cli/ only -- synth only needs the compiled `konductor` binary; mcp/ is not
# part of what gets synthesized, so this depends on cli's own `build` target
# (not the aggregate root `build` above) so `make synth` never forces an
# unrelated mcp/ rebuild.
#
# `konductor synth` (no `--from`) defaults its source tree to the process's
# current working directory, so this target must be invoked from the
# directory containing this Makefile (the package root) for `dist/` to land
# there rather than wherever `make` happened to be invoked from.
#
# Invokes the staged binary at build/cli/konductor, not the plain cargo
# output path (cli/konductor-rs/target/release/konductor): cli's own `build`
# target always stages a copy there via `cargo metadata`, which resolves the
# real cargo target-dir whether it's the plain standalone location or one
# redirected elsewhere (e.g. by a build wrapper's own persisted
# rust-toolchain.toml override, which persists across invocations once
# anything in this checkout has been built through that wrapper) -- so the
# staged path is the only one guaranteed to exist after `cli build` runs, in
# either case.
KONDUCTOR_BIN := build/cli/konductor

synth:
	$(MAKE) -C cli build
	@test -x "$(KONDUCTOR_BIN)" || { echo "error: $(KONDUCTOR_BIN) not found — run 'make build' first" >&2; exit 1; }
	@echo "=== [konductor] Running konductor synth ==="
	$(KONDUCTOR_BIN) synth
	@echo "=== [konductor] Synth complete -- output in dist/ ==="

# ── test-rust ─────────────────────────────────────────────────────────────────
test-rust:
	$(MAKE) -C cli test-rust
	$(MAKE) -C mcp test-rust

# ── test-schema-dump ──────────────────────────────────────────────────────────
# cli/ only -- mcp/ has no equivalent target.
test-schema-dump:
	$(MAKE) -C cli test-schema-dump

# ── test ──────────────────────────────────────────────────────────────────────
# Delegates to each subdirectory's own `test` target, which already encodes
# that subdirectory's dependency ordering (e.g. cli's test-schema-dump depends
# on cli's build) -- no need to duplicate that ordering here.
test:
	$(MAKE) -C cli test
	$(MAKE) -C mcp test

# ── clean ─────────────────────────────────────────────────────────────────────
clean:
	$(MAKE) -C cli clean
	$(MAKE) -C mcp clean
