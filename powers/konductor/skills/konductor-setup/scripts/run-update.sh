#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-update.sh -- konductor-setup step 9: upgrade an already-onboarded
# target, always with an explicit --target (never a bare `konductor
# update`, which errors out once a user has 2+ tracked installs).
#
# Upgrades CONTENT (agents/skills/SOPs) for one target -- deliberately not
# `konductor update --cli`, which self-replaces the machine-wide binary
# with no per-target concept at all.
#
# Usage:
#   run-update.sh --target <dir> [--version <v>] [--use-github-token]
#                  [--harness <name>]
#
#   --target <dir>   REQUIRED. Same target run-onboarding.sh installed into.
#   --version <v>    Optional: update to a specific tagged release instead
#                     of latest (passed through to `konductor update
#                     --version`).
#   --use-github-token  Opt in to reading GITHUB_TOKEN and passing
#                     --use-github-token through to `konductor update`'s
#                     own GitHub API call. The agent must say a token
#                     will be sent when offering this.
#   --harness <name>  Optional: which tracked harness to update, forwarded
#                     verbatim as `--harness <name>` to `konductor update`.
#                     Only needed when the target tracks more than one
#                     harness. Omitted means nothing forwarded. Validated
#                     against KONDUCTOR_HARNESS_NAME_REGEX (lib.sh) before
#                     use -- refuses an unsafe shape before the value is
#                     ever forwarded as an argv entry; the CLI itself
#                     still validates it against its own harness allowlist.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

TARGET_DIR=""
VERSION_ARGS=()
USE_GITHUB_TOKEN_ARGS=()
HARNESS_VALUE=""
HARNESS_ARGS=()

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
    --harness)
      HARNESS_VALUE="${2:?--harness requires a value}"
      shift 2
      ;;
    *)
      konductor_die "unknown argument: $1" || exit 64
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  konductor_die "usage: run-update.sh --target <dir> [--version <v>] [--use-github-token] [--harness <name>]" || exit 64
fi

# Validated before use -- see KONDUCTOR_HARNESS_NAME_REGEX in lib.sh.
if [[ -n "$HARNESS_VALUE" ]]; then
  if [[ ! "$HARNESS_VALUE" =~ $KONDUCTOR_HARNESS_NAME_REGEX ]]; then
    konductor_die "'${HARNESS_VALUE}' is not a valid --harness value (expected lowercase letters, digits, and hyphens, starting with a letter or digit) -- refusing to forward it to konductor update." || exit 64
  fi
  HARNESS_ARGS=(--harness "$HARNESS_VALUE")
fi

# NOT a bare `~/.local/bin/konductor` assumption: that symlink is shared
# across every project and may no longer match THIS target's recorded CLI
# binary. See lib.sh's konductor_resolve_target_binary for the full
# resolution order and why it is power-cli.json, never install-info.json.
konductor_resolve_target_binary "$TARGET_DIR"
KONDUCTOR_BIN="$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT"
KONDUCTOR_BIN_VERSION="$KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT"

# konductor_run_cli (not konductor_run): prints an exact retry command on
# a GitHub rate-limit/auth signature -- see lib.sh's konductor_run_cli.
# ${arr[@]+"${arr[@]}"}, not a bare "${arr[@]}": these arrays are often
# empty, and bash 3.2 (stock macOS) treats expanding an empty array under
# `set -u` as an unbound variable; `+` short-circuits to nothing first.
konductor_run_cli "$KONDUCTOR_BIN" update --target "$TARGET_DIR" ${VERSION_ARGS[@]+"${VERSION_ARGS[@]}"} ${USE_GITHUB_TOKEN_ARGS[@]+"${USE_GITHUB_TOKEN_ARGS[@]}"} ${HARNESS_ARGS[@]+"${HARNESS_ARGS[@]}"}

# Refresh power-cli.json with the binary this run actually used, only now
# that update succeeded. Self-healing: a legacy or fallback-resolved
# target gets a fresh record so every later run resolves through it directly.
konductor_write_power_cli_record "$TARGET_DIR" "$KONDUCTOR_BIN_VERSION" "$KONDUCTOR_BIN"
