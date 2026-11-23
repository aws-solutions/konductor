#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# rebuild-arm-venv.sh -- check or rebuild the arm venv: the Python 3.12 venv the plant gateways, the arm tests and the
# full suite use (BENCH_ARM_PYTHON, --plant-python). A Kiro Crew update once removed the Python the venv was built on,
# so its bin/python gave ENOENT and every plant and arm run stopped. This script builds the venv on a Python outside the
# Kiro Crew runtime when it can, so a Crew update cannot break it again. Free: no model call. It downloads the pinned
# wheels from the pip index.
#
#   bash bench/ops/workspace/rebuild-arm-venv.sh --check     print OK, or what is wrong and the exact fix; change nothing
#   bash bench/ops/workspace/rebuild-arm-venv.sh             rebuild only when the check fails; a working venv is kept
#
# Options: --venv DIR (default $ARM_VENV, else ~/.cache/konductor-arm/venv), --python PY (the base Python 3.12; default:
# the first that runs of mise's python 3.12, /usr/bin/python3.12, /usr/local/bin/python3.12, python3.12 on PATH, and
# only then the Kiro Crew runtime's own Python, with a warning).
# The pins are bench/physical/gateway-wheels.json (cedarpy, mujoco, numpy); pip adds what mujoco needs. LD_LIBRARY_PATH
# is passed through (MuJoCo may need libffi from it).
# The old venv is kept as DIR.broken (DIR.broken.<time> when that exists). If the new build fails, the old one is put
# back. Exit 0: OK or rebuilt. 1: --check found a problem. 2: the rebuild failed (the old venv is back).
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
WHEELS=$HERE/../../physical/gateway-wheels.json
VENV=${ARM_VENV:-$HOME/.cache/konductor-arm/venv}
BASE=
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1; shift ;;
    --venv) VENV=$2; shift 2 ;;
    --python) BASE=$2; shift 2 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "usage: rebuild-arm-venv.sh [--check] [--venv DIR] [--python PY]" >&2; exit 64 ;;
  esac
done
SELF_CMD="bash bench/ops/workspace/rebuild-arm-venv.sh --venv $VENV"
say() { echo "[arm-venv] $*"; }

# The pins as "name==version" words, read with the given Python (the JSON is a flat object).
pins_of() { "$1" -c 'import json,sys; print(" ".join(f"{k}=={v}" for k, v in sorted(json.load(open(sys.argv[1])).items())))' "$WHEELS"; }

# Why the venv is not usable, or nothing when it is: the interpreter runs, is 3.12, imports the pinned modules at the
# pinned versions.
problem_of() {
  local py=$1/bin/python
  if [ -L "$py" ] && [ ! -e "$py" ]; then echo "$py does not run: its base Python $(readlink "$py") is gone"; return; fi
  [ -e "$py" ] || { echo "$py does not exist"; return; }
  "$py" -c 'pass' 2>/dev/null || { echo "$py does not run (its base Python $(readlink -f "$py" 2>/dev/null || echo '?') is gone)"; return; }
  "$py" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)' || { echo "$py is Python $("$py" -c 'import platform; print(platform.python_version())'), not 3.12"; return; }
  "$py" -I - "$WHEELS" <<'PY' || echo "$py lacks the pinned wheels"
import importlib, importlib.metadata as m, json, sys
want = json.load(open(sys.argv[1]))
def ok(name, version):
    try:
        importlib.import_module(name)
        return m.version(name) == version
    except Exception:
        return False
bad = [f"{k}=={v}" for k, v in sorted(want.items()) if not ok(k, v)]
if bad:
    print("missing or wrong: " + " ".join(bad), file=sys.stderr)
    sys.exit(1)
PY
}

# The base Python: the first candidate that runs and is 3.12, outside the Kiro Crew runtime first.
pick_base() {
  local c real crew=
  for c in $(ls -d "$HOME"/.local/share/mise/installs/python/3.12*/bin/python3.12 2>/dev/null | sort -V -r) /usr/bin/python3.12 /usr/local/bin/python3.12 $(command -v -a python3.12 2>/dev/null); do
    [ -x "$c" ] || continue
    real=$(readlink -f "$c")
    "$real" -c 'import sys, venv; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>/dev/null || continue
    case "$real" in */kirocrew-internal/*) [ -n "$crew" ] || crew=$real; continue ;; esac
    echo "$real"; return
  done
  [ -n "$crew" ] && { say "warning: only the Kiro Crew runtime's Python ($crew) is a 3.12 here; a Crew update can break this venv again" >&2; echo "$crew"; return; }
  return 1
}

why=$(problem_of "$VENV" 2>&1 || true)
if [ -z "$why" ]; then say "OK: $VENV/bin/python runs Python 3.12 with $(pins_of "$VENV/bin/python")"; exit 0; fi
if [ "$CHECK" = 1 ]; then
  say "PROBLEM: $why"
  say "fix: $SELF_CMD"
  exit 1
fi

say "rebuilding $VENV: $why"
if [ -z "$BASE" ]; then BASE=$(pick_base) || { say "STOP: no Python 3.12 found (mise, /usr/bin, /usr/local/bin, PATH); install one, e.g. 'mise install python@3.12', then rerun"; exit 2; }; fi
"$BASE" -c 'import sys; sys.exit(0 if sys.version_info[:2] == (3, 12) else 1)' 2>/dev/null || { say "STOP: --python $BASE is not a working Python 3.12"; exit 2; }
PINS=$(pins_of "$BASE")
say "base Python $BASE; pins $PINS"

old=
if [ -e "$VENV" ] || [ -L "$VENV" ]; then
  old=$VENV.broken
  [ -e "$old" ] && old=$VENV.broken.$(date -u +%Y%m%d-%H%M%S)
  mv "$VENV" "$old"
  say "kept the old venv as $old"
fi
restore() {
  rm -rf -- "$VENV"
  [ -n "$old" ] && mv "$old" "$VENV" && say "put the old venv back at $VENV"
  exit 2
}
mkdir -p "$(dirname "$VENV")"
# The venv is made at its final path: a venv moved after it is made keeps the old path in its scripts.
"$BASE" -m venv "$VENV" || { say "STOP: $BASE -m venv failed"; restore; }
# shellcheck disable=SC2086
"$VENV/bin/python" -m pip install --quiet --disable-pip-version-check --only-binary=:all: $PINS || { say "STOP: pip install $PINS failed (see above)"; restore; }
why=$(problem_of "$VENV" 2>&1 || true)
[ -z "$why" ] || { say "STOP: the new venv does not pass its check: $why (MuJoCo may need LD_LIBRARY_PATH set to the folder with libffi.so)"; restore; }
say "OK: rebuilt $VENV on $BASE with $PINS"
