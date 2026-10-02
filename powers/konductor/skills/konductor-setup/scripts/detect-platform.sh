#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# detect-platform.sh -- konductor-setup step 1: detect OS + architecture and
# classify the host into one of three buckets:
#
#   SUPPORTED:<triple>       one of the three published release triples
#                            (aarch64-apple-darwin, aarch64-unknown-linux-musl,
#                            x86_64-unknown-linux-musl) -- go download+verify
#                            a binary (step 2).
#   SOURCE_FALLBACK:<triple> Intel Mac (x86_64-apple-darwin): no binary is
#                            published -- go build from source instead
#                            (step 3).
#   WINDOWS_UNSUPPORTED      running under a native-Windows bash (Git Bash /
#                            MSYS2 / Cygwin, detected via `uname -s`'s own
#                            MINGW*/MSYS*/CYGWIN* prefix) -- out of scope for
#                            v1 (step 4). WSL is NOT this case: under WSL,
#                            `uname -s` reports "Linux" and the normal Linux
#                            detection below applies exactly as it would on a
#                            native Linux host.
#
# Anything else (e.g. Linux on an architecture other than x86_64/aarch64, or
# an OS this script cannot identify at all) is a hard, explicit stop -- this
# script recognizes exactly the three buckets above and nothing else, and
# does not invent a fourth fallback for a platform it cannot classify.
#
# Mirrors scripts/konductor-install.sh's own `map_target_triple` table
# byte-for-byte for the SUPPORTED case, so this script and `konductor
# install`'s own no-`--from` triple detection always agree on a given host.
#
# Usage:
#   detect-platform.sh                 # uses the real `uname -s`/`uname -m`
#   detect-platform.sh <os> <arch>     # override, for testing
#
# Prints exactly one classification line to stdout (see above) and exits 0
# on every recognized case, INCLUDING Windows and the generic unknown-
# platform case -- those are reported as data for the caller to act on
# (e.g. print a message and stop), not treated as a script failure. Exits 1
# with a message on stderr for a genuinely unrecoverable error (out of
# scope here; this script currently has none).
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# detect_platform <os> <arch>
# Pure classification function -- no I/O beyond stdout -- so tests can
# source this file and call it directly with fixture values instead of
# stubbing `uname`.
detect_platform() {
  local os="$1" arch="$2"

  # Windows-with-bash first: `uname -m` on these environments varies
  # (x86_64 on Git Bash, sometimes reporting the MSYSTEM arch), so the
  # decisive signal is `uname -s`'s OS string, not the arch.
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
      # Intel Mac: no free-tier Intel macOS GitHub runner, so no binary is
      # published for this triple -- source-build fallback.
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
