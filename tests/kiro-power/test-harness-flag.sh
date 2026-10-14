#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-harness-flag.sh -- pins the optional `--harness <value>` flag on
# run-update.sh/run-uninstall.sh: forwarded verbatim as `--harness
# <value>` to the underlying `konductor update`/`uninstall` call when
# given; omitted means the prior single-harness behavior (nothing
# forwarded at all); an unsafe value is rejected before the underlying
# CLI ever runs. Also pins that --confirmed/--dry-run gating on
# run-uninstall.sh is unaffected by --harness being present.
#
# Uses a stubbed konductor binary on a scratch HOME, same convention as
# test-resolve-target-binary.sh/test-uninstall-confirm.sh -- no real
# ~/.local or ~/.konductor touched.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR: see test-fail-stop.sh's identical header
# comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
UPDATE_SCRIPT="${SCRIPTS_DIR}/run-update.sh"
UNINSTALL_SCRIPT="${SCRIPTS_DIR}/run-uninstall.sh"

SCRATCH="$(mktemp -d)"
FAKE_HOME="${SCRATCH}/fake-home"
TARGET_DIR="${SCRATCH}/project"
UPDATE_ARGV_LOG="${SCRATCH}/update-argv.log"
UNINSTALL_ARGV_LOG="${SCRATCH}/uninstall-argv.log"
UNINSTALL_MARKER="${SCRATCH}/real-uninstall-was-called.marker"
mkdir -p "${FAKE_HOME}/.local/bin" "${FAKE_HOME}/.konductor/cli-releases" "${TARGET_DIR}/.konductor"

cat > "${TARGET_DIR}/.konductor/install-info.json" <<'JSON'
{"schema_version": 1, "agent_version": "1.0.2", "harness": "kiro-v3", "installed_at": "2026-01-01T00:00:00Z"}
JSON
cat > "${TARGET_DIR}/.konductor/power-cli.json" <<JSON
{"cli_version": "1.0.2", "binary": "${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-x86_64-unknown-linux-musl"}
JSON

# A fake `konductor` that records its full `update`/`uninstall` argv
# (one arg per line) to a log file, then succeeds -- `uninstall` mirrors
# test-uninstall-confirm.sh's own --dry-run/real split so this file can
# also pin that --harness never disturbs that gating.
STUB_BIN="${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-x86_64-unknown-linux-musl"
cat > "$STUB_BIN" <<STUB
#!/usr/bin/env bash
case "\$1" in
  --version)
    echo "konductor 1.0.2"
    exit 0
    ;;
  update)
    printf '%s\n' "\$@" > "${UPDATE_ARGV_LOG}"
    exit 0
    ;;
  uninstall)
    printf '%s\n' "\$@" > "${UNINSTALL_ARGV_LOG}"
    for arg in "\$@"; do
      if [[ "\$arg" == "--dry-run" ]]; then
        echo "dry run: would remove ...(nothing actually removed)"
        exit 0
      fi
    done
    touch "${UNINSTALL_MARKER}"
    echo "uninstalled."
    exit 0
    ;;
  *)
    echo "stub-konductor: unexpected argument: \$1" >&2
    exit 1
    ;;
esac
STUB
chmod +x "$STUB_BIN"

# ── run-update.sh ─────────────────────────────────────────────────────────

# Test 1: --harness claude is forwarded verbatim to konductor update.
rm -f "$UPDATE_ARGV_LOG"
t_run env HOME="$FAKE_HOME" bash "$UPDATE_SCRIPT" --target "$TARGET_DIR" --harness claude
t_assert_status "run-update.sh --harness claude succeeds" 0
ARGV_FLAT="$(tr '\n' ' ' < "$UPDATE_ARGV_LOG" 2>/dev/null || true)"
if [[ "$ARGV_FLAT" == *"--harness claude"* ]]; then
  t_pass "run-update.sh forwards --harness claude verbatim to konductor update"
else
  t_fail "run-update.sh must forward --harness claude to konductor update" "update argv: ${ARGV_FLAT:-<no argv log written>}"
fi

# Test 2: no --harness -> nothing forwarded.
rm -f "$UPDATE_ARGV_LOG"
t_run env HOME="$FAKE_HOME" bash "$UPDATE_SCRIPT" --target "$TARGET_DIR"
t_assert_status "run-update.sh without --harness succeeds" 0
ARGV_FLAT="$(tr '\n' ' ' < "$UPDATE_ARGV_LOG" 2>/dev/null || true)"
if [[ "$ARGV_FLAT" != *"--harness"* ]]; then
  t_pass "run-update.sh never forwards --harness when it was not given"
else
  t_fail "run-update.sh must not forward --harness when omitted" "update argv: $ARGV_FLAT"
fi

# Test 3: an unsafe --harness value is rejected before konductor update
# ever runs, for each of: shell-metacharacter payload, empty string,
# path traversal.
for bad_value in 'x; rm' '' '../a'; do
  rm -f "$UPDATE_ARGV_LOG"
  t_run env HOME="$FAKE_HOME" bash "$UPDATE_SCRIPT" --target "$TARGET_DIR" --harness "$bad_value"
  if [[ "$T_STATUS" -ne 0 ]]; then
    t_pass "run-update.sh --harness '${bad_value}' is rejected (exit ${T_STATUS})"
  else
    t_fail "run-update.sh --harness '${bad_value}' must be rejected" "exit status: $T_STATUS" "output: $T_OUTPUT"
  fi
  if [[ -f "$UPDATE_ARGV_LOG" ]]; then
    t_fail "konductor update must never run with an unsafe --harness value" "found argv log: $(cat "$UPDATE_ARGV_LOG")"
  else
    t_pass "konductor update never ran for --harness '${bad_value}'"
  fi
