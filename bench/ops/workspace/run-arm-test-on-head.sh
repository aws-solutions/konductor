#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Runs scripts/arm-signed-release-test-v2.sh against the current origin/feat/bench-pilot-nk head (the D-168 control fix),
# not the older phys-nk checkout. It keeps a detached worktree at konductor-plant/.worktrees/arm-test, moves it to the
# head, and passes it as PLANT_CHECKOUT. Free: no model, no credits. The arm test waits for the heavy lock itself.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CLONE=$KONDUCTOR_WS/worktrees/konductor-plant
WT=$CLONE/.worktrees/arm-test
BRANCH=feat/bench-pilot-nk

git -C "$CLONE" fetch -q origin "$BRANCH"
head=$(git -C "$CLONE" rev-parse "origin/$BRANCH")
if [ -e "$WT" ]; then
  [ -z "$(git -C "$WT" status --porcelain)" ] || { echo "STOP: $WT has changes"; exit 2; }
  git -C "$WT" checkout -q --detach "$head"
else
  git -C "$CLONE" worktree add -q --detach "$WT" "$head"
fi
echo "arm test on $BRANCH head $head ($WT)"
exec env PLANT_CHECKOUT="$WT" bash "$SELF/arm-signed-release-test-v2.sh" "$@"
