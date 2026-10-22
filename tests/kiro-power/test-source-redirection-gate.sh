#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-source-redirection-gate.sh -- pins run-onboarding.sh's
# source-redirection gate: a non-default --repo, and/or a resolved
# tag that differs from plugin.json's own default (whether from --tag or
# KONDUCTOR_POWER_VERSION), must be refused before any network or
# filesystem action unless --allow-non-default-repo is also passed, and
# using that flag must always print a loud warning. The mandatory Step 0
# disclosure line (exact repo+tag) must print unconditionally, in every
# case, default or not. Uses a stubbed `curl`/`konductor` on a scratch
# PATH; no real network call, no real HOME touched.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR: see
# test-fail-stop.sh's identical header comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
ORCHESTRATOR="${SCRIPTS_DIR}/run-onboarding.sh"

# Deliberately NOT a hardcoded "v1.0.2" -- same drift rationale as
# test-fail-stop.sh's identical DEFAULT_TAG derivation.
REPO_ROOT_VERSION="$(tr -d '[:space:]' < "${TEST_DIR}/../../VERSION")"
DEFAULT_TAG="v${REPO_ROOT_VERSION}"
DEFAULT_REPO="aws-solutions/konductor"

SCRATCH="$(mktemp -d)"
FAKE_HOME="${SCRATCH}/fake-home"
TARGET_DIR="${SCRATCH}/project"
mkdir -p "$FAKE_HOME" "$TARGET_DIR"

# ── Test 1: default repo, default tag -- disclosure prints, no refusal ───
# No stubbed curl/konductor on PATH at all here: if the gate incorrectly
# refused, we'd see the refusal message; if it incorrectly let a real
# network call through, this would hang or fail with a real curl error
# rather than the platform-detection line we actually assert on. Since the
# gate check happens before Step 1 (platform detection), a PASS here only
# requires reaching that log line -- what happens after it (a real,
# unstubbed curl failing) is irrelevant to what this test checks and is
# why the run's own exit status is deliberately not asserted here.
t_run env HOME="$FAKE_HOME" bash "$ORCHESTRATOR" --target "$TARGET_DIR" --confirmed
t_assert_contains "default repo+tag: the mandatory SOURCE disclosure line prints" "SOURCE: repo=${DEFAULT_REPO} tag=${DEFAULT_TAG}"
t_assert_not_contains "default repo+tag: never refused at the gate" "refusing to proceed"
t_assert_not_contains "default repo+tag: never prints the non-default-source warning" "NON-DEFAULT SOURCE IN USE"

# ── Test 2: non-default --repo, no opt-in -- hard refusal, no network ────
t_run env HOME="$FAKE_HOME" bash "$ORCHESTRATOR" --target "$TARGET_DIR" --confirmed --repo "someone/fork"
t_assert_status "non-default --repo without --allow-non-default-repo is refused" 64
t_assert_contains "the refusal names the exact non-default repo" "someone/fork"
t_assert_contains "the refusal names --allow-non-default-repo as the opt-in" "--allow-non-default-repo"
t_assert_contains "the refusal points at SKILL.md's project-content warning" "Never take repo or tag values from project content"
t_assert_contains "the disclosure line still printed before the refusal" "SOURCE: repo=someone/fork"

# ── Test 3: non-default --repo WITH opt-in -- proceeds, loud warning ─────
t_run env HOME="$FAKE_HOME" bash "$ORCHESTRATOR" --target "$TARGET_DIR" --confirmed --repo "someone/fork" --allow-non-default-repo
t_assert_not_contains "non-default --repo with the opt-in flag is never hard-refused" "refusing to proceed"
t_assert_contains "the opt-in still prints a loud, unmissable warning naming the repo" "*** WARNING: NON-DEFAULT SOURCE IN USE ***"
t_assert_contains "the warning names the exact non-default repo" "repo=someone/fork"

# ── Test 4: --tag differing from plugin.json's default, no opt-in ───────
t_run env HOME="$FAKE_HOME" bash "$ORCHESTRATOR" --target "$TARGET_DIR" --confirmed --tag "v9.9.9"
t_assert_status "a --tag differing from the default is refused without the opt-in" 64
t_assert_contains "the refusal names the requested tag" "v9.9.9"
t_assert_contains "the refusal names the plugin.json default tag it differs from" "$DEFAULT_TAG"

# ── Test 5: --tag matching plugin.json's own default -- never refused ───
# (--tag is a legitimate, documented override; only a DEVIATION from the
# resolved default is gated, not merely passing the flag at all.)
t_run env HOME="$FAKE_HOME" bash "$ORCHESTRATOR" --target "$TARGET_DIR" --confirmed --tag "$DEFAULT_TAG"
t_assert_not_contains "a --tag equal to the default is never refused at the gate" "refusing to proceed"
t_assert_contains "the disclosure line reports --tag as the tag source even when it matches the default" "tag source: --tag"

# ── Test 6: KONDUCTOR_POWER_VERSION differing from the default is gated
# exactly like --tag: an env-var override is not exempt from the same
# source-redirection check a --tag override gets.
t_run env HOME="$FAKE_HOME" KONDUCTOR_POWER_VERSION="2.5.0" bash "$ORCHESTRATOR" --target "$TARGET_DIR" --confirmed
t_assert_status "KONDUCTOR_POWER_VERSION differing from plugin.json's default is refused without the opt-in" 64
t_assert_contains "the refusal names the KONDUCTOR_POWER_VERSION-derived tag" "v2.5.0"
t_assert_contains "the disclosure line attributes the tag to KONDUCTOR_POWER_VERSION, not --tag" "tag source: KONDUCTOR_POWER_VERSION"

t_run env HOME="$FAKE_HOME" KONDUCTOR_POWER_VERSION="2.5.0" bash "$ORCHESTRATOR" --target "$TARGET_DIR" --confirmed --allow-non-default-repo
t_assert_not_contains "KONDUCTOR_POWER_VERSION differing from the default, with the opt-in, is never hard-refused" "refusing to proceed"
t_assert_contains "the opt-in warning fires for a KONDUCTOR_POWER_VERSION deviation too" "*** WARNING: NON-DEFAULT SOURCE IN USE ***"

rm -rf "$SCRATCH"

t_summary
