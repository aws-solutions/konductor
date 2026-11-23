#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The free toy walkthrough (DEBT D-82): build the public toy release, test its policy, run the scripted controls on it
# as Claude Code, then write the plant report and a call-by-call trace. No model, no credits, no AWS keys, no login.
# Needs Node 22+ and a Python with cedarpy:
#
#   python3 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2
#   bash bench/physical/toy/walkthrough.sh
#
# Everything goes under one new dir outside the repo and HOME (TOY_WORK, default a new /tmp/konductor-toy.XXXXXX).
# Overrides (env): TOY_PYTHON (default <repo>/.venv/bin/python), TOY_WORK, TOY_STRANDS_PYTHON (a Python with
# strands-agents: also runs the Strands controls on the scripted fake model, step 6).
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
PY=${TOY_PYTHON:-$REPO/.venv/bin/python}
BENCH=(node "$REPO/bench/runner/bench.js")
CONTROLS="$REPO/bench/physical/controls"
"$PY" -c 'import cedarpy' 2>/dev/null || { echo "STOP: $PY has no cedarpy; run: python3 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2" >&2; exit 1; }
WORK=${TOY_WORK:-$(mktemp -d /tmp/konductor-toy.XXXXXX)}
export TMPDIR=/tmp   # Claude Code runs refuse a scratch dir under HOME

step() { printf '\n== %s\n' "$*"; }

step "1. build and sign the toy release (toy key, public on purpose)"
node "$REPO/bench/physical/toy/toy-release.js" "$WORK" | tee "$WORK/release.txt"
REL="$WORK/release"
SHA=$(sed -n 's/^manifest SHA-256: //p' "$WORK/release.txt")
TASKS=$(sed -n 's/^tasks: //p' "$WORK/release.txt")

step "2. plant-policy-test: every truth-table cell against a test-mode gateway"
"${BENCH[@]}" plant-policy-test --release "$REL" --python "$PY"

step "3. the careful operator and the unsafe agent, as Claude Code, on both arms (controls: no model)"
# No --model: a scripted control calls no model. The run config still records the runner's default model id, and the
# plant report reads the run as a TOY control suite, never as a model result (D-191).
for control in careful-operator unsafe-agent; do
  "${BENCH[@]}" run --suite lite --tasks "$TASKS" --arms cc-plant-policy,cc-plant-allowall \
    --claude-bin "$CONTROLS/$control-claude" \
    --plant-release "$REL" --plant-release-sha256 "$SHA" --extra-tasks "$REL/tasks" --plant-python "$PY" \
    --isolate none --allow-unisolated --parallel 1 --replicates 1 --out "$WORK/runs/$control" > "$WORK/run-$control.log" 2>&1 \
    || { echo "STOP: the $control run failed; see $WORK/run-$control.log" >&2; exit 1; }
  echo "$control: $(grep -o 'finished: .*' "$WORK/run-$control.log" | tail -1)"
done

step "4. plant-report: the control suites against what each must show"
"${BENCH[@]}" plant-report --run "$WORK/runs/careful-operator,$WORK/runs/unsafe-agent" --release "$REL" --out "$WORK/report"
sed -n '/^## Controls/,$p' "$WORK/report/plant-report.md"

step "5. plant-trace: the unsafe agent on the guard probe, allow-all above the policy arm"
TRIAL="$WORK/runs/unsafe-agent/cc-plant-allowall/toy-p2-guard-moving.v01/1"
"${BENCH[@]}" plant-trace --run "$TRIAL" --vs "$WORK/runs/unsafe-agent/cc-plant-policy/toy-p2-guard-moving.v01/1" --out "$WORK/trace.html"

if [ -n "${TOY_STRANDS_PYTHON:-}" ]; then
  # A plant report covers one adapter kind, so the Strands runs (kind B, forwarding stubs) get a report of their own.
  step "6. (TOY_STRANDS_PYTHON set) the Strands controls on the scripted fake model, and their own plant report"
  for control in do-nothing path unsafe-agent; do
    "${BENCH[@]}" run --suite lite --tasks "$TASKS" --arms st-plant-policy,st-plant-allowall \
      --model "fake:$CONTROLS/strands/$control-strands.json" --strands-python "$TOY_STRANDS_PYTHON" \
      --plant-release "$REL" --plant-release-sha256 "$SHA" --extra-tasks "$REL/tasks" --plant-python "$PY" \
      --isolate none --allow-unisolated --parallel 1 --replicates 1 --out "$WORK/strands/$control" > "$WORK/strands-$control.log" 2>&1 \
      || { echo "STOP: the Strands $control run failed; see $WORK/strands-$control.log" >&2; exit 1; }
    echo "strands $control: $(grep -o 'finished: .*' "$WORK/strands-$control.log" | tail -1)"
  done
  "${BENCH[@]}" plant-report --run "$WORK/strands/do-nothing,$WORK/strands/path,$WORK/strands/unsafe-agent" --release "$REL" --out "$WORK/report-strands"
  sed -n '/^## Controls/,$p' "$WORK/report-strands/plant-report.md"
fi

step "done"
echo "report: $WORK/report/plant-report.md"
echo "trace:  $WORK/trace.html (open it in a browser; it is one offline page)"
echo "Remove $WORK when you are done."
