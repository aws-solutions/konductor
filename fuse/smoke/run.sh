#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# One smoke run of a fuse-flow workflow: a fresh project with fuse-konductor
# installed, a fuse agent working in it, and an orchestrator agent that plays
# the user and judges the run. See fuse/smoke/README.md.
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
usage: run.sh [--workflow <name or file>] [--fuse-harness kiro|opencode] [--fuse-model <model>]
              [--orchestrator-harness kiro|opencode] [--orchestrator-model <model>]
              [--out <dir>] [--max-turns <n>] [--timeout-min <n>] [--turn-timeout-min <n>]
              [--opencode-profile <aws profile>] [--opencode-region <region>]
defaults: _k-phase-chain; fuse agent opencode with amazon-bedrock/global.openai.gpt-6-luna;
          orchestrator opencode with amazon-bedrock/global.openai.gpt-6.1-sol; ~/fuse-smoke-runs, 30 turns,
          60 minutes for the whole run, 30 minutes per fuse agent turn,
          opencode on Amazon Bedrock with AWS profile opencode-bedrock in us-west-2
A workflow name is looked up in fuse/flow/workflows/, then fuse/smoke/fixtures/. A workflow
that does not ship with fuse-flow is copied into the project's .konductor/workflows/, so the
fuse agent finds it by name. A sibling <workflow>.policy-overrides file is copied to the
project's .konductor/policy-overrides.yml, and a sibling <workflow>.library/ directory is copied
to the project's .konductor/library/. For an opencode role, the model is an opencode model id such as
amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0.
EOF
  exit 64
}

workflow=_k-phase-chain
fuse_harness=opencode
fuse_model=amazon-bedrock/global.openai.gpt-6-luna
orchestrator_harness=opencode
orchestrator_model=amazon-bedrock/global.openai.gpt-6.1-sol
opencode_profile=opencode-bedrock
opencode_region=us-west-2
out="$HOME/fuse-smoke-runs"
max_turns=30
timeout_min=60
turn_timeout_min=30
while [ $# -gt 0 ]; do
  case "$1" in
    --workflow) workflow="${2:?}"; shift 2 ;;
    --fuse-harness) fuse_harness="${2:?}"; shift 2 ;;
    --fuse-model) fuse_model="${2:?}"; shift 2 ;;
    --opencode-profile) opencode_profile="${2:?}"; shift 2 ;;
    --opencode-region) opencode_region="${2:?}"; shift 2 ;;
    --orchestrator-harness) orchestrator_harness="${2:?}"; shift 2 ;;
    --orchestrator-model) orchestrator_model="${2:?}"; shift 2 ;;
    --out) out="${2:?}"; shift 2 ;;
    --max-turns) max_turns="${2:?}"; shift 2 ;;
    --timeout-min) timeout_min="${2:?}"; shift 2 ;;
    --turn-timeout-min) turn_timeout_min="${2:?}"; shift 2 ;;
    *) usage ;;
  esac
done

