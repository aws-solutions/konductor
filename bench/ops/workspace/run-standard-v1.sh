#!/usr/bin/env bash
# STANDARD run, owner wrapper: bench/kit/standard/run-standard.sh with this host's paths (scripts/standard-kit-env.sh).
# Owner terminal only: paid. The kit's own header has the rules (caps, stages, resume, freeze).
#
#   bash run-standard-v1.sh --prepare-only   free: gate, plan preview, all three arms built and trial-installed
#   bash run-standard-v1.sh                  the paid run in the background (log /var/tmp/konductor-standard-v1/run.log)
#   bash run-standard-v1.sh --foreground     the same, in this terminal
set -u
. "$(dirname "${BASH_SOURCE[0]}")/standard-kit-env.sh"
exec bash "$KIT/run-standard.sh" "$@"
