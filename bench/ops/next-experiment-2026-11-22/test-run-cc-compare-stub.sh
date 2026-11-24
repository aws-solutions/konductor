#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Free test of run-cc-compare.sh's paid path with a stub bench command, and of cc-skill-loads.js on a made-up stream.
# No model call, no claude, no build.
#   case 1: all 8 tasks run once each with both arms, 2 replicates, the USD caps and the AWS profile
#   case 2: a rerun skips all 8 (resume)
#   case 3: a stub that spends USD 7 a run makes the cap guard cut task 2 and stop before task 3
#   case 4: a command that finishes 2 of 4 runs leaves no .done; the rerun passes --resume and finishes the task
#   case 5: a ROOT under HOME is refused before any bench call
#   case 6: cc-skill-loads.js tells whole, partial, preload, failed and missing apart, with the frozen stream reader
#   case 7: cc-team-mode.patch (D-241) gives the pinned tree and team mode for cc-konductor only
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
HERE0=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d /var/tmp/cc-compare-stub.XXXXXX)   # outside HOME: the script refuses a ROOT under it
trap 'rm -r -- "$T"' EXIT
STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: logs its args; writes run-config.json and STUB_RUNS result.json files of
// STUB_SPEND USD each (2 arms x replicates), skipping runs that already have one (as --resume does).
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out');
fs.mkdirSync(out, { recursive: true });
fs.appendFileSync(path.join(path.dirname(out), 'calls.log'), a.join(' ') + '\n');
fs.writeFileSync(path.join(out, 'run-config.json'), '{}\n');
let want = Number(process.env.STUB_RUNS || 4);
for (const arm of ['cc-vanilla', 'cc-konductor']) for (const rep of [1, 2]) {
  const d = path.join(out, arm, val('--tasks'), String(rep));
  if (fs.existsSync(path.join(d, 'result.json'))) continue;
  if (want-- <= 0) continue;
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'stream.jsonl'), '');
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ costUsd: Number(process.env.STUB_SPEND || 0.5) }) + '\n');
}
JS
fail() { echo "FAIL: $*"; exit 1; }
go() { local root=$1; shift; env WAIT_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK="$T/heavy.lock" CC_AWS_PROFILE=stub-profile \
  STUB="node $STUBJS" ROOT="$root" "$@" bash "$HERE0/run-cc-compare.sh" --go; }

go "$T/a" > "$T/a.log" 2>&1 || { cat "$T/a.log"; fail "case 1 exited non-zero"; }
[ "$(ls "$T/a/runs" | grep -c '\.done$')" = 8 ] || fail "case 1: not 8 .done files"
[ "$(wc -l < "$T/a/runs/calls.log")" = 8 ] || fail "case 1: not 8 bench calls"
L=$(head -n 1 "$T/a/runs/calls.log")
for want in '--arms cc-vanilla,cc-konductor=f5d184596378ae72ae531d80647548512c14cacf' '--replicates 2 --parallel 1' \
  '--isolate unshare --seed 20261121' '--model us.anthropic.claude-sonnet-5-5 --effort high --run-budget-usd 1' \
  '--aws-profile stub-profile --budget-usd 4.00' '--tasks t8-dec-deploy-strategy'; do
  case "$L" in *"$want"*) ;; *) fail "case 1: first call lacks '$want': $L" ;; esac
done
grep -q -- '--hide ' "$T/a/runs/calls.log" || fail "case 1: no --hide"
grep -q -- '--resume' "$T/a/runs/calls.log" && fail "case 1: a fresh task passed --resume"
grep -q 'all tasks done, spent USD 16.00 of 30' "$T/a.log" || { cat "$T/a.log"; fail "case 1: spend line"; }
echo "case 1 ok: 8 tasks, 2 arms x 2 replicates, caps and profile passed"

go "$T/a" > "$T/b.log" 2>&1 || fail "case 2 exited non-zero"
[ "$(grep -c 'done, skipped' "$T/b.log")" = 8 ] || fail "case 2: not all skipped"
[ "$(wc -l < "$T/a/runs/calls.log")" = 8 ] || fail "case 2: a bench call ran"
echo "case 2 ok: rerun skips all 8"

