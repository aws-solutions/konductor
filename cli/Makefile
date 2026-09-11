# SPDX-License-Identifier: Apache-2.0
#
# Build for the Konductor CLI (Rust). Works standalone for any developer
# or OSS consumer with Rust (cargo) installed. No Brazil, no Amazon
# tooling required.
#
# ── Targets ───────────────────────────────────────────────────────────────────
#   build           Compile Rust binary (cargo build --release) and stage it at
#                   build/cli/konductor (relative to the package root) for Brazil
#                   packaging -- see the `build` target's own comment for why.
#   fmt             Auto-format: cargo fmt
#   lint            Check formatting/linting: clippy + cargo fmt --check
#   install         Install Rust binary to ~/.cargo/bin
#   link            Symlink the built Rust binary into ~/.local/bin/konductor
#                   (the PATH setup this project's README recommends; does not touch
#                   ~/.cargo/bin and works inside a Brazil workspace, unlike `install`)
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

CARGO    ?= cargo
PYTHON   ?= python3
JQ       ?= jq

RUST_DIR := konductor-rs

# `RUST_BIN` cannot be a hardcoded `$(RUST_DIR)/target/release/konductor`
# guess: cargo's actual output directory is redirected by ANY `[build]
# target-dir` override in a `.cargo/config.toml` (Amazon's CargoBrazil
# tooling generates exactly such a file, at
# `build/private/cargo-home/config.toml`, redirecting to
# `build/private/cargo-target` -- present in every CargoBrazil-managed
# build, dev desktop and pkgbuild sandbox alike) or a `CARGO_TARGET_DIR`
# env var, and a hardcoded guess silently diverges from wherever `cargo
# build --release` actually placed the binary the moment either applies.
# `cargo metadata`'s `target_directory` field is cargo's own answer to
# "where will you actually put build output", so querying it here keeps
# this Makefile correct under the default layout, a config.toml
# override, and a `CARGO_TARGET_DIR` override alike -- in any
# environment -- with zero guessing. Falls back to the historical
# `$(RUST_DIR)/target` default if the query itself fails (e.g. `cargo`
# missing or unparseable output), so a broken toolchain fails at `build`
# with a clear cargo error rather than this computation failing silently.
#
# `target_directory` is extracted with `grep`/`cut`, not
# `$(PYTHON) -c '...json.load...'` (an earlier revision of this file did
# use python -- see CR-302539291 r5/r6). On the real pkgbuild-const
# build fleet (Dry Run Build, build.amazon.com/8015129743) the python
# pipeline produced empty output and silently hit the hardcoded fallback
# below on AL2_x86_64 and AL2_aarch64 specifically, while the identical
# commit succeeded on AL2023_x86_64/AL2023_aarch64 in the same build.
# That AL2-only split is not a `CARGO_TARGET_DIR`/config-vs-environment
# mismatch: the plain `cargo build --release` two lines below it in this
# same recipe -- which touches no python at all -- correctly reused the
# CargoBrazil-redirected target dir on all 4 platforms in that build
# (confirmed by its 0.07s cache-hit landing under
# `build/private/cargo-target/release`, matching the linker paths this
# package's other Rust build steps used in the same log). The signature
# instead matches `python3` simply not being on `$PATH` in the AL2 image:
# AL2's default userland ships Python 2 and treats `python3` as an
# optional add-on, where AL2023 ships `python3` standard. `cargo
# metadata`'s output is one compact line of JSON, and Linux build paths
# never contain a literal `"`, so a `grep -o`/`cut` pair extracts
# `target_directory` with the same semantics as the python one-liner
# using only POSIX tools guaranteed present wherever `make`/`sh`
# themselves run -- removing the AL2-specific gap entirely instead of
# requiring `python3` on every platform this Makefile might build on.
#
# The `cargo metadata` call itself only runs for goals that actually
# consume `$(RUST_BIN)` (directly, or transitively through a
# prerequisite). `help`, `fmt`, `lint`, `install`, and `clean` have no
# use for a resolved binary path, so they never pay its latency or its
# implicit `cargo`-on-`$PATH` dependency; a bare `make` with no goal at
# all falls back to the default target (`all` -> `build`), which does
# need it.
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

RUST_BIN := $(CARGO_TARGET_DIR)/release/konductor
LOCAL_BIN_DIR := $(HOME)/.local/bin

