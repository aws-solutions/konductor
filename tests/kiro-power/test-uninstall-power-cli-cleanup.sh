#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# test-uninstall-power-cli-cleanup.sh -- pins run-uninstall.sh's own
# power-cli.json cleanup rule: a REAL removal deletes this Power's own
# <target>/.konductor/power-cli.json only once the target no longer
# tracks ANY harness, never on a `--harness <name>` removal that leaves
# another harness still tracked. Deleting it on a partial removal would
# strand that surviving harness's next update/uninstall on
# konductor_resolve_target_binary's own legacy path (lib.sh's "no
# power-cli.json" branch, which trusts the shared ~/.local/bin/konductor
# outright, with no version check at all).
#
# The stubbed `konductor` binary below reproduces the real CLI's own
# on-disk post-condition for this (cli/konductor-rs/src/cli/install/
# manifest.rs's remove_strategy_locked/delete_and_remove_strategy_
# locked): a `.konductor/manifest` document with a `strategies` list,
# where uninstalling one named strategy drops it from the list and the
# file itself is deleted outright -- never left behind as an empty
# `{"strategies": []}` document -- once nothing remains tracked. That
# file's own presence/absence afterward is exactly the signal
# run-uninstall.sh now reads to decide whether to clear power-cli.json.
#
# Uses a stubbed konductor binary on a scratch HOME, same convention as
# test-harness-flag.sh/test-uninstall-confirm.sh -- no real ~/.local or
# ~/.konductor touched.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=helpers.sh
source "${TEST_DIR}/helpers.sh"

# KONDUCTOR_SETUP_SCRIPTS_DIR: see test-fail-stop.sh's identical header
# comment for the full rationale.
SCRIPTS_DIR="${KONDUCTOR_SETUP_SCRIPTS_DIR:-${TEST_DIR}/../../powers/konductor/skills/konductor-setup/scripts}"
UNINSTALL_SCRIPT="${SCRIPTS_DIR}/run-uninstall.sh"

SCRATCH="$(mktemp -d)"
FAKE_HOME="${SCRATCH}/fake-home"
mkdir -p "${FAKE_HOME}/.local/bin" "${FAKE_HOME}/.konductor/cli-releases"

# make_target <dir>
# Minimal <dir>/.konductor/install-info.json -- konductor_resolve_target_
# binary only requires this file's existence.
make_target() {
  local dir="$1"
  mkdir -p "${dir}/.konductor"
  cat > "${dir}/.konductor/install-info.json" <<'JSON'
{"schema_version": 1, "agent_version": "1.0.2", "harness": "kiro-v3", "installed_at": "2026-01-01T00:00:00Z"}
JSON
}

# make_power_cli_json <dir> <binary-path>
make_power_cli_json() {
  local dir="$1" binary_path="$2"
  cat > "${dir}/.konductor/power-cli.json" <<JSON
{"cli_version": "1.0.2", "binary": "${binary_path}"}
JSON
}

# A stubbed `konductor` whose `uninstall` subcommand reproduces the real
# CLI's own manifest post-condition: on a real (non-dry-run) removal, it
# drops the named `--harness <name>` strategy (or, with no --harness,
# every strategy -- the single-harness case) from
# `<target>/.konductor/manifest`'s `strategies` list via jq (lib.sh
# already depends on jq for this Power's own power-cli.json, so this
# stub uses the same tool rather than introducing a new one), then
# deletes the manifest file outright once the list is empty -- matching
# manifest.rs's remove_strategy_locked/delete_and_remove_strategy_locked,
# which never writes back an empty `{"strategies": []}` document.
STUB_BIN="${FAKE_HOME}/.konductor/cli-releases/konductor-v1.0.2-x86_64-unknown-linux-musl"
cat > "$STUB_BIN" <<STUB
#!/usr/bin/env bash
case "\$1" in
  --version)
    echo "konductor 1.0.2"
    exit 0
    ;;
  uninstall)
    shift
    harness=""
    target=""
    dry_run=""
    while [[ \$# -gt 0 ]]; do
      case "\$1" in
        --harness) harness="\$2"; shift 2 ;;
        --target) target="\$2"; shift 2 ;;
        --dry-run) dry_run="1"; shift ;;
        *) shift ;;
      esac
    done
    if [[ -n "\$dry_run" ]]; then
      echo "dry run: would remove ...(nothing actually removed)"
      exit 0
    fi
    manifest="\${target}/.konductor/manifest"
    if [[ -f "\$manifest" ]]; then
      if [[ -n "\$harness" ]]; then
        jq --arg h "\$harness" '.strategies |= map(select(.strategy != \$h))' "\$manifest" > "\${manifest}.tmp"
      else
        jq '.strategies = []' "\$manifest" > "\${manifest}.tmp"
      fi
      mv "\${manifest}.tmp" "\$manifest"
      remaining="\$(jq '.strategies | length' "\$manifest")"
      if [[ "\$remaining" -eq 0 ]]; then
        rm -f "\$manifest"
      fi
    fi
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

