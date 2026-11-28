#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# host-bound-tests.sh: run the tests the dev host skips because it blocks user namespaces (DEBT D-6), as one command.
# Free: no model call, no credit. Run it from a terminal or container where `unshare --user --map-root-user true`
# works. It stops at once on a host that refuses user namespaces, and fails when any test is still skipped for the
# sandbox or any test fails.
#
#   bash bench/scripts/host-bound-tests.sh          # run the eight files
#   bash bench/scripts/host-bound-tests.sh --list   # print the file names and run nothing
#
# Overrides, for the stub test only: HBT_UNSHARE (the unshare command) and HBT_NODE (the node command).
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
unshare_cmd=${HBT_UNSHARE:-unshare}
node_cmd=${HBT_NODE:-node}
files=(plant-walls.test.js isolate.test.js judge-opencode-read.test.js cap-p2-runner.test.js run-cmd-flag-legality.test.js arm-drift.test.js resume.test.js claude-code-harness.test.js)

if [ "${1:-}" = "--list" ]; then printf '%s\n' "${files[@]}"; exit 0; fi
stop() { echo "STOP: $*" >&2; exit 1; }

"$unshare_cmd" --user --map-root-user true 2>/dev/null \
  || stop "this host refuses user namespaces (unshare --user --map-root-user true fails), so the sandbox tests would skip again (DEBT D-6). Run this from your own terminal or a container that allows it."

paths=()
for f in "${files[@]}"; do paths+=("bench/runner/test/$f"); done
out=$(mktemp -d "${TMPDIR:-/tmp}/hbt.XXXXXX")
trap 'rm -rf -- "$out"' EXIT
cd "$repo"
code=0
TMPDIR=/tmp "$node_cmd" --test --test-reporter=tap "${paths[@]}" > "$out/tap" 2> "$out/err" || code=$?

count() { sed -n "s/^# $1 \([0-9][0-9]*\)\$/\1/p" "$out/tap" | tail -n 1; }
pass=$(count pass); fail=$(count fail); skipped=$(count skipped)
if [ -z "$pass" ] || [ -z "$fail" ] || [ -z "$skipped" ]; then
  tail -n 20 "$out/err" >&2 || true
  stop "no TAP summary from node (exit $code); the tests did not run to the end"
fi

# A skip whose reason names the sandbox or user namespaces should have run on this host.
grep -E '^ *ok [0-9]+ - .* # SKIP .*(namespace|unshare|sandbox)' "$out/tap" > "$out/sandbox-skips" || true
n=$(wc -l < "$out/sandbox-skips" | tr -d ' ')
echo "host-bound tests: pass $pass, fail $fail, skipped $skipped, $n skipped for the sandbox"
sed -E 's/^ *ok [0-9]+ - (.*) # SKIP (.*)$/skipped for the sandbox: \1 (\2)/' "$out/sandbox-skips"

if [ "$fail" != 0 ]; then
  grep -E '^ *not ok ' "$out/tap" | head -n 20 || true
  echo "FAIL: $fail test(s) failed" >&2; exit 1
fi
[ "$n" = 0 ] || { echo "FAIL: $n test(s) still skipped for the sandbox on a host that has user namespaces" >&2; exit 1; }
[ "$code" = 0 ] || stop "node exited $code with no failed test"
