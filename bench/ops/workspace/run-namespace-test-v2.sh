#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# DEBT D-165, second try: runs scripts/run-namespace-test.sh with a python that has pytest. The host python3 is a mise
# shim to Python 3.9 with no pytest, so the case's fake project tests read "unparsed" and failed (2026-11-22 log).
# This makes (once) a venv with pytest at NS_VENV, puts it first on PATH, and sets BENCH_REQUIRE_PYTEST=1 so a missing
# pytest fails loudly instead of skipping. Free, no model call, no heavy lock. Run it from the owner's terminal.
set -euo pipefail
SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
NS_VENV=${NS_VENV:-$HOME/.cache/konductor-ns/venv}

if ! "$NS_VENV/bin/python" -m pytest --version >/dev/null 2>&1; then
  echo "making a venv with pytest at $NS_VENV"
  /usr/bin/python3 -m venv "$NS_VENV"
  "$NS_VENV/bin/pip" install -q pytest
fi
exec env PATH="$NS_VENV/bin:$PATH" BENCH_REQUIRE_PYTEST=1 bash "$SELF/run-namespace-test.sh" "$@"
