#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-all.sh -- runs every test-*.sh in this directory in turn, aggregating
# pass/fail across all of them. Each test file is self-contained (its own
# `set -uo pipefail`, its own scratch dirs, no shared state) and exits 0/1
# on its own, so this runner just calls each one and tracks whether any
# failed -- it does not re-implement assertion logic itself (see
# helpers.sh for that).
#
# Usage: run-all.sh
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FAILED=0
for test_file in "${TEST_DIR}"/test-*.sh; do
  echo "=== $(basename "$test_file") ==="
  if ! bash "$test_file"; then
    FAILED=1
  fi
  echo ""
done

if [[ "$FAILED" -ne 0 ]]; then
  echo "=== FAILED: one or more test files reported a failure above ==="
  exit 1
fi

echo "=== All kiro-power test files passed ==="
