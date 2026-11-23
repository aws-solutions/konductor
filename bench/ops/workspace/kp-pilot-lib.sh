# SPDX-License-Identifier: Apache-2.0
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
# kp-pilot-lib.sh -- shared steps of the two keep-or-prune pilot wrappers (run-pilot-author.sh, run-pilot-run.sh).
# Sourced, not run. Every function binds its variables at the top, so `set -u` sees the paid path's names.
#
# Env (all optional): KP_WORKSPACE (default the mate workspace), KP_WT_NAME (the wrapper's own worktree under
# konductor-plant/.worktrees, default kp-pilot), KP_REF (a commit for this run only; default the pinned commit, see
# kp_refresh), KP_KIRO_BIN (default the pinned kiro-cli 3.5.0 binary when present, else kiro-cli), KP_PILOT_WORK (work dir outside home, default /var/tmp/konductor-kp-pilot),
# KP_BASELINES (where the baseline lives between the two steps, default <workspace>/reports/kp-pilot/unit-baselines),
# KP_LOG_ROOT (default <workspace>/reports), KP_PIN_FILE (the pinned commit, default <workspace>/reports/kp-pilot/pinned-commit),
# KP_HEAVY_LOCK (default /var/tmp/konductor-heavy.lock).

kp_stop() { echo "STOP: $*" >&2; exit 1; }

# kp_setup STEP: binds the shared names (globals, read by the wrapper) and opens the log under reports/.
kp_setup() {
  local step=$1 ts
  ts=$(date -u +%Y%m%d-%H%M%S)
  KP_W=${KP_WORKSPACE:-$KONDUCTOR_WS}
  KP_CLONE=$KP_W/worktrees/konductor-plant
  KP_WT=$KP_CLONE/.worktrees/${KP_WT_NAME:-kp-pilot}
  # The kiro-cli 3.5.0 build LITE ran on, so a toolbox auto-update cannot change the stream format mid-pilot.
  KP_BIN=${KP_KIRO_BIN:-}
  if [ -z "$KP_BIN" ]; then KP_BIN=kiro-cli; [ -x /var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli ] && KP_BIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli; fi
  KP_WORK=${KP_PILOT_WORK:-/var/tmp/konductor-kp-pilot}
  KP_BASE_DIR=${KP_BASELINES:-$KP_W/reports/kp-pilot/unit-baselines}
  KP_BASELINE=$KP_BASE_DIR/context-k-orchestrator-shared/baseline.json
  KP_LOGDIR=${KP_LOG_ROOT:-$KP_W/reports}/kp-pilot-$step-$ts
  mkdir -p "$KP_LOGDIR"
  mkdir -p -m 700 "$KP_WORK" && chmod 700 "$KP_WORK"   # saved prompts, answers, the ledger: not for other users
  # Detached-safe: a closed terminal (nohup, setsid) does not stop the run; every line also goes to the log.
  trap '' HUP
  exec > >(tee -a "$KP_LOGDIR/run.log") 2>&1
  echo "kp-pilot $step, log $KP_LOGDIR/run.log"
}

# kp_refresh: moves the wrapper's own detached worktree to the commit to run (never another session's worktree).
# The commit is pinned: the first wrapper run records the feat/bench-pilot-nk head in KP_PIN_FILE, and every later
# run (step 1 again, step 3) uses that same commit, so a push between the steps never changes the code that spends.
# KP_REF names a commit for this run only. To move the pin, delete the pin file.
kp_refresh() {
  local ref head pin
  ref=${KP_REF:-}
  pin=${KP_PIN_FILE:-$KP_W/reports/kp-pilot/pinned-commit}
  git -C "$KP_CLONE" fetch -q origin feat/bench-pilot-nk || kp_stop "git fetch failed"
  if [ -z "$ref" ] && [ -s "$pin" ]; then
    ref=$(head -n 1 "$pin")
    echo "pinned commit $ref (from $pin; delete that file to move to a newer head)"
  elif [ -z "$ref" ]; then
    ref=$(git -C "$KP_CLONE" rev-parse --verify "origin/feat/bench-pilot-nk^{commit}") || kp_stop "no origin/feat/bench-pilot-nk"
    mkdir -p "$(dirname "$pin")"
    printf '%s\n' "$ref" > "$pin"
    echo "pinned commit $ref, the feat/bench-pilot-nk head now (recorded in $pin)"
  fi
  head=$(git -C "$KP_CLONE" rev-parse --verify "$ref^{commit}") || kp_stop "no commit $ref"
  printf '%s\n' "$head" > "$KP_LOGDIR/commit.txt"
  if [ -e "$KP_WT" ]; then
    [ -z "$(git -C "$KP_WT" status --porcelain)" ] || kp_stop "$KP_WT has local changes; it is this wrapper's own checkout, so look at them before removing them"
    git -C "$KP_WT" checkout -q --detach "$head"
  else
    git -C "$KP_CLONE" worktree add -q --detach "$KP_WT" "$head"
  fi
  echo "checkout: $KP_WT at $(git -C "$KP_WT" log --oneline -1)"
}

# kp_repin WHY: moves the pin to the feat/bench-pilot-nk head now, and logs old -> new with WHY in <pin>.log. Only the
# owner's deliberate steps call it (the freeze and the replacement), so the pin never moves on its own.
kp_repin() {
  local why=$1 pin old new
  pin=${KP_PIN_FILE:-$KP_W/reports/kp-pilot/pinned-commit}
  git -C "$KP_CLONE" fetch -q origin feat/bench-pilot-nk || kp_stop "git fetch failed"
  new=$(git -C "$KP_CLONE" rev-parse --verify "${KP_REF:-origin/feat/bench-pilot-nk}^{commit}") || kp_stop "no commit to pin"
  old=$( [ -s "$pin" ] && head -n 1 "$pin" || echo none)
  mkdir -p "$(dirname "$pin")"
  printf '%s\n' "$new" > "$pin"
  printf '%s %s -> %s (%s)\n' "$(date -u +%FT%TZ)" "$old" "$new" "$why" >> "$pin.log"
  echo "pin moved: $old -> $new ($why); logged in $pin.log"
}

# kp_sweep DIR: removes scratch HOMEs a killed run left in DIR (each holds a sign-in copy). Call it under the kp lock.
kp_sweep() {
  local dir=$1 stale=""
  while IFS= read -r stale; do
    chmod -R u+rwX "$stale" && find "$stale" -depth -delete && echo "removed a stale scratch HOME (sign-in copy): $stale"
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -type d -name 'home-*' 2>/dev/null)
}

# kp_heavy_lock: a paid step holds the host's heavy lock, so other heavy jobs (run-forced-small.sh, the arm test) wait.
kp_heavy_lock() {
  local lock
  lock=${KP_HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
  exec 8>"$lock"
  echo "waiting for the heavy lock $lock ..."
  flock -x 8
}

# kp_creds: kiro-cli must be signed in; a paid call would fail on every call otherwise.
kp_creds() {
  "$KP_BIN" whoami < /dev/null > "$KP_LOGDIR/whoami.txt" 2>&1 || kp_stop "kiro-cli is not signed in (see $KP_LOGDIR/whoami.txt): run kiro-cli login, then this command again"
  echo "kiro-cli signed in ($KP_BIN)"
}