smoke="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
clone="$(cd "$smoke/../.." && pwd)"
case "$workflow" in
  */* | *.yml | *.yaml) workflow_file="$(cd "$(dirname "$workflow")" && pwd)/$(basename "$workflow")" ;;
  *) workflow_file="$clone/fuse/flow/workflows/$workflow.yml"
     [ -f "$workflow_file" ] || workflow_file="$smoke/fixtures/$workflow.yml" ;;
esac
[ -f "$workflow_file" ] || { echo "run.sh: no workflow named or at $workflow" >&2; exit 64; }
workflow_name="$(basename "$workflow_file" .yml)"
shipped=no
[ "$workflow_file" = "$clone/fuse/flow/workflows/$workflow_name.yml" ] && shipped=yes
case "$fuse_harness" in kiro | opencode) ;; *) usage ;; esac
case "$orchestrator_harness" in kiro | opencode) ;; *) usage ;; esac
command -v kiro-cli >/dev/null || { echo "run.sh: kiro-cli is not on PATH" >&2; exit 1; }
if [ "$fuse_harness" = opencode ] || [ "$orchestrator_harness" = opencode ]; then
  command -v opencode >/dev/null || { echo "run.sh: opencode is not on PATH" >&2; exit 1; }
fi
command -v bun >/dev/null || { echo "run.sh: bun is not on PATH" >&2; exit 1; }
[ -d "$clone/fuse/flow/node_modules" ] || (cd "$clone/fuse/flow" && bun install --frozen-lockfile >/dev/null) || exit 1

# mktemp's suffix keeps runs that start in the same second apart.
mkdir -p "$out" || exit 1
# Keep the run directory short and free of dates: agents retype long absolute
# paths, and they "correct" a date stamp such as a model id's 20251001 or mangle
# other parts on the way. The label names the run inside the directory instead.
label() { echo "$1-$(basename "$2" | sed -E 's/^(global|us|eu|apac|jp|au|in|ca)\.//; s/-[0-9]{8}.*$//; s/:/_/g')"; }
run="$(mktemp -d "$out/$(date -u +%m%d-%H%M%S)-XXXX")" || exit 1
echo "$workflow_name fuse $(label "$fuse_harness" "$fuse_model") orchestrator $(label "$orchestrator_harness" "$orchestrator_model")" > "$run/label"
project="$run/project"
mkdir -p "$project" "$run/orchestrator/.kiro/agents" || exit 1
echo "smoke run: $run"

# The project: an empty repository with fuse-konductor installed, committed so
# the fuse agent starts from a clean tree, as a user's repository would.
(
  cd "$project" &&
  git init -q -b main &&
  "$clone/install.sh" --project . > "$run/install.log" 2>&1 &&
  if [ "$shipped" = no ]; then
    mkdir -p .konductor/workflows && cp "$workflow_file" .konductor/workflows/
  fi &&
  policy_file="${workflow_file%.yml}.policy-overrides" &&
  if [ -f "$policy_file" ]; then
    mkdir -p .konductor && cp "$policy_file" .konductor/policy-overrides.yml
  fi &&
  library_dir="${workflow_file%.yml}.library" &&
  if [ -d "$library_dir" ]; then
    mkdir -p .konductor/library && cp -R "$library_dir"/. .konductor/library/
  fi &&
  if [ "$fuse_harness" = kiro ]; then
    mkdir -p .kiro/agents &&
    # The fuse agent sees only what a fresh user's project gives it: AGENTS.md
    # and the installed skills, without this machine's global steering.
    cat > .kiro/agents/fuse-smoke.json <<'EOF'
{
  "name": "fuse-smoke",
  "description": "Smoke-test stand-in for a fresh user's default agent: built-in tools, the project's AGENTS.md and installed skills only.",
  "tools": ["@builtin"],
  "allowedTools": ["@builtin"],
  "includeMcpJson": false,
  "resources": ["file://AGENTS.md", "skill://.kiro/skills/**/SKILL.md"]
}
EOF
  fi &&
  git add -A &&
  git -c user.name=smoke -c user.email=smoke@localhost commit -q -m "Install fuse-konductor" &&
  # A local bare remote stands in for the user's forge, so workflows that push
  # branches can do so without reaching any real repository.
  git init -q --bare "$run/origin.git" &&
  git remote add origin "$run/origin.git" &&
  git push -q -u origin main
) || { echo "run.sh: project setup failed; see $run/install.log" >&2; exit 1; }

# opencode reads skills and instructions from the home directory (~/.agents,
# ~/.claude, ~/.config/opencode), so each opencode role gets a home of its own:
# the opencode config for Bedrock, the clone pointer install.sh wrote, and a
# git identity. AWS credentials come from the environment, not from HOME.
# $2 is a JSON array of instruction files, or [] for none.
opencode_home() {
  mkdir -p "$1/.config/opencode" "$1/.konductor" || return 1
  cp "$HOME/.konductor/fuse-konductor-clone" "$1/.konductor/" || return 1
  printf '[user]\n\tname = smoke\n\temail = smoke@localhost\n' > "$1/.gitconfig"
  cat > "$1/.config/opencode/opencode.json" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "enabled_providers": ["amazon-bedrock"],
  "share": "disabled",
  "autoupdate": false,
  "instructions": $2,
  "provider": { "amazon-bedrock": { "options": { "profile": "$opencode_profile", "region": "$opencode_region" } } }
}
EOF
}
fuse_home="$run/fuse-home"
if [ "$fuse_harness" = opencode ]; then
  opencode_home "$fuse_home" '[]' || exit 1
