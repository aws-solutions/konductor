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
#                     [--harness <name>]
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
#   --harness <name>  Optional: which tracked harness to uninstall,
#                     forwarded verbatim as `--harness <name>` to
#                     `konductor uninstall`. Only needed when the target
#                     tracks more than one harness -- `konductor
#                     uninstall` otherwise reports a usage error naming
#                     this flag. Omitted means the prior single-harness
#                     behavior (nothing forwarded). Gated independently
#                     of --dry-run/--confirmed: it names WHICH harness to
#                     act on, not whether to act at all, so it applies on
#                     both the dry-run and the real-removal path. Same
#                     KONDUCTOR_HARNESS_NAME_REGEX validation as
#                     run-update.sh's identical flag -- see that script's
#                     own doc comment.
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

# Validated BEFORE any use, same rationale as run-update.sh's identical
# check -- see KONDUCTOR_HARNESS_NAME_REGEX's own doc comment in lib.sh.
# Checked here, before the consent backstop below, so an unsafe value is
# refused regardless of whether this run is a --dry-run or a real,
# --confirmed removal.
if [[ -n "$HARNESS_VALUE" ]]; then
  if [[ ! "$HARNESS_VALUE" =~ $KONDUCTOR_HARNESS_NAME_REGEX ]]; then
    konductor_die "'${HARNESS_VALUE}' is not a valid --harness value (expected lowercase letters, digits, and hyphens, starting with a letter or digit) -- refusing to forward it to konductor uninstall." || exit 64
  fi
  HARNESS_ARGS=(--harness "$HARNESS_VALUE")
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

konductor_run "$KONDUCTOR_BIN" uninstall --target "$TARGET_DIR" "${DRY_RUN_ARGS[@]}" "${HARNESS_ARGS[@]}"

# On a REAL removal that actually succeeded (a failed `konductor_run` call
# above already `exit`ed via `set -e` before this line is ever reached):
# remove this Power's own power-cli.json for this target, but ONLY if the
# target no longer tracks ANY harness. `konductor uninstall` has no
# knowledge of this file at all -- it is this Power's own record, not the
# CLI's -- so it is this script's job, not the CLI's, to clean it up, and
# that cleanup must be scoped the same way the CLI's own teardown is: a
# `--harness <name>` uninstall on a target that still tracks ANOTHER
# harness (e.g. `claude` surviving a `--harness kiro-v3` removal) must
# leave power-cli.json in place -- deleting it there would strand that
# surviving harness's next update/uninstall on konductor_resolve_target_
# binary's legacy path (see lib.sh's own doc comment: "legacy" trusts the
# shared ~/.local/bin/konductor outright, with no version check at all).
# Only the LAST tracked harness's removal clears it, matching the
# single-harness target's existing behavior.
#
# Signal used: whether `<target>/.konductor/manifest` itself still exists
# afterward. `konductor uninstall` (cli/konductor-rs/src/cli/install/
# manifest.rs's `remove_strategy_locked`/`delete_and_remove_strategy_
# locked`) deletes that exact file -- never leaves behind an empty
# `{"strategies": []}` document -- precisely when the removal just
# performed leaves no strategy tracked at all, and only ever writes the
# file back (naming the survivor(s)) when another strategy remains. The
# file's own existence is therefore the CLI's own direct, already-durable
# signal for "is anything still installed here"; no parsing is needed to
# read it (unlike power-cli.json itself, elsewhere in this Power's
# scripts, which does need jq). Never done on --dry-run, which must not
# touch the filesystem in any way.
if [[ -z "$DRY_RUN" ]]; then
  if [[ ! -f "${TARGET_DIR}/.konductor/manifest" ]]; then
    rm -f "${TARGET_DIR}/.konductor/power-cli.json"
  else
    konductor_log "${TARGET_DIR}/.konductor/manifest still exists after this uninstall -- another harness is still tracked at this target, so this Power's own power-cli.json record is kept."
  fi
fi
