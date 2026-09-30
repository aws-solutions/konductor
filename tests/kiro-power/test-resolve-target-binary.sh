#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-resolve-target-binary.sh -- pins lib.sh's konductor_resolve_target_
# binary and konductor_write_power_cli_record (adversarial-review finding
# C2, then its own regression fix): update/uninstall must verify the
# binary they are about to run actually matches THIS target's own
# recorded CLI binary, rather than trusting the shared
# ~/.local/bin/konductor symlink -- which may have been re-pointed by a
# DIFFERENT project's onboarding/update run since this target was last
# touched.
#
# REGRESSION THIS FILE NOW PINS: an earlier version of this resolver
# compared power-cli.json's would-be cli_version against install-info.
# json's own `agent_version` field -- but `agent_version` is the
# installed CONTENT's own version (confirmed directly against
# install_info.rs's own header comment), completely independent of which
# CLI binary ran the command; `update --version <v>` (cli.rs's
# `release_version` field) changes ONLY that content version, on
# whichever CLI binary happens to be resolved. Comparing the two
# conflated two unrelated axes and locked every LATER update/uninstall
# out entirely the moment a single legitimate `--version` content bump
# ran on a perfectly good CLI binary. The fix tracks the CLI-binary axis
# in its own file, <target>/.konductor/power-cli.json, entirely separate
# from install-info.json, and this file's own Scenario G is the direct
# reproduction of that regression and its fix.
#
# Stubs multiple distinct konductor binary versions under a scratch HOME
# (never the real one) and exercises every branch of the resolution
# order documented on konductor_resolve_target_binary itself, plus the
# power-cli.json trust boundary and cli_version validation.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR (adversarial-review finding I4): see
# test-fail-stop.sh's identical header comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"

SCRATCH="$(mktemp -d)"
FAKE_HOME="${SCRATCH}/fake-home"
mkdir -p "${FAKE_HOME}/.local/bin" "${FAKE_HOME}/.konductor/cli-releases"

# make_stub_konductor <path> <version> [extra-subcommand-body]
# A fake `konductor` binary: `--version` always prints "konductor
# <version>" (matching the CLI's own real output format); `update`/
# `uninstall` succeed (exit 0) by default so the update/uninstall
# reproduction scenarios below can run the real wrapper scripts end to
# end without a real network call or real content changes.
make_stub_konductor() {
  local path="$1" version="$2"
  cat > "$path" <<STUB
#!/usr/bin/env bash
case "\$1" in
  --version)
    echo "konductor ${version}"
    exit 0
    ;;
  update|uninstall)
    exit 0
    ;;
  *)
    echo "stub-konductor: unexpected argument: \$1" >&2
    exit 1
    ;;
esac
STUB
  chmod +x "$path"
}

# make_target <dir> [content-version]
# Writes a minimal <dir>/.konductor/install-info.json -- konductor_resolve_
# target_binary now only checks this file's EXISTENCE (proof the target
# was onboarded by this Power at all); its own agent_version content is
# deliberately given an UNRELATED value here (default "9.9.9-content-only",
# never matching any stub binary's own --version) to prove the resolver
# never reads it for binary matching.
make_target() {
  local dir="$1" content_version="${2:-9.9.9-content-only}"
  mkdir -p "${dir}/.konductor"
  cat > "${dir}/.konductor/install-info.json" <<JSON
{"schema_version": 1, "agent_version": "${content_version}", "harness": "kiro-v3", "installed_at": "2026-01-01T00:00:00Z"}
JSON
}

# make_power_cli_json <dir> <cli-version> <binary-path>
make_power_cli_json() {
  local dir="$1" cli_version="$2" binary_path="$3"
  mkdir -p "${dir}/.konductor"
  cat > "${dir}/.konductor/power-cli.json" <<JSON
{"cli_version": "${cli_version}", "binary": "${binary_path}"}
JSON
}

# Two distinct versions, stubbed under the CACHE dir with the exact naming
# convention fetch-verify-binary.sh/build-from-source.sh actually use
# (konductor-v<version>-<triple-or-source-build>) -- proving the glob in
# konductor_resolve_target_binary matches real cache-file names, not an
# invented shape.
BIN_1_0_2="${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-x86_64-unknown-linux-musl"
BIN_2_0_0="${FAKE_HOME}/.konductor/cli-releases/konductor-v2.0.0-source-build"
make_stub_konductor "$BIN_1_0_2" "1.0.2"
make_stub_konductor "$BIN_2_0_0" "2.0.0"

# shellcheck disable=SC1090,SC1091
source "${SCRIPTS_DIR}/lib.sh"