done

# ── run-uninstall.sh ────────────────────────────────────────────────────────

# Test 4: --harness claude is forwarded verbatim to konductor uninstall
# on a real removal.
rm -f "$UNINSTALL_ARGV_LOG" "$UNINSTALL_MARKER"
t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_DIR" --confirmed --harness claude
t_assert_status "run-uninstall.sh --confirmed --harness claude succeeds" 0
ARGV_FLAT="$(tr '\n' ' ' < "$UNINSTALL_ARGV_LOG" 2>/dev/null || true)"
if [[ "$ARGV_FLAT" == *"--harness claude"* ]]; then
  t_pass "run-uninstall.sh forwards --harness claude verbatim to konductor uninstall"
else
  t_fail "run-uninstall.sh must forward --harness claude to konductor uninstall" "uninstall argv: ${ARGV_FLAT:-<no argv log written>}"
fi
if [[ -f "$UNINSTALL_MARKER" ]]; then
  t_pass "the real removal still ran with --harness present"
else
  t_fail "a confirmed real removal with --harness present must still actually run" "no marker at: $UNINSTALL_MARKER"
fi
# A real removal clears power-cli.json (see run-uninstall.sh's own real-
# removal cleanup) -- restore it for the remaining scenarios below, which
# each need konductor_resolve_target_binary to succeed again.
cat > "${TARGET_DIR}/.konductor/power-cli.json" <<JSON
{"cli_version": "1.0.2", "binary": "${STUB_BIN}"}
JSON

# Test 5: no --harness -> nothing forwarded.
rm -f "$UNINSTALL_ARGV_LOG" "$UNINSTALL_MARKER"
t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_DIR" --confirmed
t_assert_status "run-uninstall.sh --confirmed without --harness succeeds" 0
ARGV_FLAT="$(tr '\n' ' ' < "$UNINSTALL_ARGV_LOG" 2>/dev/null || true)"
if [[ "$ARGV_FLAT" != *"--harness"* ]]; then
  t_pass "run-uninstall.sh never forwards --harness when it was not given"
else
  t_fail "run-uninstall.sh must not forward --harness when omitted" "uninstall argv: $ARGV_FLAT"
fi
cat > "${TARGET_DIR}/.konductor/power-cli.json" <<JSON
{"cli_version": "1.0.2", "binary": "${STUB_BIN}"}
JSON

# Test 6: --dry-run + --harness together never require --confirmed, and
# the dry run still reaches the underlying stub -- --harness must not
# disturb the existing --dry-run/--confirmed gating.
rm -f "$UNINSTALL_ARGV_LOG" "$UNINSTALL_MARKER"
t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_DIR" --dry-run --harness claude
t_assert_status "--dry-run --harness claude needs no --confirmed" 0
t_assert_contains "the dry run still reaches the underlying call" "dry run: would remove"
ARGV_FLAT="$(tr '\n' ' ' < "$UNINSTALL_ARGV_LOG" 2>/dev/null || true)"
if [[ "$ARGV_FLAT" == *"--harness claude"* ]]; then
  t_pass "--harness is still forwarded on a --dry-run"
else
  t_fail "--harness must be forwarded on a --dry-run too" "uninstall argv: ${ARGV_FLAT:-<no argv log written>}"
fi
if [[ -f "$UNINSTALL_MARKER" ]]; then
  t_fail "--dry-run must never trigger the real removal, even with --harness present" "found marker at: $UNINSTALL_MARKER"
else
  t_pass "--dry-run + --harness still never triggers a real removal"
fi

# Test 7: a real removal (no --dry-run) with --harness present but
# without --confirmed is still refused -- --harness must not bypass the
# existing consent backstop.
t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_DIR" --harness claude
t_assert_status "a real removal with --harness present is still refused without --confirmed" 64
t_assert_contains "the refusal still names --confirmed specifically" "--confirmed"
if [[ -f "$UNINSTALL_MARKER" ]]; then
  t_fail "the real removal must still never run without --confirmed, even with --harness present" "found marker at: $UNINSTALL_MARKER"
else
  t_pass "the consent backstop is unaffected by --harness being present"
fi

# Test 8: an unsafe --harness value is rejected before konductor
# uninstall ever runs, regardless of --confirmed/--dry-run.
for bad_value in 'x; rm' '' '../a'; do
  rm -f "$UNINSTALL_ARGV_LOG" "$UNINSTALL_MARKER"
  t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_DIR" --confirmed --harness "$bad_value"
  if [[ "$T_STATUS" -ne 0 ]]; then
    t_pass "run-uninstall.sh --harness '${bad_value}' is rejected (exit ${T_STATUS})"
  else
    t_fail "run-uninstall.sh --harness '${bad_value}' must be rejected" "exit status: $T_STATUS" "output: $T_OUTPUT"
  fi
  if [[ -f "$UNINSTALL_ARGV_LOG" || -f "$UNINSTALL_MARKER" ]]; then
    t_fail "konductor uninstall must never run with an unsafe --harness value" "argv log present: $([[ -f "$UNINSTALL_ARGV_LOG" ]] && echo yes || echo no); marker present: $([[ -f "$UNINSTALL_MARKER" ]] && echo yes || echo no)"
  else
    t_pass "konductor uninstall never ran for --harness '${bad_value}'"
  fi
done

rm -rf "$SCRATCH"

t_summary
