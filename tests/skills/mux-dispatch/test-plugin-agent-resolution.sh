#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-plugin-agent-resolution.sh: which `claude --agent` name tmux-dispatch.sh
# and zellij-dispatch.sh launch on Claude Code, for a CLI install
# (~/.claude/agents), a plugin-only install, plugin-qualified names, an
# ambiguous name, and agents that are not installed.
#
# Usage: bash test-plugin-agent-resolution.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SKILL_SRC="${PKG_ROOT}/skills/mux-dispatch"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"
CLAUDE_RECORD="$WORKDIR/claude-agent.txt"

cat > "$MOCK_BIN/claude" <<MOCKEOF
#!/usr/bin/env bash
[[ "\$1" == "--agent" ]] && printf '%s' "\$2" > "${CLAUDE_RECORD}"
exit 0
MOCKEOF

cat > "$MOCK_BIN/tmux" <<'MOCKEOF'
#!/usr/bin/env bash
case "$1" in
  split-window|new-window) bash -c "${!#}" >>"$PANE_LOG" 2>&1; echo "%1" ;;
  *) exit 0 ;;
esac
MOCKEOF

cat > "$MOCK_BIN/zellij" <<'MOCKEOF'
#!/usr/bin/env bash
[[ "$1" == "list-sessions" ]] && { echo "test-session"; exit 0; }
cmd=() sep=0
for a in "$@"; do
  if [[ "$sep" == 1 ]]; then cmd+=("$a"); elif [[ "$a" == "--" ]]; then sep=1; fi