# ── Scenario A: power-cli.json's own recorded binary directly matches --
# used immediately, regardless of what the shared bin currently is OR
# what install-info.json's own (unrelated) content version says.
TARGET_A="${SCRATCH}/project-a"
make_target "$TARGET_A" "5.0.0-totally-different-content-version"
make_power_cli_json "$TARGET_A" "1.0.2" "$BIN_1_0_2"
cp "$BIN_2_0_0" "${FAKE_HOME}/.local/bin/konductor"  # shared bin mismatched on purpose
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_A' && echo \"RESULT=\$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT VERSION=\$KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT\""
t_assert_status "power-cli.json's own recorded binary resolves directly" 0
t_assert_contains "resolves to exactly the recorded binary" "RESULT=${BIN_1_0_2}"
t_assert_contains "resolves to the recorded binary's own real version" "VERSION=1.0.2"

# ── Scenario B: power-cli.json's recorded binary path no longer exists --
# falls through to this target's own cached binary matching the same
# cli_version.
TARGET_B="${SCRATCH}/project-b"
make_target "$TARGET_B"
make_power_cli_json "$TARGET_B" "1.0.2" "${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-deleted-triple"
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_B' && echo \"RESULT=\$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT\""
t_assert_status "a missing recorded binary falls through to the cache" 0
t_assert_contains "falls through to this target's own cached 1.0.2 binary" "RESULT=${BIN_1_0_2}"

# ── Scenario C: power-cli.json's recorded binary is missing AND no cached
# binary exists for that version (cli_version 3.0.0 -- deliberately a
# version with no konductor-v3.0.0-* entry anywhere in the cache dir, so
# the cache-search branch genuinely finds nothing rather than
# incidentally matching a leftover from another scenario) -- falls
# through to the shared bin. The shared bin is a REAL symlink into
# cli-releases (matching link-binary.sh's own real convention -- see the
# hardening trust-boundary check this scenario also exercises), pointing
# at a file deliberately named WITHOUT the "konductor-v3.0.0-" prefix, so
# the cache-glob step genuinely finds nothing and this scenario proves
# the shared-bin fallback specifically, not an accidental cache hit.
TARGET_C="${SCRATCH}/project-c"
make_target "$TARGET_C"
make_power_cli_json "$TARGET_C" "3.0.0" "${FAKE_HOME}/.konductor/cli-releases/konductor-v3.0.0-deleted-triple"
BIN_3_0_0="${FAKE_HOME}/.konductor/cli-releases/shared-bin-target-not-matching-the-cache-glob"
make_stub_konductor "$BIN_3_0_0" "3.0.0"
ln -sf "$BIN_3_0_0" "${FAKE_HOME}/.local/bin/konductor"
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_C' && echo \"RESULT=\$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT\""
t_assert_status "missing recorded binary + no cache match falls through to the shared bin" 0
t_assert_contains "resolves to the shared bin's own RESOLVED target once it matches cli_version" "RESULT=${BIN_3_0_0}"

# ── Scenario D: LEGACY target with no power-cli.json at all -- trusts the
# shared binary outright (no version to compare against yet), logs a
# clear notice, and a SECOND resolve call after the caller writes a fresh
# record (simulating what run-update.sh does after a real success) takes
# the direct-record path instead. The shared bin is a REAL symlink into
# cli-releases, matching link-binary.sh's own real convention.
TARGET_D="${SCRATCH}/project-d"
make_target "$TARGET_D"
ln -sf "$BIN_1_0_2" "${FAKE_HOME}/.local/bin/konductor"
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_D' && echo \"RESULT=\$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT VERSION=\$KONDUCTOR_RESOLVE_TARGET_BINARY_VERSION_RESULT\""
t_assert_status "a legacy target (no power-cli.json) resolves via the shared bin" 0
t_assert_contains "legacy target uses the shared bin's own RESOLVED target" "RESULT=${BIN_1_0_2}"
t_assert_contains "legacy target prints a clear notice naming the fallback" "No power-cli.json found for ${TARGET_D}"
if [[ -f "${TARGET_D}/.konductor/power-cli.json" ]]; then
  t_fail "konductor_resolve_target_binary must never itself write power-cli.json -- only the caller does, after a real success" "found: ${TARGET_D}/.konductor/power-cli.json"
else
  t_pass "resolving a legacy target does not itself write power-cli.json"
fi
# Simulate what run-update.sh/run-onboarding.sh do after a real success:
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_write_power_cli_record '$TARGET_D' '1.0.2' '$BIN_1_0_2'"
t_assert_status "writing a fresh power-cli.json record succeeds" 0
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_D' && echo \"RESULT=\$KONDUCTOR_RESOLVE_TARGET_BINARY_RESULT\""
t_assert_not_contains "the now-legacy-healed target no longer logs the legacy notice" "No power-cli.json found"
t_assert_contains "the now-healed target resolves via its own fresh record" "RESULT=${BIN_1_0_2}"

