#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-resolve-version.sh -- pins resolve-version.sh's tag construction
# (design §5.3 step 2: "Tag construction is not optional and must match the
# CLI's own scheme exactly" -- "v${plugin_version}", never a bare version).
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR (adversarial-review finding I4): defaults to
# this repo's own source tree, but a caller (make kiro-power-check, the CI
# publish job) can point it at the ASSEMBLED tree instead, so the test
# suite actually exercises what gets published rather than only the
# pre-assembly source layout. See tests/kiro-power/README (or run-all.sh's
# own header) for the full rationale shared across every test-*.sh file.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
SCRIPT="${SCRIPTS_DIR}/resolve-version.sh"

# ── construct_tag: pure string function, sourced directly ────────────────
# shellcheck disable=SC1090,SC1091
source "$SCRIPT"

t_run construct_tag "1.0.2"
t_assert_status "construct_tag exits 0 for a normal version" 0
t_assert_equal "construct_tag prepends 'v', never leaves it bare" "v1.0.2" "$T_OUTPUT"

t_run construct_tag "2.0.0"
t_assert_equal "construct_tag works for any bare semver, not just 1.0.2" "v2.0.0" "$T_OUTPUT"

t_run construct_tag ""
t_assert_status "construct_tag refuses an empty version" 1
if [[ "$T_OUTPUT" == "v" ]]; then
  t_fail "construct_tag with empty input must not silently produce a bare 'v'" "got: $T_OUTPUT"
else
  t_pass "construct_tag with empty input does not silently produce a bare 'v'"
fi

# "1.0.2" and "v1.0.2" are two different strings -- assert the un-prefixed
# form is never what gets used as the tag, for the one real, checked-in
# plugin.json this Power ships.
t_run construct_tag "1.0.2"
t_assert_not_contains "the constructed tag is never the bare version string" "not-a-real-check"
if [[ "$T_OUTPUT" == "1.0.2" ]]; then
  t_fail "construct_tag must never return the bare version unprefixed" "got: $T_OUTPUT"
else
  t_pass "construct_tag never returns the bare version unprefixed"
fi

# ── resolve_plugin_version: walks up to this Power's own plugin.json ─────
# Deliberately NOT a hardcoded "v1.0.2" (adversarial-review finding I5):
# reads the repo-root VERSION file at test-run time and derives the
# expected tag from it, so this assertion stays correct across a future
# version bump with no edit to this test file needed. This is also a
# second, independent check against plugin.json/VERSION drift, alongside
# scripts/check-plugin-json-version-drift.sh's own dedicated check: if a
# bump ever updates VERSION without updating the checked-in
# powers/konductor/plugin.json (or the assembled tree's freshly-rendered
# one, when SCRIPTS_DIR points there), THIS assertion compares
# resolve-version.sh's real output against VERSION's own value and fails
# if they disagree.
REPO_ROOT_VERSION="$(tr -d '[:space:]' < "${TEST_DIR}/../../VERSION")"
EXPECTED_TAG="v${REPO_ROOT_VERSION}"

t_run bash "$SCRIPT"
t_assert_status "resolve-version.sh (no override) exits 0 against the real plugin.json" 0
t_assert_equal "resolve-version.sh reads plugin.json's real version (matching the repo-root VERSION file) and tags it" "$EXPECTED_TAG" "$T_OUTPUT"

t_run env KONDUCTOR_POWER_VERSION=9.9.9 bash "$SCRIPT"
t_assert_status "KONDUCTOR_POWER_VERSION override exits 0" 0
t_assert_equal "KONDUCTOR_POWER_VERSION overrides plugin.json entirely" "v9.9.9" "$T_OUTPUT"

# resolve_plugin_version must fail closed, not silently invent a version,
# when run from a directory with no plugin.json anywhere above it.
SCRATCH_NO_PLUGIN="$(mktemp -d)"
mkdir -p "${SCRATCH_NO_PLUGIN}/a/b/c/scripts"
cp "$SCRIPT" "${SCRATCH_NO_PLUGIN}/a/b/c/scripts/resolve-version.sh"
cp "${SCRIPTS_DIR}/lib.sh" "${SCRATCH_NO_PLUGIN}/a/b/c/scripts/lib.sh"
t_run bash "${SCRATCH_NO_PLUGIN}/a/b/c/scripts/resolve-version.sh"
t_assert_status "resolve-version.sh fails closed with no plugin.json anywhere above it" 1
t_assert_contains "the failure names what to do instead (KONDUCTOR_POWER_VERSION override)" "KONDUCTOR_POWER_VERSION"
rm -rf "$SCRATCH_NO_PLUGIN"

t_summary
