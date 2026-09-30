#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# helpers.sh -- tiny, dependency-free assertion harness for
# tests/kiro-power/*.sh. Written as plain shell rather than against
# bats-core: this host's own `bats` on PATH is a different, unrelated
# tool (a "BATS Transform" CLI, not bats-core -- confirmed via `bats
# --help`), so depending on it here would silently test against the wrong
# tool wherever that collision holds. Plain shell has no such ambiguity
# and needs nothing installed beyond what these scripts already require
# (bash, coreutils).
#
# Meant to be sourced by each test-*.sh file:
#   # shellcheck source=helpers.sh
#   source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"
#
# Convention, mirroring bats' own `run`: `t_run <command...>` executes a
# command WITHOUT the harness's own `set -e` aborting on a non-zero exit,
# capturing its stdout+stderr (merged) into `$T_OUTPUT` and its exit code
# into `$T_STATUS` -- exactly the two things every test below asserts on.
set -u

T_TESTS_RUN=0
T_TESTS_FAILED=0
T_OUTPUT=""
T_STATUS=0

# t_run <command...>
# Runs a command, never letting its non-zero exit propagate to the caller
# (so a test file can use `set -e` itself without a deliberately-failing
# stubbed command aborting the whole test run). Captures combined
# stdout+stderr into $T_OUTPUT (a single string; tests that care about
# stdout/stderr separately should redirect one of the two to a file
# instead) and the real exit code into $T_STATUS.
t_run() {
  local status=0
  T_OUTPUT="$("$@" 2>&1)" || status=$?
  T_STATUS=$status
}

# t_pass <description>
t_pass() {
  T_TESTS_RUN=$((T_TESTS_RUN + 1))
  echo "ok - $1"
}

# t_fail <description> <detail...>
t_fail() {
  local desc="$1"
  shift
  T_TESTS_RUN=$((T_TESTS_RUN + 1))
  T_TESTS_FAILED=$((T_TESTS_FAILED + 1))
  echo "not ok - $desc"
  for line in "$@"; do
    echo "    # $line"
  done
}

# t_assert_equal <description> <expected> <actual>
t_assert_equal() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    t_pass "$desc"
  else
    t_fail "$desc" "expected: $expected" "actual:   $actual"
  fi
}

# t_assert_status <description> <expected-exit-code>
# Compares against $T_STATUS, set by the most recent t_run.
t_assert_status() {
  local desc="$1" expected="$2"
  t_assert_equal "$desc" "$expected" "$T_STATUS"
}

# t_assert_contains <description> <needle>
# Checks $T_OUTPUT, set by the most recent t_run.
t_assert_contains() {
  local desc="$1" needle="$2"
  if [[ "$T_OUTPUT" == *"$needle"* ]]; then
    t_pass "$desc"
  else
    t_fail "$desc" "expected output to contain: $needle" "actual output:" "$T_OUTPUT"
  fi
}

# t_assert_not_contains <description> <needle>
t_assert_not_contains() {
  local desc="$1" needle="$2"
  if [[ "$T_OUTPUT" != *"$needle"* ]]; then
    t_pass "$desc"
  else
    t_fail "$desc" "expected output NOT to contain: $needle" "actual output:" "$T_OUTPUT"
  fi
}

# t_summary -- print a one-line summary and exit 1 if anything failed.
# Called once, at the end of each test file's own `main`.
t_summary() {
  echo "# ${T_TESTS_RUN} run, ${T_TESTS_FAILED} failed"
  if [[ "$T_TESTS_FAILED" -gt 0 ]]; then
    exit 1
  fi
  exit 0
}
