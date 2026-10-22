#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# copy-skills-with-collision-guard.sh: assembles a flat skills/ directory
# from two sources: this repo's native skills/*/SKILL.md directories, and
# the SOP-derived sop-*/SKILL.md directories konductor install --harness
# claude produces (see generated/claude-plugin/README.md for why two
# different tools produce these). Extracted out of
# scripts/assemble-claude-plugin-branch.sh as its own script so the
# collision-guard behavior below can be unit tested against synthetic
# directories, without needing to run the full synth/install pipeline that
# script depends on to populate its real inputs.
#
# Usage: copy-skills-with-collision-guard.sh --native <dir> --sop <dir> --out <dir>
#
#   --native <dir>   Directory of native skills/*/SKILL.md directories to
#                     copy first (each subdirectory of <dir> becomes
#                     <out>/<name>/).
#   --sop <dir>       Directory of SOP-derived sop-*/SKILL.md directories
#                     to copy second, under the same rule.
#   --out <dir>       Destination skills/ directory. Created if it does
#                     not exist; an existing directory is written into,
#                     not wiped first.
#
# Collision guard: `cp -r src dst` MERGES into an existing dst directory
# instead of failing, so a sop-* name colliding with a native skill name
# already copied from --native would silently interleave the two
# directories' files rather than error, e.g. a native skill and a
# converted SOP both named "sop-something" would end up sharing one
# directory, with whichever SKILL.md copied second winning. Every name is
# expected to be new (agent-sops/*.sop.md are all named distinctly from
# skills/*), so this check should never fire in practice. It exists to
# fail loudly the moment that stops being true, instead of producing a
# silently merged skill directory that looks fine until Claude Code loads
# the wrong SKILL.md.
set -euo pipefail

NATIVE=""
SOP=""
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --native)
      if [ $# -lt 2 ]; then
        echo "copy-skills-with-collision-guard.sh: --native requires a directory argument" >&2
        exit 64
      fi
      NATIVE="$2"
      shift 2
      ;;
    --sop)
      if [ $# -lt 2 ]; then
        echo "copy-skills-with-collision-guard.sh: --sop requires a directory argument" >&2
        exit 64
      fi
      SOP="$2"
      shift 2
      ;;
    --out)
      if [ $# -lt 2 ]; then
        echo "copy-skills-with-collision-guard.sh: --out requires a directory argument" >&2
        exit 64
      fi
      OUT="$2"
      shift 2
      ;;
    *)
      echo "copy-skills-with-collision-guard.sh: unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$NATIVE" ] || [ -z "$SOP" ] || [ -z "$OUT" ]; then
  echo "copy-skills-with-collision-guard.sh: --native, --sop, and --out are all required" >&2
  exit 64
fi
if [ ! -d "$NATIVE" ]; then
  echo "copy-skills-with-collision-guard.sh: --native directory not found: $NATIVE" >&2
  exit 1
fi
if [ ! -d "$SOP" ]; then
  echo "copy-skills-with-collision-guard.sh: --sop directory not found: $SOP" >&2
  exit 1
fi

mkdir -p "$OUT"

for d in "$NATIVE"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  cp -r "$d" "$OUT/$name"
done

for d in "$SOP"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  if [ -e "$OUT/$name" ]; then
    echo "error: [copy-skills-with-collision-guard] skills/$name already exists (copied from --native above); refusing to merge the SOP-derived skills/$name/ directory into it. Rename the colliding native skill directory or the agent-sops/*.sop.md that produces this name so the two don't share a skill name." >&2
    exit 1
  fi
  cp -r "$d" "$OUT/$name"
done
