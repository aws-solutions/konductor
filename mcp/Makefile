# SPDX-License-Identifier: Apache-2.0
#
# Build for the Konductor MCP servers workspace (Rust). Mirrors
# cli/Makefile's target set and conventions. Works standalone for any
# developer with Rust (cargo) installed. No internal build system or
# Amazon tooling required.
#
# All targets invoke cargo at the mcp/ workspace root (this directory),
# not per-server, so adding a new server under servers/<name>/ requires
# NO edit to this file as long as it is added to the `members` list in
# mcp/Cargo.toml. Only the `install` target globs servers/* to discover
# binary names.
#
# ── Targets ───────────────────────────────────────────────────────────────────
#   build           Compile all server binaries (cargo build --release --workspace)
#                   and stage each name in BINARY_NAMES at target/release/<name>
#                   -- see the `build` target's own comment for why.
#   fmt             Auto-format: cargo fmt --all
#   lint            Check formatting/linting: clippy + cargo fmt --check
#   install         Install all server binaries to ~/.cargo/bin
#   test-rust       Run Rust unit tests (cargo test --workspace)
#   test            Thin aggregator: depends on test-rust
#   clean           Remove all build artifacts
#   help            Show this usage summary
#
# ── Overridable variables ─────────────────────────────────────────────────────
#   CARGO    path to cargo   (default: cargo)
#   JQ       path to jq      (default: jq; build falls back to grep/sed if absent)
#   TARGET   cargo `--target` triple (default: empty, i.e. cargo's own
#            unqualified host build). Mirrors cli/Makefile's TARGET
#            variable -- see that Makefile's comment for the full
#            rationale. When set, passed straight through to `cargo build
#            --target $(TARGET)`, and the staging step below reads
#            cargo's per-target output path instead of the untargeted
#            one. The target must already be installed (`rustup target
#            add $(TARGET)`), and targets needing a C toolchain (e.g. any
#            *-musl target, via `ring`'s dependency) need a matching
#            linker/cc on PATH (e.g. `musl-tools` for `musl-gcc`) --
#            neither is installed by this Makefile.

CARGO ?= cargo
JQ    ?= jq
TARGET ?=

# Passed to every `cargo build`/`cargo metadata` invocation below; empty
# (the default) reproduces the exact untargeted command this Makefile ran
# before TARGET existed.
CARGO_TARGET_FLAG := $(if $(TARGET),--target $(TARGET),)
# cargo nests output one directory deeper, under $(TARGET)/, whenever
# --target is passed explicitly -- even for a target matching the host's
# own triple -- so this suffix must be empty (untargeted) or `$(TARGET)/`
# (targeted), never guessed from whether TARGET "looks like" the host.
CARGO_TARGET_SUBDIR := $(if $(TARGET),$(TARGET)/,)

# Binary names `build` stages at target/release/<name> for `konductor
# install`'s discovery (see `mcp_binary_source_path` in
# cli/konductor-rs/src/cli/install/mcp_server.rs). Mirrors
# `MCP_SERVER_BINARY_NAMES` in that same file -- keep both in sync when
# adding a new MCP server binary `konductor install` should discover.
# Unlike `install` above (which globs servers/* and needs no edit for a
# new server), this list matches a specific hardcoded Rust-side lookup
# path, so it does need updating.
BINARY_NAMES := skill-lookup-mcp

.PHONY: all build fmt lint install test test-rust clean help

all: build

# ── help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Konductor MCP servers — Makefile targets"
	@echo ""
	@echo "  make build              Compile all server binaries (release)"
	@echo "  make lint               Rust lint (clippy + cargo fmt --check)"
	@echo "  make fmt                Rust fmt"
	@echo "  make install            Install all server binaries to ~/.cargo/bin"
	@echo "  make test               Run test-rust"
	@echo "  make test-rust          Run Rust unit tests (no internet required)"
	@echo "  make clean              Remove build artifacts"
	@echo ""

