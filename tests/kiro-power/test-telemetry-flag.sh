#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-telemetry-flag.sh -- pins run-onboarding.sh's --no-telemetry opt-out:
# telemetry is enabled by default (no flag forwarded at all); --no-telemetry
# is forwarded
# verbatim to `konductor install`'s own --no-telemetry flag (confirmed
# against cli.rs's Commands::Install variant) only when explicitly passed.
# Uses a stubbed curl+konductor on a scratch PATH/HOME; no real network
# call, no real ~/.local or ~/.konductor touched.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR: see
# test-fail-stop.sh's identical header comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
ORCHESTRATOR="${SCRIPTS_DIR}/run-onboarding.sh"

SCRATCH="$(mktemp -d)"
FAKE_BIN="${SCRATCH}/fake-bin"
FAKE_HOME="${SCRATCH}/fake-home"
TARGET_DIR="${SCRATCH}/project"
ARGV_LOG="${SCRATCH}/install-argv.log"
mkdir -p "$FAKE_BIN" "$FAKE_HOME" "$TARGET_DIR"

# Read before the stub below is created, since the stub's own `--version`
# branch interpolates this value directly into the heredoc.
REPO_ROOT_VERSION="$(tr -d '[:space:]' < "${TEST_DIR}/../../VERSION")"
DEFAULT_TAG="v${REPO_ROOT_VERSION}"

# A fake `konductor` whose `install` subcommand records its FULL argv
# (one arg per line) to $ARGV_LOG, then succeeds -- this test reads that
# log back to check whether --no-telemetry was (or was not) forwarded,
# rather than asserting on any narration text. Also handles `--version`
# (run-onboarding.sh's own final step calls it directly, on the real
# downloaded binary path, to record this run's own CLI binary+version in
# power-cli.json) and `doctor`, since a full successful onboarding run
# reaches all three.
cat > "${FAKE_BIN}/fake-konductor-body.sh" <<STUB
#!/usr/bin/env bash
case "\$1" in
  install)
    printf '%s\n' "\$@" > "${ARGV_LOG}"
    exit 0
    ;;
  doctor)
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

# ── Test 1: telemetry is ON by default -- no --no-telemetry flag at all
# when the flag is omitted (an intentional default-on choice).
rm -f "$ARGV_LOG"
t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "$DEFAULT_TAG" --confirmed
t_assert_status "onboarding without --no-telemetry succeeds" 0
if [[ -f "$ARGV_LOG" ]] && grep -qx -- "--no-telemetry" "$ARGV_LOG"; then
  t_fail "telemetry must be ON by default -- --no-telemetry must never be forwarded unless explicitly requested" "install argv: $(cat "$ARGV_LOG")"
else
  t_pass "telemetry is ON by default: --no-telemetry was not forwarded to konductor install"
fi

# ── Test 2: --no-telemetry on run-onboarding.sh IS forwarded verbatim to
# `konductor install --no-telemetry`.
rm -f "$ARGV_LOG"
t_run env HOME="$FAKE_HOME" PATH="${FAKE_BIN}:${PATH}" \
  bash "$ORCHESTRATOR" --target "$TARGET_DIR" --tag "$DEFAULT_TAG" --confirmed --no-telemetry
t_assert_status "onboarding with --no-telemetry succeeds" 0
if [[ -f "$ARGV_LOG" ]] && grep -qx -- "--no-telemetry" "$ARGV_LOG"; then
  t_pass "--no-telemetry was forwarded verbatim to konductor install"
else
  t_fail "--no-telemetry must be forwarded to konductor install's own flag" "install argv: $(cat "$ARGV_LOG" 2>/dev/null || echo '<no argv log written>')"
fi

rm -rf "$SCRATCH"

t_summary
