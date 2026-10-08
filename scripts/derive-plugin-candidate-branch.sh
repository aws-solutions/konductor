#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Derives the collision-resistant candidate branch name for a Claude Code
# plugin publish. The name is release version + workflow run identifier,
# which GitHub guarantees unique per workflow run (run-attempt disambiguates
# a manual re-run of the same run id) -- so collision resistance comes from
# the inputs, not from this script. This script's own job is to validate
# those inputs and refuse to emit anything that isn't a safe git ref name,
# or that collides with a protected branch name.
#
# Usage: derive-plugin-candidate-branch.sh --version <vX.Y.Z> --run-id <id> \
#          --run-attempt <attempt> [--prefix <prefix>]
#
# Prints the candidate branch name to stdout on success.
set -euo pipefail

VERSION=""
RUN_ID=""
RUN_ATTEMPT=""
PREFIX="plugin-candidate"

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || { echo "derive-plugin-candidate-branch.sh: --version requires an argument" >&2; exit 64; }
      VERSION="$2"
      shift 2
      ;;
    --run-id)
      [ $# -ge 2 ] || { echo "derive-plugin-candidate-branch.sh: --run-id requires an argument" >&2; exit 64; }
      RUN_ID="$2"
      shift 2
      ;;
    --run-attempt)
      [ $# -ge 2 ] || { echo "derive-plugin-candidate-branch.sh: --run-attempt requires an argument" >&2; exit 64; }
      RUN_ATTEMPT="$2"
      shift 2
      ;;
    --prefix)
      [ $# -ge 2 ] || { echo "derive-plugin-candidate-branch.sh: --prefix requires an argument" >&2; exit 64; }
      PREFIX="$2"
      shift 2
      ;;
    *)
      echo "derive-plugin-candidate-branch.sh: unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$VERSION" ] || [ -z "$RUN_ID" ] || [ -z "$RUN_ATTEMPT" ]; then
  echo "derive-plugin-candidate-branch.sh: --version, --run-id, and --run-attempt are all required" >&2
  exit 64
fi

# Mirrors validate-version-semver.sh's check but requires the leading "v",
# since callers pass release.yml's RELEASE_VERSION output (e.g. "v1.0.4"),
# not the bare VERSION file content.
if ! printf '%s' "$VERSION" | grep -qE '^v[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "FATAL: --version '$VERSION' is not a valid vX.Y.Z release version. Failing closed." >&2
  exit 1
fi

# GitHub documents run_id/run_attempt as numeric
# (https://docs.github.com/en/actions/learn-github-actions/contexts#github-context),
# but this check is cheap insurance against a malformed caller, not trust in
# that guarantee holding forever.
if ! printf '%s' "$RUN_ID" | grep -qE '^[0-9]+$'; then
  echo "FATAL: --run-id '$RUN_ID' is not purely numeric. Failing closed." >&2
  exit 1
fi
if ! printf '%s' "$RUN_ATTEMPT" | grep -qE '^[0-9]+$'; then
  echo "FATAL: --run-attempt '$RUN_ATTEMPT' is not purely numeric. Failing closed." >&2
  exit 1
fi

# PREFIX is caller-controlled (release.yml passes a fixed literal, never
# user input), but validate it anyway rather than trust the caller.
if ! printf '%s' "$PREFIX" | grep -qE '^[A-Za-z0-9][A-Za-z0-9_-]*$'; then
  echo "FATAL: --prefix '$PREFIX' contains characters unsafe for a git ref component. Failing closed." >&2
  exit 1
fi

CANDIDATE_BRANCH="${PREFIX}/${VERSION}-${RUN_ID}-${RUN_ATTEMPT}"

# Defense in depth: the inputs above already make these equalities
# structurally impossible, but a candidate branch publish must never equal
# a protected ref name under any future change to this derivation.
case "$CANDIDATE_BRANCH" in
  main|mainline|release/plugins)
    echo "FATAL: derived candidate branch '$CANDIDATE_BRANCH' equals a protected ref name. Failing closed." >&2
    exit 1
    ;;
esac

# git-check-ref-format enforces the real git ref grammar (no "..", no
# control characters, no leading/trailing "/", no trailing ".lock", etc.)
# against the fully-qualified ref, rather than re-implementing that grammar
# here.
if ! git check-ref-format "refs/heads/$CANDIDATE_BRANCH" >/dev/null 2>&1; then
  echo "FATAL: derived candidate branch '$CANDIDATE_BRANCH' is not a valid git ref name. Failing closed." >&2
  exit 1
fi

printf '%s\n' "$CANDIDATE_BRANCH"
