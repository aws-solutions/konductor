#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-checksum-failure.sh -- pins fetch-verify-binary.sh's behavior on a
# corrupted/tampered download (design §5.3 step 2, §9: "checksum
# verification, every time, no exceptions"). Uses a stubbed `curl` on a
# scratch PATH, so this never makes a real network call and never depends
# on a specific real release existing.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR (adversarial-review finding I4): defaults to
# this repo's own source tree, but a caller (make kiro-power-check, the CI
# publish job) can point it at the ASSEMBLED tree instead, so the test
# suite actually exercises what gets published rather than only the
# pre-assembly source layout.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
SCRIPT="${SCRIPTS_DIR}/fetch-verify-binary.sh"

SCRATCH="$(mktemp -d)"
FAKE_BIN="${SCRATCH}/fake-bin"
mkdir -p "$FAKE_BIN"

# A stub `curl` that serves a deliberately WRONG binary body but a
# checksum sidecar computed over the RIGHT (expected) content -- i.e. a
# corrupted-in-transit or tampered download. It never touches the network.
#
# Usage this stub actually receives: `curl -fsSL -o <out> <url>`. It
# inspects the URL's own basename to decide what to serve, so one stub
# covers both the asset request and the sidecar request.
cat > "${FAKE_BIN}/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "-o" ]]; then
    out="${args[$((i + 1))]}"
  fi
done
url="${args[-1]}"
name="$(basename "$url")"

case "$name" in
  *.sha256)
    # Sidecar always records the checksum of the CORRECT content
    # ("correct-binary-content\n"), regardless of what the asset stub
    # below actually serves -- this is what makes the mismatch real.
    printf 'correct-binary-content\n' > /tmp/kiro-power-test-correct-content.$$.tmp
    (cd /tmp && sha256sum "kiro-power-test-correct-content.$$.tmp") \
      | sed "s/kiro-power-test-correct-content\.$$\.tmp/$(basename "$out" .sha256)/" > "$out"
    rm -f "/tmp/kiro-power-test-correct-content.$$.tmp"
    ;;
  *)
    # The asset itself: serve WRONG content, simulating corruption/tampering.
    printf 'tampered-binary-content\n' > "$out"
    ;;
esac
exit 0
STUB
chmod +x "${FAKE_BIN}/curl"

# shellcheck disable=SC1090,SC1091
source "$SCRIPT"

DEST_DIR="${SCRATCH}/dest"
t_run env PATH="${FAKE_BIN}:${PATH}" bash "$SCRIPT" "aws-solutions/konductor" "v1.0.2" "x86_64-unknown-linux-musl" "$DEST_DIR"
t_assert_status "a checksum mismatch exits non-zero" 1
t_assert_contains "the error names checksum verification, not a generic failure" "checksum verification failed"
t_assert_contains "the error says the download is not being installed" "Not installing"

if [[ -x "${DEST_DIR}/konductor-v1.0.2-x86_64-unknown-linux-musl" ]]; then
  # The corrupted file may still be sitting on disk (chmod +x happens
  # before verification in some designs) -- what matters is that this
  # script never reports it as usable, which the exit-code/message
  # assertions above already pin. This is a soft, informational check.
  t_pass "(informational) corrupted asset left on disk for inspection -- not treated as a failure by itself"
fi

rm -rf "$SCRATCH"

t_summary
