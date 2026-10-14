#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-binary-version-validation.sh -- pins that run-onboarding.sh
# validates the installing binary's own `--version` output against
# KONDUCTOR_CLI_VERSION_REGEX (lib.sh's bare-semver shape) BEFORE writing
# it into power-cli.json, not just checking it for emptiness. A binary
# that produces non-semver garbage on `--version` must fail the whole
# run closed, with power-cli.json never created -- a malformed
# cli_version written there would otherwise only surface much later, as
# an opaque failure inside konductor_resolve_target_binary's own
# validation (run-update.sh/run-uninstall.sh), disconnected from the
# onboarding run that actually produced it.
#
# Uses a stubbed environment (fake `curl` serving a fake `konductor`
# binary on a scratch PATH) -- no real network call, no real HOME/PATH
# touched. Mirrors test-record-written-before-doctor.sh's own stub shape.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR: see test-fail-stop.sh's identical header
# comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
ORCHESTRATOR="${SCRIPTS_DIR}/run-onboarding.sh"

# Deliberately NOT a hardcoded "v1.0.2" -- same drift rationale as
# test-fail-stop.sh/test-resolve-version.sh: derived from the repo-root
# VERSION file at test-run time.
REPO_ROOT_VERSION="$(tr -d '[:space:]' < "${TEST_DIR}/../../VERSION")"
DEFAULT_TAG="v${REPO_ROOT_VERSION}"

# make_fake_bin_dir <scratch> <version-output>
# Builds a scratch PATH whose `konductor` always succeeds `install` and
# `doctor`, but whose `--version` prints exactly <version-output> --
# garbage, in the RED case below, rather than a real "konductor <semver>"
# line.
make_fake_bin_dir() {
  local scratch="$1" version_output="$2"
  local fake_bin="${scratch}/fake-bin"
  mkdir -p "$fake_bin"

  cat > "${fake_bin}/fake-konductor-body.sh" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install)
    exit 0
    ;;
  doctor)
    exit 0
    ;;
  --version)
    echo "${version_output}"
    exit 0
    ;;
  *)
    echo "fake-konductor: unexpected subcommand: \$1" >&2
    exit 1
    ;;
esac
STUB
  chmod +x "${fake_bin}/fake-konductor-body.sh"

  cat > "${fake_bin}/curl" <<STUB
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
    cp "${fake_bin}/fake-konductor-body.sh" "\${out%.sha256}.__reference"
    (cd "\$(dirname "\$out")" && sha256sum "\$(basename "\${out%.sha256}.__reference")" \\
      | sed "s/\$(basename "\${out%.sha256}.__reference")/\$(basename "\${out%.sha256}")/") > "\$out"
    rm -f "\${out%.sha256}.__reference"
    ;;
  *)
    cp "${fake_bin}/fake-konductor-body.sh" "\$out"
    ;;
esac
exit 0
STUB
  chmod +x "${fake_bin}/curl"

  echo "$fake_bin"
}

# ── RED case: the installing binary's own `--version` prints garbage
# (no "konductor <semver>" line at all) -- onboarding must fail before
# writing power-cli.json. ───────────────────────────────────────────────
SCRATCH_GARBAGE="$(mktemp -d)"
FAKE_HOME_GARBAGE="${SCRATCH_GARBAGE}/fake-home"
TARGET_GARBAGE="${SCRATCH_GARBAGE}/project"
mkdir -p "$FAKE_HOME_GARBAGE" "$TARGET_GARBAGE"
FAKE_BIN_GARBAGE="$(make_fake_bin_dir "$SCRATCH_GARBAGE" "unexpected garbage output")"

t_run env HOME="$FAKE_HOME_GARBAGE" PATH="${FAKE_BIN_GARBAGE}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_GARBAGE" --tag "$DEFAULT_TAG" --confirmed
t_assert_status "onboarding fails closed when --version prints non-semver garbage" 1
# BINARY_OWN_VERSION is `--version`'s SECOND whitespace-separated field
# (matching the real binary's own "konductor <semver>" shape, via `awk
# '{print $2}'`) -- for "unexpected garbage output" that is "garbage",
# not the line verbatim; the failure message names that extracted value.
t_assert_contains "the failure names the extracted (non-semver) value" "produced 'garbage'"
t_assert_contains "the failure names the expected bare-semver shape" "not a bare semver"

POWER_CLI_JSON_GARBAGE="${TARGET_GARBAGE}/.konductor/power-cli.json"
if [[ -f "$POWER_CLI_JSON_GARBAGE" ]]; then
  t_fail "power-cli.json must never be written when --version output fails semver validation" "found: $POWER_CLI_JSON_GARBAGE"
else
  t_pass "power-cli.json is never created when --version output is not a bare semver"
fi

rm -rf "$SCRATCH_GARBAGE"

# ── GREEN case: a real, well-formed semver on --version still succeeds
# and still writes power-cli.json, proving the new check does not block
# legitimate use. ───────────────────────────────────────────────────────
SCRATCH_VALID="$(mktemp -d)"
FAKE_HOME_VALID="${SCRATCH_VALID}/fake-home"
TARGET_VALID="${SCRATCH_VALID}/project"
mkdir -p "$FAKE_HOME_VALID" "$TARGET_VALID"
FAKE_BIN_VALID="$(make_fake_bin_dir "$SCRATCH_VALID" "konductor ${REPO_ROOT_VERSION}")"

t_run env HOME="$FAKE_HOME_VALID" PATH="${FAKE_BIN_VALID}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_VALID" --tag "$DEFAULT_TAG" --confirmed
t_assert_status "onboarding still succeeds for a real, well-formed --version output" 0

POWER_CLI_JSON_VALID="${TARGET_VALID}/.konductor/power-cli.json"
if [[ -f "$POWER_CLI_JSON_VALID" ]]; then
  RECORDED_VERSION="$(jq -r '.cli_version // empty' "$POWER_CLI_JSON_VALID" 2>/dev/null || true)"
  t_assert_equal "power-cli.json still records the installing binary's own --version" "$REPO_ROOT_VERSION" "$RECORDED_VERSION"
else
  t_fail "power-cli.json must still be written for a valid --version output" "expected file at: $POWER_CLI_JSON_VALID"
fi

rm -rf "$SCRATCH_VALID"

t_summary
