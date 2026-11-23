#!/usr/bin/env bash
# One command for the owner terminal. Runs, one after another:
#   1. run-reruns-2.sh              the 3 fixed T11/T12 tasks (about 10 credits)
#   2. run-physical-ai-wave0.sh     Physical AI wave 0 rehearsal (about 26 credits) and the arm trial (USD 8 cap)
#   3. run-lite-konductor.sh        konductor-vs-plain run (about 1,031 real credits, cap 1,300)
# Each step waits for a quiet host by itself. A failed step does not stop the next one.
# Keep keep-creds-fresh.sh running in another terminal.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
S=$KONDUCTOR_WS/scripts
say() { echo "[$(date -u +%H:%M)] $*"; }

say "step 1: run-reruns-2.sh"
bash "$S/run-reruns-2.sh" || say "step 1 returned an error: going on"

say "step 2: run-physical-ai-wave0.sh"
bash "$S/run-physical-ai-wave0.sh" || say "step 2 returned an error: going on"

say "step 3: run-lite-konductor.sh (starts in the background, see its run.log)"
bash "$S/run-lite-konductor.sh" || say "step 3 returned an error"
say "all steps started or done"