if go "$T/c" STUB_SPEND=7 > "$T/c.log" 2>&1; then fail "case 3 should stop"; fi
grep -q 'cannot fit one run of USD 1' "$T/c.log" || { cat "$T/c.log"; fail "case 3: wrong stop"; }
[ "$(wc -l < "$T/c/runs/calls.log")" = 2 ] || fail "case 3: not 2 bench calls before the stop"
sed -n 2p "$T/c/runs/calls.log" | grep -q -- '--budget-usd 1.11' || fail "case 3: task 2 budget not cut to 1.11"
echo "case 3 ok: the cap guard cuts task 2 and stops before task 3"

if go "$T/d" STUB_RUNS=2 > "$T/d.log" 2>&1; then fail "case 4 should stop"; fi
grep -q '2 of 4 runs finished' "$T/d.log" || { cat "$T/d.log"; fail "case 4: wrong stop"; }
[ ! -e "$T/d/runs/t8-dec-deploy-strategy.done" ] || fail "case 4: .done written"
go "$T/d" > "$T/d2.log" 2>&1 || { cat "$T/d2.log"; fail "case 4 rerun exited non-zero"; }
sed -n 2p "$T/d/runs/calls.log" | grep -q -- '--resume' || fail "case 4: rerun did not pass --resume"
[ -e "$T/d/runs/t8-dec-deploy-strategy.done" ] || fail "case 4: no .done after the rerun"
echo "case 4 ok: a short task resumes"

if go "$HOME/cc-compare-stub-never" > "$T/e.log" 2>&1; then fail "case 5 should stop"; fi
grep -q 'is under HOME' "$T/e.log" || { cat "$T/e.log"; fail "case 5: wrong stop"; }
[ ! -e "$HOME/cc-compare-stub-never" ] || fail "case 5: made a dir under HOME"
echo "case 5 ok: ROOT under HOME refused"

# case 6: a made-up Claude Code stream, read with the frozen bench's own reader (exported, not checked out).
mkdir -p "$T/R" "$T/skills/alpha" "$T/skills/beta" "$T/skills/gamma" "$T/skills/sop-delta" "$T/runs6/tx/cc-konductor/tx/1"
git -C "$KONDUCTOR_WS/worktrees/konductor-plant" archive 69149846ad65f1016ec386e88ec9043bdec57203 bench/runner/lib | tar -x -C "$T/R"
BODY=$(printf 'line %s of the skill body\n' $(seq 1 40))
for s in alpha beta gamma sop-delta; do printf -- '---\nname: %s\n---\n%s\n' "$s" "$BODY" > "$T/skills/$s/SKILL.md"; done
echo '{"tasks":{"tx":{"units":["skill:alpha","skill:beta","skill:gamma","sop:delta","skill:omega"]}}}' > "$T/manifest.json"
node -e '
const body = process.argv[1], half = body.slice(0, body.length / 3);
const use = (id, name, input, parent = null) => ({ type: "assistant", parent_tool_use_id: parent, message: { content: [{ type: "tool_use", id, name, input }] } });
const res = (id, text, err = false, parent = null) => ({ type: "user", parent_tool_use_id: parent, message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: err }] } });
const bodyMsg = (text, parent = null) => ({ type: "user", parent_tool_use_id: parent, message: { content: [{ type: "text", text }] } });
const ev = [
  use("a", "Skill", { skill: "alpha" }), res("a", "Launching skill: alpha"), bodyMsg("Base directory for this skill: /h/.claude/skills/alpha\n\n" + body),
  use("b", "Read", { file_path: "/h/.claude/skills/beta/SKILL.md" }), res("b", half),
  use("g", "Skill", { skill: "gamma" }, "p1"), res("g", "Launching skill: gamma", false, "p1"),
  use("d", "Read", { file_path: "/h/.claude/skills/sop-delta/SKILL.md" }), res("d", "File does not exist.", true),
];
process.stdout.write(ev.map((e) => JSON.stringify(e)).join("\n") + "\n");' "$BODY" > "$T/runs6/tx/cc-konductor/tx/1/stream.jsonl"
node "$HERE0/cc-skill-loads.js" "$T/runs6" "$T/manifest.json" "$T/R" "$T/skills" > "$T/f.md" || fail "case 6: cc-skill-loads.js exited non-zero"
for want in 'alpha (whole, main)' 'beta (partial, main)' 'gamma (preload, child)' 'sop-delta (failed, main)' '| 1 of 5 |' \
  '| cc-konductor | 1 | 1 | 1 | 1 | 1 | 1 | 1 |'; do
  grep -qF -- "$want" "$T/f.md" || { cat "$T/f.md"; fail "case 6: no '$want'"; }
