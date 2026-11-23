#!/usr/bin/env bash
# STANDARD Claude Code step, owner wrapper: bench/kit/standard/claude-standard.sh with this host's paths. Owner
# terminal only.
#
#   bash run-standard-claude.sh --prepare-only                 free: task pick, both arms prepared; no model call
#   CC_AWS_PROFILE=<profile> bash run-standard-claude.sh       paid, USD 1 per run, USD 30 cap
set -u
. "$(dirname "${BASH_SOURCE[0]}")/standard-kit-env.sh"
exec bash "$KIT/claude-standard.sh" "$@"
