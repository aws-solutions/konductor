#!/usr/bin/env bash
# Free dry-run gate for four tasks. Run from the repo worktree root.
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
cd "$KONDUCTOR_WS/worktrees/ops" || exit 2
for p in "t2 t2-arch-dr-two-regions" "t2 t2-gaps-jwt-middleware" "t4 t4-iam-bucket-policy-oac" "t7 t7-pm-launch-cut"; do
  set -- $p
  echo "== $2"
  TMPDIR=/tmp node bench/scenarios/lib/dry-run.js --config "bench/scenarios/$1/scenario.config.js" "$2" 2>&1 | tail -12
  echo "exit ${PIPESTATUS[0]}"
done
