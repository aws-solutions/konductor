#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-uninstall-confirm.sh -- pins run-uninstall.sh's I2 fix
# (adversarial-review finding I2): a REAL removal (no --dry-run) must
# refuse without --confirmed, exactly mirroring run-onboarding.sh's own
# consent backstop; --dry-run itself must stay completely unguarded, since
# it never touches the filesystem and gating it would only make the
# agent's own "show the user what would happen first" step harder to run.
# Uses a stubbed konductor binary on a scratch HOME; no real ~/.local or
# ~/.konductor touched.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR (adversarial-review finding I4): see
# test-fail-stop.sh's identical header comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
SCRIPT="${SCRIPTS_DIR}/run-uninstall.sh"

SCRATCH="$(mktemp -d)"
FAKE_HOME="${SCRATCH}/fake-home"
TARGET_DIR="${SCRATCH}/project"
mkdir -p "${FAKE_HOME}/.local/bin" "${FAKE_HOME}/.konductor/cli-releases" "${TARGET_DIR}/.konductor"

cat > "${TARGET_DIR}/.konductor/install-info.json" <<'JSON'
{"schema_version": 1, "agent_version": "1.0.2", "harness": "kiro-v3", "installed_at": "2026-01-01T00:00:00Z"}
JSON

UNINSTALL_MARKER="${SCRATCH}/real-uninstall-was-called.marker"
# Placed directly under cli-releases, with the shared bin as a SYMLINK
# into it -- matching link-binary.sh's own real convention, and required
# by konductor_resolve_target_binary's own trust boundary (adversarial-
# review finding C2's own hardening): the shared bin is only ever trusted
# once RESOLVED to a direct-child regular file under cli-releases, never
# as a bare regular file/copy sitting directly at ~/.local/bin/konductor.
STUB_BIN="${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-x86_64-unknown-linux-musl"
cat > "$STUB_BIN" <<STUB
#!/usr/bin/env bash
if [[ "\$1" == "--version" ]]; then
  echo "konductor 1.0.2"
  exit 0
fi
if [[ "\$1" == "uninstall" ]]; then
  for arg in "\$@"; do
    if [[ "\$arg" == "--dry-run" ]]; then
      echo "dry run: would remove ...(nothing actually removed)"
      exit 0
    fi
  done
  touch "${UNINSTALL_MARKER}"
  echo "uninstalled."
  exit 0
fi
echo "stub-konductor: unexpected argument: \$1" >&2
exit 1
STUB
chmod +x "$STUB_BIN"
ln -s "$STUB_BIN" "${FAKE_HOME}/.local/bin/konductor"

# ── Test 1: a REAL removal (no --dry-run, no --confirmed) is refused,
# and the underlying `konductor uninstall` never actually runs.
t_run env HOME="$FAKE_HOME" bash "$SCRIPT" --target "$TARGET_DIR"
t_assert_status "a real uninstall without --confirmed is refused" 64
t_assert_contains "the refusal names --confirmed specifically" "--confirmed"
t_assert_contains "the refusal tells the agent to show --dry-run's output first" "--dry-run first"
if [[ -f "$UNINSTALL_MARKER" ]]; then
  t_fail "the real uninstall must NEVER run when --confirmed is missing" "found marker at: $UNINSTALL_MARKER"
else
  t_pass "the real uninstall never ran (refused before touching konductor at all)"
fi

# ── Test 2: --dry-run is unguarded -- no --confirmed needed, and it
# reaches the real (stubbed) `konductor uninstall --dry-run` call.
t_run env HOME="$FAKE_HOME" bash "$SCRIPT" --target "$TARGET_DIR" --dry-run
t_assert_status "--dry-run without --confirmed is never refused" 0
t_assert_contains "--dry-run reaches the underlying dry-run call" "dry run: would remove"
if [[ -f "$UNINSTALL_MARKER" ]]; then
  t_fail "--dry-run must never trigger the REAL removal path" "found marker at: $UNINSTALL_MARKER"
else
  t_pass "--dry-run never touched the real removal path"
fi

# ── Test 3: a real removal WITH --confirmed proceeds and actually calls
# the underlying uninstall.
t_run env HOME="$FAKE_HOME" bash "$SCRIPT" --target "$TARGET_DIR" --confirmed
t_assert_status "a real uninstall with --confirmed succeeds" 0
if [[ -f "$UNINSTALL_MARKER" ]]; then
  t_pass "the real uninstall ran when --confirmed was passed (no --dry-run)"
else
  t_fail "the real uninstall should have run with --confirmed passed" "expected marker at: $UNINSTALL_MARKER"
fi

# ── Test 4: --dry-run AND --confirmed together still only dry-runs --
# --dry-run always wins; --confirmed is never itself a trigger to remove.
rm -f "$UNINSTALL_MARKER"
t_run env HOME="$FAKE_HOME" bash "$SCRIPT" --target "$TARGET_DIR" --dry-run --confirmed
t_assert_status "--dry-run with --confirmed still only dry-runs" 0
t_assert_contains "still reaches the dry-run call, not a real removal" "dry run: would remove"
if [[ -f "$UNINSTALL_MARKER" ]]; then
  t_fail "--dry-run must win even when --confirmed is also passed" "found marker at: $UNINSTALL_MARKER"
else
  t_pass "--dry-run + --confirmed together never triggers a real removal"
fi

rm -rf "$SCRATCH"

t_summary