done
[[ "${#cmd[@]}" -gt 0 ]] && "${cmd[@]}" >>"$PANE_LOG" 2>&1
echo "terminal_1"
MOCKEOF
chmod +x "$MOCK_BIN"/*

export PATH="$MOCK_BIN:$PATH"
export CLAUDECODE=1
export KONDUCTOR_MUX_REGISTRY_DIR="$WORKDIR/registry"
# The mocks append pane output here, as a real pane would show it.
export PANE_LOG="$WORKDIR/out"

# CLI install: skills and agents both under ~/.claude.
CLI_HOME="$WORKDIR/cli-home"
mkdir -p "$CLI_HOME/.claude/skills" "$CLI_HOME/.claude/agents"
cp -R "$SKILL_SRC" "$CLI_HOME/.claude/skills/mux-dispatch"
touch "$CLI_HOME/.claude/agents/k-developer.md" \
  "$CLI_HOME/.claude/agents/local-a-k-tpm.md" "$CLI_HOME/.claude/agents/local-b-k-tpm.md"

# Package-prefixed installs: a local- install, a registry install, and both.
LOCAL_HOME="$WORKDIR/local-home"
REGISTRY_HOME="$WORKDIR/registry-home"
BOTH_HOME="$WORKDIR/both-home"
for home in "$LOCAL_HOME" "$REGISTRY_HOME" "$BOTH_HOME"; do
  mkdir -p "$home/.claude/skills" "$home/.claude/agents"
  cp -R "$SKILL_SRC" "$home/.claude/skills/mux-dispatch"
done
touch "$LOCAL_HOME/.claude/agents/local-yourpkg-k-developer.md" \
  "$REGISTRY_HOME/.claude/agents/yourpkg-k-developer.md" \
  "$BOTH_HOME/.claude/agents/local-yourpkg-k-developer.md" \
  "$BOTH_HOME/.claude/agents/yourpkg-k-developer.md"

# Plugin-only install: nothing under ~/.claude/agents.
PLUGIN_HOME="$WORKDIR/plugin-home"
PLUGIN_ROOT="$WORKDIR/plugins/cache/market/konductor/1.0.0"
mkdir -p "$PLUGIN_HOME" "$PLUGIN_ROOT/.claude-plugin" "$PLUGIN_ROOT/agents" "$PLUGIN_ROOT/skills"
printf '{"name": "konductor"}\n' > "$PLUGIN_ROOT/.claude-plugin/plugin.json"
touch "$PLUGIN_ROOT/agents/k-developer.md"
cp -R "$SKILL_SRC" "$PLUGIN_ROOT/skills/mux-dispatch"

# dispatch <backend> <home> <skill-dir> <agent>; leaves the launcher's output
# in $WORKDIR/out and the launched agent name (if any) in $CLAUDE_RECORD.
dispatch() {
  local backend="$1" home="$2" skill_dir="$3" agent="$4"
  rm -f "$CLAUDE_RECORD"
  rm -rf "$KONDUCTOR_MUX_REGISTRY_DIR"
  : >"$WORKDIR/out"
  if [[ "$backend" == tmux ]]; then
    HOME="$home" TMUX=fake bash "$skill_dir/tmux-dispatch.sh" \
      --agent "$agent" --task "t" --cwd "$WORKDIR" >>"$WORKDIR/out" 2>&1
  else
    HOME="$home" ZELLIJ=fake ZELLIJ_SESSION_NAME=test-session bash "$skill_dir/zellij-dispatch.sh" \
      --agent "$agent" --task "t" --cwd "$WORKDIR" >>"$WORKDIR/out" 2>&1
  fi
}

launched() { [[ -f "$CLAUDE_RECORD" ]] && cat "$CLAUDE_RECORD"; }

expect_launch() {
  local label="$1" want="$2" got
  got="$(launched)"
  if [[ "$got" == "$want" ]]; then
    log_pass "$label: launches claude --agent $want"
  else
    log_fail "$label: expected claude --agent '$want', got '${got:-<not launched>}'"
    sed 's/^/    /' "$WORKDIR/out"
  fi
}

expect_error() {
  local label="$1" pattern="$2"
  if [[ -z "$(launched)" ]] && grep -q -- "$pattern" "$WORKDIR/out"; then
    log_pass "$label: refuses with '$pattern'"
  else
    log_fail "$label: expected no launch and '$pattern', got launch '$(launched)'"
    sed 's/^/    /' "$WORKDIR/out"
  fi
}

for backend in tmux zellij; do
  CLI=("$CLI_HOME" "$CLI_HOME/.claude/skills/mux-dispatch")
  PLUGIN=("$PLUGIN_HOME" "$PLUGIN_ROOT/skills/mux-dispatch")

  dispatch "$backend" "${CLI[@]}" k-developer
  expect_launch "$backend CLI install" k-developer

  dispatch "$backend" "${CLI[@]}" k-tpm
  expect_error "$backend CLI install, ambiguous name" "matches multiple installed agents"

  dispatch "$backend" "${CLI[@]}" konductor:k-developer
  expect_error "$backend CLI install, qualified name without a plugin" "claude agent konductor:k-developer not installed"

  dispatch "$backend" "$LOCAL_HOME" "$LOCAL_HOME/.claude/skills/mux-dispatch" k-developer
  expect_launch "$backend local- prefixed install" local-yourpkg-k-developer

  dispatch "$backend" "$REGISTRY_HOME" "$REGISTRY_HOME/.claude/skills/mux-dispatch" k-developer
  expect_launch "$backend registry prefixed install" yourpkg-k-developer

  dispatch "$backend" "$BOTH_HOME" "$BOTH_HOME/.claude/skills/mux-dispatch" k-developer
  expect_launch "$backend local- and registry installs, local- wins" local-yourpkg-k-developer

  dispatch "$backend" "${PLUGIN[@]}" k-developer
  expect_launch "$backend plugin-only install, bare name" k-developer

  dispatch "$backend" "${PLUGIN[@]}" konductor:k-developer
  expect_launch "$backend plugin-only install, qualified name" konductor:k-developer

  dispatch "$backend" "${PLUGIN[@]}" konductor:k-missing
  expect_error "$backend qualified name the plugin does not ship" "claude agent konductor:k-missing not installed"

  dispatch "$backend" "${PLUGIN[@]}" other:k-developer
  expect_error "$backend qualified name for another plugin" "claude agent other:k-developer not installed"

  dispatch "$backend" "${PLUGIN[@]}" k-missing
  expect_error "$backend plugin-only install, unknown agent" "claude agent k-missing not installed"

  dispatch "$backend" "${PLUGIN[@]}" "konductor:k-dev;id"
  expect_error "$backend invalid name" "ERROR: --agent must be"
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