# ── build ─────────────────────────────────────────────────────────────────────
# Compiles all workspace binaries, then stages each name in BINARY_NAMES at
# target/release/<name> -- the exact path `mcp_binary_source_path` in
# cli/konductor-rs/src/cli/install/mcp_server.rs hardcodes for `konductor
# install` to find a pre-built server binary. That hardcoded path assumes
# cargo's default target-dir (mcp/target), which doesn't hold under a
# `.cargo/config.toml` or `CARGO_TARGET_DIR` override -- see cli/Makefile's
# CARGO_TARGET_DIR comment. Querying `cargo metadata` for the real
# `target_directory` keeps the binary landing at target/release/<name>
# either way.
#
# Guards against copying a file onto itself: with the default (non-redirected)
# target dir and no TARGET set, source and destination resolve to the same
# path, and `cp` on two identical paths fails. The stage step is a no-op in
# that case. Whenever TARGET is set, source and destination always differ
# (source gains a $(TARGET)/ subdirectory), so the copy always runs.
build:
	@echo "=== [mcp] Building Rust binaries (release$(if $(TARGET), --target $(TARGET),)) ==="
	$(CARGO) build --release --workspace $(CARGO_TARGET_FLAG)
	@echo "=== [mcp] Staging binaries at target/release/ for konductor install discovery ==="
	@metadata=$$($(CARGO) metadata --no-deps --format-version=1); \
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
	mkdir -p target/release; \
	dst_dir=$$(cd target/release && pwd); \
	for name in $(BINARY_NAMES); do \
		src="$$cargo_target_dir/$(CARGO_TARGET_SUBDIR)release/$$name"; \
		if [ ! -f "$$src" ]; then \
			echo "error: [mcp] built, but no binary found at $$src" >&2; \
			echo "  cargo metadata target_directory resolved to: $$cargo_target_dir" >&2; \
			echo "  Re-run to inspect what cargo metadata reports here:" >&2; \
			echo "    cargo metadata --format-version=1 --no-deps" >&2; \
			exit 1; \
		fi; \
		src_dir=$$(cd "$$(dirname "$$src")" && pwd); \
		if [ "$$src_dir" != "$$dst_dir" ]; then \
			cp "$$src" "$$dst_dir/$$name" || { echo "error: [mcp] failed to stage $$name" >&2; exit 1; }; \
		fi; \
	done
	@echo "=== [mcp] Build complete ==="

# ── fmt ───────────────────────────────────────────────────────────────────────
fmt:
	@echo "=== [mcp] Formatting Rust (cargo fmt) ==="
	$(CARGO) fmt --all
	@echo "=== [mcp] Format complete ==="

# ── lint ──────────────────────────────────────────────────────────────────────
# cargo clippy -- -D warnings treats all clippy warnings as errors.
lint:
	@echo "=== [mcp] Linting Rust (clippy -D warnings) ==="
	$(CARGO) clippy --workspace -- -D warnings
	@echo "=== [mcp] Checking Rust formatting (cargo fmt --check) ==="
	$(CARGO) fmt --all -- --check
	@echo "=== [mcp] Lint passed ==="

# ── install ───────────────────────────────────────────────────────────────────
# Install every server binary declared under servers/*/Cargo.toml to
# ~/.cargo/bin. Globs servers/* only to discover which binary-crate
# directories exist -- adding a new server here requires no edit, just a
# new servers/<name>/ directory with its own Cargo.toml.
install:
	@echo "=== [mcp] Installing Rust binaries ==="
	@for d in servers/*/; do \
		if [ -f "$$d/Cargo.toml" ]; then \
			echo "  installing from $$d"; \
			$(CARGO) install --path "$$d" || exit 1; \
		fi; \
	done
	@echo "=== [mcp] Install complete ==="

# ── test-rust ─────────────────────────────────────────────────────────────────
# Run Rust unit tests via cargo test across the whole workspace.
# No internet access needed beyond what cargo build already fetched.
test-rust:
	@echo "=== [mcp] Running Rust tests ==="
	$(CARGO) test --workspace
	@echo "=== [mcp] Rust tests passed ==="

# ── test ──────────────────────────────────────────────────────────────────────
# Aggregator: run test-rust. (cli/Makefile also runs test-schema-dump here;
# mcp/ has no equivalent smoke check yet, so test is just test-rust today.)
test: test-rust
	@echo "=== [mcp] All tests complete ==="

# ── clean ─────────────────────────────────────────────────────────────────────
# Remove all build artifacts. Safe to run at any time -- in particular,
# safe to run when a gitignored rust-toolchain.toml still points at a
# toolchain path that no longer exists, which would otherwise make
# `cargo clean` itself fail before doing anything.
clean:
	@echo "=== [mcp] Cleaning Rust build artifacts ==="
	@toolchain=$$(sed -n 's/^path = "\(.*\)"/\1/p' rust-toolchain.toml 2>/dev/null); \
	if [ -n "$$toolchain" ] && [ ! -d "$$toolchain/bin" ]; then \
	  echo "  Toolchain path from rust-toolchain.toml absent ($$toolchain) -- removing target/ directly"; \
	  rm -rf target; \
	else \
	  $(CARGO) clean; \
	fi
	@rm -f rust-toolchain.toml
	@echo "=== [mcp] Clean complete ==="
