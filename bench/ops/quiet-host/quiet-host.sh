#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# quiet-host.sh -- the quiet host for a counted plant run (D-95), as one container on the owner's dev host. Run from the
# owner's own terminal, never from an agent. Steps and why each flag is there: bench/ops/quiet-host/README.md.
#
#   bash quiet-host.sh print          # free: the docker commands it would run, nothing else
#   bash quiet-host.sh build          # build the image (Node 22, Python 3.12 + cedarpy; about 5 minutes)
#   bash quiet-host.sh start          # start the container: own network, no published port, not privileged
#   bash quiet-host.sh login          # kiro-cli login inside (device code); once per container
#   bash quiet-host.sh check          # free: unshare probe, then bench plant-host-check; must end "YES"
#   bash quiet-host.sh wave N         # plant-wave.sh N inside (N 1 to 4; --plan / --prepare-only pass through)
#   bash quiet-host.sh shell          # a shell inside
#   bash quiet-host.sh stop           # remove the container (the wave dir on the host stays)
#
# Inputs (env): QH_CHECKOUT a konductor checkout of feat/bench-pilot-nk for the run (not the ops checkout; it is
# mounted read-write); QH_CS the private counted-set folder (read-only); QH_NORMAL the folder of plant-n*.json normal
# tasks (read-only; wave 4); QH_R the wave dir with the signed release, default /var/tmp/plant-counted-r1; QH_KIRO the
# native pinned kiro-cli binary (read-only). QH_DOCKER the docker command (tests). QH_UID the owner's uid (default id -u).

set -euo pipefail
DOCKER=${QH_DOCKER:-docker}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
IMAGE=konductor-quiet-host:1
NAME=konductor-quiet
R_IN=/var/tmp/plant-counted-r1
stop() { printf 'STOP: %s\n' "$*" >&2; exit 1; }

usage() { sed -n '8,16p' "${BASH_SOURCE[0]}" | sed 's/^# //'; }
[ $# -ge 1 ] || { usage >&2; exit 64; }
CMD=$1; shift

# Every input is bound here, at the top, so each subcommand sees the same values under set -u.
CHECKOUT=${QH_CHECKOUT:-}; CS=${QH_CS:-}; NORMAL=${QH_NORMAL:-}; R=${QH_R:-$R_IN}; KIRO=${QH_KIRO:-}; UID_=${QH_UID:-$(id -u)}

inputs_ok() {
  [ -n "$CHECKOUT" ] && [ -f "$CHECKOUT/bench/runner/bench.js" ] || stop "set QH_CHECKOUT to a konductor checkout of feat/bench-pilot-nk (its bench/runner/bench.js must exist)"
  [ -n "$CS" ] && [ -d "$CS/release/tasks" ] || stop "set QH_CS to the private counted-set folder (it must hold release/tasks)"
  [ -n "$NORMAL" ] && compgen -G "$NORMAL/plant-n*.json" >/dev/null || stop "set QH_NORMAL to a folder of plant-n*.json normal tasks (for example the plant-r2 release tasks)"
  [ -d "$R/release" ] && [ -f "$R/release.sha256" ] || stop "QH_R ($R) must hold the signed release/ and release.sha256 from wave 0"
  [ -n "$KIRO" ] && [ -f "$KIRO" ] && [ -x "$KIRO" ] || stop "set QH_KIRO to the native pinned kiro-cli binary (a file; the one whose sha256 the release pins)"
  kiro_pin_ok
}

# The release pins the kiro-cli build by sha256. Stop here, not after the image build and the login, when QH_KIRO is
# another build (toolbox removes old versions, and kiro-cli 3.5.0 once updated itself over its own file: D-305).
kiro_pin_ok() {
  local want have
  [ -f "$R/release/manifest.json" ] || stop "$R/release/manifest.json is missing, so the kiro-cli pin cannot be read"
  want=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).versions?.kiroCli?.sha256 ?? "")' "$R/release/manifest.json")
  [ -n "$want" ] || stop "the release at $R/release pins no kiro-cli (manifest versions.kiroCli.sha256)"
  have=$(sha256sum "$KIRO" | cut -d' ' -f1)
  [ "$have" = "$want" ] || stop "QH_KIRO ($KIRO) is not the pinned kiro-cli: its sha256 is $have, the release pins $want. Find that build (sha256sum each candidate) or cut a new release that pins the build you have"
}

# The container's own network namespace has no listeners, which the quiet-host gate needs. The two security options let
# bench's own sandbox (unshare: user, mount and pid namespaces, a fresh /proc) start inside; docker's default seccomp
# profile and its masked /proc paths block that. The container is not privileged, gets no new privileges, publishes no
# port and shares no host namespace.
RUN_ARGS=()
run_args() {
  RUN_ARGS=(run -d --name "$NAME" --hostname quiet-host
    --security-opt seccomp=unconfined --security-opt systempaths=unconfined --security-opt no-new-privileges
    -v "$CHECKOUT:/work/konductor" -v "$CS:/work/plant-counted-set:ro" -v "$NORMAL:/work/normal:ro"
    -v "$R:$R_IN" -v "$(dirname "$KIRO"):/opt/kiro-cli:ro"
    -e PLANT_CHECKOUT=/work/konductor -e PLANT_CS=/work/plant-counted-set -e PLANT_NORMAL=/work/normal -e PLANT_R=$R_IN
    -e "PLANT_KBIN=/opt/kiro-cli/$(basename "$KIRO")" -e PLANT_VENV=/opt/venv/bin/python -e TMPDIR=/tmp
    -e PATH=/opt/kiro-cli:/usr/local/bin:/usr/bin:/bin
    "$IMAGE" sleep infinity)
}

CHECK="unshare -Urm true && echo sandbox-ok && node /work/konductor/bench/runner/bench.js plant-host-check --release $R_IN/release --release-sha256 \$(cat $R_IN/release.sha256) --plant-python /opt/venv/bin/python --kiro-bin \$PLANT_KBIN --out $R_IN"

case "$CMD" in
  print)
    inputs_ok; run_args
    echo "$DOCKER build --build-arg UID=$UID_ -t $IMAGE $HERE"
    echo "$DOCKER ${RUN_ARGS[*]}"
    echo "$DOCKER exec -it $NAME /opt/kiro-cli/$(basename "$KIRO") login"
    echo "$DOCKER exec $NAME bash -lc '$CHECK'"
    ;;
  build) "$DOCKER" build --build-arg "UID=$UID_" -t "$IMAGE" "$HERE" ;;
  start) inputs_ok; run_args; "$DOCKER" "${RUN_ARGS[@]}" ;;
  login) "$DOCKER" exec -it "$NAME" bash -lc '"$PLANT_KBIN" login' ;;
  check) "$DOCKER" exec "$NAME" bash -lc "$CHECK" ;;
  wave)
    [ $# -ge 1 ] && [[ "$1" =~ ^[1-4]$ ]] || stop "wave needs N from 1 to 4 (wave 0 ran on the dev box)"
    "$DOCKER" exec -it "$NAME" bash /work/konductor/bench/scripts/plant-wave.sh "$@" ;;
  shell) "$DOCKER" exec -it "$NAME" bash ;;
  stop) "$DOCKER" rm -f "$NAME" ;;
  *) usage >&2; exit 64 ;;
esac
