#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# The free toy walkthrough (DEBT D-82): build the public toy release, test its policy, run the scripted controls on it
# as Claude Code, then write the plant report and a call-by-call trace. No model, no credits, no AWS keys, no login.
# Needs Node 22+ and a Python with cedarpy:
#
#   python3.12 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2     # Python 3.10 or newer
#   bash bench/physical/toy/walkthrough.sh
#
# Everything goes under one new dir outside the repo and HOME (TOY_WORK, default a new /tmp/konductor-toy.XXXXXX).
# Overrides (env): TOY_PYTHON (default <repo>/.venv/bin/python), TOY_WORK, TOY_STRANDS_PYTHON (a Python with
# strands-agents: also runs the Strands controls on the scripted fake model, step 6), TOY_ARM_PYTHON (a Python 3.12
# with mujoco and cedarpy: also builds the toy arm release and runs the two arm controls on it, step 7).
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
PY=${TOY_PYTHON:-$REPO/.venv/bin/python}
BENCH=(node "$REPO/bench/runner/bench.js")
CONTROLS="$REPO/bench/physical/controls"
# cedarpy 4.12.2 ships no wheel for Python 3.9 or older, so name the version before pip fails on it.
if ! "$PY" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
  echo "STOP: $PY is missing or older than Python 3.10 (cedarpy 4.12.2 needs 3.10+); run: python3.12 -m venv .venv && .venv/bin/pip install cedarpy==4.12.2" >&2
  exit 1
fi
"$PY" -c 'import cedarpy' 2>/dev/null || { echo "STOP: $PY has no cedarpy; run: .venv/bin/pip install cedarpy==4.12.2 (the venv needs Python 3.10 or newer)" >&2; exit 1; }
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

if [ -n "${TOY_ARM_PYTHON:-}" ]; then
  # The robot arm: its own toy release (plant-toy-arm-v1), the same two controls as Claude Code, and its own report.
  step "7. (TOY_ARM_PYTHON set) the arm: toy arm release, policy test, the two arm controls on both arms, report"
  node "$REPO/bench/physical/toy/toy-release.js" "$WORK/arm" --arm "$TOY_ARM_PYTHON" | tee "$WORK/arm-release.txt"
  AREL="$WORK/arm/release"
  ASHA=$(sed -n 's/^manifest SHA-256: //p' "$WORK/arm-release.txt")
  ATASKS=$(sed -n 's/^tasks: //p' "$WORK/arm-release.txt")
  "${BENCH[@]}" plant-policy-test --release "$AREL" --python "$TOY_ARM_PYTHON" | tail -n 1
  for control in arm-careful-operator arm-unsafe-agent; do
    "${BENCH[@]}" run --suite lite --tasks "$ATASKS" --arms cc-plant-policy,cc-plant-allowall \
      --claude-bin "$CONTROLS/$control-claude" --model us.anthropic.claude-sonnet-5-5 \
      --plant-release "$AREL" --plant-release-sha256 "$ASHA" --extra-tasks "$AREL/tasks" --plant-python "$TOY_ARM_PYTHON" \
      --isolate none --allow-unisolated --parallel 1 --replicates 1 --out "$WORK/arm-runs/$control" > "$WORK/arm-run-$control.log" 2>&1 \
      || { echo "STOP: the arm $control run failed; see $WORK/arm-run-$control.log" >&2; exit 1; }
    echo "$control: $(grep -o 'finished: .*' "$WORK/arm-run-$control.log" | tail -1)"
  done
  "${BENCH[@]}" plant-report --run "$WORK/arm-runs/arm-careful-operator,$WORK/arm-runs/arm-unsafe-agent" --release "$AREL" --out "$WORK/report-arm"
  sed -n '/^## Controls/,$p' "$WORK/report-arm/plant-report.md"
fi

step "done"
echo "report: $WORK/report/plant-report.md${TOY_ARM_PYTHON:+ (arm: $WORK/report-arm/plant-report.md)}"
echo "trace:  $WORK/trace.html (open it in a browser; it is one offline page)"
echo "Remove $WORK when you are done."
