#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-cc-plant-check-v2.sh -- the first REAL Claude Code plant check (docs/physical-ai-claude-code.md, Still open). PAID:
# two trials on Bedrock, one cc-plant-allowall and one cc-plant-policy, on one arm task of the signed arm release, each
# capped at USD 1 by claude itself (--run-budget-usd 1) and the command at USD 2 (--budget-usd 2). Worst case USD 2.
#
# It checks, from each trial's own files: the trial completed with zero stream-to-gateway mismatches; the real binary
# read the plant MCP config (the init line lists the plant server, connected) and named the plant tools
# mcp__plant__<tool>; it offered no Task, Agent or other spawn tool; and the run cost no more than its cap.
#
#   bash scripts/run-cc-plant-check-v2.sh --dry-run   # FREE: the same command with the scripted-calls Claude Code control
#                                                  # as --claude-bin (no model, no keys); checks every rule but the cost
#   CC_AWS_PROFILE=<profile> bash scripts/run-cc-plant-check-v2.sh   # PAID, owner only: the real claude, keys of that profile
#
# Waits for the heavy lock (/var/tmp/konductor-heavy.lock), so it never runs during another heavy job. With no
# PLANT_CHECKOUT it runs on its own checkout (konductor-plant/.worktrees/cc-check), moved to the feat/bench-pilot-nk head.
# Overrides (env): PLANT_CHECKOUT, PLANT_VENV, PLANT_FFI, ARM_RELEASE, ARM_SHA, CC_TASK, CC_CLAUDE_BIN, CC_MODEL,
# CC_WORKSPACE, CC_HEAVY_LOCK, CC_OUT_ROOT (the last three for scripts/test-run-cc-plant-check-v2.sh).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
DRY=0; for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,18p' "$0"; exit 0 ;; *) echo "unknown arg $a" >&2; exit 64 ;; esac; done

W=${CC_WORKSPACE:-$KONDUCTOR_WS}
CHECKOUT=${PLANT_CHECKOUT:-}
if [ -z "$CHECKOUT" ]; then
  # Its own detached checkout of the feat/bench-pilot-nk head (never another session's worktree), moved on every run.
  CLONE=$W/worktrees/konductor-plant
  CHECKOUT=$CLONE/.worktrees/cc-check
  git -C "$CLONE" fetch -q origin feat/bench-pilot-nk || { echo "STOP: git fetch failed" >&2; exit 1; }
  CC_HEAD=$(git -C "$CLONE" rev-parse origin/feat/bench-pilot-nk)
  if [ -e "$CHECKOUT" ]; then
    [ -z "$(git -C "$CHECKOUT" status --porcelain)" ] || { echo "STOP: $CHECKOUT has local changes" >&2; exit 1; }
    git -C "$CHECKOUT" checkout -q --detach "$CC_HEAD"
  else
    git -C "$CLONE" worktree add -q --detach "$CHECKOUT" "$CC_HEAD"
  fi
  echo "checkout: $CHECKOUT at $(git -C "$CHECKOUT" log --oneline -1 | cut -c1-72)"
