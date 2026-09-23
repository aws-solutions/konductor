# SPDX-License-Identifier: Apache-2.0
#
# Build for the Konductor CLI (Rust). Works standalone for any developer
# or OSS consumer with Rust (cargo) installed. No internal build system
# or Amazon tooling required.
#
# ── Targets ───────────────────────────────────────────────────────────────────
#   build           Compile Rust binary (cargo build --release) and stage it at
#                   build/cli/konductor (relative to the package root) for
#                   downstream packaging -- see the `build` target's own
#                   comment for why.
#   fmt             Auto-format: cargo fmt
#   lint            Check formatting/linting: clippy + cargo fmt --check
#   install         Install Rust binary to ~/.cargo/bin
#   link            Symlink the built Rust binary into ~/.local/bin/konductor
#                   (the PATH setup this project's README recommends; does not touch
#                   ~/.cargo/bin)
#   test-rust       Run Rust unit tests (cargo test)
#   test-schema-dump  Cheap smoke check: verifies `__dump_schema` produces
#                   valid JSON on the Rust binary. See cli.rs's __dump_schema
#                   docstring.
#   check-skill-scope  Hard-fails if THIS package's own agents/*.agent-spec.json
#                   violate the skill-scope consistency rule (resources ⊆
#                   skillNames). See the target's own comment below for why
#                   this is a CI-side gate rather than a change to the shared
#                   `check_skill_scope_consistency` library function.
#   test            Thin aggregator: depends on test-rust + test-schema-dump
#   clean           Remove all build artifacts
#   help            Show this usage summary
#
# ── Overridable variables ─────────────────────────────────────────────────────
#   CARGO    path to cargo   (default: cargo)
#   PYTHON   path to python3 (default: python3)
#   JQ       path to jq      (default: jq; build falls back to grep/sed if absent)
#   TARGET   cargo `--target` triple (default: empty, i.e. cargo's own
#            unqualified host build). When set (e.g. `make build
#            TARGET=x86_64-unknown-linux-musl`), passed straight through to
#            `cargo build --target $(TARGET)`, and RUST_BIN below points at
#            cargo's per-target output path instead of the untargeted one --
#            cargo nests output under a $(TARGET)/ subdirectory whenever
#            --target is passed explicitly, even if it matches the host's
#            own triple. The target must already be installed (`rustup
#            target add $(TARGET)`), and targets needing a C toolchain
#            (e.g. any *-musl target, via this crate's `ring` dependency)
#            need a matching linker/cc on PATH (e.g. `musl-tools` for
#            *-unknown-linux-musl) -- neither is installed by this Makefile.

CARGO    ?= cargo
PYTHON   ?= python3
JQ       ?= jq
TARGET   ?=

RUST_DIR := konductor-rs

# Passed to every `cargo build`/`cargo metadata` invocation below; empty
# (the default) reproduces the exact untargeted command this Makefile ran
# before TARGET existed.
CARGO_TARGET_FLAG := $(if $(TARGET),--target $(TARGET),)
# cargo nests output one directory deeper, under $(TARGET)/, whenever
# --target is passed explicitly -- even for a target matching the host's
# own triple -- so this suffix must be empty (untargeted) or `$(TARGET)/`
# (targeted), never guessed from whether TARGET "looks like" the host.
CARGO_TARGET_SUBDIR := $(if $(TARGET),$(TARGET)/,)

# `RUST_BIN` can't be a hardcoded `$(RUST_DIR)/target/release/konductor`
# guess: cargo's actual output directory is redirected by any `[build]
# target-dir` override in `.cargo/config.toml` or a `CARGO_TARGET_DIR` env
# var. `cargo metadata`'s `target_directory` field is cargo's own answer to
# where build output lands, so querying it keeps this correct under the
# default layout and either override, with zero guessing. Falls back to
# the historical `$(RUST_DIR)/target` default if the query itself fails
# (e.g. cargo missing), so a broken toolchain fails at `build` with a
# clear cargo error instead of silently.
#
# Extracted with `grep`/`cut` rather than `$(PYTHON) -c '...json.load...'`:
# `python3` isn't guaranteed on PATH everywhere this runs (Amazon Linux 2
# ships Python 2 by default; AL2023 ships python3 standard), and a missing
# python3 would silently produce empty output here for the wrong reason.
# `cargo metadata`'s output is one compact JSON line with no literal `"`
# in Linux build paths, so `grep -o`/`cut` extracts `target_directory`
# using only POSIX tools guaranteed present wherever make/sh run.
#
# The `cargo metadata` call only runs for goals that actually consume
# `$(RUST_BIN)`. `help`, `fmt`, `lint`, `install`, and `clean` don't need a
# resolved binary path, so they skip its latency and its implicit
# cargo-on-PATH dependency.
RUST_BIN_GOALS := build link test-schema-dump check-skill-scope test all
INVOKED_GOALS := $(if $(MAKECMDGOALS),$(MAKECMDGOALS),all)

