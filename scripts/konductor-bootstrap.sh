#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# konductor-bootstrap.sh
#
# ── WHAT THIS DOES ───────────────────────────────────────────────────────────
# Fetches scripts/konductor-install.sh from this repo's GitHub source,
# verifies it against the git blob SHA GitHub's Contents API reports for
# that file, and only then runs it. This is what README's Quick Start
# `curl ... | bash` one-liner actually pipes into -- a small,
# independently auditable fetch-verify-run step, so the one-liner never
# executes unverified code despite being a single piped command.
#
# The checksum check catches network corruption or a truncated download.
# It does not catch a compromise of GitHub itself, since both the
# downloaded file and the hash it's checked against come from the same
# source. Confirming against a checksum obtained independently of GitHub
# would need a separate attestation, which this repo does not yet
# publish.
#
# Any arguments given to this script are passed through verbatim to
# konductor-install.sh, so a future flag on that script (e.g. --harness)
# reaches it unchanged.
#
# ── USAGE ────────────────────────────────────────────────────────────────────
#   curl -fsSL https://raw.githubusercontent.com/aws-solutions/konductor/refs/heads/main/scripts/konductor-bootstrap.sh | bash
#
# `REPO` and `BRANCH` default to `aws-solutions/konductor` and `main`
# (override to test a fork or branch). `jq` is required here, to pull the
# checksum out of the Contents API's JSON response -- konductor-install.sh
# itself only needs `jq` on its own separate KONDUCTOR_USE_GITHUB_TOKEN
# opt-in path.
# `KONDUCTOR_USE_GITHUB_TOKEN` opts into reading `GITHUB_TOKEN` and
# sending it as a bearer token on both of this script's GitHub requests
# (the raw file fetch and the Contents API checksum lookup) -- needed
# only while this repo is still private ahead of its public launch.
# Mirrors konductor-install.sh's own `KONDUCTOR_USE_GITHUB_TOKEN` opt-in
# exactly, and is passed through to it below, so setting it once here
# covers both scripts' authenticated calls end to end.

set -euo pipefail

REPO="${REPO:-aws-solutions/konductor}"
BRANCH="${BRANCH:-main}"
SCRIPT_PATH="scripts/konductor-install.sh"

# Fail loudly, before any network access, rather than midway through a
# partially-verified download.
for dep in curl jq git; do
  if ! command -v "${dep}" >/dev/null 2>&1; then
    echo "error: this script requires '${dep}', which was not found on PATH." >&2
    exit 1
  fi
done

# An empty/unset GITHUB_TOKEN with the opt-in set is treated the same as
# not opting in at all. Mirrors konductor-install.sh's own
# KONDUCTOR_USE_GITHUB_TOKEN gate exactly: the authenticated path never
# activates on GITHUB_TOKEN's mere presence.
GITHUB_TOKEN_ACTIVE=""
if [[ -n "${KONDUCTOR_USE_GITHUB_TOKEN:-}" && -n "${GITHUB_TOKEN:-}" ]]; then
  GITHUB_TOKEN_ACTIVE="1"
fi

# Compares the git blob SHA fetched from GitHub's Contents API against
# the git blob SHA computed locally over the downloaded file. Treats an
# empty or "null" expected value (a malformed or unexpected API response)
# the same as a real mismatch, rather than passing a comparison against
# nothing.
checksums_match() {
  local expected="$1" actual="$2"
  [[ -n "${expected}" && "${expected}" != "null" && "${expected}" == "${actual}" ]]
}

# Runs a GET request against $1, forwarding any remaining args to curl.
# Authenticates via curl's `--config -` (stdin), not a `-H` command-line
# argument, when the GITHUB_TOKEN opt-in is active -- same handling as
# konductor-install.sh's own bearer-token requests, so the token never
# lands in the process table where another local user could read it via
# `ps aux` or `/proc/<pid>/cmdline`.
curl_get() {
  local url="$1"
  shift
  if [[ -n "${GITHUB_TOKEN_ACTIVE}" ]]; then
    printf 'header = "Authorization: Bearer %s"\n' "${GITHUB_TOKEN}" | curl -fsSL --config - "$@" "${url}"
  else
    curl -fsSL "$@" "${url}"
  fi
}

# A unique per-run path under /tmp, not a fixed name: two invocations
# running at the same time -- two terminals, or a developer and a CI job
# -- would otherwise race on the same file, where one's download could
# truncate or overwrite the other's mid-write. Removed on exit via the
# trap below regardless of how the run ends, so it never lingers as an
# unexplained file once the installer has run.
INSTALL_SCRIPT="$(mktemp /tmp/konductor-install.XXXXXX)"
cleanup() {
  rm -f "${INSTALL_SCRIPT}"
}
trap cleanup EXIT

echo "=== [konductor-bootstrap] Fetching ${SCRIPT_PATH} from ${REPO}@${BRANCH} ==="
curl_get "https://raw.githubusercontent.com/${REPO}/refs/heads/${BRANCH}/${SCRIPT_PATH}" -o "${INSTALL_SCRIPT}"

echo "=== [konductor-bootstrap] Verifying against GitHub's Contents API checksum ==="
CONTENTS_API_URL="https://api.github.com/repos/${REPO}/contents/${SCRIPT_PATH}?ref=${BRANCH}"
contents_response="$(curl_get "${CONTENTS_API_URL}")" || {
  echo "error: failed to fetch checksum metadata from ${CONTENTS_API_URL} -- check network access or GitHub API rate limits." >&2
  exit 1
}
expected_sha="$(printf '%s' "${contents_response}" | jq -r .sha)"
actual_sha="$(git hash-object "${INSTALL_SCRIPT}")"

if ! checksums_match "${expected_sha}" "${actual_sha}"; then
  echo "checksum mismatch: expected ${expected_sha}, got ${actual_sha}" >&2
  exit 1
fi

echo "=== [konductor-bootstrap] Verified. Running ${SCRIPT_PATH} ==="
KONDUCTOR_USE_GITHUB_TOKEN="${KONDUCTOR_USE_GITHUB_TOKEN:-}" bash "${INSTALL_SCRIPT}" "$@"
