#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-record-written-before-doctor.sh -- pins that power-cli.json is
# written as soon as `konductor install` succeeds, not only after
# `doctor` also succeeds. `doctor` can legitimately fail (it is a real,
# non-zero exit this script still propagates, per the fail-stop rule) on
# a target where install has already written real files -- a user in
# that state still needs run-update.sh/run-uninstall.sh to resolve the
# CLI binary that performed the install, so the record must exist
# regardless of what doctor reports afterward.
#
# Uses a stubbed environment (fake `curl` serving a fake `konductor`
# binary on a scratch PATH) -- no real network call, no real HOME/PATH
# touched. Mirrors test-fail-stop.sh's own stub shape.
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

SCRATCH="$(mktemp -d)"
FAKE_BIN="${SCRATCH}/fake-bin"
FAKE_HOME="${SCRATCH}/fake-home"
TARGET_DIR="${SCRATCH}/project"
mkdir -p "$FAKE_BIN" "$FAKE_HOME" "$TARGET_DIR"

# A fake `konductor` whose `install` subcommand always succeeds and whose
# `doctor` subcommand always fails with a distinctive stderr message --
# the record of this run's own CLI binary must exist afterward even
# though the overall run still exits non-zero.
cat > "${FAKE_BIN}/fake-konductor-body.sh" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install)
    exit 0
    ;;
  doctor)
    echo "konductor doctor: DISTINCTIVE_DOCTOR_FAILURE_MESSAGE" >&2
    exit 1
    ;;
  --version)
    echo "konductor ${REPO_ROOT_VERSION}"
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

t_assert_status "run-onboarding.sh still exits non-zero when 'konductor doctor' fails" 1
t_assert_contains "doctor's real stderr is relayed word for word" "DISTINCTIVE_DOCTOR_FAILURE_MESSAGE"

POWER_CLI_JSON="${TARGET_DIR}/.konductor/power-cli.json"
if [[ -f "$POWER_CLI_JSON" ]]; then
  t_pass "power-cli.json was written even though doctor failed afterward (install already succeeded)"
else
  t_fail "power-cli.json must be written once install succeeds, regardless of doctor's own result" "expected file at: $POWER_CLI_JSON"
fi

RECORDED_VERSION="$(jq -r '.cli_version // empty' "$POWER_CLI_JSON" 2>/dev/null || true)"
t_assert_equal "power-cli.json records the installing binary's own --version" "$REPO_ROOT_VERSION" "$RECORDED_VERSION"

RECORDED_BINARY="$(jq -r '.binary // empty' "$POWER_CLI_JSON" 2>/dev/null || true)"
case "$RECORDED_BINARY" in
  "${FAKE_HOME}/.konductor/cli-releases/konductor-${DEFAULT_TAG}-"*)
    t_pass "power-cli.json records the stable cached binary path, not a transient download path"
    ;;
  *)
    t_fail "power-cli.json's recorded binary path has an unexpected shape" "got: ${RECORDED_BINARY:-<empty>}"
    ;;
esac

if [[ -x "$RECORDED_BINARY" ]]; then
  t_pass "the recorded binary path is an existing, executable file"
else
  t_fail "the recorded binary path must exist and be executable" "path: ${RECORDED_BINARY:-<empty>}"
fi

rm -rf "$SCRATCH"

t_summary