ifneq (,$(filter $(RUST_BIN_GOALS),$(INVOKED_GOALS)))
CARGO_TARGET_DIR := $(shell cd $(RUST_DIR) && $(CARGO) metadata --format-version=1 --no-deps 2>/dev/null | grep -o '"target_directory":"[^"]*"' | cut -d'"' -f4)
ifeq ($(strip $(CARGO_TARGET_DIR)),)
CARGO_TARGET_DIR := $(abspath $(RUST_DIR)/target)
endif
else
CARGO_TARGET_DIR := $(abspath $(RUST_DIR)/target)
endif

RUST_BIN := $(CARGO_TARGET_DIR)/$(CARGO_TARGET_SUBDIR)release/konductor
LOCAL_BIN_DIR := $(HOME)/.local/bin

# Published build-artifact location, relative to this Makefile's own directory
# (cli/), i.e. <package root>/build/cli/konductor. This is NOT the same path as
# RUST_BIN above: RUST_BIN is CARGO_TARGET_DIR/release/konductor, which varies
# with the cargo target-dir resolution described above -- but downstream
# tooling expects the compiled binary at this fixed, predictable location,
# so `build` below copies RUST_BIN there explicitly.
STAGE_DIR := ../build/cli
STAGE_BIN := $(STAGE_DIR)/konductor

# Package root: this package's own agents/skills/agent-sops/context tree
# lives one directory above cli/ (i.e. at the directory containing Config).
PACKAGE_ROOT := $(abspath ..)

.PHONY: all build fmt lint install link test test-rust test-schema-dump check-skill-scope clean help

all: build

# ── help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Konductor CLI — Makefile targets"
	@echo ""
	@echo "  make build              Compile Rust binary"
	@echo "  make lint               Rust lint (clippy + cargo fmt --check)"
	@echo "  make fmt                Rust fmt"
	@echo "  make install            Install Rust binary to ~/.cargo/bin"
	@echo "  make link               Symlink target/release/konductor into ~/.local/bin"
	@echo "  make test               Run test-rust + test-schema-dump"
	@echo "  make test-rust          Run Rust unit tests (no internet required)"
	@echo "  make test-schema-dump   Smoke-check __dump_schema produces valid JSON"
	@echo "  make check-skill-scope  Hard-fail on this package's own skill-scope drift"
	@echo "  make clean              Remove build artifacts"
	@echo ""

# ── build ─────────────────────────────────────────────────────────────────────
# Compiles the release binary and stages a copy at STAGE_BIN (see STAGE_DIR
# comment above). Resolves the real cargo target directory via `cargo
# metadata` rather than assuming $(RUST_DIR)/target (see RUST_BIN comment
# above), extracting with jq when available and grep/sed otherwise -- same
# python3-availability reasoning as RUST_BIN's own comment.
#
# Fails immediately, with the resolved paths and a repro command, if
# RUST_BIN doesn't exist right after building -- rather than leaving
# `check-skill-scope`/`link`/`test-schema-dump` to hit that missing binary
# later as an opaque shell error with no indication of why CARGO_TARGET_DIR
# resolved wrong.
build:
	@echo "=== [konductor] Building Rust binary (release$(if $(TARGET), --target $(TARGET),)) ==="
	cd $(RUST_DIR) && $(CARGO) build --release $(CARGO_TARGET_FLAG)
	@echo "=== [konductor] Staging binary at $(STAGE_BIN) ==="
	@metadata=$$(cd $(RUST_DIR) && $(CARGO) metadata --no-deps --format-version=1); \
	if command -v $(JQ) >/dev/null 2>&1; then \
		cargo_target_dir=$$(printf '%s' "$$metadata" | $(JQ) -r '.target_directory'); \
	else \
		cargo_target_dir=$$(printf '%s' "$$metadata" \
			| grep -o '"target_directory":"[^"]*"' \
			| sed -e 's/^"target_directory":"//' -e 's/"$$//'); \
	fi; \
	if [ -z "$$cargo_target_dir" ]; then \
		echo "error: could not determine cargo target_directory from 'cargo metadata'" >&2; \
		exit 1; \
	fi; \
	mkdir -p "$(STAGE_DIR)"; \
	cp "$$cargo_target_dir/$(CARGO_TARGET_SUBDIR)release/konductor" "$(STAGE_BIN)"
	@echo "=== [konductor] Build complete ==="
	@test -x "$(RUST_BIN)" || { \
		echo "error: [konductor] built, but no binary found at RUST_BIN=$(RUST_BIN)" >&2; \
		echo "  CARGO_TARGET_DIR resolved to: $(CARGO_TARGET_DIR)" >&2; \
		echo "  This means 'cargo metadata's target_directory (or its fallback)" >&2; \
		echo "  disagreed with where 'cargo build --release' actually placed the" >&2; \
		echo "  binary. Re-run to inspect what cargo metadata reports here:" >&2; \
		echo "    cd $(RUST_DIR) && cargo metadata --format-version=1 --no-deps" >&2; \
		exit 1; \
	}

