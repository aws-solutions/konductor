#!/usr/bin/env bash
# Waits for any running pilot-wave.sh to end, then runs waves 11 and 12 one by one.
# Does not move the pilot pin. Stops if a wave fails to write its table.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WAVE=$KONDUCTOR_WS/worktrees/pilot/bench/scripts/pilot-wave.sh

echo "[$(date -u +%H:%M)] waiting for wave 10 to end"
while pgrep -f 'pilot-wave.sh' >/dev/null; do
  sleep 30
done
echo "[$(date -u +%H:%M)] no wave running"

if [ ! -s /tmp/pilot-w10-table.md ]; then
  echo "wave 10 table missing: stopping. Check /tmp/pilot-w10.log"
  exit 1
fi

for w in 11 12; do
  echo "[$(date -u +%H:%M)] starting wave $w"
  env -u R -u KBIN -u PY312 bash "$WAVE" "$w" > "/tmp/pilot-w$w.log" 2>&1
  if [ ! -s "/tmp/pilot-w$w-table.md" ]; then
    echo "wave $w table missing: stopping. Check /tmp/pilot-w$w.log"
    exit 1
  fi
  echo "[$(date -u +%H:%M)] wave $w done"
done
echo "[$(date -u +%H:%M)] all done"
