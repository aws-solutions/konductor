#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# kiro-agentless-discovery.sh -- runtime check that a plain Kiro CLI session
# discovers and loads the skills an agentless
# `konductor install --harness kiro-cli-v2` puts under .kiro/skills/.
#
# Not part of `make test`: it needs an authenticated `kiro-cli` and model
# calls, which CI does not have. Run it by hand after changing how skills are
# installed for Kiro, from the repository root, after `make build`:
#
#   bash tests/integration/kiro-agentless-discovery.sh
#
# It synthesizes this checkout and installs it agentless into a fresh git
# repository, then checks three things, each by a positive, exact answer:
#
# 1. A plain `kiro-cli chat --no-interactive` session loads an installed
#    ordinary skill: asked to use `aws-mcp-usage`, it reports the pinned proxy
#    version, which appears only in the skill's body.
# 2. The same kind of session loads an installed SOP conversion: asked to use
#    `sop-k-verify`, it reports the exact NOT RUN reason string from the SOP's
#    body.
# 3. A workflow step resolves to an installed skill and the session loads it:
#    `fuse-flow start` with the phase-chain workflow, then `fuse-flow next`
#    must point at `.kiro/skills/user-story-writing/SKILL.md` without "not
#    found", and a session told to run that `next` and read the file it names
#    must report the fourth entry of the file's `tags` list.
#
# The first two questions asked in an empty repository are the control: that
# session must not produce the body-only answers. Exit 0 means every check
# passed; exit 1 prints the transcripts; exit 2 means a prerequisite is missing
# (reported, not a failure of the check).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
konductor="$repo_root/build/cli/konductor"
fuse_flow="$repo_root/fuse/flow/fuse-flow"

for tool in kiro-cli git bun; do
  command -v "$tool" >/dev/null 2>&1 || { echo "SKIP: $tool not on PATH" >&2; exit 2; }
done
[[ -x "$konductor" ]] || { echo "SKIP: $konductor missing; run make build" >&2; exit 2; }

work="$(mktemp -d "${TMPDIR:-/tmp}/kiro-agentless-discovery.XXXXXX")"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/installed" "$work/empty"
git -C "$work/installed" init -q
git -C "$work/empty" init -q

(cd "$repo_root" && "$konductor" synth >/dev/null)
HOME="$work/installed" "$konductor" install --from "$repo_root" --harness kiro-cli-v2 \
  --target "$work/installed" --no-telemetry >/dev/null

ask() { # ask <dir> <prompt>
  (cd "$1" && timeout 300 kiro-cli chat --no-interactive --trust-all-tools "$2" 2>/dev/null) || true
}

# fuse-flow as the installed project sees it: no skills directory override,
# and HOME pointed at the install target like the install above.
flow() {
  (cd "$work/installed" && unset FUSE_SKILLS_DIR && HOME="$work/installed" "$fuse_flow" "$@")
}

failures=0
check() { # check <label> <haystack> <needle>
  if grep -qiF -- "$3" <<<"$2"; then
    echo "PASS: $1"
  else
    echo "FAIL: $1 (expected: $3)"; failures=$((failures + 1))
  fi
}
check_absent() { # check_absent <label> <haystack> <needle>
  if grep -qiF -- "$3" <<<"$2"; then
    echo "FAIL: $1 (unexpected: $3)"; failures=$((failures + 1))
  else
    echo "PASS: $1"
  fi
}

skill_q='Use the aws-mcp-usage skill. Reply with only the exact package and version it tells you to run with uvx, in the form name@1.2.3.'
sop_q='Use the sop-k-verify skill. Reply with only the exact reason string it tells you to give when the session has no shell tool.'
skill_installed="$(ask "$work/installed" "$skill_q")"
skill_control="$(ask "$work/empty" "$skill_q")"
sop_installed="$(ask "$work/installed" "$sop_q")"
sop_control="$(ask "$work/empty" "$sop_q")"
check "installed session loads the aws-mcp-usage skill" "$skill_installed" "mcp-proxy-for-aws@1.7.0"
check_absent "control session cannot load aws-mcp-usage" "$skill_control" "mcp-proxy-for-aws@1.7.0"
check "installed session loads the sop-k-verify SOP" "$sop_installed" "no shell tool in this session"
check_absent "control session cannot load sop-k-verify" "$sop_control" "no shell tool in this session"

flow start smoke --workflow "$repo_root/fuse/flow/workflows/_k-phase-chain.yml" >/dev/null
next_out="$(flow next smoke)"
check "fuse-flow resolves the first step's skill to the installed copy" "$next_out" \
  ".kiro/skills/user-story-writing/SKILL.md"
check_absent "fuse-flow finds the installed skill" "$next_out" "not found"
step_q="In this directory, run: HOME=$work/installed $fuse_flow next smoke -- then read the skill file named on its read: line, and reply with only the fourth entry of that file's tags list."
step_installed="$(ask "$work/installed" "$step_q")"
check "session loads the workflow step's skill" "$step_installed" "invest"

if (( failures > 0 )); then
  printf '\n--- skill (installed) ---\n%s\n--- skill (control) ---\n%s\n' "$skill_installed" "$skill_control"
  printf -- '--- sop (installed) ---\n%s\n--- sop (control) ---\n%s\n' "$sop_installed" "$sop_control"
  printf -- '--- fuse-flow next ---\n%s\n--- step (installed) ---\n%s\n' "$next_out" "$step_installed"
  exit 1
fi
