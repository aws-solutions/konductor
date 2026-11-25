#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-orchestrator-recipe.sh: runs the commands konductor-mux-orchestrator's
# prompt and the mux-dispatch skill tell the model to run, as written:
#   - the "For Long Prompts" recipe dispatches on a fresh host under umask 002,
#     leaves the registry at mode 700 and removes its temporary brief;
#   - with KONDUCTOR_MUX_REGISTRY_DIR set, the prompt's and the skill's poll
#     commands find the .done the dispatch printed as done_file=.
#
# Usage: bash test-orchestrator-recipe.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

# Variables set here are read inside check's eval.
# shellcheck disable=SC2016,SC2034

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SKILL_DIR="${PKG_ROOT}/skills/mux-dispatch"
SPEC="${PKG_ROOT}/agents/konductor-mux-orchestrator.agent-spec.json"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }
check() { if eval "$2"; then log_pass "$1"; else log_fail "$1"; fi; }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"
cat > "$MOCK_BIN/claude" <<'MOCKEOF'
#!/usr/bin/env bash
printf '{"status": "done", "summary": "child wrote this"}' > "$KONDUCTOR_DONE_FILE"
MOCKEOF
cat > "$MOCK_BIN/tmux" <<'MOCKEOF'
#!/usr/bin/env bash
case "$1" in
  split-window|new-window) bash -c "${!#}" >/dev/null 2>&1; echo "%1" ;;
  *) exit 0 ;;
esac
MOCKEOF
chmod +x "$MOCK_BIN"/*

export PATH="$MOCK_BIN:$PATH"
export HOME="$WORKDIR/home"
export TMPDIR="$WORKDIR/tmp"
export CLAUDECODE=1 TMUX=fake KONDUCTOR_DISPATCH_PERMISSION_MODE=headless
mkdir -p "$HOME/.claude/agents" "$TMPDIR"
touch "$HOME/.claude/agents/k-developer.md"
cd "$WORKDIR" || exit 1

# prompt_block <heading>: the first fenced bash block after <heading> in the
# orchestrator's system prompt.
prompt_block() {
  python3 - "$SPEC" "$1" <<'PY'
import json, re, sys
prompt = json.load(open(sys.argv[1]))["config"]["systemPrompt"]
rest = prompt[prompt.index(sys.argv[2]):]
print(re.search(r"```bash\n(.*?)```", rest, re.S).group(1), end="")
PY
}

RECIPE="$(prompt_block '### For Long Prompts')"
RECIPE="${RECIPE//<MUX_DISPATCH_DIR>/$SKILL_DIR}"
RECIPE="${RECIPE//\/absolute\/path\/to\/workspace/$WORKDIR}"
PROMPT_POLL="$(prompt_block '**After dispatching' | grep '^find ')"
SKILL_POLL="$(grep -o '^`find [^`]*`$' "$SKILL_DIR/SKILL.md" | tr -d '`')"

check "the prompt has a long-prompt recipe and a poll command" '[[ -n "$RECIPE" && -n "$PROMPT_POLL" && -n "$SKILL_POLL" ]]'
check "the long-prompt recipe never writes into the registry" '! grep -q "konductor-mux" <<<"$RECIPE"'

export KONDUCTOR_MUX_REGISTRY_DIR="$WORKDIR/shared-host/registry"
OUT="$(umask 002 && bash -c "$RECIPE" 2>"$WORKDIR/err")"
RC=$?
DONE="$(grep -o 'done_file=[^ ]*' <<<"$OUT" | cut -d= -f2)"
check "the recipe dispatches on a fresh registry under umask 002" \
  '[[ "$RC" -eq 0 && -n "$DONE" ]] || { sed "s/^/    /" "$WORKDIR/err"; false; }'
check "the registry it creates is mode 700" \
  '[[ "$(stat -c %a "$KONDUCTOR_MUX_REGISTRY_DIR" 2>/dev/null || stat -f %Lp "$KONDUCTOR_MUX_REGISTRY_DIR")" == 700 ]]'
check "the brief reaches the dispatch dir" 'grep -q "delegation prompt" "$(dirname "$DONE")/task.md"'
check "the temporary brief is removed" '[[ -z "$(ls -A "$TMPDIR")" ]]'

# A plain --task dispatch, so the poll checks do not depend on the recipe.
POLL_DONE="$(bash "$SKILL_DIR/dispatch.sh" --agent k-developer --cwd "$WORKDIR" --task "poll me" 2>/dev/null \
  | grep -o 'done_file=[^ ]*' | cut -d= -f2)"
check "the poll fixture dispatch printed a done_file" '[[ -f "$POLL_DONE" ]]'
check "the prompt's poll finds the printed done_file under the overridden registry" \
  '[[ -n "$POLL_DONE" ]] && bash -c "$PROMPT_POLL" | grep -qxF "$POLL_DONE"'
check "the skill's poll finds the printed done_file under the overridden registry" \
  '[[ -n "$POLL_DONE" ]] && bash -c "$SKILL_POLL" | grep -qxF "$POLL_DONE"'

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
