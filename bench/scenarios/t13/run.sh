#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The T13 run script for bench/scenarios/lib/stage.js (its `run.sh <model> <cwd> <promptfile> <outprefix>` contract), with
# the owner's spend check in front of every model call. PAID when it runs a model: one `kiro-cli chat` call in an
# isolated HOME (the bench's own sandbox helpers: no steering, skills, MCP or rules; the sign-in copied in), the prompt
# read from <promptfile>, the stream written to <outprefix>.out. Before the call it reads the ledger and refuses, writing
# <outprefix>.refused instead (stage.js reads that as "spend check refused"), when:
#   - spent + 15 would pass CAP (every call counts max(15, its real credits); the counted figure is appended after the call);
#   - the model is a Claude family (the writer path is non-Claude by rule);
#   - a paid job of the owner is running (run-overnight, run-cc-compare, run-clean-fill, run-model-swap, run-nudge,
#     pilot-wave) or the load is 4 or more, unless HOST_CHECK=0.
# Copy or link it into $T13_AUTH as run.sh. Env: CAP (default 300), LEDGER (default $T13_AUTH/ledger.tsv, falling back to
# the directory of this script), KIRO (kiro-cli), BENCH_REPO (the checkout whose sandbox helpers make the HOME; default:
# this script's checkout), TIMEOUT (seconds, default 1500), HOST_CHECK.
set -u

model=${1:?model}
cwd=${2:?cwd}
promptfile=${3:?promptfile}
out=${4:?outprefix}

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BENCH_REPO=${BENCH_REPO:-$(cd "$HERE/../../.." && pwd)}
AUTH=${T13_AUTH:-$HERE}
CAP=${CAP:-300}
COUNT_MIN=15
LEDGER=${LEDGER:-$AUTH/ledger.tsv}
KIRO=${KIRO:-kiro-cli}
TIMEOUT=${TIMEOUT:-1500}
say() { echo "[t13 run $(date -u +%H:%M)] $*" >&2; }
refuse() { say "REFUSED $(basename "$out"): $*"; echo "$*" > "$out.refused"; exit 0; }

spent() { touch "$LEDGER"; awk '{ s += $3 } END { printf "%g", s + 0 }' "$LEDGER"; }
busy() {
  [ "${HOST_CHECK:-1}" = 0 ] && return 1
  pgrep -f 'run-overnight[.]sh|run-cc-compare[.]sh|run-clean-fill[.]sh|run-model-swap[.]sh|run-nudge[.]sh|pilot-wave[.]sh' >/dev/null && { echo "a paid job of the owner is running"; return 0; }
  awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l >= 4) }' && { echo "load is 4 or more"; return 0; }
  return 1
}

rm -f "$out.refused"
# A copy of this script in $T13_AUTH has no checkout above it: BENCH_REPO must then name one.
[ -f "$BENCH_REPO/bench/runner/lib/sandbox.js" ] || refuse "BENCH_REPO=$BENCH_REPO is not a bench checkout; set BENCH_REPO when run.sh is a copy outside the checkout"
case "$model" in *claude*|*anthropic*) refuse "model $model is a Claude family; the writer path is non-Claude" ;; esac
left=$(awk -v s="$(spent)" -v c="$CAP" -v m="$COUNT_MIN" 'BEGIN { print (s + m > c) ? "no" : "yes" }')
[ "$left" = yes ] || refuse "spent $(spent) counted of the $CAP cap leaves no room for one more counted call"
why=$(busy) && refuse "$why; try again when the host is quiet"

mkdir -p "$cwd"
h=$(mktemp -d "${TMPDIR:-/tmp}/t13-home.XXXXXX")
node -e 'const sb=require(process.argv[1]+"/bench/runner/lib/sandbox.js");sb.emptyKiroHome(process.argv[2]);sb.copyAuthDb(sb.defaultAuthDb(),process.argv[2]);' "$BENCH_REPO" "$h" || refuse "cannot make an isolated HOME"
say "start $(basename "$out") on $model (spent $(spent) of $CAP counted)"
rc=0
(cd "$cwd" && HOME=$h TMPDIR=$h timeout "$TIMEOUT" nice -n 19 "$KIRO" chat --no-interactive --trust-all-tools --model "$model" \
  --output-format stream-json "$(cat "$promptfile")" < /dev/null > "$out.out" 2> "$out.err") || rc=$?
node -e 'const sb=require(process.argv[1]+"/bench/runner/lib/sandbox.js");sb.removeAuthCopy(process.argv[2]);' "$BENCH_REPO" "$h" || true
real=$(node -e 'const s=require(process.argv[1]+"/bench/scenarios/lib/stage.js");try{console.log(s.streamInfo(process.argv[2]).credits.toFixed(3))}catch(e){console.log("NaN")}' "$BENCH_REPO" "$out.out")
counted=$(awk -v r="$real" -v m="$COUNT_MIN" 'BEGIN { if (r == "NaN" || r + 0 < m) print m; else print r }')
echo "$(basename "$out") $model $counted real=$real rc=$rc $(date -u +%FT%TZ)" >> "$LEDGER"
say "done $(basename "$out"): counted $counted (real $real, exit $rc); spent $(spent) of $CAP"
exit 0
