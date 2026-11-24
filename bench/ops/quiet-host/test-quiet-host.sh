#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-quiet-host.sh -- free test of quiet-host.sh with a stub docker (QH_DOCKER) that records its arguments. No
# container starts, no image builds, no network. Checks the refusals, that `start` publishes no port, uses no host
# network and no privileged mode, gives the two sandbox security options and the five mounts, and that `check` and
# `wave N` run the right commands inside.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/qh-test.XXXXXX")
trap 'rm -rf -- "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

mkdir -p "$T/co/bench/runner" "$T/cs/release/tasks" "$T/normal" "$T/r/release" "$T/kiro"
touch "$T/co/bench/runner/bench.js" "$T/normal/plant-n1-target-speed.v01.json" "$T/r/release.sha256"
printf '#!/bin/sh\necho kiro-cli 3.5.0\n' > "$T/kiro/kiro-cli"; chmod +x "$T/kiro/kiro-cli"
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\n' "$T/docker.log" > "$T/docker"; chmod +x "$T/docker"
export QH_DOCKER="$T/docker" QH_CHECKOUT="$T/co" QH_CS="$T/cs" QH_NORMAL="$T/normal" QH_R="$T/r" QH_KIRO="$T/kiro/kiro-cli"
qh() { bash "$HERE/quiet-host.sh" "$@"; }

# 1. usage and refusals stop before docker runs
qh 2>/dev/null && fail "no subcommand should exit non-zero"
QH_CS=/no/such qh start 2>"$T/err" && fail "a missing counted set should stop"
grep -q 'QH_CS' "$T/err" || fail "the stop should name QH_CS"
QH_KIRO="$T/kiro" qh start 2>"$T/err" && fail "a kiro-cli that is not a file should stop"
[ ! -e "$T/docker.log" ] || fail "docker ran before the refusals passed"
echo "case 1 ok: refusals"

# 2. start: no published port, no host network, not privileged, the sandbox options, the mounts
qh start >/dev/null
run=$(grep '^run ' "$T/docker.log")
for bad in ' -p ' '--publish' '--network host' '--net=host' '--network=host' '--privileged' '--pid host' '--ipc host'; do
  case "$run" in *"$bad"*) fail "start passes $bad: $run" ;; esac
done
for want in '--security-opt seccomp=unconfined' '--security-opt systempaths=unconfined' '--security-opt no-new-privileges' \
  "$T/co:/work/konductor" "$T/cs:/work/plant-counted-set:ro" "$T/normal:/work/normal:ro" "$T/r:/var/tmp/plant-counted-r1" \
  "$T/kiro:/opt/kiro-cli:ro" 'PLANT_KBIN=/opt/kiro-cli/kiro-cli' 'PLANT_VENV=/opt/venv/bin/python' 'PATH=/opt/kiro-cli:' '--name konductor-quiet'; do
  case "$run" in *"$want"*) ;; *) fail "start lacks $want: $run" ;; esac
done
echo "case 2 ok: start is unpublished, unprivileged, own network"

# 3. check runs the sandbox probe and plant-host-check inside; wave N runs plant-wave.sh N inside
: > "$T/docker.log"
qh check >/dev/null
grep -q 'exec konductor-quiet bash -lc .*unshare -Urm true.*plant-host-check .*--out /var/tmp/plant-counted-r1' "$T/docker.log" || fail "check: $(cat "$T/docker.log")"
: > "$T/docker.log"
qh wave 2 >/dev/null
grep -q 'exec -it konductor-quiet bash /work/konductor/bench/scripts/plant-wave.sh 2' "$T/docker.log" || fail "wave: $(cat "$T/docker.log")"
qh wave 9 2>/dev/null && fail "wave 9 should be refused"
echo "case 3 ok: check and wave"

# 4. print shows the commands and runs nothing
: > "$T/docker.log"
qh print > "$T/print.txt"
grep -q 'docker run' "$T/print.txt" || fail "print shows no docker run line"
[ ! -s "$T/docker.log" ] || fail "print ran docker"
echo "case 4 ok: print"
echo "all quiet-host cases passed"