done
echo "case 6 ok: whole, partial, preload, failed and missing"

# case 7 (D-241): cc-team-mode.patch on the frozen bench gives TEAM_TREE, carries the current bench's team-mode.js
# unchanged, and the patched frozen harness writes team mode into a cc-konductor run HOME only.
REPO=$KONDUCTOR_WS/worktrees/konductor-plant
PATCH=$HERE0/cc-team-mode.patch
WANT_TREE=$(sed -n 's/^TEAM_TREE=\([0-9a-f]*\).*/\1/p' "$HERE0/run-cc-compare.sh")
GIT_INDEX_FILE=$T/idx git -C "$REPO" read-tree 69149846ad65f1016ec386e88ec9043bdec57203
GIT_INDEX_FILE=$T/idx git -C "$REPO" apply --cached "$PATCH"
[ "$(GIT_INDEX_FILE=$T/idx git -C "$REPO" write-tree)" = "$WANT_TREE" ] || fail "case 7: the patched tree is not TEAM_TREE $WANT_TREE"
mkdir -p "$T/F"
git -C "$REPO" archive 69149846ad65f1016ec386e88ec9043bdec57203 bench/runner/lib | tar -x -C "$T/F"
(cd "$T/F" && git apply "$PATCH") || fail "case 7: the patch does not apply to the frozen bench"
cmp -s "$T/F/bench/runner/lib/harness/claude-team-mode.js" "$HERE0/../../plugins/claude-code/team-mode.js" \
  || fail "case 7: the patch's claude-team-mode.js differs from bench/plugins/claude-code/team-mode.js (regenerate the patch)"
node -e '
const fs = require("fs"), path = require("path");
const cc = require(path.join(process.argv[1], "bench/runner/lib/harness/claude-code.js"));
const NAMES = ["k-architect", "k-browser", "k-developer", "k-media-analyzer", "k-product-manager", "k-quality-assurance", "k-researcher", "k-tpm", "konductor", "konductor-cmux-orchestrator", "konductor-mux-orchestrator"];
const claudeInstall = (home) => { fs.mkdirSync(path.join(home, ".claude/agents"), { recursive: true });
  for (const n of NAMES) fs.writeFileSync(path.join(home, ".claude/agents", n + ".md"), "---\nname: " + n + "\nmodel: claude-sonnet-5-5\n---\n");
  fs.writeFileSync(path.join(home, ".claude/settings.json"), JSON.stringify({ hooks: { SessionStart: [] } })); return "installed"; };
const config = { model: "us.anthropic.claude-sonnet-5-5", canonicalModel: "claude-sonnet-5-5", effort: "high" };
for (const vanilla of [false, true]) {
  const home = path.join(process.argv[2], vanilla ? "hv" : "hk");
  cc.installInto(home, { arm: { vanilla, agent: "konductor" }, prepared: {}, ctx: { config, claude: { version: "t" }, claudeInstall }, config, outDir: null });
  const f = path.join(home, ".claude/settings.json");
  if (vanilla) { if (fs.existsSync(f)) throw new Error("cc-vanilla got a settings.json"); continue; }
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  if (s.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS !== "1" || s.permissions.allow.length !== 23 || !s.hooks) throw new Error("cc-konductor settings: " + JSON.stringify(s));
}' "$T/F" "$T" || fail "case 7: the patched frozen harness"
echo "case 7 ok: the team-mode patch gives TEAM_TREE and writes team mode for cc-konductor only"
echo "all stub cases passed"
