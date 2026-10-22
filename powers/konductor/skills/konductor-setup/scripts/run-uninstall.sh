#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-uninstall.sh -- konductor-setup step 10: remove Konductor from a
# target, always with an explicit --target. A separate, explicitly-
# confirmed action from the agent's side -- never bundled into a "start
# over" step that also reinstalls, since uninstall removes real files.
#
# Usage:
#   run-uninstall.sh --target <dir> [--dry-run] [--confirmed]
#                     [--harness <name>]
#
#   --target <dir>   REQUIRED. Same target run-onboarding.sh installed into.
#   --dry-run        Report exactly which files would be removed, without
#                     touching the filesystem. Unguarded: never touches
#                     the filesystem, so needs no confirmation of its own;
#                     the agent should always run this first.
#   --confirmed      REQUIRED for a REAL removal (--dry-run not also
#                     given). Refuses to delete anything without it --
#                     SKILL.md's flow is always dry-run first, shown to
#                     the user, THEN --confirmed only after an explicit yes.
#   --harness <name>  Optional: which tracked harness to uninstall,
#                     forwarded verbatim as `--harness <name>` to
#                     `konductor uninstall`. Only needed when the target
#                     tracks more than one harness. Omitted means nothing
#                     forwarded. Gated independently of --dry-run/
#                     --confirmed: names WHICH harness, not whether to
#                     act, so it applies on both paths. Same
#                     KONDUCTOR_HARNESS_NAME_REGEX validation as
#                     run-update.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

TARGET_DIR=""
DRY_RUN=""
DRY_RUN_ARGS=()
CONFIRMED=""
HARNESS_VALUE=""
HARNESS_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_DIR="${2:?--target requires a directory argument}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="1"
      DRY_RUN_ARGS=(--dry-run)
      shift 1
      ;;
    --confirmed)
      CONFIRMED="1"
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
  konductor_die "usage: run-uninstall.sh --target <dir> [--dry-run] [--confirmed] [--harness <name>]" || exit 64
fi

# Validated before the consent backstop below, so an unsafe value is
# refused on both --dry-run and a real --confirmed removal. See
# KONDUCTOR_HARNESS_NAME_REGEX in lib.sh.
if [[ -n "$HARNESS_VALUE" ]]; then
  if [[ ! "$HARNESS_VALUE" =~ $KONDUCTOR_HARNESS_NAME_REGEX ]]; then
    konductor_die "'${HARNESS_VALUE}' is not a valid --harness value (expected lowercase letters, digits, and hyphens, starting with a letter or digit) -- refusing to forward it to konductor uninstall." || exit 64
  fi
  HARNESS_ARGS=(--harness "$HARNESS_VALUE")
fi

# ── Consent backstop for a REAL removal only ────────────────────────────────
# --dry-run is exempt (never touches the filesystem). A real removal
# refuses before doing anything destructive, same as run-onboarding.sh's
# --confirmed -- the "did the user say yes" call stays one layer up, in
# chat (see SKILL.md).
if [[ -z "$DRY_RUN" && -z "$CONFIRMED" ]]; then
  konductor_die "refusing to run a REAL uninstall without --confirmed. Run with --dry-run first, show the user exactly what would be removed, get an explicit yes, THEN re-run with --confirmed (no --dry-run). See konductor-setup/SKILL.md's uninstall flow." || exit 64
fi

# NOT a bare `~/.local/bin/konductor` assumption -- see lib.sh's
# konductor_resolve_target_binary for the full resolution order.
konductor_resolve_target_binary "$TARGET_DIR"
KONDUCTOR_BIN="$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT"

# ${arr[@]+"${arr[@]}"}, not a bare "${arr[@]}": these arrays are often
# empty, and bash 3.2 (stock macOS) treats expanding an empty array under
# `set -u` as an unbound variable; `+` short-circuits to nothing first.
konductor_run "$KONDUCTOR_BIN" uninstall --target "$TARGET_DIR" ${DRY_RUN_ARGS[@]+"${DRY_RUN_ARGS[@]}"} ${HARNESS_ARGS[@]+"${HARNESS_ARGS[@]}"}

# On a real removal that succeeded: remove this Power's own
# power-cli.json for this target, but ONLY if it no longer tracks ANY
# harness -- deleting it while another harness survives (e.g. `claude`
# after a `--harness kiro-v3` removal) would strand that harness's next
# update/uninstall on konductor_resolve_target_binary's legacy path.
# `konductor uninstall` has no knowledge of this file; cleaning it up is
# this script's job.
#
# Signal: whether `<target>/.konductor/manifest` still exists afterward.
# manifest.rs's remove_strategy_locked deletes that file outright (never
# an empty `{"strategies": []}`) once no strategy remains, so its
# existence is already the CLI's own durable "anything still installed"
# signal -- no parsing needed. Never done on --dry-run.
if [[ -z "$DRY_RUN" ]]; then
  if [[ ! -f "${TARGET_DIR}/.konductor/manifest" ]]; then
    rm -f "${TARGET_DIR}/.konductor/power-cli.json"
  else
    konductor_log "${TARGET_DIR}/.konductor/manifest still exists after this uninstall -- another harness is still tracked at this target, so this Power's own power-cli.json record is kept."
  fi
fi
