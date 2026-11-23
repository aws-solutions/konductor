#!/usr/bin/env bash
# STANDARD judge pass, owner wrapper: bench/kit/standard/judge-standard.sh with this host's paths. Owner terminal only.
#
#   bash run-standard-judge.sh --plan                         free: calls and estimated USD; no model call
#   AWS_PROFILE_NAME=<profile> bash run-standard-judge.sh     paid, USD 15 cap
set -u
. "$(dirname "${BASH_SOURCE[0]}")/standard-kit-env.sh"
exec bash "$KIT/judge-standard.sh" "$@"