# ── Scenario E: a CRAFTED power-cli.json naming a binary OUTSIDE both
# trusted locations (~/.konductor/cli-releases and the literal shared
# ~/.local/bin/konductor) must be REFUSED even though the file at that
# path exists, is executable, and reports the exact right version -- a
# marker file proves it was never actually invoked. cli_version 9.9.9 is
# used deliberately: it has no real cached binary anywhere in the shared
# cache dir this whole test file uses, and the shared bin is removed too,
# so a fail-closed result here can ONLY mean the untrusted path was
# genuinely never trusted -- not that some other, unrelated fallback
# happened to also fail.
TARGET_E="${SCRATCH}/project-e"
make_target "$TARGET_E"
OUTSIDE_MARKER="${SCRATCH}/outside-binary-was-invoked.marker"
OUTSIDE_BIN="${SCRATCH}/outside-binary-not-in-a-trusted-location"
cat > "$OUTSIDE_BIN" <<STUB
#!/usr/bin/env bash
touch "${OUTSIDE_MARKER}"
if [[ "\$1" == "--version" ]]; then
  echo "konductor 9.9.9"
  exit 0
fi
exit 1
STUB
chmod +x "$OUTSIDE_BIN"
make_power_cli_json "$TARGET_E" "9.9.9" "$OUTSIDE_BIN"
rm -f "${FAKE_HOME}/.local/bin/konductor"  # no shared-bin fallback available either
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_E'"
t_assert_status "a recorded binary outside both trusted locations is refused, not used" 1
t_assert_contains "the refusal names it as not resolving to a trusted direct-child regular file" "does not resolve to a trusted direct-child regular file"
if [[ -f "$OUTSIDE_MARKER" ]]; then
  t_fail "the untrusted recorded binary must NEVER actually be executed" "found marker at: $OUTSIDE_MARKER"
else
  t_pass "the untrusted recorded binary was never executed"
fi

# ── Scenario E2: a recorded binary path claiming to be under cli-releases
# but actually escaping into a SUBDIRECTORY of it (violating the flat-
# directory invariant) must be refused the same way -- not just anything
# literally outside the releases_dir prefix string. Same cli_version
# 9.9.9 (no real match anywhere) as Scenario E, for the same "a fail-
# closed result can only mean this specific refusal" reasoning.
TARGET_E2="${SCRATCH}/project-e2"
make_target "$TARGET_E2"
mkdir -p "${FAKE_HOME}/.konductor/cli-releases/nested"
NESTED_BIN="${FAKE_HOME}/.konductor/cli-releases/nested/konductor-v9.9.9-escaped"
make_stub_konductor "$NESTED_BIN" "9.9.9"
make_power_cli_json "$TARGET_E2" "9.9.9" "$NESTED_BIN"
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_E2'"
t_assert_status "a recorded binary nested under cli-releases (not a direct child) is refused" 1
t_assert_contains "the refusal names it as not resolving to a trusted direct-child regular file" "does not resolve to a trusted direct-child regular file"

# ── Scenario E3/E4: a SYMLINK dropped directly inside ~/.konductor/
# cli-releases, whose own NAME looks like a perfectly ordinary direct
# child (or even matches the cache-glob's own naming convention for a
# specific version), but whose target actually escapes outside
# cli-releases entirely -- must be refused in BOTH the places this
# resolver ever trusts a candidate: the direct power-cli.json record
# (E3) AND the cache-glob search (E4). A path-STRING check alone (does
# this literal path start with releases_dir) cannot catch this -- the
# symlink's own path genuinely IS a direct child of releases_dir by
# string; only resolving it and checking where it actually POINTS does.
ESCAPE_MARKER="${SCRATCH}/escape-script-was-invoked.marker"
ESCAPE_SCRIPT="${SCRATCH}/escape-script-lives-outside-cli-releases"
cat > "$ESCAPE_SCRIPT" <<STUB
#!/usr/bin/env bash
touch "${ESCAPE_MARKER}"
if [[ "\$1" == "--version" ]]; then
  echo "konductor 9.9.7"
  exit 0
fi
exit 1
STUB
chmod +x "$ESCAPE_SCRIPT"
ESCAPE_SYMLINK="${FAKE_HOME}/.konductor/cli-releases/konductor-v9.9.7-escape-symlink"
ln -sf "$ESCAPE_SCRIPT" "$ESCAPE_SYMLINK"