# Published build-artifact location, relative to this Makefile's own directory
# (cli/), i.e. <package root>/build/cli/konductor. This is NOT the same path as
# RUST_BIN above: RUST_BIN assumes cargo's default target-dir
# ($(RUST_DIR)/target), which holds for a plain standalone `cargo build`, but
# under the Brazil build (build-tools/bin/aim-and-make-build) CargoBrazil
# redirects cargo's target-dir to build/private/cargo-target via a generated
# CARGO_HOME/config.toml -- so the real compiled binary does not live at
# RUST_BIN in that case. STAGE_BIN is populated by the `build` target below by
# asking cargo itself (via `cargo metadata`) where it actually put the binary,
# which is correct in both the standalone and the Brazil-wrapped case.
#
# This exact path is what downstream deployment tooling resolves against for
# this package's published build artifacts.
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
# Compiles the release binary, then stages a copy at STAGE_BIN
# (../build/cli/konductor, relative to this Makefile). The staging copy is
# required for Brazil packaging: Brazil publishes a package's build/
# directory (except build/private/) as that package's build artifacts, and
# BrazilPathArtifacts.fromPackage in the CDK release pipeline reads the
# compiled binary from exactly that published location -- see the STAGE_DIR
# comment above. The actual cargo output directory is resolved via `cargo
# metadata` rather than assumed to be $(RUST_DIR)/target, because it is not:
# under the Brazil build wrapper (aim-and-make-build) CargoBrazil redirects
# it to build/private/cargo-target via CARGO_HOME/config.toml, whereas a
# plain standalone `cargo build` uses $(RUST_DIR)/target. Querying cargo
# directly keeps this correct in both cases without hardcoding either path.
#
# `cargo metadata`'s default JSON output is a single line, so the
# target_directory field is extracted with jq when available and with a
# grep/sed field extraction otherwise -- not with $(PYTHON), since python3
# is not guaranteed present on every build image (e.g. some Brazil build
# images only ship a versioned python3.N, or no python3 at all).
#
# Fails immediately, with the resolved paths and a reproduction command,
# if RUST_BIN doesn't exist right after building -- rather than leaving
# `check-skill-scope`/`link`/`test-schema-dump` to hit that missing
# binary later as an opaque "No such file or directory" from `/bin/sh`
# with no indication of WHY CARGO_TARGET_DIR resolved to the wrong place
# (the failure mode this fixes; see CARGO_TARGET_DIR's own comment
# above for the concrete instance of it observed in the real build
# fleet).
build:
	@echo "=== [konductor] Building Rust binary (release) ==="
	cd $(RUST_DIR) && $(CARGO) build --release
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
	cp "$$cargo_target_dir/release/konductor" "$(STAGE_BIN)"
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
# Symlink the already-built Rust binary into ~/.local/bin/konductor. This is the
# PATH setup this project's README recommends for local dev — separate from
# `install` (cargo install --path .), which writes to ~/.cargo/bin and does not
# work inside a Brazil workspace (Brazil blocks `cargo install`).
# Requires `build` to have run first; does not build automatically so `make link`
# never silently triggers a full rebuild.
#
# Verifies the symlink itself resolves to an executable after creating it, the
# same post-condition idiom `build` uses above for RUST_BIN — `ln -sf` exits 0
# even if its target later disappears or the resulting link is broken (e.g.
# LOCAL_BIN_DIR is on a filesystem that silently rejects symlinks), so without
# this check a caller relying on `make link`'s exit code alone could see
# success while `$(LOCAL_BIN_DIR)/konductor` doesn't actually resolve, and only
# discover that later as a confusing "command not found" instead of a clear
# diagnostic here.
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
# Hard-fails THIS package's OWN build when its OWN agents/*.agent-spec.json
# violate the skill-scope consistency rule: every `clientConfig.kiroCli.
# resources` `skill://` entry must name a skill also present in that
# agent's `dependencies.skills.skillNames`.
#
# `check_skill_scope_consistency` (synth/parse_canonical.rs) only ever WARNS,
# via `eprintln!("konductor: warning: ...")` -- deliberately, and that stays
# unconditional for every caller. `parse_canonical` runs against whatever
# source tree an external `synth`/`install --from`/`doctor` invocation points
# it at (this crate is the public-base CLI other teams point at their own
# spec trees), so promoting that check to a hard `ParseError` there would
# break any external consumer with legitimate resources/skillNames drift,
# with no deprecation window (see CR-302539291 review thread r4p5/r4p6).
#
# This target adds CI-side enforcement ONLY for this package's own tree, with
# ZERO change to the shared library function or its behavior for any other
# caller: it runs the already-built binary's `doctor` command (read-only --
# unlike `synth`, it writes no `dist/` output) against this package's own
# root, points `--target` AND `HOME` at throwaway empty scratch directories
# (`--target` alone is not enough -- doctor's `config` check resolves the
# user-config tier via the real `$HOME` unconditionally, ignoring `--target`,
# so a malformed personal `~/.konductor/config.yml` on the host running this
# would otherwise fail this gate for a reason unrelated to skill-scope; same
# isolation pattern `test-schema-dump` above already uses for the same
# reason), so the result never depends on ambient `$HOME` state (and nothing
# is written back into this package's tree), and fails if the captured
# output contains the warning's fixed "konductor: warning: " prefix.
# `doctor`'s own report (`print_report`) is written via `println!`, i.e. to
# STDOUT, not stderr -- so stdout and stderr are captured together into one
# stream; capturing stderr alone would silently discard the actual
# diagnostic text on any real check failure (as opposed to a crash/bad
# invocation, which does still produce stderr text), leaving only the bare
# "doctor exited N" with no indication of what broke. `doctor`'s own exit
# code IS still checked, but only to catch the command failing to run at all
# (crash, bad `--from`/`--target`, unreadable tree) -- that path produces no
# skill-scope warning either, so without this check it would silently
# PASS the gate. For a normal `ok`/`info`/`warn` run, `doctor` exits 0
# regardless of this specific warning (`check_skill_scope_consistency`'s
# eprintln is independent of doctor's own CheckStatus/exit-code machinery),
# so the warning-grep remains the actual pass/fail signal in that case.
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
# to run when rust-toolchain.toml (CargoBrazil-generated, gitignored) still
# points at a `bb clean`-deleted build/private/cargo-brazil-toolchain path,
# which would otherwise make `cargo clean` itself fail before doing anything.
clean:
	@echo "=== [konductor] Cleaning Rust build artifacts ==="
	@toolchain=$$(sed -n 's/^path = "\(.*\)"/\1/p' $(RUST_DIR)/rust-toolchain.toml 2>/dev/null); \
	if [ -n "$$toolchain" ] && [ ! -d "$$toolchain/bin" ]; then \
	  echo "  CargoBrazil toolchain absent ($$toolchain) -- removing target/ directly"; \
	  rm -rf $(RUST_DIR)/target; \
	else \
	  cd $(RUST_DIR) && $(CARGO) clean; \
	fi
	@rm -f $(RUST_DIR)/rust-toolchain.toml
	@rm -rf $(STAGE_DIR)
	@echo "=== [konductor] Clean complete ==="
