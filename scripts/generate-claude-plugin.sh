#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# generate-claude-plugin.sh -- regenerate generated/claude-plugin/{agents,skills}/,
# .claude-plugin/plugin.json, and .mcp.json from this repo's own source of
# truth (agents/*.agent-spec.json, skills/*/SKILL.md, agent-sops/*.sop.md),
# via the konductor CLI's `synth` and `install --harness claude`. See
# generated/claude-plugin/README.md for why both subcommands are needed and
# what each directory here contains.
#
# .mcp.json is the plugin-level MCP server declaration Claude Code reads at
# a plugin's root (https://code.claude.com/docs/en/plugins/components#mcp-servers)
# -- rendered by render-claude-plugin-json.py's --agent-specs-dir/
# --mcp-output flags as the union of every agents/*.agent-spec.json's
# dependencies.mcpRegistry entry. Needed because Claude Code ignores an
# agent's own `mcpServers:` frontmatter when that agent is loaded from a
# plugin (ClaudeTransformer's rendered `mcpServers:` field only takes effect
# for a standalone, non-plugin `.claude/agents/` install -- see
# cli/konductor-rs/src/cli/synth/claude.rs's own module docstring).
#
# MCP servers are bring-your-own by default -- Konductor does not package
# a user's MCP server for them -- with ONE packaged exception: AWS MCP,
# because k-architect/k-developer depend on it directly enough to ship
# pre-wired for Claude Code (both this plugin and the standalone install).
# Playwright (k-browser) and anything else stays bring-your-own on every
# harness. Which server names are packaged is data, not code: it lives in
# scripts/claude-plugin-mcp-servers.json's "bundled" list, read here via
# scripts/read-bundled-mcp-servers.sh and passed identically to `synth`
# (so the standalone dist/claude/agents/*.md pre-wires the same servers)
# and to render-claude-plugin-json.py's --bundled-mcp-servers (so .mcp.json
# only declares them at the plugin level too). A packaged server's tool
# grant then also needs its `mcp__<server>__*` frontmatter entry rewritten
# to the real plugin-scoped tool name -- see
# scripts/rewrite-claude-plugin-mcp-tool-names.py's own module docstring
# for why plugin subagents resolve tool names differently than a
# standalone install.
#
# Called from the root Makefile's `claude-plugin` and `claude-plugin-check`
# targets, and from scripts/assemble-claude-plugin-branch.sh -- not meant to
# be run standalone, though it works that way too as long as KONDUCTOR_BIN
# points at an already-built binary (the Makefile builds it first via
# `make -C cli build`).
#
# Usage: generate-claude-plugin.sh
#
# Always writes into this repo's own generated/claude-plugin/{agents,skills}/,
# .claude-plugin/plugin.json, and .mcp.json -- all gitignored, so this is
# always a local/CI build step, never something to commit. There is no
# scratch-copy mode: nothing generated is committed on main for a scratch
# copy to be diffed against, so the one caller that used to need that
# (`make claude-plugin-check`) now just runs generation in place and
# validates the result instead -- see that target's own comment in the root
# Makefile.
#
# Determinism: re-running this script with no source changes MUST produce
# byte-identical output. The only two things that could make output
# non-deterministic are unsorted directory iteration and a real timestamp --
# both are avoided below: the agents list is written by
# render-claude-plugin-json.py from a sorted glob, and plugin.json carries no
# generation timestamp (see that script's own header for why
# `metadata.generatedAt` is dropped rather than "fixed").
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

KONDUCTOR_BIN="${KONDUCTOR_BIN:-build/cli/konductor}"

