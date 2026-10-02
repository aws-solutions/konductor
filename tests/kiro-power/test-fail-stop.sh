#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-fail-stop.sh -- pins the fail-stop rule end to end through
# run-onboarding.sh: "Any non-zero exit stops the flow ... relays that
# command's stderr to the user word for word ... never continues to the
# next step after a failed one." Uses a fully stubbed environment (fake
# `curl` serving a fake `konductor` binary on a scratch PATH) -- no real
# network call, no real HOME/PATH touched.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR: defaults to
# this repo's own source tree, but a caller (make kiro-power-check, the CI
# publish job) can point it at the ASSEMBLED tree instead, so the test
# suite actually exercises what gets published rather than only the
# pre-assembly source layout.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
ORCHESTRATOR="${SCRIPTS_DIR}/run-onboarding.sh"

# Deliberately NOT a hardcoded "v1.0.2" -- same drift rationale as
# test-resolve-version.sh: derived from the repo-root VERSION file at
# test-run time, so a future version bump can never make every `--tag
# "$DEFAULT_TAG"` call below silently start tripping the non-default-source
# gate in run-onboarding.sh (that gate refuses whenever the resolved tag
# differs from plugin.json's own default -- an accidentally-stale
# hardcoded tag here would look exactly like a real deviation to that
# check).
REPO_ROOT_VERSION="$(tr -d '[:space:]' < "${TEST_DIR}/../../VERSION")"
DEFAULT_TAG="v${REPO_ROOT_VERSION}"

SCRATCH="$(mktemp -d)"
FAKE_BIN="${SCRATCH}/fake-bin"
FAKE_HOME="${SCRATCH}/fake-home"
TARGET_DIR="${SCRATCH}/project"
DOCTOR_MARKER="${SCRATCH}/doctor-was-called.marker"
mkdir -p "$FAKE_BIN" "$FAKE_HOME" "$TARGET_DIR"

# ── Test 1: `konductor install` itself fails -> doctor must never run ────
#
# The fake `konductor` binary this curl stub serves: `install` always
# fails with a distinctive stderr message; `doctor` writes a marker file
# so this test can prove it was (or was not) reached.
cat > "${FAKE_BIN}/fake-konductor-body.sh" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install)
    echo "konductor install: DISTINCTIVE_INSTALL_FAILURE_MESSAGE" >&2
    exit 1
    ;;
  doctor)
    touch "${DOCTOR_MARKER}"
    exit 0
    ;;
  *)
    echo "fake-konductor: unexpected subcommand: \$1" >&2
    exit 1
    ;;
esac
STUB
chmod +x "${FAKE_BIN}/fake-konductor-body.sh"

cat > "${FAKE_BIN}/curl" <<STUB
#!/usr/bin/env bash
set -euo pipefail
out=""
args=("\$@")
for ((i = 0; i < \${#args[@]}; i++)); do
  if [[ "\${args[\$i]}" == "-o" ]]; then
    out="\${args[\$((i + 1))]}"
  fi
done
url="\${args[-1]}"
name="\$(basename "\$url")"

case "\$name" in
  *.sha256)
    cp "${FAKE_BIN}/fake-konductor-body.sh" "\${out%.sha256}.__reference"
    (cd "\$(dirname "\$out")" && sha256sum "\$(basename "\${out%.sha256}.__reference")" \
      | sed "s/\$(basename "\${out%.sha256}.__reference")/\$(basename "\${out%.sha256}")/") > "\$out"
    rm -f "\${out%.sha256}.__reference"
    ;;
  *)
    cp "${FAKE_BIN}/fake-konductor-body.sh" "\$out"
    ;;
esac
exit 0
STUB
chmod +x "${FAKE_BIN}/curl"

t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "$DEFAULT_TAG" --confirmed
t_assert_status "run-onboarding.sh exits non-zero when 'konductor install' fails" 1
t_assert_contains "the failing command's real stderr is relayed word for word" "DISTINCTIVE_INSTALL_FAILURE_MESSAGE"

if [[ -f "$DOCTOR_MARKER" ]]; then
  t_fail "doctor must NEVER run after install failed" "found marker at: $DOCTOR_MARKER"
else
  t_pass "doctor never ran after install failed (fail-stop, no 'continue anyway')"
fi

# ── Test 2: a download/verification failure stops before install too ────
# (--tag with a "curl" that always fails the asset fetch -- simulates a
# 404 / tag-not-found, and confirms nothing downstream (link, install,
# doctor) ever runs. This --tag deliberately differs from plugin.json's
# own default, so --allow-non-default-repo is required to get past the
# source-redirection gate and actually reach the download step this test
# exercises -- exactly what a real caller testing against a nonexistent
# tag would also need to pass.)
rm -f "$DOCTOR_MARKER"
FAKE_BIN_2="${SCRATCH}/fake-bin-2"
mkdir -p "$FAKE_BIN_2"
cat > "${FAKE_BIN_2}/curl" <<'STUB'
#!/usr/bin/env bash
# Always fail, simulating a 404 for a tag that does not exist.
exit 22
STUB
chmod +x "${FAKE_BIN_2}/curl"

t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN_2}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "v9999.0.0-does-not-exist" --allow-non-default-repo --confirmed
t_assert_status "run-onboarding.sh exits non-zero when the download itself fails" 1
t_assert_contains "the failure is attributed to the specific tag, not a generic message" "v9999.0.0-does-not-exist"
t_assert_contains "the failure explicitly says it will not fall back to latest" "Not retrying against 'latest'"

