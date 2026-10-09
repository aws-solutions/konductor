#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Send one user message to the fuse agent of a smoke run and print its reply.
# run.sh puts a wrapper for this at <run>/say; the orchestrator calls that.
#
# usage: say.sh <run dir> <message>
set -uo pipefail

run="$1"
message="${2:-}"
if [ -z "$message" ]; then
  echo "usage: say <message>" >&2
  exit 64
fi
# shellcheck source=/dev/null
. "$run/run.env"

turn=$(( $(cat "$run/turns" 2>/dev/null || echo 0) + 1 ))
if [ "$turn" -gt "$MAX_TURNS" ]; then
  echo "say: the turn budget of $MAX_TURNS messages is spent; write the verdict now." >&2
  exit 1
fi
echo "$turn" > "$run/turns"

resume=()
[ "$turn" -gt 1 ] && resume=(--resume)
continue_session=()
[ "$turn" -gt 1 ] && continue_session=(--continue)

out="$run/turns.d/$turn.out"
err="$run/turns.d/$turn.err"
mkdir -p "$run/turns.d"
start=$(date +%s)
if [ "${FUSE_HARNESS:-kiro}" = opencode ]; then
  ( cd "$PROJECT" && HOME="$FUSE_HOME" XDG_CONFIG_HOME="$FUSE_HOME/.config" OPENCODE_DISABLE_AUTOUPDATE=1 \
      timeout -k 30 "${TURN_TIMEOUT_MIN}m" \
      opencode run --pure --auto -m "$FUSE_MODEL" "${continue_session[@]}" "$message" ) > "$out" 2> "$err"
else
  ( cd "$PROJECT" && timeout -k 30 "${TURN_TIMEOUT_MIN}m" \
      kiro-cli chat --no-interactive --trust-all-tools --agent fuse-smoke --model "$FUSE_MODEL" \
      "${resume[@]}" "$message" ) > "$out" 2> "$err"
fi
rc=$?
seconds=$(( $(date +%s) - start ))

# Strip terminal colour codes so the transcript reads as plain text.
reply=$(sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g' "$out")
printf '%s\t%s\t%s\n' "$turn" "$seconds" "$rc" >> "$run/timings.tsv"
{
  printf '## Turn %s: user\n\n%s\n\n' "$turn" "$message"
  printf '## Turn %s: fuse agent (%ss, exit %s)\n\n%s\n\n' "$turn" "$seconds" "$rc" "$reply"
} >> "$run/transcript.md"

printf '%s\n' "$reply"
if [ "$rc" -ne 0 ]; then
  echo "say: the fuse agent exited with status $rc after ${seconds}s (124 means the turn timed out)." >&2
  tail -n 20 "$err" >&2
fi
exit "$rc"
