#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
#
# Runs the Playwright tests against the real server, `konductor flow view`, with a stand-in `kiro-cli` first on the
# PATH, as cli/konductor-rs/tests/flow_kiro_e2e.rs does. The stand-in waits two seconds and reports success, so a run
# shows a stage that is `Running`. The harness is `kiro-cli`, which is what the stub reports too.
#
# Usage: scripts/e2e-real.sh <path to the konductor binary> [playwright arguments]
#
# The project, the home folder and the stand-in are made in a temporary folder that is removed at the end. The launch
# code of the server works once and for 60 seconds, so Playwright starts as soon as the server prints its address, and
# gets the code from WC_LAUNCH_CODE.
set -euo pipefail

bin=$(realpath "${1:?usage: scripts/e2e-real.sh <path to the konductor binary> [playwright arguments]}")
shift
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
server=""
cleanup() {
  if [ -n "$server" ]; then
    kill -TERM "$server" 2>/dev/null || true
    # `flow view` ends its sessions before it exits, so wait for it before the folder it uses is removed.
    wait "$server" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

cd "$here"
npm run build >/dev/null

mkdir -p "$work/project/.konductor/workflows" "$work/project/.kiro/agents" "$work/home" "$work/fake-bin"
node -e "import('./stub-api/core/sample.ts').then((m) => process.stdout.write(m.SAMPLE_FILES.hello))" \
  >"$work/project/.konductor/workflows/hello.yml"
for agent in k-developer k-quality-assurance; do
  # Kiro finds an agent by the `name` in its JSON, so each file names its own agent.
  echo "{\"name\":\"$agent\",\"allowedTools\":[\"fs_read\",\"fs_write\"]}" >"$work/project/.kiro/agents/$agent.json"
done
cat >"$work/fake-bin/kiro-cli" <<'SCRIPT'
#!/bin/sh
sleep 2
echo 'KONDUCTOR_RESULT {"status": "success", "outputs": []}'
SCRIPT
chmod +x "$work/fake-bin/kiro-cli"

# The subshell ends in `exec`, so `$!` of the server below is the PID of konductor itself.
konductor_env() {
  env HOME="$work/home" PATH="$work/fake-bin:$PATH" KONDUCTOR_CANVAS_DIR="$here/dist" "$bin" "$@"
}

(cd "$work/project" && konductor_env flow trust hello --yes) >/dev/null
(cd "$work/project" && exec env HOME="$work/home" PATH="$work/fake-bin:$PATH" KONDUCTOR_CANVAS_DIR="$here/dist" \
  "$bin" flow view hello --harness kiro-cli) >"$work/address" </dev/null &
server=$!
for _ in $(seq 1 100); do
  [ -s "$work/address" ] && break
  sleep 0.1
done
address=$(head -1 "$work/address")
case "$address" in
  http://127.0.0.1:*/#*) ;;
  *) echo "flow view printed no launch address" >&2; exit 1 ;;
esac
origin=${address%%/#*}
code=${address##*/#}

# Eight cases are left out, each for a feature that the real server does not have yet:
# - "shows what the server says about a param it refuses" (next-run-params.spec.ts): the engine does not read declared
#   params yet (slice 2); the real server answers "Only a goal is allowed."; removed by follow-up 27.
# - the seven cases of library.spec.ts that open the library list, copy from it or check its accessibility: the real
#   server does not serve the workflow library yet; removed by follow-up 28.
skipped='shows what the server says about a param it refuses|lists ready and planned workflows with focusable'
skipped="$skipped unavailable actions|has no accessibility violations in the Library in both themes"
skipped="$skipped|lists and opens a ready library workflow read-only|keeps a planned workflow unavailable with its reason"
skipped="$skipped|keeps Start from unavailable while a run is active|shows a copy refusal when a run starts after the dialog"
skipped="$skipped open|reports a workflow name clash without closing the dialog"
WC_API_TARGET="$origin" WC_LAUNCH_CODE="$code" \
  npx playwright test --grep-invert "$skipped" "$@"