if [[ -f "$DOCTOR_MARKER" ]]; then
  t_fail "doctor must NEVER run after the download itself failed" "found marker at: $DOCTOR_MARKER"
else
  t_pass "doctor never ran after the download failed (fail-stop at the earliest possible step)"
fi

# ── Test 3: --confirmed is a real, checked gate ──────────────────────────
# Omitting it must refuse to run before touching the network or the
# filesystem at all -- this is the consent backstop itself, not the
# fail-stop rule the two tests above pin.
rm -f "$DOCTOR_MARKER"
t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "$DEFAULT_TAG"
t_assert_status "run-onboarding.sh refuses to run without --confirmed" 64
t_assert_contains "the refusal names --confirmed specifically" "--confirmed"
t_assert_contains "the refusal points at SKILL.md Step 0" "SKILL.md"

if [[ -f "$DOCTOR_MARKER" ]]; then
  t_fail "no --confirmed means nothing downstream should ever run" "found marker at: $DOCTOR_MARKER"
else
  t_pass "no --confirmed means nothing downstream ran (no fetch, no install, no doctor)"
fi

# ── Test 4: a GitHub rate-limit/auth signature triggers a retry suggestion
#
# The fake `konductor install` below fails with the CLI's own real
# "HTTP status 403 ... GITHUB_TOKEN ... --use-github-token" wording
# (verified directly against install/github.rs's private_repo_hint --
# see lib.sh's konductor_suggest_rate_limit_retry doc comment). This pins
# that konductor_run_cli notices that signature and prints an exact,
# copy-pasteable retry command rather than leaving the user to guess.
rm -f "$DOCTOR_MARKER"
cat > "${FAKE_BIN}/fake-konductor-body.sh" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install)
    echo "konductor install: GitHub API responded with HTTP status 403 while fetching release metadata -- if this repository is private, set the GITHUB_TOKEN environment variable and pass --use-github-token" >&2
    exit 1
    ;;
  doctor)
    touch "${DOCTOR_MARKER}"
    exit 0
    ;;
  *)
    echo "fake-konductor: unexpected subcommand: \$1" >&2
    exit 1
    ;;
esac
STUB
chmod +x "${FAKE_BIN}/fake-konductor-body.sh"

t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "$DEFAULT_TAG" --confirmed
t_assert_status "a rate-limited install still exits non-zero (this is a hint, not a silent recovery)" 1
t_assert_contains "the real HTTP 403 stderr is still relayed in full" "HTTP status 403"
t_assert_contains "a rate-limit/auth signature triggers the retry-suggestion block" "rate limit or auth problem"
t_assert_contains "the suggested retry command names --use-github-token for install" "--use-github-token"
t_assert_contains "the suggested retry command tells the user to supply GITHUB_TOKEN" "GITHUB_TOKEN=<your-token>"

# ── Test 5: the SAME signature on `doctor` suggests --no-version-check,
# never --use-github-token (doctor has no such flag at all).
rm -f "$DOCTOR_MARKER"
cat > "${FAKE_BIN}/fake-konductor-body.sh" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install)
    exit 0
    ;;
  doctor)
    echo "could not determine the latest available CLI version: GitHub API responded with HTTP status 403 while fetching release metadata -- if this repository is private, set the GITHUB_TOKEN environment variable and pass --use-github-token" >&2
    exit 1
    ;;
  *)
    echo "fake-konductor: unexpected subcommand: \$1" >&2
    exit 1
    ;;
esac
STUB
chmod +x "${FAKE_BIN}/fake-konductor-body.sh"

t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "$DEFAULT_TAG" --confirmed
t_assert_status "a rate-limited doctor call still exits non-zero" 1
t_assert_contains "doctor's retry suggestion names --no-version-check" "--no-version-check"
t_assert_contains "doctor's retry suggestion explicitly says --use-github-token does not apply to doctor" "does not apply to doctor"

rm -rf "$SCRATCH"

t_summary
