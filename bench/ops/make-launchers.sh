#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Writes the owner workspace's thin launchers for the scripts versioned here (DEBT D-236).
# The real scripts live in bench/ops/workspace/ and bench/ops/next-experiment-2026-11-22/; the workspace keeps, at the
# old paths, one launcher per script so every old command still works:
#   bench/ops/workspace/<f>                      -> <ws>/scripts/<f>
#   bench/ops/next-experiment-2026-11-22/<f>     -> <ws>/reports/next-experiment-2026-11-22/<f>
# A .sh launcher exports KONDUCTOR_WS and execs the versioned script (the two sourced libs are sourced, not exec'd);
# a .js launcher runs it with node; any other file (JSON, prompt, queue) becomes a symlink to the versioned copy.
# The versioned scripts read the workspace from KONDUCTOR_WS, so no committed file names a host path.
# Launchers run the copy in KONDUCTOR_OPS (default <ws>/worktrees/ops, a checkout of feat/bench-pilot-nk).
# Usage: bench/ops/make-launchers.sh <workspace> [--replace|--check]
#   --replace   overwrite a file that is not yet a launcher (back it up first); without it such a file is refused.
#   --check     write nothing; exit 1 when a workspace owner script is a plain file, not a launcher (see below).
#               bench/scripts/test.sh runs it when KONDUCTOR_WS is set, so the counted suite catches a drifting copy.
# A file that a running process names on its command line is never replaced (bash reads a script as it runs).
# Exit 0 when every launcher is written; 1 when any file was refused or skipped.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
WS=${1:?usage: make-launchers.sh <workspace> [--replace|--check]}
REPLACE=0
CHECK=0
case "${2:-}" in
  --replace) REPLACE=1 ;;
  --check) CHECK=1 ;;
  '') ;;
  *) echo "usage: make-launchers.sh <workspace> [--replace|--check]" >&2; exit 2 ;;
esac
# Workspace files that are not versioned on purpose: the docs owner's index, and the credential refresher (it names an
# AWS account and role).
LOCAL_ONLY=' scripts/README.md scripts/keep-creds-fresh.sh '
WS=$(cd "$WS" && pwd -P)
MARK='Launcher written by bench/ops/make-launchers.sh'
SOURCED=' kp-pilot-lib.sh standard-kit-env.sh lib.sh '
OPS_EXPR='${KONDUCTOR_OPS:-$KONDUCTOR_WS/worktrees/ops}'
RUNNING=$(ps -eo args= 2>/dev/null || true)
status=0

# dest_of REL: the workspace path for a file under bench/ops
dest_of() {
  case "$1" in
    workspace/*) echo "$WS/scripts/${1#workspace/}" ;;
    next-experiment-2026-11-22/*) echo "$WS/reports/$1" ;;
  esac
}

write_one() {   # write_one REL
  local rel=$1 dest name body
  dest=$(dest_of "$rel")
  name=$(basename "$rel")
  if grep -qF -- "$dest" <<< "$RUNNING"; then echo "skip (running): $dest"; status=1; return; fi
  if [ -e "$dest" ] && [ ! -L "$dest" ] && ! grep -qF -- "$MARK" "$dest" && [ "$REPLACE" = 0 ]; then
    echo "refused (not a launcher; back it up and pass --replace): $dest"; status=1; return
  fi
  mkdir -p "$(dirname "$dest")"
  case "$name" in
    *.sh)
      if [[ $SOURCED == *" $name "* ]]; then body=". \"$OPS_EXPR/bench/ops/$rel\""
      else body="exec bash \"$OPS_EXPR/bench/ops/$rel\" \"\$@\""; fi
      rm -f "$dest"
      printf '#!/usr/bin/env bash\n# %s; the script is bench/ops/%s in konductor.\nexport KONDUCTOR_WS=${KONDUCTOR_WS:-%s}\n%s\n' \
        "$MARK" "$rel" "$WS" "$body" > "$dest"
      chmod 755 "$dest" ;;
    *.js)
      rm -f "$dest"
      printf '#!/usr/bin/env node\n// %s; the script is bench/ops/%s in konductor.\n%s\n' "$MARK" "$rel" \
        "'use strict';
process.env.KONDUCTOR_WS ||= '$WS';
const ops = process.env.KONDUCTOR_OPS || \`\${process.env.KONDUCTOR_WS}/worktrees/ops\`;
const r = require('node:child_process').spawnSync(process.execPath, [\`\${ops}/bench/ops/$rel\`, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 1);" > "$dest"
      chmod 755 "$dest" ;;
    *)
      rm -f "$dest"
      ln -s "${KONDUCTOR_OPS:-$WS/worktrees/ops}/bench/ops/$rel" "$dest" ;;
  esac
  echo "launcher: $dest"
}

# --check: write nothing; list every workspace owner script that is a plain file instead of a launcher (a copy that can
# drift from bench/ops, or a new script never versioned), and every launcher whose versioned script is gone.
if [ "$CHECK" = 1 ]; then
  while IFS= read -r f; do
    rel=${f#"$WS"/}
    [[ $LOCAL_ONLY == *" $rel "* ]] && continue
    case "$rel" in scripts/*) src=workspace/${rel#scripts/} ;; *) src=${rel#reports/} ;; esac
    if [ -L "$f" ]; then
      [ -e "$f" ] || { echo "broken symlink (no versioned file): $f"; status=1; }
    elif grep -qF -- "$MARK" "$f"; then
      [ -e "$HERE/$src" ] || { echo "launcher with no versioned script bench/ops/$src: $f"; status=1; }
    elif [ -e "$HERE/$src" ]; then
      echo "plain copy of bench/ops/$src (it can drift; run make-launchers.sh $WS --replace after landing any edit): $f"; status=1
    else
      echo "not in bench/ops (version it under bench/ops/$src, then run make-launchers.sh): $f"; status=1
    fi
  done < <(find "$WS/scripts" \( -name __pycache__ -prune \) -o \( -type f -o -type l \) -print; find "$WS/reports/next-experiment-2026-11-22" -maxdepth 1 \( -type f -o -type l \) -name '*.sh' -print)
  [ "$status" = 0 ] && echo "ok: every workspace owner script is a launcher into bench/ops"
  exit "$status"
fi

while IFS= read -r rel; do write_one "$rel"; done < <(cd "$HERE" && find workspace next-experiment-2026-11-22 -type f | sort)
exit "$status"
