#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-cleanup-dispatch.sh: mux-cleanup-dispatch.sh and cmux-cleanup-dispatch.sh,
# the only way the orchestrators remove a dispatch directory. A valid id's
# directory is removed. A crafted '../x', an absolute path, an id that does
# not match the dispatch format, a symlinked dispatch directory, and a
# registry that is a symlink, writable by others, or owned by someone else
# are each refused with nothing removed.
#
# Usage: bash test-cleanup-dispatch.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }
check() { if eval "$2"; then log_pass "$1"; else log_fail "$1"; sed 's/^/    /' "$WORKDIR/err"; fi; }

WORKDIR="$(mktemp -d)"
trap 'chmod -R u+w "$WORKDIR" 2>/dev/null; rm -rf "$WORKDIR"' EXIT

# A file outside every registry that no refusal may touch.
mkdir -p "$WORKDIR/outside"
echo keep > "$WORKDIR/outside/keep.txt"

RC=0
# RC is read inside check's eval.
# shellcheck disable=SC2034
run() {
  local helper="$1" var="$2"; shift 2
  env "$var=$REG" bash "$PKG_ROOT/skills/$helper" "$@" >"$WORKDIR/out" 2>"$WORKDIR/err"
  RC=$?
}

for spec in "mux-dispatch/mux-cleanup-dispatch.sh KONDUCTOR_MUX_REGISTRY_DIR tmux-0123abcd zellij-89abcdef tmux-0123ABCD" \
            "cmux-dispatch/cmux-cleanup-dispatch.sh KONDUCTOR_CMUX_REGISTRY_DIR surface_3-0123abcd surface_12-89abcdef surface_3-0123abc"; do
  read -r helper var id other_id bad_id <<<"$spec"
  name="$(basename "$helper" .sh)"
  REG="$WORKDIR/$name-registry"
  rm -rf "$REG"
  mkdir -m 700 "$REG"
  mkdir -m 700 "$REG/$id" "$REG/$other_id"
  echo brief > "$REG/$id/task.md"
  echo shared > "$REG/dispatched.json"

  run "$helper" "$var" --id "$id"
  check "$name: a valid id's directory is removed" '[[ "$RC" -eq 0 && ! -e "$REG/$id" ]]'
  check "$name: only that directory goes" '[[ -d "$REG/$other_id" && -f "$REG/dispatched.json" ]]'
  run "$helper" "$var" --id "$id"
  check "$name: removing it again is not an error" '[[ "$RC" -eq 0 ]]'

  for crafted in "../outside" "$WORKDIR/outside" "$bad_id" "" "$other_id/../.." "$other_id;rm"; do
    run "$helper" "$var" --id "$crafted"
    check "$name: --id '$crafted' is refused" '[[ "$RC" -ne 0 ]] && grep -q "nothing removed" "$WORKDIR/err"'
  done
  check "$name: no refusal removed anything" '[[ -f "$WORKDIR/outside/keep.txt" && -d "$REG/$other_id" && -f "$REG/dispatched.json" ]]'

  # A dispatch directory that is a symlink, under a valid id.
  ln -s "$WORKDIR/outside" "$REG/$id"
  run "$helper" "$var" --id "$id"
  check "$name: a symlinked dispatch directory is refused" '[[ "$RC" -ne 0 && -L "$REG/$id" && -f "$WORKDIR/outside/keep.txt" ]]'
  rm "$REG/$id"

  # The registry itself must be private.
  REAL_REG="$REG"
  REG="$WORKDIR/$name-registry-link"
  ln -s "$REAL_REG" "$REG"
  run "$helper" "$var" --id "$other_id"
  check "$name: a symlinked registry is refused" '[[ "$RC" -ne 0 && -d "$REAL_REG/$other_id" ]] && grep -q "is a symlink" "$WORKDIR/err"'
  REG="$REAL_REG"
  chmod 777 "$REG"
  run "$helper" "$var" --id "$other_id"
  check "$name: a world-writable registry is refused" '[[ "$RC" -ne 0 && -d "$REG/$other_id" ]] && grep -q "group- or world-writable" "$WORKDIR/err"'
  chmod 700 "$REG"
  # / is owned by root, so it stands in for a registry someone else owns.
  if [[ "$(id -u)" -ne 0 ]]; then
    REG=/
    run "$helper" "$var" --id "$other_id"
    REG="$REAL_REG"
    check "$name: a registry owned by someone else is refused" '[[ "$RC" -ne 0 && -d "$REG/$other_id" ]] && grep -q "is owned by uid 0" "$WORKDIR/err"'
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
