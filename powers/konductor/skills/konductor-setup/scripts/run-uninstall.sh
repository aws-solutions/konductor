#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-uninstall.sh -- konductor-setup step 10: remove Konductor from a
# target, always with an explicit --target, same multi-tracked-install
# reasoning as run-update.sh. This is a separate, explicitly-confirmed
# action from the agent's side -- never bundled into a "start over" step
# that also reinstalls, since uninstall removes real files.
#
# Usage:
#   run-uninstall.sh --target <dir> [--dry-run] [--confirmed]
#
#   --target <dir>   REQUIRED. Same target run-onboarding.sh installed into.
#   --dry-run        Report exactly which files would be removed, without
#                     touching the filesystem at all. Unguarded -- a dry
#                     run never touches the filesystem, so it needs no
#                     confirmation of its own; the agent should always run
#                     this first and show the user the result (the CLI
#                     itself offers --dry-run precisely so a user can see
#                     what would be removed before it is).
#   --confirmed      REQUIRED for a REAL removal (i.e. whenever --dry-run
#                     is NOT also given). Same consent-backstop rationale
#                     as run-onboarding.sh's identical flag (see that
#                     script's own doc comment and
#                     SKILL.md's "Consent is prose, not a provable gate"
#                     section): this script refuses to actually delete
#                     anything without it. SKILL.md's own uninstall flow is
#                     always dry-run first, shown to the user, THEN
#                     --confirmed only after an explicit yes -- never both
#                     flags skipped straight to a real removal.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

TARGET_DIR=""
DRY_RUN=""
DRY_RUN_ARGS=()
CONFIRMED=""

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
    *)
      konductor_die "unknown argument: $1" || exit 64
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  konductor_die "usage: run-uninstall.sh --target <dir> [--dry-run] [--confirmed]" || exit 64
fi

# ── Consent backstop for a REAL removal only ────────────────────────────────
# --dry-run is deliberately exempt: it never touches the filesystem, so
# gating it behind --confirmed would just make the agent's own "show the
# user what would happen first" step harder to run. A real removal without
# --dry-run, though, gets the exact same backstop run-onboarding.sh's
# --confirmed gives installs: refuse before doing anything destructive,
# leaving the actual "did the user say yes" judgment call one layer up, in
# chat (see SKILL.md).
if [[ -z "$DRY_RUN" && -z "$CONFIRMED" ]]; then
  konductor_die "refusing to run a REAL uninstall without --confirmed. Run with --dry-run first, show the user exactly what would be removed, get an explicit yes, THEN re-run with --confirmed (no --dry-run). See konductor-setup/SKILL.md's uninstall flow." || exit 64
fi

# NOT a bare `~/.local/bin/konductor` assumption -- same rationale as
# run-update.sh's identical resolution (see that script's own comment and
# lib.sh's konductor_resolve_target_binary doc comment for the full
# resolution order).
konductor_resolve_target_binary "$TARGET_DIR"
KONDUCTOR_BIN="$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT"

konductor_run "$KONDUCTOR_BIN" uninstall --target "$TARGET_DIR" "${DRY_RUN_ARGS[@]}"

# On a REAL removal that actually succeeded (a failed `konductor_run` call
# above already `exit`ed via `set -e` before this line is ever reached;
# --dry-run never reaches here with anything to remove, since DRY_RUN_ARGS
# is empty only on the real-removal path and this target's own files are
# already gone by this point either way): remove this Power's own
# power-cli.json for this target along with everything else `uninstall`
# just removed. `konductor uninstall` has no knowledge of this file at all
# -- it is this Power's own record, not the CLI's -- so it is this
# script's job, not the CLI's, to clean it up. Never done on --dry-run,
# which must not touch the filesystem in any way.
if [[ -z "$DRY_RUN" ]]; then
  rm -f "${TARGET_DIR}/.konductor/power-cli.json"
fi
