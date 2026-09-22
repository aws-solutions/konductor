# SPDX-License-Identifier: Apache-2.0
#
# Build for the shared/ workspace (Rust). Mirrors cli/Makefile's and
# mcp/Makefile's target set and conventions. Works standalone for any
# developer with Rust (cargo) installed. No internal build system or
# Amazon tooling required.
#
# This workspace has no binaries -- its crates (konductor-telemetry,
# telemetry-test-sink) are pulled into cli/ and mcp/
# only as path dependencies -- so there is no `build`/`install` target
# here, only lint and test.
#
# ── Targets ───────────────────────────────────────────────────────────────────
#   fmt         Auto-format: cargo fmt --all
#   lint        Check formatting/linting: clippy + cargo fmt --check
#   test-rust   Run Rust unit tests (cargo test --workspace --all-features)
#   test        Thin aggregator: depends on test-rust
#   clean       Remove all build artifacts
#   help        Show this usage summary
#
# ── Overridable variables ─────────────────────────────────────────────────────
#   CARGO   path to cargo (default: cargo)

CARGO ?= cargo

.PHONY: all fmt lint test test-rust clean help

all: test

# ── help ──────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "Konductor shared crates — Makefile targets"
	@echo ""
	@echo "  make lint       Rust lint (clippy + cargo fmt --check)"
	@echo "  make fmt        Rust fmt"
	@echo "  make test       Run test-rust"
	@echo "  make test-rust  Run Rust unit tests (no internet required)"
	@echo "  make clean      Remove build artifacts"
	@echo ""

# ── fmt ───────────────────────────────────────────────────────────────────────
fmt:
	@echo "=== [shared] Formatting Rust (cargo fmt) ==="
	$(CARGO) fmt --all
	@echo "=== [shared] Format complete ==="

# ── lint ──────────────────────────────────────────────────────────────────────
# cargo clippy -- -D warnings treats all clippy warnings as errors.
# --all-features: konductor-telemetry's `async` feature is off by
# default, so without this clippy never sees the feature-gated async
# DNS path when shared/ is linted on its own.
lint:
	@echo "=== [shared] Linting Rust (clippy -D warnings, all features) ==="
	$(CARGO) clippy --workspace --all-features -- -D warnings
	@echo "=== [shared] Checking Rust formatting (cargo fmt --check) ==="
	$(CARGO) fmt --all -- --check
	@echo "=== [shared] Lint passed ==="

# ── test-rust ─────────────────────────────────────────────────────────────────
# --all-features, same reason as `lint` above: otherwise the six
# #[tokio::test]s gated behind konductor-telemetry's `async` feature
# never run when shared/ is tested on its own.
test-rust:
	@echo "=== [shared] Running Rust tests (all features) ==="
	$(CARGO) test --workspace --all-features
	@echo "=== [shared] Rust tests passed ==="

# ── test ──────────────────────────────────────────────────────────────────────
test: test-rust
	@echo "=== [shared] All tests complete ==="

# ── clean ─────────────────────────────────────────────────────────────────────
clean:
	@echo "=== [shared] Cleaning Rust build artifacts ==="
	$(CARGO) clean
	@echo "=== [shared] Clean complete ==="