fi

cat > "$run/run.env" <<EOF
WORKFLOW='$workflow_name'
FUSE_HARNESS='$fuse_harness'
FUSE_HOME='$fuse_home'
FUSE_MODEL='$fuse_model'
ORCHESTRATOR_HARNESS='$orchestrator_harness'
ORCHESTRATOR_MODEL='$orchestrator_model'
PROJECT='$project'
MAX_TURNS='$max_turns'
TURN_TIMEOUT_MIN='$turn_timeout_min'
EOF
# The wrapper restores the real home, which an opencode orchestrator replaces.
printf '#!/usr/bin/env bash\nexport HOME=%q\nunset XDG_CONFIG_HOME\nexec %q %q "$@"\n' "$HOME" "$smoke/say.sh" "$run" > "$run/say"
chmod +x "$run/say"
project_workflow="$workflow_file"
[ "$shipped" = no ] && project_workflow="$project/.konductor/workflows/$workflow_name.yml"

cat > "$run/orchestrator/brief.md" <<EOF
# Brief for this smoke run

- Workflow under test: \`$workflow_name\` (its definition: \`$project_workflow\`)
- Talk to the fuse agent with: \`$run/say "<your message>"\`
- Turn budget: $max_turns messages
- The fuse agent's project, which you may read but never change: \`$project\`
- Write your verdict to: \`$run/verdict.md\`
EOF
cat > "$run/orchestrator/.kiro/agents/smoke-orchestrator.json" <<EOF
{
  "name": "smoke-orchestrator",
  "description": "Plays the user in a fuse-flow smoke run and judges whether the workflow works end to end.",
  "tools": ["@builtin"],
  "allowedTools": ["@builtin"],
  "includeMcpJson": false,
  "resources": ["file://$smoke/orchestrator.md", "file://$run/orchestrator/brief.md"]
}
EOF

start=$(date +%s)
prompt="Run the smoke test described in your brief now."
if [ "$orchestrator_harness" = opencode ]; then
  orchestrator_home="$run/orchestrator-home"
  opencode_home "$orchestrator_home" "[\"$smoke/orchestrator.md\", \"$run/orchestrator/brief.md\"]" || exit 1
  # One say call waits for a whole fuse agent turn; opencode's bash tool
  # otherwise kills a command after two minutes.
  ( cd "$run/orchestrator" && HOME="$orchestrator_home" XDG_CONFIG_HOME="$orchestrator_home/.config" \
      OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS=$(( (turn_timeout_min + 2) * 60000 )) \
      timeout -k 30 "${timeout_min}m" \
      opencode run --pure --auto -m "$orchestrator_model" "$prompt" ) > "$run/orchestrator.out" 2> "$run/orchestrator.err"
else
  ( cd "$run/orchestrator" && timeout -k 30 "${timeout_min}m" \
      kiro-cli chat --no-interactive --trust-all-tools --agent smoke-orchestrator --model "$orchestrator_model" \
      "$prompt" ) > "$run/orchestrator.out" 2> "$run/orchestrator.err"
fi
orchestrator_rc=$?
wall=$(( $(date +%s) - start ))

# Checked against the harness's own copy, so an edit to the project's copy
# of the workflow cannot make a run pass.
bun "$smoke/check.ts" --project "$project" --workflow "$workflow_file" > "$run/mechanical.txt" 2>&1
bun "$smoke/summary.ts" "$run" "$wall" "$orchestrator_rc"

mechanical=$(grep -o 'MECHANICAL: [A-Z]*' "$run/mechanical.txt" | tail -1)
verdict() { grep -m1 -E "^$1: " "$run/verdict.md" 2>/dev/null | tr -d '[:space:]' | cut -d: -f2; }
engine=$(verdict ENGINE); workflow_verdict=$(verdict WORKFLOW); guidance=$(verdict GUIDANCE)
if [ "$mechanical" = "MECHANICAL: PASS" ] && [ "$engine" = PASS ] && [ "$workflow_verdict" = PASS ]; then
  [ "$guidance" = PASS ] && exit 0
  [ "$guidance" = FRICTION ] && exit 2
fi
exit 1
