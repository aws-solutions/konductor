#!/usr/bin/env bash
# One unattended command for the night. Run it once and go to sleep.
#   1. waits (up to 8 h) until the LITE judge pass has ended (it keeps the host busy)
#   2. runs Physical AI wave 0 (and its arm trial); if it stops only because the host was busy, it waits 10 min
#      and tries again (up to 15 tries); any other stop ends the script with the reason in the log
# Needs keep-creds-fresh.sh running in another terminal. Log: reports/overnight-<time>.log
# Wave 0 spends about 26 credits plus the arm trial (USD 8 cap), both already approved.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
LOG=$WS/reports/overnight-$(date -u +%Y%m%d-%H%M).log
say() { echo "[$(date -u +%H:%M)] $*" | tee -a "$LOG"; }

say "waiting for the judge pass to end (up to 8 h)"
for _ in $(seq 1 960); do
  pgrep -f 'run-lite-judge.sh|bench/runner/bench.js judge' >/dev/null || break
  sleep 30
done
if pgrep -f 'run-lite-judge.sh|bench/runner/bench.js judge' >/dev/null; then
  say "judge pass still running after 8 h: going on anyway"
else
  say "judge pass ended"
fi

for try in $(seq 1 15); do
  say "wave 0, try $try"
  out=$(mktemp "${TMPDIR:-/tmp}/wave0-try.XXXXXX")
  bash "$WS/scripts/run-physical-ai-wave0.sh" 2>&1 | tee "$out" | tee -a "$LOG"
  rc=${PIPESTATUS[0]}
  if [ "$rc" -eq 0 ] && ! grep -q '^STOP' "$out"; then
    say "wave 0 finished (exit 0). Results under $WS/reports/physical-ai-wave0-*/"
    exit 0
  fi
  if grep -q 'STOP: host load' "$out"; then
    say "host was busy: waiting 10 min, then trying again"
    sleep 600
    continue
  fi
  say "wave 0 stopped for another reason (exit $rc): see the log above. Not retrying."
  exit 1
done
say "gave up after 15 tries: the host never became quiet"
exit 1
