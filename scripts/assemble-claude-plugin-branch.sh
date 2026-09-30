#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# assemble-claude-plugin-branch.sh -- build the flat plugin tree published to
# the `claude-plugin` branch by .github/workflows/release.yml's
# `publish-claude-plugin` job. Reuses `scripts/generate-claude-plugin.sh`
# (and therefore `make claude-plugin`) for all of the synth/install/render
# work; this script only reshapes that output into the flat layout Claude
# Code expects when installing a plugin straight from a repository ref --
# `.claude-plugin/plugin.json`, `agents/`, and `skills/` all at the tree
# root, with no `generated/claude-plugin/` nesting. See
# https://code.claude.com/docs/en/plugins/marketplace-reference's `github`
# plugin source, which fetches exactly this shape from a ref.
#
# Usage: assemble-claude-plugin-branch.sh --out <dir>
#
#   --out <dir>   Required. Directory to assemble the flat plugin tree
#                 into. Must not already exist -- this script creates it,
#                 and refuses to overwrite one that's already there so a
#                 caller can never mistake a stale prior assembly for a
#                 fresh one.
#
# What ends up under <dir>:
#   .claude-plugin/plugin.json   -- rendered with agents/skills paths
#                                   rewritten to "./agents/..."/"./skills/"
#                                   (see render-claude-plugin-json.py
#                                   --path-prefix)
#   .mcp.json                    -- the plugin-level MCP server declaration
#                                   (https://code.claude.com/docs/en/plugins/
#                                   components#mcp-servers), rendered by the
#                                   same render-claude-plugin-json.py call as
#                                   the union of every agents/*.agent-spec.json's
#                                   dependencies.mcpRegistry entry, FILTERED to
#                                   scripts/claude-plugin-mcp-servers.json's
#                                   "bundled" allowlist (--bundled-mcp-servers,
#                                   below) -- today just aws-mcp; everything
#                                   else (e.g. playwright-mcp) is bring-your-own
#                                   and never written here. Needed because
#                                   Claude Code ignores an agent's own
#                                   `mcpServers:` frontmatter -- which the
#                                   agents/*.md files below already carry --
#                                   when that agent is loaded from a plugin.
#   agents/*.md                  -- the same 11 files `make claude-plugin`
#                                   writes to generated/claude-plugin/agents/,
#                                   COPIED VERBATIM including
#                                   generate-claude-plugin.sh's own
#                                   plugin-scoped tool-name rewrite for
#                                   bundled servers (see that script and
#                                   scripts/rewrite-claude-plugin-mcp-tool-
#                                   names.py) -- this script does not repeat
#                                   that rewrite itself.
#   skills/<name>/                -- every native skills/*/SKILL.md
#                                   directory from the repo root, PLUS every
#                                   sop-*/SKILL.md directory
#                                   generated/claude-plugin/skills/ holds --
#                                   i.e. the union `.claude-plugin/plugin.json`
#                                   would otherwise assemble via two separate
#                                   fields (a default skills/ scan plus a
#                                   sop-* addition), flattened into one real
#                                   directory since there is no `generated/`
#                                   subtree here to scan separately, via
#                                   scripts/copy-skills-with-collision-
#                                   guard.sh (see that script for the
#                                   collision guard between the two
#                                   sources).
#   README.md, LICENSE.txt        -- copied from the repo root unchanged
#
# No `.claude-plugin/marketplace.json` is written here: the marketplace
# manifest lives on `main` (see .claude-plugin/marketplace.json there),
# pointing its plugin entry's `source` at this branch by `ref` -- it is not
# itself part of what gets published to this branch.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out)
      if [ $# -lt 2 ]; then
        echo "assemble-claude-plugin-branch.sh: --out requires a directory argument" >&2
        exit 64
      fi
      OUT="$2"
      shift 2
      ;;
    *)
      echo "assemble-claude-plugin-branch.sh: unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$OUT" ]; then
  echo "assemble-claude-plugin-branch.sh: --out <dir> is required" >&2
  exit 64
fi
if [ -e "$OUT" ]; then
  echo "assemble-claude-plugin-branch.sh: $OUT already exists -- refusing to overwrite" >&2
  exit 1
fi

if [ ! -f README.md ] || [ ! -f LICENSE.txt ]; then
  echo "error: [assemble-claude-plugin] README.md and/or LICENSE.txt not found at repo root" >&2
  exit 1
fi

echo "=== [assemble-claude-plugin] Regenerating generated/claude-plugin/ + .claude-plugin/plugin.json + .mcp.json ==="
"$REPO_ROOT/scripts/generate-claude-plugin.sh"

echo "=== [assemble-claude-plugin] Assembling flat plugin tree at $OUT ==="
mkdir -p "$OUT/agents" "$OUT/skills" "$OUT/.claude-plugin"

cp generated/claude-plugin/agents/*.md "$OUT/agents/"

# Native skills/*/SKILL.md directories, PLUS every sop-*/SKILL.md
# directory konductor install --harness claude produced -- see
# generated/claude-plugin/README.md for why two different tools produce
# these, and scripts/copy-skills-with-collision-guard.sh's own header for
# the collision guard between the two sources (a sop-* name colliding
# with a native skill name fails loudly instead of `cp -r` silently
# merging the two directories together).
"$REPO_ROOT/scripts/copy-skills-with-collision-guard.sh" \
  --native "$REPO_ROOT/skills" \
  --sop "$REPO_ROOT/generated/claude-plugin/skills" \
  --out "$OUT/skills"

cp README.md "$OUT/README.md"
cp LICENSE.txt "$OUT/LICENSE.txt"

BUNDLED_MCP_SERVERS="$("$REPO_ROOT/scripts/read-bundled-mcp-servers.sh")"
BUNDLED_MCP_CONFIG="$REPO_ROOT/scripts/claude-plugin-mcp-servers.json"

python3 "$REPO_ROOT/scripts/render-claude-plugin-json.py" \
  --template "$REPO_ROOT/scripts/claude-plugin.template.json" \
  --version-file "$REPO_ROOT/VERSION" \
  --agents-dir "$OUT/agents" \
  --path-prefix "./" \
  --agent-specs-dir "$REPO_ROOT/agents" \
  --mcp-output "$OUT/.mcp.json" \
  --bundled-mcp-servers "$BUNDLED_MCP_SERVERS" \
  --bundled-mcp-config "$BUNDLED_MCP_CONFIG" \
  --output "$OUT/.claude-plugin/plugin.json"

echo "=== [assemble-claude-plugin] Done -- flat plugin tree at $OUT ==="