# ── fmt ───────────────────────────────────────────────────────────────────────
fmt:
	@echo "=== [konductor] Formatting Rust (cargo fmt) ==="
	cd $(RUST_DIR) && $(CARGO) fmt
	@echo "=== [konductor] Format complete ==="

# ── lint ──────────────────────────────────────────────────────────────────────
# cargo clippy -- -D warnings treats all clippy warnings as errors.
lint:
	@echo "=== [konductor] Linting Rust (clippy -D warnings) ==="
	cd $(RUST_DIR) && $(CARGO) clippy -- -D warnings
	@echo "=== [konductor] Checking Rust formatting (cargo fmt --check) ==="
	cd $(RUST_DIR) && $(CARGO) fmt -- --check
	@echo "=== [konductor] Lint passed ==="

# ── install ───────────────────────────────────────────────────────────────────
# Install the Rust binary to ~/.cargo/bin.
install:
	@echo "=== [konductor] Installing Rust binary ==="
	cd $(RUST_DIR) && $(CARGO) install --path .
	@echo "=== [konductor] Install complete ==="

# ── link ──────────────────────────────────────────────────────────────────────
# Symlinks the already-built binary into ~/.local/bin/konductor -- the PATH
# setup this project's README recommends, separate from `install` (which
# writes to ~/.cargo/bin). Requires `build` to have run first; doesn't
# build automatically, so `make link` never triggers a silent rebuild.
#
# Verifies the symlink resolves to an executable after creating it: `ln -sf`
# exits 0 even if the target is broken (e.g. LOCAL_BIN_DIR rejects symlinks),
# so without this check a caller could see success while the link doesn't
# actually resolve, and only find out later as a confusing "command not
# found".
link:
	@test -x "$(RUST_BIN)" || { echo "error: $(RUST_BIN) not found — run 'make build' first" >&2; exit 1; }
	@mkdir -p "$(LOCAL_BIN_DIR)"
	ln -sf "$(abspath $(RUST_BIN))" "$(LOCAL_BIN_DIR)/konductor"
	@test -x "$(LOCAL_BIN_DIR)/konductor" || { \
		echo "error: [konductor] linked, but $(LOCAL_BIN_DIR)/konductor is not executable" >&2; \
		echo "  Symlink target: $(abspath $(RUST_BIN))" >&2; \
		exit 1; \
	}
	@echo "=== [konductor] Linked $(RUST_BIN) -> $(LOCAL_BIN_DIR)/konductor ==="

# ── test-rust ─────────────────────────────────────────────────────────────────
# Run Rust unit tests via cargo test.
# No internet access needed beyond what cargo build already fetched.
# Depends only on the Rust source being present — cargo's own incremental
# compilation decides whether a rebuild is needed before running tests, so we
# do not force a separate make build-rust step here.
test-rust:
	@echo "=== [konductor] Running Rust tests ==="
	cd $(RUST_DIR) && $(CARGO) test
	@echo "=== [konductor] Rust tests passed ==="

# ── test-schema-dump ─────────────────────────────────────────────────────────
# Cheap smoke check: invokes the hidden `__dump_schema` command on the Rust
# binary and verifies its output is valid JSON. This is intentionally a
# MINIMAL check -- its only purpose is to catch a broken __dump_schema
# invocation (e.g. a crash, a malformed print) cheaply and early.
#
# Depends on `build` so the Rust binary exists before the check runs.
test-schema-dump: build
	@echo "=== [konductor] Running __dump_schema smoke check ==="
	HOME=$$(mktemp -d) $(RUST_BIN) __dump_schema | $(PYTHON) -c "import json,sys; json.load(sys.stdin)"
	@echo "=== [konductor] rust __dump_schema produced valid JSON ==="
	@echo "=== [konductor] Schema-dump smoke check passed ==="

