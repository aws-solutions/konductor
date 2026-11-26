#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# test-run.sh: free test of debt-paid/run.sh and its job wrappers with a stub kiro-cli (no model, no keys, no
# spend). Bundles and prompts are built from PIN (default: the checkout this file sits in).
#   case 1: every job's --plan makes no call and no ledger line and prints its calls, counted floor and cap
#   case 2: a map job: one call per task, the reply's names filtered to the catalogue, 15 counted per call
#   case 3: a rerun skips finished calls
#   case 4: a write then its recheck: the recheck reads the writer's files; a 22-credit call counts 22
#   case 5: the cap refuses a call before it starts (writer 22 + 15 > 30)
#   case 6: a new-task writer (task-draft.json) is laid out as tasks/<id>/ for its recheck
#   case 7: another paid job running, or another debt-paid run holding the lock, refuses --go before any call
#   case 8: a call that writes no result is counted and stops the job, no retry
#   case 9: a job with a Claude model, or a recheck by its writer's own family, is refused at --plan
#   case 10: each wrapper runs its own job
#   case 11: the D-275 CardDemo recheck: its bundle holds rules, interface, hidden tests and goldens and no answer key
#            or authorship; --go needs --cap; the cap stops the job; no Claude model
set -uo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PIN=${1:-$(cd "$HERE/../../../.." && pwd)}
T=$(mktemp -d /var/tmp/debt-paid-test.XXXXXX)
trap 'pkill -P "${HOLDER:-0}" 2>/dev/null; kill "${HOLDER:-0}" "${BUSY:-0}" 2>/dev/null; rm -rf -- "$T"' EXIT
fail=0; ok() { printf 'PASS: %s\n' "$*"; }; bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

# Stub kiro-cli: whoami succeeds; chat logs "HOME model kind" and acts by what the prompt asks for.
cat > "$T/kiro" <<'SH'
#!/usr/bin/env bash
[ "$1" = whoami ] && exit 0
model=$5; prompt=$8
kind=other
case "$prompt" in *'Reply with one JSON object'*) kind=map ;; *'write `rewrite.json`'*) kind=write ;; *'task-draft.json'*) kind=author ;; *'recheck.json'*) kind=recheck ;; esac
printf '%s %s %s\n' "$HOME" "$model" "$kind" >> "$CALLS"
printf '{"type":"metadata","data":{"meteringUsage":[{"unit":"credit","value":%s}]}}\n' "${STUB_CREDITS:-0.2}"
[ -n "${STUB_NOJSON:-}" ] && exit 1
case $kind in
  map) printf '%s\n' '{"type":"runFinished","data":{"status":"success","finalText":"{\"targetSkills\":[\"code-review\",\"no-such-skill\"],\"targetSop\":\"k-verify\",\"targetAgent\":null,\"why\":\"stub\"}"}}' ;;
  write) for d in tasks/*/; do node -e 'const f=process.argv[1];const t=JSON.parse(require("fs").readFileSync(f,"utf8"));t.prompt+=" STUB-REWRITE";require("fs").writeFileSync(f,JSON.stringify(t))' "$d/task.json"; done
         echo '{"tasks":{}}' > rewrite.json ;;
  author) mkdir -p fixture hidden solution; echo x > fixture/README.md; echo y > hidden/a.test.js
          echo '{"id":"stub","prompt":"STUB-NEW","checks":[],"rubric":[]}' > task-draft.json ;;
  recheck) cat tasks/*/task.json > seen.txt; echo '{"tasks":{}}' > recheck.json ;;
esac
SH
chmod +x "$T/kiro"
run() { # run TAG JOB [ARGS]: one run of the engine with its state under $T/TAG
  local tag=$1; shift
  ROOT="$T/$tag" PIN_REPO="$PIN" PIN_CLEAN=0 KIRO="$T/kiro" HEAVY_LOCK="$T/heavy.lock" HOST_CHECK=0 JOB_LOCK="$T/job.lock" \
    PAID_PAT="${PAID_PAT:-no-such-paid-job-x9}" CALLS="$T/calls" bash "$HERE/run.sh" "$@" > "$T/log" 2>&1
}
calls() { [ -f "$T/calls" ] && wc -l < "$T/calls" | tr -d ' ' || echo 0; }
counted() { awk '{ s += $3 } END { printf "%g", s + 0 }' "$1"; }

bash -n "$HERE/run.sh" && ok "bash -n clean" || bad syntax

