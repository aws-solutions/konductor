#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-write-power-cli-record-symlink.sh -- pins
# konductor_write_power_cli_record against a symlink planted at its own
# temp-file path. The old implementation built that path as
# "${power_cli_json}.tmp.$$" -- predictable from the target directory and
# the calling process's PID alone -- then wrote jq's output straight
# through it with a bare `>`. A symlink dropped at that exact path ahead
# of time turns the write into a write-through-symlink into whatever the
# attacker pointed it at, before the final `mv -f` ever runs.
#
# This test is run IN-PROCESS (sourcing lib.sh and calling the function
# directly, never through a nested `bash -c`/`env ... bash script`
# invocation) specifically so `$$` inside the function is the SAME value
# as this test script's own `$$`: bash preserves `$$` across the
# command-substitution subshell `t_run` uses (confirmed: `$$` names the
# top-level shell's PID even inside `$(...)`, unlike `$BASHPID`), so the
# symlink planted below sits at exactly the path the old vulnerable code
# would have picked.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"

# shellcheck disable=SC1090,SC1091
source "${SCRIPTS_DIR}/lib.sh"

SCRATCH="$(mktemp -d)"
TARGET_DIR="${SCRATCH}/project"
POWER_CLI_DIR="${TARGET_DIR}/.konductor"
POWER_CLI_JSON="${POWER_CLI_DIR}/power-cli.json"
DO_NOT_TOUCH="${SCRATCH}/do-not-touch"
OLD_PREDICTABLE_TMP="${POWER_CLI_JSON}.tmp.$$"

mkdir -p "$POWER_CLI_DIR"
printf 'pre-existing, unrelated content\n' > "$DO_NOT_TOUCH"
ln -s "$DO_NOT_TOUCH" "$OLD_PREDICTABLE_TMP"

t_run konductor_write_power_cli_record "$TARGET_DIR" "1.2.3" "/some/binary"
t_assert_status "writes the record successfully even with a symlink planted at the old predictable temp path" 0

if [[ "$(cat "$DO_NOT_TOUCH")" == "pre-existing, unrelated content" ]]; then
  t_pass "the symlink's target file is left untouched"
else
  t_fail "the symlink's target file must never be written through" "contents: $(cat "$DO_NOT_TOUCH" 2>&1)"
fi

if [[ -L "$OLD_PREDICTABLE_TMP" ]]; then
  t_pass "the planted symlink at the old predictable path is itself left in place, unharmed"
else
  t_fail "the planted symlink at the old predictable path should never be touched" "no longer a symlink at: $OLD_PREDICTABLE_TMP"
fi

if [[ -f "$POWER_CLI_JSON" && ! -L "$POWER_CLI_JSON" ]]; then
  t_pass "power-cli.json itself is a regular file, not a symlink"
else
  t_fail "power-cli.json must be a regular file after a successful write" "type: $(stat -c '%F' "$POWER_CLI_JSON" 2>&1 || stat -f '%HT' "$POWER_CLI_JSON" 2>&1)"
fi

RECORDED_VERSION="$(jq -r '.cli_version // empty' "$POWER_CLI_JSON" 2>/dev/null || true)"
t_assert_equal "power-cli.json records the expected cli_version" "1.2.3" "$RECORDED_VERSION"

rm -rf "$SCRATCH"

t_summary