# ── check-skill-scope ─────────────────────────────────────────────────────────
# Hard-fails this package's own build when its own agents/*.agent-spec.json
# violate the skill-scope consistency rule: every `clientConfig.kiroCli.
# resources` `skill://` entry must name a skill also present in that agent's
# `dependencies.skills.skillNames`.
#
# `check_skill_scope_consistency` (synth/parse_canonical.rs) only ever warns
# (`eprintln!`), deliberately -- it runs against whatever tree an external
# `synth`/`install --from`/`doctor` invocation points it at, and promoting
# it to a hard error there would break external consumers with legitimate
# drift, with no deprecation window. This target adds CI enforcement for
# this package's own tree only, with no change to that shared function: it
# runs the built binary's `doctor` (read-only) against this package's root,
# and fails if the output contains the warning's `konductor: warning: `
# prefix.
#
# Points both `--target` and `HOME` at scratch directories: `--target`
# alone isn't enough, since doctor's `config` check resolves the
# user-config tier via the real `$HOME` regardless, and a malformed
# personal `~/.konductor/config.yml` would otherwise fail this gate for an
# unrelated reason (same isolation `test-schema-dump` uses above).
#
# Captures stdout+stderr together: `doctor`'s report goes to stdout, so
# capturing stderr alone would discard the actual diagnostic on a real
# failure. The exit code is checked separately, only to catch `doctor`
# failing to run at all (crash, bad path) -- that failure mode produces no
# skill-scope warning, so without this check it would silently pass.
#
# Depends on `build` so the binary exists before the check runs.
check-skill-scope: build
	@echo "=== [konductor] Checking skill-scope consistency (this package's own tree) ==="
	@target_scratch=$$(mktemp -d); \
	home_scratch=$$(mktemp -d); \
	combined_out=$$( HOME="$$home_scratch" $(RUST_BIN) doctor --from "$(PACKAGE_ROOT)" --target "$$target_scratch" 2>&1 ); \
	doctor_status=$$?; \
	rm -rf "$$target_scratch" "$$home_scratch"; \
	if [ "$$doctor_status" -ne 0 ]; then \
		printf '%s\n' "$$combined_out" >&2; \
		echo "=== [konductor] FAILED: doctor exited $$doctor_status ===" >&2; \
		exit 1; \
	fi; \
	warnings=$$(printf '%s\n' "$$combined_out" | grep '^konductor: warning: ' || true); \
	if [ -n "$$warnings" ]; then \
		printf '%s\n' "$$warnings"; \
		echo "=== [konductor] FAILED: skill-scope consistency warning(s) found in this package's own agents/*.agent-spec.json (resources must be a subset of skillNames) ===" >&2; \
		exit 1; \
	fi
	@echo "=== [konductor] Skill-scope consistency check passed (zero warnings) ==="

# ── test ──────────────────────────────────────────────────────────────────────
# Aggregator: run test-rust and test-schema-dump in sequence.
test: test-rust test-schema-dump
	@echo "=== [konductor] All tests complete ==="

# ── clean ─────────────────────────────────────────────────────────────────────
# Remove all build artifacts. Safe to run at any time -- in particular, safe
# to run when a gitignored rust-toolchain.toml still points at a toolchain
# path that no longer exists, which would otherwise make `cargo clean`
# itself fail before doing anything.
clean:
	@echo "=== [konductor] Cleaning Rust build artifacts ==="
	@toolchain=$$(sed -n 's/^path = "\(.*\)"/\1/p' $(RUST_DIR)/rust-toolchain.toml 2>/dev/null); \
	if [ -n "$$toolchain" ] && [ ! -d "$$toolchain/bin" ]; then \
	  echo "  Toolchain path from rust-toolchain.toml absent ($$toolchain) -- removing target/ directly"; \
	  rm -rf $(RUST_DIR)/target; \
	else \
	  cd $(RUST_DIR) && $(CARGO) clean; \
	fi
	@rm -f $(RUST_DIR)/rust-toolchain.toml
	@rm -rf $(STAGE_DIR)
	@echo "=== [konductor] Clean complete ==="