# case 1
for want in 'D-132 2 30 30' 'D-167 12 180 180' 'D-123 2 30 30' 'D-159 2 30 75' 'D-137 4 60 60' 'D-275 6 90 105'; do
  read -r job n floor cap <<<"$want"
  : > "$T/calls"; run p1 "$job" --plan; rc=$?
  [ "$rc" = 0 ] && [ "$(calls)" = 0 ] && grep -q "plan: $n calls, at least $floor counted of the $cap cap" "$T/log" && [ ! -s "$T/p1/ledger" ] \
    && ok "plan $job: $n calls, floor $floor, cap $cap, no call" || { bad "plan $job: rc $rc"; tail -4 "$T/log"; }
done
[ ! -e "$T/p1/pin.txt" ] && ok "a plan writes no pin" || bad "a plan wrote pin.txt"

# case 2
: > "$T/calls"; run m D-132 --go; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 2 ] && [ "$(counted "$T/m/ledger")" = 30 ] && ok "map job: 2 calls, 15 counted each" || { bad "map: rc $rc, calls $(calls)"; tail -4 "$T/log"; }
node -e 'const r=require(process.argv[1]); if (r.targetSkills.join()!=="code-review"||r.targetSop!=="k-verify") process.exit(1)' "$T/m/results/M1.json" \
  && ok "map result keeps catalogue names only" || bad "map result: $(cat "$T/m/results/M1.json" 2>/dev/null)"
grep -q 'D-132 map' "$T/m/results/M1.json" 2>/dev/null && bad "result carries a label" || true
! grep -q "^$HOME " "$T/calls" && ok "every call runs in its own HOME" || bad "HOME: $(head -1 "$T/calls")"

# case 3
: > "$T/calls"; run m D-132 --go; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 0 ] && grep -q 'M2: done, skipped' "$T/log" && ok "rerun skips finished calls" || bad "resume: calls $(calls)"

# case 4
: > "$T/calls"; STUB_CREDITS=22 run w D-159 --go; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 2 ] && [ "$(counted "$T/w/ledger")" = 44 ] && ok "write and recheck: 22 counted at 22 each" || { bad "write: rc $rc, ledger $(cat "$T/w/ledger" 2>/dev/null)"; tail -4 "$T/log"; }
grep -q STUB-REWRITE "$T/w/calls/R1/work/seen.txt" 2>/dev/null && ok "the recheck reads the writer's files" || bad "recheck did not see the rewrite"
[ -f "$T/w/results/W1/rewrite.json" ] && [ -f "$T/w/results/R1.json" ] && ok "both results kept" || bad "results: $(ls "$T/w/results")"
grep -q 'deepseek-3.2 recheck\|gpt-5.6-luna recheck' "$T/calls" && ! grep -qi claude "$T/calls" && ok "no Claude model" || bad "models: $(cat "$T/calls")"

# case 5
: > "$T/calls"; STUB_CREDITS=22 run c D-123 --go; rc=$?
[ "$rc" = 1 ] && [ "$(calls)" = 1 ] && grep -q 'REFUSED R1: spent 22 of the 30 cap' "$T/log" && ok "cap: the recheck is refused before it starts" || { bad "cap: rc $rc, calls $(calls)"; tail -3 "$T/log"; }

# case 6
: > "$T/calls"; run n D-137 --go; rc=$?
[ "$rc" = 0 ] && [ "$(calls)" = 4 ] && grep -q STUB-NEW "$T/n/calls/R1/work/tasks/t1-refactor-permission-boundary/task.json" 2>/dev/null \
  && ok "new-task writer: its draft is the recheck's tasks/<id>/task.json" || { bad "new task: rc $rc, calls $(calls)"; tail -4 "$T/log"; }
sed -n 1p "$T/calls" | grep -q ' author$' && ok "a new task gets the batch's author prompt" || bad "first D-137 call: $(sed -n 1p "$T/calls")"

# case 7
sleep 61 & BUSY=$!
: > "$T/calls"; PAID_PAT='sleep 61' run b D-132 --go; rc=$?
kill "$BUSY" 2>/dev/null; wait "$BUSY" 2>/dev/null
[ "$rc" = 1 ] && [ "$(calls)" = 0 ] && grep -q 'STOP: another paid job runs' "$T/log" && ok "another paid job: refused, no call" || { bad "busy: rc $rc"; tail -2 "$T/log"; }
flock -x "$T/job.lock" sleep 60 & HOLDER=$!; sleep 0.3
: > "$T/calls"; run l D-132 --go; rc=$?
pkill -P "$HOLDER" 2>/dev/null; kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
[ "$rc" = 1 ] && [ "$(calls)" = 0 ] && grep -q 'STOP: another debt-paid run holds' "$T/log" && ok "the job lock: refused, no call" || { bad "lock: rc $rc"; tail -2 "$T/log"; }

