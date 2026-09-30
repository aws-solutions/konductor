#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-update.sh -- konductor-setup step 9: upgrade an already-onboarded
# target, always with an explicit --target. Never a bare `konductor
# update`: a user who has tried this Power in more than one
# project has more than one entry in `~/.konductor/installs`, and
# cli/README.md's own selection table treats a bare `update`/`uninstall`
# against 2+ tracked installs as a usage error demanding `--target`/`--all`
# -- this script already knows which target it is acting on (the current
# project), so it always supplies it explicitly rather than relying on the
# "exactly one tracked install" convenience case.
#
# This upgrades CONTENT (agents/skills/SOPs) for one target, keyed off
# `doctor`'s own content_version check (see run-onboarding.sh's step 7) --
# it is deliberately not `konductor update --cli`, which self-replaces the
# machine-wide konductor binary and has no per-target concept at all.
#
# Usage:
#   run-update.sh --target <dir> [--version <v>] [--use-github-token]
#
#   --target <dir>   REQUIRED. Same target run-onboarding.sh installed into.
#   --version <v>    Optional: update to a specific tagged release instead
#                     of latest (passed through to `konductor update
#                     --version`).
#   --use-github-token  Opt in to reading GITHUB_TOKEN from the environment
#                     and passing --use-github-token through to `konductor
#                     update`'s own GitHub API call -- same opt-in-only
#                     rationale as run-onboarding.sh's identical flag (see
#                     that script's own doc comment). The agent must say a
#                     token will be sent when offering this.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

TARGET_DIR=""
VERSION_ARGS=()
USE_GITHUB_TOKEN_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_DIR="${2:?--target requires a directory argument}"
      shift 2
      ;;
    --version)
      VERSION_ARGS=(--version "${2:?--version requires a value}")
      shift 2
      ;;
    --use-github-token)
      USE_GITHUB_TOKEN_ARGS=(--use-github-token)
      shift 1
      ;;
    *)
      konductor_die "unknown argument: $1" || exit 64
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  konductor_die "usage: run-update.sh --target <dir> [--version <v>] [--use-github-token]" || exit 64
fi

# NOT a bare `~/.local/bin/konductor` assumption: that symlink is shared
# across every project on the machine and re-pointed by every onboarding
# run elsewhere, so it may no longer match THIS target's own recorded CLI
# binary by the time `update` runs against it. konductor_resolve_target_
# binary verifies the actual match against this target's own
# power-cli.json record -- deliberately NOT install-info.json's
# `agent_version`, which is the installed CONTENT's own version and
# independent of which CLI binary ran the command (a `--version <v>`
# bump below changes ONLY that content version, on whichever CLI binary
# happens to be resolved; comparing it against a CLI binary's own
# `--version` output would be comparing two unrelated axes -- see
# lib.sh's konductor_write_power_cli_record for the full rationale).
# Falls back to this target's own
# cached, previously-verified binary under ~/.konductor/cli-releases/, or
# the shared binary, before ever failing closed -- see lib.sh's own doc
# comment on konductor_resolve_target_binary for the full resolution order.
konductor_resolve_target_binary "$TARGET_DIR"
KONDUCTOR_BIN="$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT"
KONDUCTOR_BIN_VERSION="$KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT"

# konductor_run_cli (not konductor_run): detects a GitHub rate-limit/auth
# signature in this command's own stderr and prints an exact retry command
# -- see lib.sh's konductor_run_cli/konductor_suggest_rate_limit_retry.
konductor_run_cli "$KONDUCTOR_BIN" update --target "$TARGET_DIR" "${VERSION_ARGS[@]}" "${USE_GITHUB_TOKEN_ARGS[@]}"

# Refresh this target's own power-cli.json with the binary this run
# actually used, only now that `update` has actually succeeded (a failed
# `konductor_run_cli` call above already `exit`ed via `set -e` before this
# line is ever reached). Self-healing: a legacy target with no record yet,
# or one whose recorded binary konductor_resolve_target_binary had to fall
# back away from, gets a fresh, correct record immediately -- every LATER
# run then resolves through this target's own power-cli.json directly.
konductor_write_power_cli_record "$TARGET_DIR" "$KONDUCTOR_BIN_VERSION" "$KONDUCTOR_BIN"