# E3: power-cli.json's OWN recorded binary is the escape symlink's path
# directly -- a direct child of releases_dir by path string, but its
# resolved target is outside it.
TARGET_E3="${SCRATCH}/project-e3"
make_target "$TARGET_E3"
make_power_cli_json "$TARGET_E3" "9.9.7" "$ESCAPE_SYMLINK"
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_E3'"
t_assert_status "a recorded binary that is a cli-releases symlink escaping outside it is refused (direct record)" 1
t_assert_contains "the refusal names it as not resolving to a trusted direct-child regular file (direct record)" "does not resolve to a trusted direct-child regular file"
if [[ -f "$ESCAPE_MARKER" ]]; then
  t_fail "the escape symlink's target must NEVER actually be executed via the direct power-cli.json record" "found marker at: $ESCAPE_MARKER"
else
  t_pass "the escape symlink's target was never executed via the direct power-cli.json record"
fi

# E4: power-cli.json's own recorded binary is missing entirely (so step 1
# falls through), but cli_version 9.9.7 matches the escape symlink's own
# naming convention, so the CACHE-GLOB step is what would find it by
# name -- must be refused there too, never executed.
TARGET_E4="${SCRATCH}/project-e4"
make_target "$TARGET_E4"
make_power_cli_json "$TARGET_E4" "9.9.7" "${FAKE_HOME}/.konductor/cli-releases/konductor-v9.9.7-deleted-direct-record"
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_E4'"
t_assert_status "a cache-glob match that is a cli-releases symlink escaping outside it is refused" 1
if [[ -f "$ESCAPE_MARKER" ]]; then
  t_fail "the escape symlink's target must NEVER actually be executed via the cache-glob search either" "found marker at: $ESCAPE_MARKER"
else
  t_pass "the escape symlink's target was never executed via the cache-glob search either"
fi
rm -f "$ESCAPE_SYMLINK"

# ── Scenario F: a malformed cli_version in power-cli.json is rejected
# outright, BEFORE it is ever used in a glob or path -- never silently
# treated as "no record" (a legacy target) either, since the file is
# present but untrustworthy, not genuinely absent.
TARGET_F="${SCRATCH}/project-f"
make_target "$TARGET_F"
make_power_cli_json "$TARGET_F" '1.0.2; rm -rf /' "$BIN_1_0_2"
t_run env HOME="$FAKE_HOME" bash -c "source '${SCRIPTS_DIR}/lib.sh'; konductor_resolve_target_binary '$TARGET_F'"
t_assert_status "a malformed cli_version is rejected" 1
t_assert_contains "the rejection names the expected bare-semver shape" "expected a bare semver"

# ── Scenario G: THE REGRESSION REPRODUCTION -- a legitimate content-only
# `--version 2.0.0` update, run on a target whose own CLI binary is (and
# stays) 1.0.2, must NEVER lock out a later update or uninstall. This is
# the exact scenario the coordinator's report reproduced against the
# earlier, buggy resolver (which compared power-cli.json's would-be
# cli_version against install-info.json's own `agent_version` -- the
# CONTENT version -- and found nothing on the machine reporting `--version`
# as "2.0.0", since that string never named a real CLI release at all).
TARGET_G="${SCRATCH}/project-g"
make_target "$TARGET_G" "1.0.2"
make_power_cli_json "$TARGET_G" "1.0.2" "$BIN_1_0_2"
t_run env HOME="$FAKE_HOME" bash "${SCRIPTS_DIR}/run-update.sh" --target "$TARGET_G" --version 2.0.0
t_assert_status "a content-only --version 2.0.0 update succeeds on the 1.0.2 CLI binary" 0
t_assert_contains "run-update.sh resolves and uses the target's own 1.0.2 binary, never a phantom 2.0.0 one" "Running: ${BIN_1_0_2} update --target ${TARGET_G} --version 2.0.0"
RECORDED_CLI_VERSION_AFTER_UPDATE="$(jq -r '.cli_version' "${TARGET_G}/.konductor/power-cli.json")"
t_assert_equal "power-cli.json's cli_version is unaffected by the CONTENT version bump" "1.0.2" "$RECORDED_CLI_VERSION_AFTER_UPDATE"
t_run env HOME="$FAKE_HOME" bash "${SCRIPTS_DIR}/run-uninstall.sh" --target "$TARGET_G" --confirmed
t_assert_status "a subsequent uninstall is NOT locked out by the earlier content-version bump" 0
t_assert_contains "uninstall resolves and uses the same 1.0.2 binary" "Running: ${BIN_1_0_2} uninstall --target ${TARGET_G}"
if [[ -f "${TARGET_G}/.konductor/power-cli.json" ]]; then
  t_fail "run-uninstall.sh must remove power-cli.json on a real removal" "still present: ${TARGET_G}/.konductor/power-cli.json"
else
  t_pass "run-uninstall.sh removed power-cli.json on the real removal"
fi

rm -rf "$SCRATCH"

t_summary