# case 8
: > "$T/calls"; STUB_NOJSON=1 run j D-132 --go; rc=$?
[ "$rc" = 1 ] && [ "$(calls)" = 1 ] && [ "$(wc -l < "$T/j/ledger")" = 1 ] && grep -q 'NORESULT M1' "$T/log" && ok "no result: counted, the job stops, no retry" || { bad "noresult: rc $rc"; tail -2 "$T/log"; }

# case 9
printf 'cap X 30\nX A1 map claude-sonnet-5.5 - t8-heldout-rollback-decision\n' > "$T/jobs-claude.txt"
JOBS="$T/jobs-claude.txt" run q X --plan; rc=$?
[ "$rc" = 1 ] && grep -q 'A1 uses a Claude family' "$T/log" && ok "Claude model refused" || bad "claude: rc $rc; $(tail -1 "$T/log")"
printf 'cap Y 30\nY W1 write deepseek-3.2 - t5-qa-flaky-fix\nY R1 recheck deepseek-3.2 W1 t5-qa-flaky-fix\n' > "$T/jobs-same.txt"
JOBS="$T/jobs-same.txt" run s Y --plan; rc=$?
[ "$rc" = 1 ] && grep -q "R1 rechecks W1 with the writer's own family" "$T/log" && ok "same-family recheck refused" || bad "same family: rc $rc; $(tail -1 "$T/log")"

# case 10
for w in d132-map:D-132 d167-remap:D-167 d123-limiter:D-123 d159-rewrite:D-159 d137-refactor:D-137; do
  f=$HERE/../run-debt-${w%%:*}.sh
  ROOT="$T/wr" PIN_REPO="$PIN" PIN_CLEAN=0 KIRO="$T/kiro" HOST_CHECK=0 bash "$f" --plan > "$T/log" 2>&1
  grep -q "job ${w#*:}:" "$T/log" && ok "run-debt-${w%%:*}.sh plans ${w#*:}" || { bad "wrapper ${w%%:*}"; tail -2 "$T/log"; }
done

# case 11
W=$HERE/../run-debt-d275-cx-recheck.sh
cx() { ROOT="$T/cx" PIN_REPO="$PIN" PIN_CLEAN=0 KIRO="$T/kiro" HEAVY_LOCK="$T/heavy.lock" HOST_CHECK=0 JOB_LOCK="$T/job.lock" \
  PAID_PAT=no-such-paid-job-x9 CALLS="$T/calls" bash "$W" "$@" > "$T/log" 2>&1; }
: > "$T/calls"; cx --go; rc=$?
[ "$rc" = 64 ] && [ "$(calls)" = 0 ] && ok "D-275 --go without --cap is refused, no call" || { bad "D-275 no cap: rc $rc"; tail -2 "$T/log"; }
: > "$T/calls"; cx --go --cap 10; rc=$?
[ "$rc" = 64 ] && [ "$(calls)" = 0 ] && ok "D-275 --cap under 15 is refused" || bad "D-275 cap 10: rc $rc"
: > "$T/calls"; cx --go --cap 35; rc=$?
[ "$rc" = 1 ] && [ "$(calls)" = 2 ] && [ "$(counted "$T/cx/ledger")" = 30 ] && grep -q 'REFUSED C3: spent 30 of the 35 cap' "$T/log" \
  && ok "D-275 --cap 35: two calls, the third refused" || { bad "D-275 cap 35: rc $rc, calls $(calls)"; tail -3 "$T/log"; }
B=$T/cx/calls/C4/work/tasks/cx-carddemo-batchday
: > "$T/calls"; cx --go --cap 90; rc=$?
[ "$(calls)" = 4 ] && [ -f "$B/fixture/docs/REQUIREMENTS.md" ] && [ -f "$B/fixture/docs/INTERFACE.md" ] && [ -d "$B/hidden/golden" ] && ls "$B"/hidden/*.test.js > /dev/null 2>&1 \
  && ok "D-275 bundle: rules, interface, hidden tests, goldens" || { bad "D-275 bundle: $(ls "$B" "$B/hidden" 2>&1 | head -5)"; tail -2 "$T/log"; }
[ ! -e "$B/fixture/.bench-answer-key.md" ] && ! grep -q '"authorship"\|"review"' "$B/task.json" && ok "D-275 bundle: no answer key, authorship or review" || bad "D-275 bundle leaks the key or authorship"
grep -q 'gpt-5.6-luna recheck' "$T/calls" && grep -q 'deepseek-3.2 recheck' "$T/calls" && ! grep -qi claude "$T/calls" && ok "D-275: three non-Claude families" || bad "D-275 models: $(cat "$T/calls")"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"
