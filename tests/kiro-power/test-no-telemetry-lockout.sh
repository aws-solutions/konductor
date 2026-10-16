#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-no-telemetry-lockout.sh -- pins that onboarding, updating, and
# uninstalling a target that opted out of telemetry (--no-telemetry) all
# succeed, even though install-info.json is never written for it.
#
# `konductor install --no-telemetry` never writes install-info.json at all
# (finalize_install_telemetry only calls write_install_info when telemetry
# is on -- see cli/konductor-rs/src/cli/install.rs), and `update
# --no-telemetry` deletes it on a target that previously had one.
# konductor_resolve_target_binary must therefore gate on this Power's own
# power-cli.json (or the CLI's own manifest file), never on
# install-info.json -- otherwise every update/uninstall on an opted-out
# target fails closed with "this target was not onboarded by this Power",
# even though it plainly was.
#
# Uses a stubbed curl+konductor on a scratch PATH/HOME; no real network
# call, no real ~/.local or ~/.konductor touched. The stubbed `install`
# subcommand deliberately never writes install-info.json itself (same
# constraint test-telemetry-flag.sh's stub already has), so this
# reproduces the real --no-telemetry on-disk state exactly.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR: see test-fail-stop.sh's identical header
# comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
ORCHESTRATOR="${SCRIPTS_DIR}/run-onboarding.sh"
UPDATE_SCRIPT="${SCRIPTS_DIR}/run-update.sh"
UNINSTALL_SCRIPT="${SCRIPTS_DIR}/run-uninstall.sh"

SCRATCH="$(mktemp -d)"
FAKE_BIN="${SCRATCH}/fake-bin"
FAKE_HOME="${SCRATCH}/fake-home"
TARGET_DIR="${SCRATCH}/project"
mkdir -p "$FAKE_BIN" "$FAKE_HOME" "$TARGET_DIR"

REPO_ROOT_VERSION="$(tr -d '[:space:]' < "${TEST_DIR}/../../VERSION")"
DEFAULT_TAG="v${REPO_ROOT_VERSION}"

# A fake `konductor`: `install`/`update`/`uninstall`/`doctor` all succeed;
# `install` deliberately never writes install-info.json (matching the
# real CLI's own --no-telemetry behaviour), and never writes a manifest
# file either -- this test only needs power-cli.json (written by
# run-onboarding.sh itself, not by the CLI) to prove the fix.
cat > "${FAKE_BIN}/fake-konductor-body.sh" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install|doctor|update|uninstall)
    exit 0
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
url="\${args[\$((\${#args[@]} - 1))]}"
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

# ── Onboard with --no-telemetry ─────────────────────────────────────────
t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "$DEFAULT_TAG" --confirmed --no-telemetry
t_assert_status "onboarding with --no-telemetry succeeds" 0

if [[ -f "${TARGET_DIR}/.konductor/install-info.json" ]]; then
  t_fail "the premise of this test requires install-info.json to be absent after a --no-telemetry onboard" "found: ${TARGET_DIR}/.konductor/install-info.json"
else
  t_pass "install-info.json is not written when --no-telemetry was used (matches the real CLI)"
fi
if [[ -f "${TARGET_DIR}/.konductor/power-cli.json" ]]; then
  t_pass "power-cli.json is written regardless of --no-telemetry"
else
  t_fail "run-onboarding.sh must write power-cli.json even with --no-telemetry" "missing: ${TARGET_DIR}/.konductor/power-cli.json"
fi

# ── Update must succeed on this opted-out target ────────────────────────
t_run env HOME="$FAKE_HOME" bash "$UPDATE_SCRIPT" --target "$TARGET_DIR"
t_assert_status "run-update.sh succeeds on a target that opted out of telemetry" 0
t_assert_not_contains "run-update.sh never claims the target was not onboarded" "was not onboarded by this Power"

# ── Uninstall must succeed on this opted-out target ─────────────────────
t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_DIR" --confirmed
t_assert_status "run-uninstall.sh succeeds on a target that opted out of telemetry" 0
t_assert_not_contains "run-uninstall.sh never claims the target was not onboarded" "was not onboarded by this Power"

rm -rf "$SCRATCH"

t_summary
