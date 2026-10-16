#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-plugin-agent-resolution.sh: which `claude --agent` name cmux-dispatch.sh
# launches on Claude Code, for a CLI install (~/.claude/agents), a plugin-only
# install, plugin-qualified names, an ambiguous name, agents that are not
# installed, and an agent filename that tries to inject a command.
#
# Usage: bash test-plugin-agent-resolution.sh
# Exit code: 0 = all assertions passed, 1 = a regression was detected.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SKILL_SRC="${PKG_ROOT}/skills/cmux-dispatch"

PASS=0
FAIL=0
log_pass() { echo "PASS: $1"; PASS=$((PASS + 1)); }
log_fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

MOCK_BIN="$WORKDIR/bin"
mkdir -p "$MOCK_BIN"
PANE_CMD_FILE="$WORKDIR/pane-cmd.txt"
CLAUDE_RECORD="$WORKDIR/claude-agent.txt"

cat > "$MOCK_BIN/cmux" <<MOCKEOF
#!/usr/bin/env bash
case "\$1" in
  new-split) echo "surface:1" ;;
  read-screen) echo "ready" ;;
  send) printf '%s' "\${!#}" > "${PANE_CMD_FILE}" ;;
  *) exit 0 ;;
esac
MOCKEOF

cat > "$MOCK_BIN/claude" <<MOCKEOF
#!/usr/bin/env bash
[[ "\$1" == "--agent" ]] && printf '%s' "\$2" > "${CLAUDE_RECORD}"
exit 0
MOCKEOF
chmod +x "$MOCK_BIN"/*

export PATH="$MOCK_BIN:$PATH"
export CMUX_BIN="$MOCK_BIN/cmux"
export CLAUDECODE=1
export KONDUCTOR_CMUX_REGISTRY_DIR="$WORKDIR/registry"

CLI_HOME="$WORKDIR/cli-home"
mkdir -p "$CLI_HOME/.claude/skills" "$CLI_HOME/.claude/agents"
cp -R "$SKILL_SRC" "$CLI_HOME/.claude/skills/cmux-dispatch"
touch "$CLI_HOME/.claude/agents/k-developer.md" \
  "$CLI_HOME/.claude/agents/local-a-k-tpm.md" "$CLI_HOME/.claude/agents/local-b-k-tpm.md"

# Package-prefixed installs: a local- install, a registry install, and both.
LOCAL_HOME="$WORKDIR/local-home"
REGISTRY_HOME="$WORKDIR/registry-home"
BOTH_HOME="$WORKDIR/both-home"
for home in "$LOCAL_HOME" "$REGISTRY_HOME" "$BOTH_HOME"; do
  mkdir -p "$home/.claude/skills" "$home/.claude/agents"
  cp -R "$SKILL_SRC" "$home/.claude/skills/cmux-dispatch"
done
touch "$LOCAL_HOME/.claude/agents/local-yourpkg-k-developer.md" \
  "$REGISTRY_HOME/.claude/agents/yourpkg-k-developer.md" \
  "$BOTH_HOME/.claude/agents/local-yourpkg-k-developer.md" \
  "$BOTH_HOME/.claude/agents/yourpkg-k-developer.md"

PLUGIN_HOME="$WORKDIR/plugin-home"
PLUGIN_ROOT="$WORKDIR/plugins/cache/market/konductor/1.0.0"
mkdir -p "$PLUGIN_HOME" "$PLUGIN_ROOT/.claude-plugin" "$PLUGIN_ROOT/agents" "$PLUGIN_ROOT/skills"
printf '{"name": "konductor"}\n' > "$PLUGIN_ROOT/.claude-plugin/plugin.json"
touch "$PLUGIN_ROOT/agents/k-developer.md"
cp -R "$SKILL_SRC" "$PLUGIN_ROOT/skills/cmux-dispatch"

# dispatch <home> <skill-dir> <agent>: runs the dispatch, then the pane
# command it sent, as a cmux surface would.
dispatch() {
  local home="$1" skill_dir="$2" agent="$3"
  rm -f "$CLAUDE_RECORD" "$PANE_CMD_FILE"
  rm -rf "$KONDUCTOR_CMUX_REGISTRY_DIR"
  HOME="$home" bash "$skill_dir/cmux-dispatch.sh" --agent "$agent" --task "t" >"$WORKDIR/out" 2>&1
  [[ -f "$PANE_CMD_FILE" ]] && (cd "$WORKDIR" && bash -c "$(cat "$PANE_CMD_FILE")") >>"$WORKDIR/out" 2>&1
  return 0
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

CLI=("$CLI_HOME" "$CLI_HOME/.claude/skills/cmux-dispatch")
PLUGIN=("$PLUGIN_HOME" "$PLUGIN_ROOT/skills/cmux-dispatch")

dispatch "${CLI[@]}" k-developer
expect_launch "CLI install" k-developer

dispatch "$LOCAL_HOME" "$LOCAL_HOME/.claude/skills/cmux-dispatch" k-developer
expect_launch "local- prefixed install" local-yourpkg-k-developer

dispatch "$REGISTRY_HOME" "$REGISTRY_HOME/.claude/skills/cmux-dispatch" k-developer
expect_launch "registry prefixed install" yourpkg-k-developer

dispatch "$BOTH_HOME" "$BOTH_HOME/.claude/skills/cmux-dispatch" k-developer
expect_launch "local- and registry installs, local- wins" local-yourpkg-k-developer

dispatch "${CLI[@]}" k-tpm
expect_error "CLI install, ambiguous name" "matches multiple installed agents"

dispatch "${CLI[@]}" konductor:k-developer
expect_error "CLI install, qualified name without a plugin" "claude agent konductor:k-developer not installed"

dispatch "${PLUGIN[@]}" k-developer
expect_launch "plugin-only install, bare name" k-developer

dispatch "${PLUGIN[@]}" konductor:k-developer
expect_launch "plugin-only install, qualified name" konductor:k-developer

dispatch "${PLUGIN[@]}" konductor:k-missing
expect_error "qualified name the plugin does not ship" "claude agent konductor:k-missing not installed"

dispatch "${PLUGIN[@]}" other:k-developer
expect_error "qualified name for another plugin" "claude agent other:k-developer not installed"

dispatch "${PLUGIN[@]}" k-missing
expect_error "plugin-only install, unknown agent" "claude agent k-missing not installed"

dispatch "${PLUGIN[@]}" "konductor:k-dev;id"
expect_error "invalid name" "ERROR: --agent must be"

# The prefix comes from a filename under ~/.claude/agents and is pasted
# into the pane command, so it must not be able to run anything.
touch "$CLI_HOME/.claude/agents/local-\$(echo>pwned)-k-qa.md"
dispatch "${CLI[@]}" k-qa
expect_error "agent filename with a command substitution" "unsafe agent file name"
if [[ -e "$WORKDIR/pwned" ]]; then
  log_fail "agent filename with a command substitution: the injected command ran"
else
  log_pass "agent filename with a command substitution: the injected command did not run"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
