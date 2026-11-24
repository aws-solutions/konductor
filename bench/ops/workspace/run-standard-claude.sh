#!/usr/bin/env bash
# STANDARD Claude Code arms, owner wrapper: bench/kit/standard/claude-standard.sh with this host's paths. Owner
# terminal only. Runs after run-standard.sh (it reads the frozen plan) and before run-standard-judge.sh.
#
#   bash run-standard-claude.sh --plan                         free: arms, batches, runs, expected USD; no bench call
#   bash run-standard-claude.sh --prepare-only                 free: three cc- arms prepared; no model call
#   CC_AWS_PROFILE=<profile> bash run-standard-claude.sh       paid, USD 1.5 a run, USD 80 a stage, CC_STAGES stages
set -u
. "$(dirname "${BASH_SOURCE[0]}")/standard-kit-env.sh"
exec bash "$KIT/claude-standard.sh" "$@"