# ── Scenario A/B: a target tracking TWO harnesses. Removing one leaves
# power-cli.json (and cli_version/binary) untouched; removing the LAST
# one clears it. ─────────────────────────────────────────────────────────
TARGET_MULTI="${SCRATCH}/project-multi"
make_target "$TARGET_MULTI"
make_power_cli_json "$TARGET_MULTI" "$STUB_BIN"
POWER_CLI_JSON_MULTI="${TARGET_MULTI}/.konductor/power-cli.json"
BEFORE_CONTENT="$(cat "$POWER_CLI_JSON_MULTI")"
cat > "${TARGET_MULTI}/.konductor/manifest" <<'JSON'
{
  "schema_version": 2,
  "strategies": [
    {"strategy": "claude", "installed_at": "2026-01-01T00:00:00Z", "destination": ".", "source": null, "status": "complete", "files": []},
    {"strategy": "kiro-v3", "installed_at": "2026-01-01T00:00:00Z", "destination": ".", "source": null, "status": "complete", "files": []}
  ]
}
JSON

# (a) --harness claude on a two-harness target: power-cli.json survives,
# byte-for-byte unchanged (cli_version/binary untouched).
t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_MULTI" --confirmed --harness claude
t_assert_status "removing one of two tracked harnesses succeeds" 0
if [[ -f "$POWER_CLI_JSON_MULTI" ]]; then
  AFTER_CONTENT="$(cat "$POWER_CLI_JSON_MULTI")"
  t_assert_equal "power-cli.json's cli_version/binary are unchanged after a partial removal" "$BEFORE_CONTENT" "$AFTER_CONTENT"
else
  t_fail "power-cli.json must survive a --harness removal that leaves another harness tracked" "expected file at: $POWER_CLI_JSON_MULTI"
fi
REMAINING="$(jq -r '.strategies[].strategy' "${TARGET_MULTI}/.konductor/manifest" 2>/dev/null | tr '\n' ' ')"
if [[ "$REMAINING" == *"kiro-v3"* ]]; then
  t_pass "the surviving strategy is still kiro-v3"
else
  t_fail "the surviving strategy is still kiro-v3" "remaining strategies: ${REMAINING:-<none>}"
fi

# (b) --harness kiro-v3 (the last remaining one) on the same target: this
# time power-cli.json is removed.
t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_MULTI" --confirmed --harness kiro-v3
t_assert_status "removing the last tracked harness succeeds" 0
if [[ -f "$POWER_CLI_JSON_MULTI" ]]; then
  t_fail "power-cli.json must be removed once the last tracked harness is uninstalled" "found: $POWER_CLI_JSON_MULTI"
else
  t_pass "power-cli.json is removed once nothing is left tracked at the target"
fi

# ── Scenario C: single-harness target, real uninstall (no --harness) --
# existing behaviour: power-cli.json is removed. ───────────────────────
TARGET_SINGLE="${SCRATCH}/project-single"
make_target "$TARGET_SINGLE"
make_power_cli_json "$TARGET_SINGLE" "$STUB_BIN"
POWER_CLI_JSON_SINGLE="${TARGET_SINGLE}/.konductor/power-cli.json"
cat > "${TARGET_SINGLE}/.konductor/manifest" <<'JSON'
{
  "schema_version": 2,
  "strategies": [
    {"strategy": "kiro-v3", "installed_at": "2026-01-01T00:00:00Z", "destination": ".", "source": null, "status": "complete", "files": []}
  ]
}
JSON

t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_SINGLE" --confirmed
t_assert_status "a single-harness real uninstall still succeeds" 0
if [[ -f "$POWER_CLI_JSON_SINGLE" ]]; then
  t_fail "a single-harness target's power-cli.json must still be removed on a real uninstall (existing behaviour)" "found: $POWER_CLI_JSON_SINGLE"
else
  t_pass "a single-harness target's power-cli.json is still removed on a real uninstall"
fi

# ── Scenario D: --dry-run never removes power-cli.json, even on a
# multi-harness target with --harness given. ────────────────────────────
TARGET_DRY="${SCRATCH}/project-dry-run"
make_target "$TARGET_DRY"
make_power_cli_json "$TARGET_DRY" "$STUB_BIN"
POWER_CLI_JSON_DRY="${TARGET_DRY}/.konductor/power-cli.json"
cat > "${TARGET_DRY}/.konductor/manifest" <<'JSON'
{
  "schema_version": 2,
  "strategies": [
    {"strategy": "claude", "installed_at": "2026-01-01T00:00:00Z", "destination": ".", "source": null, "status": "complete", "files": []},
    {"strategy": "kiro-v3", "installed_at": "2026-01-01T00:00:00Z", "destination": ".", "source": null, "status": "complete", "files": []}
  ]
}
JSON

t_run env HOME="$FAKE_HOME" bash "$UNINSTALL_SCRIPT" --target "$TARGET_DRY" --dry-run --harness kiro-v3
t_assert_status "--dry-run --harness kiro-v3 needs no --confirmed" 0
if [[ -f "$POWER_CLI_JSON_DRY" ]]; then
  t_pass "--dry-run never removes power-cli.json"
else
  t_fail "--dry-run must never remove power-cli.json, even with --harness given" "expected file at: $POWER_CLI_JSON_DRY"
fi
if [[ -f "${TARGET_DRY}/.konductor/manifest" ]]; then
  t_pass "--dry-run never touches the manifest file either"
else
  t_fail "--dry-run must never touch the filesystem at all" "manifest unexpectedly missing"
fi

rm -rf "$SCRATCH"

t_summary