fi
VENV=${PLANT_VENV:-/home/$USER/.cache/konductor-arm/venv}
FFI=${PLANT_FFI:-/local/apollo/package/local_1/AL2023_x86_64/Libffi/Libffi-119967.0-0/lib}
ARM_RELEASE=${ARM_RELEASE:-/var/tmp/plant-arm-release/release}
ARM_SHA=${ARM_SHA:-bcaa554d17e2f31ae382a79f6aa8b325f04b867a2899b5d0ca6f59dd412a79a8}
TASK=${CC_TASK:-plant-a2-door-no-approval.v01}
MODEL=${CC_MODEL:-us.anthropic.claude-sonnet-5-5}
RUN_CAP_USD=1
TOTAL_CAP_USD=2
HEAVY_LOCK=${CC_HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
OUT_ROOT=${CC_OUT_ROOT:-/var/tmp}   # outside home and the repo, as bench requires for plant paths
TS=$(date -u +%Y%m%d-%H%M%S)
# v2: `|| true`, because under set -e a failed `[ ]` in the substitution made the paid path exit 1 here with no message.
LOGDIR="$W/reports/cc-plant-check-$TS$([ "$DRY" = 1 ] && echo -dry || true)"
stop() { echo "STOP: $*" >&2; exit 1; }

[ -f "$CHECKOUT/bench/runner/bench.js" ] || stop "no bench at $CHECKOUT (set PLANT_CHECKOUT)"
[ -f "$ARM_RELEASE/manifest.json.sig" ] || stop "no signed arm release at $ARM_RELEASE"
[ "$(sha256sum "$ARM_RELEASE/manifest.json" | cut -d' ' -f1)" = "$ARM_SHA" ] || stop "$ARM_RELEASE is not the release $ARM_SHA"
[ -f "$ARM_RELEASE/tasks/$TASK.json" ] || stop "no task $TASK in the release"
LD_LIBRARY_PATH="$FFI" "$VENV/bin/python" -c 'import mujoco, cedarpy' 2>/dev/null || stop "the arm venv $VENV lacks mujoco or cedarpy"

AUTH=()
if [ "$DRY" = 1 ]; then
  CLAUDE="$CHECKOUT/bench/physical/controls/arm-scripted-calls-claude"
  [ -e "$CLAUDE" ] || stop "no Claude Code plant control at $CLAUDE (the checkout predates D-113)"
  echo "dry run: the scripted-calls Claude Code control stands in for claude; no model, no keys, no cost"
else
  CLAUDE=${CC_CLAUDE_BIN:-$(ls -d "$HOME"/.toolbox/tools/claude-code/*/claude 2>/dev/null | sort -V | tail -1)}
  [ -x "${CLAUDE:-}" ] || stop "no real claude binary (set CC_CLAUDE_BIN to <tools>/claude-code/<version>/claude)"
  [ -n "${CC_AWS_PROFILE:-}" ] || stop "a paid run needs CC_AWS_PROFILE, the AWS profile whose keys claude may use"
  AUTH=(--aws-profile "$CC_AWS_PROFILE")
  echo "PAID: 2 trials on $MODEL with $CLAUDE, at most USD $RUN_CAP_USD each and USD $TOTAL_CAP_USD in all"
fi
mkdir -p "$LOGDIR"
OUT=$(mktemp -d "$OUT_ROOT/cc-plant-check-$TS.XXXXXX")   # v2: made after the checks, so a STOP leaves no dir

if [ "$DRY" = 0 ]; then   # a paid run never overlaps another heavy job; the dry run is two scripted trials
  exec 9>"$HEAVY_LOCK"
  echo "waiting for the heavy lock $HEAVY_LOCK ..."
  flock -x 9
fi

LD_LIBRARY_PATH="$FFI" BENCH_ARM_PYTHON="$VENV/bin/python" TMPDIR=/tmp nice -n 19 \
  node "$CHECKOUT/bench/runner/bench.js" run --suite lite --tasks "$TASK" --arms cc-plant-allowall,cc-plant-policy \
    --claude-bin "$CLAUDE" --model "$MODEL" "${AUTH[@]}" --run-budget-usd "$RUN_CAP_USD" --budget-usd "$TOTAL_CAP_USD" \
    --plant-release "$ARM_RELEASE" --plant-release-sha256 "$ARM_SHA" --extra-tasks "$ARM_RELEASE/tasks" \
    --hide "$CHECKOUT" --python "$VENV/bin/python" --plant-python "$VENV/bin/python" \
    --isolate none --allow-unisolated --parallel 1 --replicates 1 --out "$OUT" > "$LOGDIR/bench.log" 2>&1 || true

set +e
OUT="$OUT" TASK="$TASK" CAP="$RUN_CAP_USD" DRY="$DRY" python3 - <<'PY' | tee "$LOGDIR/verdict.txt"
import json, os, sys
out, task, cap, dry = os.environ["OUT"], os.environ["TASK"], float(os.environ["CAP"]), os.environ["DRY"] == "1"
SPAWN = {"Task", "Agent", "Workflow", "SendMessage"}
fails, total = [], 0.0
for arm in ("cc-plant-allowall", "cc-plant-policy"):
    d = os.path.join(out, arm, task, "1")
    try:
        r = json.load(open(os.path.join(d, "result.json")))
        events = [json.loads(l) for l in open(os.path.join(d, "stream.jsonl")) if l.strip()]
    except (OSError, ValueError) as e:
        fails.append(f"{arm}: no readable result or stream ({e})"); continue
    p = r.get("plant") or {}
    init = next((e for e in events if e.get("type") == "system" and e.get("subtype") == "init"), {})
    uses = [b.get("name", "") for e in events if e.get("type") == "assistant" for b in (e.get("message") or {}).get("content") or [] if b.get("type") == "tool_use"]
    plant_uses = [u for u in uses if u.startswith("mcp__plant__")]
    raw_cost = r.get("costUsd")
    cost = raw_cost or 0.0
    total += cost
    checks = {
        "trial complete": p.get("runState") == "complete",
        "zero mismatches": (p.get("counts") or {}).get("mismatches") == 0,
        "plant server connected in init": any(s.get("name") == "plant" and s.get("status") == "connected" for s in init.get("mcp_servers") or []),
        "plant calls named mcp__plant__<tool>": bool(plant_uses) and len(plant_uses) == (p.get("counts") or {}).get("calls"),
        "no spawn tool offered": not (SPAWN & set(init.get("tools") or [])) and not (SPAWN & set(uses)),
        # A paid trial must report its cost (a run killed before its result line reports none); the control costs 0.
        "cost reported and within the run cap": (raw_cost is not None or dry) and cost <= cap,
    }
    for name, ok in checks.items():
        print(f"{arm}: {'ok  ' if ok else 'FAIL'} {name}")
        if not ok: fails.append(f"{arm}: {name}")
    print(f"{arm}: {len(plant_uses)} plant call(s), safety {p.get('safety')}, cost USD {cost:.4f}")
print(f"total cost USD {total:.4f}{' (dry run: no model)' if dry else ''}")
if fails:
    print("FAIL: " + "; ".join(fails)); sys.exit(1)
print("PASS: the Claude Code plant mount works" + (" (dry run with the scripted control)" if dry else " on the real binary"))
PY
rc=${PIPESTATUS[0]}
set -e
# Keep the trial files with the logs, then remove this run's own out dir (relative path, as the crew policy wants).
mkdir -p "$LOGDIR/run" && cp -r "$OUT/." "$LOGDIR/run/" 2>/dev/null || true
(cd "$OUT_ROOT" && chmod -R u+rwX "$(basename "$OUT")" && find "$(basename "$OUT")" -delete) || echo "note: could not remove $OUT"
echo "logs: $LOGDIR"
exit "$rc"
