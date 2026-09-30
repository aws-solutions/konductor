#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-detect-platform.sh -- pins detect-platform.sh's classification for
# every case the design (konductor-power-design.md §5.3 steps 1-4) names:
# the three supported release triples, the Intel Mac source-fallback case,
# Windows-with-bash, and an explicit stop for anything else.
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
SCRIPT="${SCRIPTS_DIR}/detect-platform.sh"

t_run bash "$SCRIPT" Linux x86_64
t_assert_status "Linux/x86_64 exits 0" 0
t_assert_equal "Linux/x86_64 maps to the musl triple" "SUPPORTED:x86_64-unknown-linux-musl" "$T_OUTPUT"

t_run bash "$SCRIPT" Linux aarch64
t_assert_status "Linux/aarch64 exits 0" 0
t_assert_equal "Linux/aarch64 maps to the musl triple" "SUPPORTED:aarch64-unknown-linux-musl" "$T_OUTPUT"

t_run bash "$SCRIPT" Darwin arm64
t_assert_status "Darwin/arm64 exits 0" 0
t_assert_equal "Darwin/arm64 (Apple Silicon) maps to the darwin triple" "SUPPORTED:aarch64-apple-darwin" "$T_OUTPUT"

t_run bash "$SCRIPT" Darwin x86_64
t_assert_status "Darwin/x86_64 exits 0" 0
t_assert_equal "Darwin/x86_64 (Intel Mac) is the source-fallback case" "SOURCE_FALLBACK:x86_64-apple-darwin" "$T_OUTPUT"

# Windows-with-bash: three real uname -s shapes (Git Bash, MSYS2, Cygwin).
for os in "MINGW64_NT-10.0-19045" "MSYS_NT-10.0-19045" "CYGWIN_NT-10.0"; do
  t_run bash "$SCRIPT" "$os" x86_64
  t_assert_status "${os} exits 0 (informational stop, not a script crash)" 0
  t_assert_equal "${os} is classified as Windows-unsupported" "WINDOWS_UNSUPPORTED" "$T_OUTPUT"
done

# WSL is NOT the Windows case: uname -s reports "Linux" under WSL, so it
# must take the normal Linux path, not the Windows-unsupported one.
t_run bash "$SCRIPT" Linux x86_64
t_assert_equal "WSL (reports as Linux/x86_64) is NOT classified as Windows" "SUPPORTED:x86_64-unknown-linux-musl" "$T_OUTPUT"

# A platform the design names no fallback for at all (e.g. Linux/armv7)
# is a hard, explicit stop -- never silently guessed into either bucket.
t_run bash "$SCRIPT" Linux armv7l
t_assert_status "unrecognized Linux arch exits non-zero" 1
t_assert_contains "unrecognized Linux arch names both uname values in its error" "uname -s=Linux, uname -m=armv7l"

t_run bash "$SCRIPT" FreeBSD amd64
t_assert_status "an entirely unknown OS exits non-zero" 1
t_assert_contains "an entirely unknown OS gets the generic unsupported-platform error" "no prebuilt konductor binary is published"
t_assert_not_contains "an entirely unknown OS is not classified as WINDOWS_UNSUPPORTED" "WINDOWS_UNSUPPORTED"

t_summary
