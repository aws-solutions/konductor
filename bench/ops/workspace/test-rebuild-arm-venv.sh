#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Stub test of rebuild-arm-venv.sh: no download, no real venv. A fake base Python makes a fake venv whose python
# answers the script's checks, and logs each pip install. Checks: --check on a venv whose base Python is gone prints
# the fix and changes nothing; a rebuild keeps the old venv as .broken and installs exactly the pins; a rerun on a good
# venv does nothing; a failed pip install puts the old venv back; a second rebuild keeps the first .broken.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
SCRIPT=$HERE/rebuild-arm-venv.sh
T=$(mktemp -d "${KIROCREW_SCRATCH:-/tmp}/rebuild-arm.XXXX")
trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; fails=$((fails + 1)); }

# The fake Python. As a base: `-c` code with "venv" or "version_info" passes, `-m venv DIR` makes DIR/bin/python as a
# copy of itself marked as a venv python. As a venv python: `-m pip install ...` logs its args (fails when
# FAKE_PIP_FAIL is set) and marks the venv installed; `-I -` (the pin check) passes once installed; `-c` passes.
cat > "$T/python3.12" <<'SH'
#!/usr/bin/env bash
self=$(readlink -f "$0"); dir=$(dirname "$(dirname "$self")")
case "$1" in
  -m)
    if [ "$2" = venv ]; then mkdir -p "$3/bin"; cp "$self" "$3/bin/python"; touch "$3/.fake-venv"; exit 0; fi
    if [ "$2" = pip ]; then [ -n "${FAKE_PIP_FAIL:-}" ] && exit 1; echo "${*:4}" >> "$FAKE_LOG"; touch "$dir/.installed"; exit 0; fi ;;
  -I) [ -e "$dir/.installed" ]; exit $? ;;
  -c)
    case "$2" in
      *json*) echo "cedarpy==4.12.2 mujoco==3.13.0 numpy==2.5.5"; exit 0 ;;
      *python_version*) echo 3.12.15; exit 0 ;;
      *) exit 0 ;;
    esac ;;
esac
exit 0
SH
chmod +x "$T/python3.12"
export FAKE_LOG=$T/pip.log
V=$T/venv
run() { bash "$SCRIPT" --venv "$V" --python "$T/python3.12" "$@" > "$T/out" 2>&1; }

# A venv whose bin/python points at a base Python that is gone, as after the Crew update.
mkdir -p "$V/bin" && ln -s "$T/gone/python3.12" "$V/bin/python" && echo old > "$V/marker"
run --check; rc=$?
[ "$rc" = 1 ] && grep -q "PROBLEM: .*does not run: its base Python .*gone" "$T/out" && grep -q "fix: bash bench/ops/workspace/rebuild-arm-venv.sh --venv $V" "$T/out" \
  && [ -L "$V/bin/python" ] && ok "--check names the broken base Python, prints the fix and changes nothing" || { bad "--check rc $rc"; cat "$T/out"; }

run; rc=$?
[ "$rc" = 0 ] && grep -q "OK: rebuilt $V" "$T/out" && [ -e "$V/.fake-venv" ] && [ "$(cat "$V.broken/marker" 2>/dev/null)" = old ] \
  && ok "a rebuild makes a new venv and keeps the old one as .broken" || { bad "rebuild rc $rc"; cat "$T/out"; }
[ "$(cat "$T/pip.log" 2>/dev/null)" = "--quiet --disable-pip-version-check --only-binary=:all: cedarpy==4.12.2 mujoco==3.13.0 numpy==2.5.5" ] \
  && ok "pip installs exactly the pinned wheels, binary only" || bad "pip args: $(cat "$T/pip.log" 2>/dev/null)"

: > "$T/pip.log"
run; rc=$?
[ "$rc" = 0 ] && grep -q "OK: $V/bin/python runs Python 3.12" "$T/out" && [ ! -s "$T/pip.log" ] && ok "a rerun on a good venv changes nothing" || { bad "rerun rc $rc"; cat "$T/out"; }
run --check; [ $? = 0 ] && grep -q "^\[arm-venv\] OK" "$T/out" && ok "--check on a good venv prints OK" || bad "--check on a good venv"

# A broken venv again, then a pip failure: the old venv comes back, and the first .broken stays as it was.
rm -f "$V/.installed"; echo second > "$V/marker"
FAKE_PIP_FAIL=1 run; rc=$?
[ "$rc" = 2 ] && grep -q "put the old venv back" "$T/out" && [ "$(cat "$V/marker")" = second ] && [ "$(cat "$V.broken/marker")" = old ] \
  && ok "a failed pip install puts the old venv back and keeps the first .broken" || { bad "pip failure rc $rc"; cat "$T/out"; ls -a "$T"; }

run; rc=$?
[ "$rc" = 0 ] && ls -d "$V".broken.* > /dev/null 2>&1 && [ "$(cat "$V.broken/marker")" = old ] \
  && ok "a second rebuild keeps the first .broken and names the next one by time" || { bad "second rebuild rc $rc"; cat "$T/out"; }

[ "$fails" = 0 ] && echo "all cases pass" || { echo "$fails case(s) failed"; exit 1; }
