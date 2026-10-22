#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# detect-platform.sh -- konductor-setup step 1: classify the host into one
# of three buckets, printed as a single line to stdout:
#
#   SUPPORTED:<triple>       prebuilt binary exists -- download+verify (step 2).
#   SOURCE_FALLBACK:<triple> Intel Mac: no prebuilt binary -- build from source
#                            (step 3).
#   WINDOWS_UNSUPPORTED      native-Windows bash (Git Bash/MSYS2/Cygwin). WSL
#                            reports "Linux" via `uname -s` and is NOT this case.
#
# Anything else is a hard stop -- no fourth fallback for an unrecognized platform.
#
# Mirrors scripts/konductor-install.sh's own `map_target_triple` table for
# the SUPPORTED case, so this script and `konductor install`'s own triple
# detection always agree on a given host.
#
# Usage:
#   detect-platform.sh                 # uses the real `uname -s`/`uname -m`
#   detect-platform.sh <os> <arch>     # override, for testing
#
# Exits 0 for every classification above, including Windows/unknown-platform
# (the caller decides what to do); exits 1 only for a genuine error.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# detect_platform <os> <arch>
# Pure function (stdout only) so tests can call it directly with fixture
# values instead of stubbing `uname`.
detect_platform() {
  local os="$1" arch="$2"

  # uname -m varies on Windows-with-bash, so uname -s decides first.
  case "$os" in
    MINGW* | MSYS* | CYGWIN*)
      echo "WINDOWS_UNSUPPORTED"
      return 0
      ;;
  esac

  case "${os}/${arch}" in
    Linux/x86_64)
      echo "SUPPORTED:x86_64-unknown-linux-musl"
      ;;
    Linux/aarch64)
      echo "SUPPORTED:aarch64-unknown-linux-musl"
      ;;
    Darwin/arm64)
      echo "SUPPORTED:aarch64-apple-darwin"
      ;;
    Darwin/x86_64)
      # No free-tier Intel macOS GitHub runner to publish a binary for.
      echo "SOURCE_FALLBACK:x86_64-apple-darwin"
      ;;
    *)
      konductor_die "no prebuilt konductor binary is published for this platform (uname -s=${os}, uname -m=${arch}), and it is not one of this Power's known fallback cases (Intel Mac, Windows). Supported: Linux x86_64, Linux aarch64, macOS (Apple Silicon or Intel), and Windows via WSL."
      return 1
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  HOST_OS="${1:-$(uname -s)}"
  HOST_ARCH="${2:-$(uname -m)}"
  detect_platform "$HOST_OS" "$HOST_ARCH"
fi
