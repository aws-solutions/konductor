#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-completion-hook-done-file.sh: the Kiro CLI stop hooks
# (mux-completion-hook.sh and cmux-completion-hook.sh) write the .done to
# KONDUCTOR_DONE_FILE, the dispatch's own directory, when the launcher
# exports it, and nothing at the legacy top-level path.
#
# Usage: bash test-completion-hook-done-file.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

STOP='{"hook_event_name": "stop", "assistant_response": "finished the task"}'

for hook in mux-dispatch/mux-completion-hook.sh cmux-dispatch/cmux-completion-hook.sh; do
  name="$(basename "$hook" .sh)"
  done_file="$WORKDIR/$name/$name-dispatch.done"
  mkdir -p "$(dirname "$done_file")"
  # A unique id, so the legacy path can be checked without touching anything
  # another process wrote there.
  key="test-$name-$$-$RANDOM"
  printf '%s' "$STOP" | KONDUCTOR_DONE_FILE="$done_file" MUX_WORKSPACE_ID="$key" ASDLC_DONE_KEY="$key" \
    bash "$PKG_ROOT/skills/$hook"
  if python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); sys.exit(0 if d["status"] == "done" and d["summary"] == "finished the task" else 1)' "$done_file" 2>/dev/null; then
    log_pass "$name: writes the .done to KONDUCTOR_DONE_FILE"
  else
    log_fail "$name: no .done at KONDUCTOR_DONE_FILE ($(cat "$done_file" 2>/dev/null))"
  fi
  if [[ -e "/tmp/konductor-mux/$key.done" || -e "/tmp/konductor-cmux/$key.done" ]]; then
    log_fail "$name: also wrote the legacy top-level .done"
    rm -f "/tmp/konductor-mux/$key.done" "/tmp/konductor-cmux/$key.done"
  else
    log_pass "$name: leaves the legacy top-level path alone"
  fi
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
