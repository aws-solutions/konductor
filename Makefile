# SPDX-License-Identifier: Apache-2.0
#
# Root-level entry point: run every test suite in the repository.

.PHONY: all help test

all: help

help:
	@echo ""
	@echo "Konductor (root) — Makefile targets"
	@echo ""
	@echo "  make test               Run every test suite: installer, fuse-flow, scripts, skills"
	@echo ""

# Needs Bun.
test:
	bun test ./tests/install ./tests/scripts ./tests/repo
	for f in tests/skills/*/*.sh; do bash "$$f" || exit 1; done
	cd fuse/flow && bun install --frozen-lockfile && bun test
