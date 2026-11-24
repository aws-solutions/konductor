#!/usr/bin/env bash
# test-run.sh: paid-path test for run.sh with a stub kiro-cli (no model, no keys, no spend). The bundles are built
# from the real pinned worktree (free). Checks the dry run, the paid queue, the counted ledger, resume, the cap
# refusal before a call, the NOJSON stop and the heavy-lock stop.
#   bash scripts/standard-recheck/test-run.sh [PIN_REPO]
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PIN=${1:-$KONDUCTOR_WS/worktrees/recheck-std}
T=$(mktemp -d /var/tmp/rc-test.XXXXXX)
trap 'pkill -P "${HOLDER:-0}" 2>/dev/null; kill "${HOLDER:-0}" 2>/dev/null; rm -rf "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }
# stub kiro-cli: whoami ok; chat writes recheck.json in its cwd unless STUB_NOJSON, and logs its HOME and model
cat > "$T/kiro" <<'SH'
#!/bin/sh
[ "$1" = whoami ] && exit 0
printf '%s %s\n' "$HOME" "$5" >> "$CALLS"
[ -n "${STUB_NOJSON:-}" ] && exit 1
if [ -n "${STUB_SUBDIR:-}" ]; then mkdir -p tasks; echo '{"tasks":{}}' > tasks/recheck.json; else echo '{"tasks":{}}' > recheck.json; fi
echo '{"type":"result"}'
SH
chmod +x "$T/kiro"
run() { # run NAME [ARGS]
  local n=$1; shift
  S="$T/$n" PIN_REPO="$PIN" KIRO="$T/kiro" LEDGER="$T/$n.ledger" HEAVY_LOCK="$T/heavy.lock" HOST_CHECK=0 WAIT_MAX=0 \
    CALLS="$T/calls" bash "$HERE/run.sh" "$@" > "$T/log" 2>&1
}
calls() { [ -f "$T/calls" ] && wc -l < "$T/calls" | tr -d ' ' || echo 0; }

bash -n "$HERE/run.sh" && ok "bash -n clean" || bad syntax
: > "$T/calls"; run A --dry-run; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 0 ] && grep -q 'dry run: 7 calls, at least 105 counted of the 105 cap' "$T/log" && [ ! -s "$T/A.ledger" ] && ok "dry run: 7 bundles, no call, no ledger line" || { bad "dry: rc $rc"; cat "$T/log"; }
[ "$(ls "$T/A/dry" | wc -l)" = 7 ] && [ -f "$T/A/dry/S4/tasks/t3-db-audit-retention/task.json" ] && ok "every call's bundle is built" || bad "bundles: $(ls "$T/A/dry")"
[ -f "$T/A/dry/S6/tasks/t2-dr-notify-fanout-v6/task.json" ] && ok "S6 holds the v6 fan-out review (hand-edited 2026-11-24)" || bad "S6 lacks t2-dr-notify-fanout-v6"
grep -q '"review"' "$T/A/dry/S4/tasks/t3-db-audit-retention/task.json" && bad "bundle shows review" || ok "bundle hides review and pilot"
[ ! -e "$T/A/pin.txt" ] && ok "dry run writes no pin" || bad "dry run wrote pin.txt"

# a pin left by an earlier start with nothing spent moves to the worktree's head; one with spend does not
mkdir -p "$T/P"; echo 0000000000000000000000000000000000000000 > "$T/P/pin.txt"
: > "$T/calls"; run P --dry-run; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$T/P/pin.txt")" = "$(git -C "$PIN" rev-parse HEAD)" ] && grep -q 're-pinned' "$T/log" && ok "unspent queue re-pins to the worktree head" || { bad "re-pin: rc $rc"; tail -3 "$T/log"; }
mkdir -p "$T/Q"; echo 0000000000000000000000000000000000000000 > "$T/Q/pin.txt"; echo "X1 deepseek-3.2 15 real=1 rc=0 t" > "$T/Q.ledger"
: > "$T/calls"; run Q --dry-run; rc=$?
[ "$rc" = 1 ] && grep -q "not the queue's pin" "$T/log" && ok "a spent queue keeps its pin" || { bad "spent pin: rc $rc"; tail -3 "$T/log"; }

: > "$T/calls"; run B; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 7 ] && [ "$(ls "$T/B/results" | wc -l)" = 7 ] && ok "paid queue: 7 calls, 7 results" || { bad "paid: rc $rc, calls $(calls)"; tail -5 "$T/log"; }
[ "$(awk '{s+=$3} END {print s}' "$T/B.ledger")" = 105 ] && ok "ledger counts 15 per call" || bad "ledger: $(cat "$T/B.ledger")"
grep -qv "^$HOME " "$T/calls" && ! grep -q "^$HOME " "$T/calls" && ok "every call runs in its own HOME" || bad "HOME: $(head -2 "$T/calls")"
! grep -qi claude "$T/calls" && ok "no Claude model" || bad "claude model called"

: > "$T/calls"; run B; rc=$?
[ "$(calls)" = 0 ] && grep -q 'S7: done, skipped' "$T/log" && ok "rerun skips finished calls" || bad "resume: calls $(calls)"

: > "$T/calls"; echo "X1 deepseek-3.2 105 real=1 rc=0 t" > "$T/C.ledger"; run C; rc=$?
[ "$rc" = 1 ] && [ "$(calls)" = 0 ] && grep -q 'REFUSED S1: spent 105 of the 105 cap' "$T/log" && ok "cap: refused before the call" || bad "cap: rc $rc; $(tail -2 "$T/log")"

: > "$T/calls"; STUB_NOJSON=1 run D; rc=$?
[ "$rc" = 1 ] && [ "$(calls)" = 1 ] && grep -q 'NOJSON S1' "$T/log" && [ "$(wc -l < "$T/D.ledger")" = 1 ] && ok "NOJSON: counted, the queue stops, no retry" || bad "nojson: rc $rc, calls $(calls)"

: > "$T/calls"; flock -x "$T/heavy.lock" sleep 60 & HOLDER=$!; sleep 0.3
run E; rc=$?
pkill -P "$HOLDER" 2>/dev/null; kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
[ "$rc" = 1 ] && [ "$(calls)" = 0 ] && grep -q 'STOP: the heavy lock' "$T/log" && ok "held heavy lock: stops, no call" || bad "heavy: rc $rc; $(tail -2 "$T/log")"

# the model may write recheck.json under tasks/; the call moves it to work/recheck.json and counts it
: > "$T/calls"; STUB_SUBDIR=1 run F; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 7 ] && [ "$(ls "$T/F/results" | wc -l)" = 7 ] && ! grep -q NOJSON "$T/log" && [ -f "$T/F/calls/S1/work/recheck.json" ] && [ ! -e "$T/F/calls/S1/work/tasks/recheck.json" ] && ok "tasks/recheck.json is moved and read" || { bad "subdir: rc $rc"; tail -3 "$T/log"; }
grep -q 'recheck.json' "$HERE/prompt.md" && grep -q 'top level' "$HERE/prompt.md" && ok "prompt names the output path" || bad "prompt does not name recheck.json"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