if [ $# -gt 0 ]; then
  echo "generate-claude-plugin.sh: unexpected argument(s): $*" >&2
  exit 64
fi

if [ ! -x "$KONDUCTOR_BIN" ]; then
  echo "error: [claude-plugin] $KONDUCTOR_BIN not found -- run 'make -C cli build' first" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "error: [claude-plugin] python3 not found on PATH -- required to render plugin.json" >&2
  exit 1
fi

AGENTS_OUT_DIR="$REPO_ROOT/generated/claude-plugin/agents"
SKILLS_OUT_DIR="$REPO_ROOT/generated/claude-plugin/skills"
PLUGIN_JSON_OUT="$REPO_ROOT/.claude-plugin/plugin.json"
MCP_JSON_OUT="$REPO_ROOT/.mcp.json"
AGENT_SPECS_DIR="$REPO_ROOT/agents"

# Single source of truth for which MCP servers get packaged (today:
# aws-mcp only) -- see scripts/claude-plugin-mcp-servers.json and this
# script's own header comment above.
BUNDLED_MCP_SERVERS="$("$REPO_ROOT/scripts/read-bundled-mcp-servers.sh")"
BUNDLED_MCP_CONFIG="$REPO_ROOT/scripts/claude-plugin-mcp-servers.json"

# Two scratch directories, cleaned up on exit (success or failure) via the
# trap below -- never the real $HOME or the real ~/.claude / ~/.konductor.
# SCRATCH_HOME is where `install` (below) writes its own tracking index
# (~/.konductor/installs) and would write telemetry state if --no-telemetry
# weren't passed. SCRATCH_TARGET is where the actual .claude/ content lands.
SCRATCH_HOME=""
SCRATCH_TARGET=""
cleanup() {
  if [ -n "$SCRATCH_HOME" ]; then
    rm -rf "$SCRATCH_HOME"
  fi
  if [ -n "$SCRATCH_TARGET" ]; then
    rm -rf "$SCRATCH_TARGET"
  fi
}
trap cleanup EXIT

echo "=== [claude-plugin] Running konductor synth --from . ==="
"$KONDUCTOR_BIN" synth --from . --claude-bundled-mcp-servers "$BUNDLED_MCP_SERVERS" \
  --claude-bundled-mcp-config "$BUNDLED_MCP_CONFIG"

SCRATCH_HOME="$(mktemp -d)"
SCRATCH_TARGET="$(mktemp -d)"

echo "=== [claude-plugin] Running konductor install --harness claude (scratch target) ==="
HOME="$SCRATCH_HOME" "$KONDUCTOR_BIN" install --from . --harness claude \
  --target "$SCRATCH_TARGET" --no-telemetry

echo "=== [claude-plugin] Regenerating generated/claude-plugin/agents/ ==="
rm -rf "$AGENTS_OUT_DIR"
mkdir -p "$AGENTS_OUT_DIR"
for f in dist/claude/agents/*.md; do
  cp "$f" "$AGENTS_OUT_DIR/"
done

echo "=== [claude-plugin] Regenerating generated/claude-plugin/skills/ (sop-* only) ==="
rm -rf "$SKILLS_OUT_DIR"
mkdir -p "$SKILLS_OUT_DIR"
for d in "$SCRATCH_TARGET"/.claude/skills/sop-*/; do
  name="$(basename "$d")"
  # sop-state-management is a NATIVE skill whose name happens to start with
  # "sop-" -- it is not SOP-derived, and it is already covered by the
  # plugin manifest's default skills/ directory scan. See
  # generated/claude-plugin/README.md's "Why two different tools produced
  # this" section.
  if [ "$name" = "sop-state-management" ]; then
    continue
  fi
  cp -r "$d" "$SKILLS_OUT_DIR/$name"
done

echo "=== [claude-plugin] Generating .claude-plugin/plugin.json and .mcp.json ==="
mkdir -p "$(dirname "$PLUGIN_JSON_OUT")"
python3 "$REPO_ROOT/scripts/render-claude-plugin-json.py" \
  --template "$REPO_ROOT/scripts/claude-plugin.template.json" \
  --version-file "$REPO_ROOT/VERSION" \
  --agents-dir "$AGENTS_OUT_DIR" \
  --agent-specs-dir "$AGENT_SPECS_DIR" \
  --mcp-output "$MCP_JSON_OUT" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS" \
  --bundled-mcp-config "$BUNDLED_MCP_CONFIG" \
  --output "$PLUGIN_JSON_OUT"

echo "=== [claude-plugin] Rewriting bundled-server tool grants to plugin-scoped names ==="
python3 "$REPO_ROOT/scripts/rewrite-claude-plugin-mcp-tool-names.py" \
  --agents-dir "$AGENTS_OUT_DIR" \
  --plugin-json "$PLUGIN_JSON_OUT" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS"

if command -v claude >/dev/null 2>&1; then
  # Targets the plugin manifest FILE directly, not the repo-root directory
  # (`claude plugin validate .`): given a directory, Claude Code picks
  # .claude-plugin/marketplace.json over .claude-plugin/plugin.json when
  # both exist (as they do here -- main's own marketplace manifest lives
  # at the repo root), so `claude plugin validate .` never actually opened
  # this plugin's own agent/skill/MCP files at all.
  #
  # No --strict here (unlike the flat branch tree's own validation in
  # scripts/assemble-claude-plugin-branch.sh's callers): this repo's own
  # top-level CLAUDE.md, which every repo-root checkout has for Claude
  # Code's own project-context loading, makes `claude plugin validate`
  # unconditionally warn "CLAUDE.md at the plugin root is not loaded as
  # project context" whenever the plugin root and the repo root are the
  # same directory -- true regardless of anything this plugin's own
  # content does or doesn't do. --strict would turn that permanent,
  # environment-driven warning into a permanent failure. The flat tree
  # `claude-plugin` branch actually publishes has no top-level CLAUDE.md
  # (see scripts/assemble-claude-plugin-branch.sh's own file list) and is
  # validated with --strict, both in `make claude-plugin-check` and in
  # .github/workflows/release.yml's publish-claude-plugin job.
  echo "=== [claude-plugin] Running claude plugin validate on plugin.json ==="
  claude plugin validate "$PLUGIN_JSON_OUT"
else
  echo "notice: [claude-plugin] 'claude' CLI not found on PATH -- skipping 'claude plugin validate'" >&2
fi

echo "=== [claude-plugin] Done ==="
