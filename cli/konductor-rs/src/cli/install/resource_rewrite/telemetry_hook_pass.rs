// SPDX-License-Identifier: Apache-2.0
//
// install/resource_rewrite/telemetry_hook_pass.rs — Kiro CLI
// telemetry-hook wiring for both Kiro engines, mirroring the
// `agent_invocation` wiring Claude Code already gets from
// `claude_settings.rs`'s `TELEMETRY_HOOK_ENTRIES`/`apply_claude_
// settings_hooks`:
//
// - V2 (`TelemetryHookPass`): merges an entry into the installed
//   agent's own inline `hooks.agentSpawn` array -- a per-agent
//   `ResourceRewritePass`, run once per agent through
//   `resource_rewrite::apply_all`/`standard_passes`. Wires `konductor
//   __telemetry-hook agent-invocation` under `agentSpawn`, V2's trigger
//   name for "a new agent/session invocation begins".
// - V3/KAS (`apply_v3_standalone_telemetry_hook`): writes one
//   standalone `.kiro/hooks/<name>.json` document shared by every agent
//   at the install target, since KAS 3.0 moved hooks out of embedded
//   agent-config fields into standalone `.kiro/hooks/*.json` files.
//   Wires the same event under `SessionStart`, KAS 3.0's PascalCase
//   rename of V2's `agentSpawn`.
//
// Scope: only the confirmed top-level `agent_invocation` event.
// Sub-agent-delegation telemetry (`subagent_invocation`) is not wired
// here -- Kiro's PreToolUse/sub-agent-name payload shape isn't
// confirmed against `telemetry_hook.rs::resolve_agent_name`, and
// inventing a matcher without that confirmation risks misattributing
// or double-counting events.
//
// V3's standalone document is an install-target-level artifact, not
// one agent's own JSON, so `apply_v3_standalone_telemetry_hook` is a
// plain function called once per install from `kiro_cli_v3.rs`'s
// `install_from_local`, at the same call-site level as
// `write_install_info`/`apply_claude_settings_grant_and_hooks`.
// `standard_passes_v3` never carries a telemetry-hook pass.
//
// A transient `current_exe()` failure is non-fatal on both sides:
// `merge_agent_spawn_hook`'s `Absent` branch never persists a
// `$PATH`-dependent fallback command when the exe path didn't resolve
// to an absolute path this run, and `verify_agent_spawn_hook_command`
// re-checks resolvability before erroring -- still unresolvable
// degrades to a warning; resolvable but still missing means the
// agent's pre-existing `hooks` shape is genuinely malformed, which
// stays a hard error. Mirrors `claude_settings.rs`'s handling of the
// same root cause, and `apply_v3_standalone_telemetry_hook_with_exe`'s
// refusal on the V3 side.

use std::path::Path;

use super::{ResourceRewritePass, RewriteContext};

/// V2 (Kiro CLI 2.x) hook trigger name for "a new agent/session
/// invocation begins" -- the pre-3.0 camelCase spelling V2's own
/// runtime recognizes.
const AGENT_SPAWN_TRIGGER_V2: &str = "agentSpawn";

/// V3 (KAS 3.0) trigger name for the same event, per KAS's own
/// hooks-migration old-name -> new-name mapping (`agentSpawn` ->
/// `SessionStart`). Used as the standalone hook document's own
/// `"trigger"` field value (see `build_v3_standalone_hook_document`
/// below), not as an inline `hooks.<trigger>` object key the way
/// `AGENT_SPAWN_TRIGGER_V2` is.
const V3_SESSION_START_TRIGGER: &str = "SessionStart";

/// Wires `konductor __telemetry-hook agent-invocation` into a Kiro CLI
/// V2 agent's inline `hooks.agentSpawn` array.
pub(super) struct TelemetryHookPass;

impl ResourceRewritePass for TelemetryHookPass {
    /// Unconditionally `true`: every installed agent gets the telemetry
    /// hook, gated purely on `!no_telemetry` at the call site that
    /// decides whether to include this pass at all.
    fn matches(&self, _value: &serde_json::Value, _ctx: &RewriteContext<'_>) -> bool {
        true
    }

    fn rewrite(&self, value: &mut serde_json::Value, _ctx: &RewriteContext<'_>) {
        let exe = super::claude_settings::resolve_konductor_exe_path();
        merge_agent_spawn_hook(value, AGENT_SPAWN_TRIGGER_V2, &exe);
    }

    fn verify(
        &self,
        value: &serde_json::Value,
        _ctx: &RewriteContext<'_>,
        agent_file: &Path,
    ) -> Result<(), String> {
        verify_agent_spawn_hook_command(value, AGENT_SPAWN_TRIGGER_V2, agent_file)
    }
}

// ── V3/KAS: standalone SessionStart telemetry hook document ──────────

/// Relative path, under a Kiro CLI V3 (KAS) install target directory, of
/// the standalone SessionStart telemetry hook document this module
/// writes. A dedicated, Konductor-namespaced filename under the shared
/// `.kiro/hooks/` directory. This path is fully owned by Konductor
/// (never merged with unrelated hand-authored hooks the way
/// `.claude/settings.json` is), so the generic `Created`/`ReplacedOurs`/
/// `ReplacedForeign` provenance model needs no special-casing here --
/// except for the dedicated lock file this module also writes into the
/// same directory (see `V3_STANDALONE_HOOK_LOCK_FILE_NAME`), which is
/// untracked by the manifest and needs `uninstall.rs`'s own best-effort
/// cleanup. `pub(crate)`: read by `kiro_cli_v3.rs` to build the
/// manifest entry, and by `uninstall.rs` to clean up the sibling lock
/// file.
pub(crate) const V3_STANDALONE_HOOKS_RELATIVE_PATH: &str =
    ".kiro/hooks/konductor-telemetry-hooks.json";

/// The `"name"` field inside the standalone hook document's
/// `SessionStart` entry (distinct from the file name above -- the
/// schema's `name` field identifies one hook within a file's `hooks`
/// array, not the file).
const V3_STANDALONE_HOOK_SESSION_START_NAME: &str = "konductor-telemetry-session-start";

/// Lock file name (within the shared `.kiro/hooks/` directory) guarding
/// `write_v3_standalone_telemetry_hook_file`'s create-dir-plus-write
/// sequence. Dedicated to this one file, per `config_lock::acquire_named`'s
/// "a different critical section gets its own independent lock file"
/// convention, so this never contends with an unrelated lock (e.g.
/// `claude_settings.rs`'s `.settings.lock`) sharing the same directory.
/// `pub(crate)`: this file is never manifest-tracked, so
/// `uninstall.rs`'s `delete_eligible_files` reads this name directly to
/// remove it as a best-effort sibling of the tracked hook document.
pub(crate) const V3_STANDALONE_HOOK_LOCK_FILE_NAME: &str =
    ".konductor-telemetry-session-start.lock";

/// Builds the standalone hook document this module writes, for a given
/// fully-formed `session_start_command` string.
fn build_v3_standalone_hook_document(session_start_command: String) -> serde_json::Value {
    serde_json::json!({
        "version": "v1",
        "hooks": [
            {
                "name": V3_STANDALONE_HOOK_SESSION_START_NAME,
                "trigger": V3_SESSION_START_TRIGGER,
                "action": {
                    "type": "command",
                    "command": session_start_command
                },
                "enabled": true
            }
        ]
    })
}

/// Writes (or rewrites, on reinstall) `<target_dir>/<V3_STANDALONE_
/// HOOKS_RELATIVE_PATH>`, unconditionally overwriting any pre-existing
/// content with the fresh document `build_v3_standalone_hook_document`
/// produces for the current `exe`. Unlike `merge_claude_settings_hooks`
/// or this file's own V2 `merge_agent_spawn_hook`, this never reads or
/// merges pre-existing content: the file's Konductor-owned name means
/// there is no "preserve someone else's hooks" concern the way there is
/// for a genuinely shared file like `.claude/settings.json` -- it's
/// rewritten fresh on every install, the same as `.kiro/agents/
/// <name>.json`. That full overwrite also makes idempotency and
/// self-healing automatic: a relocated binary or a second install run
/// both just reproduce correct, up-to-date content from the current
/// `exe`.
///
/// Returns the exact bytes written, so the caller can hash them for the
/// manifest entry.
///
/// Unlike `.kiro/agents/<name>.json` (one file per agent), this file is
/// written unconditionally by every V3 install with telemetry enabled,
/// so two concurrent `konductor install --harness kiro-v3` runs against
/// the same target will race on this exact path. The create-dir-plus-
/// write sequence is serialized via `config_lock`'s advisory lock (the
/// same primitive `claude_settings.rs`'s settings-merge lock uses),
/// held for the rest of this function's scope.
pub(super) fn write_v3_standalone_telemetry_hook_file(
    target_dir: &Path,
    exe: &str,
) -> Result<Vec<u8>, String> {
    let file_path = target_dir.join(V3_STANDALONE_HOOKS_RELATIVE_PATH);
    let hooks_dir = file_path
        .parent()
        .expect("V3_STANDALONE_HOOKS_RELATIVE_PATH always has a parent");

    let _lock_guard =
        crate::cli::config_lock::acquire_named(hooks_dir, V3_STANDALONE_HOOK_LOCK_FILE_NAME)
            .map_err(|source| format!("failed to lock {}: {source}", hooks_dir.display()))?;

    std::fs::create_dir_all(hooks_dir)
        .map_err(|e| format!("failed to create {}: {e}", hooks_dir.display()))?;

    let quoted_exe = super::claude_settings::shell_quote_for_hook_command(exe);
    let session_start_command = format!(
        "{quoted_exe} __telemetry-hook {}",
        crate::cli::telemetry_hook::AGENT_INVOCATION
    );
    let document = build_v3_standalone_hook_document(session_start_command);

    let mut bytes = serde_json::to_vec_pretty(&document)
        .map_err(|e| format!("failed to serialize {}: {e}", file_path.display()))?;
    bytes.push(b'\n');

    crate::cli::atomic_write::write_atomic(&file_path, &bytes)
        .map_err(|e| format!("failed to write {}: {e}", file_path.display()))?;

    Ok(bytes)
}

/// Performs the V3 standalone telemetry-hook write for a whole install
/// run and returns its manifest-relative path and content hash, so the
/// caller (`kiro_cli_v3.rs`'s `install_from_local`) can build a real
/// `ManifestFile` entry for it -- same call contract as `claude_
/// settings::apply_claude_settings_hooks`. Resolves the currently
/// running `konductor` binary's own absolute path via
/// `resolve_konductor_exe_path` (shared with `claude_settings.rs` and
/// this file's own V2 side), so the wired command survives regardless
/// of `$PATH` at hook-fire time.
pub(in crate::cli::install) fn apply_v3_standalone_telemetry_hook(
    target_dir: &Path,
) -> Result<(String, String), String> {
    apply_v3_standalone_telemetry_hook_with_exe(
        target_dir,
        &super::claude_settings::resolve_konductor_exe_path(),
    )
}

/// Same as `apply_v3_standalone_telemetry_hook`, but takes the resolved
/// `konductor` exe path as a parameter rather than resolving it
/// internally -- lets a test exercise the absolute-path guard below
/// deterministically without forcing a real `std::env::current_exe()`
/// failure.
fn apply_v3_standalone_telemetry_hook_with_exe(
    target_dir: &Path,
    exe: &str,
) -> Result<(String, String), String> {
    if !super::claude_settings::is_resolved_absolute_exe_path(exe) {
        return Err(format!(
            "could not resolve the running konductor binary's own absolute path \
             (current_exe() failed) -- refusing to write a PATH-relative command into the \
             shared standalone hook file at {V3_STANDALONE_HOOKS_RELATIVE_PATH}"
        ));
    }
    let bytes = write_v3_standalone_telemetry_hook_file(target_dir, exe)?;
    Ok((
        V3_STANDALONE_HOOKS_RELATIVE_PATH.to_string(),
        super::super::artifact::sha256_hex(&bytes),
    ))
}

/// The result of searching an existing `hooks.<trigger>` array (a flat
/// array of `{command}` entries -- Kiro's own inline shape) for an
/// entry identifying the same hook as `command`. Identity is solely the
/// command's stable suffix (`super::claude_settings::stable_hook_
/// command_suffix`).
enum HookEntryMatch {
    /// No entry with a matching stable command suffix exists -- a
    /// fresh entry must be appended.
    Absent,
    /// An entry already carries the exact command already wired --
    /// nothing to do.
    UpToDate,
    /// An entry's stable command suffix matches, but its full command
    /// differs (a stale absolute exe path from a relocated or
    /// previously-unresolved binary) -- the entry at `entries[index]
    /// ["command"]` must be rewritten in place, self-healing the stale
    /// path rather than appending a duplicate entry.
    Stale { index: usize },
}

/// Searches `entries` (an existing `hooks.<trigger>` array) for an
/// entry identifying the same hook as `command`, exact-match-first then
/// falling back to a stale-suffix candidate (scanning the whole array
/// first, since an exact match can appear anywhere, not necessarily
/// before a stale-suffix entry).
fn find_agent_spawn_hook_entry(entries: &[serde_json::Value], command: &str) -> HookEntryMatch {
    let wanted_suffix = super::claude_settings::stable_hook_command_suffix(command);
    let mut stale_candidate: Option<usize> = None;
    for (index, entry) in entries.iter().enumerate() {
        let Some(existing_command) = entry.get("command").and_then(|c| c.as_str()) else {
            continue;
        };
        if existing_command == command {
            return HookEntryMatch::UpToDate;
        }
        if stale_candidate.is_none()
            && wanted_suffix.is_some()
            && super::claude_settings::stable_hook_command_suffix(existing_command) == wanted_suffix
        {
            stale_candidate = Some(index);
        }
    }
    match stale_candidate {
        Some(index) => HookEntryMatch::Stale { index },
        None => HookEntryMatch::Absent,
    }
}

/// Reads `value["hooks"][trigger]` without creating either key --
/// `Ok(&[])` when `hooks` or `hooks.<trigger>` is simply absent, `Err(())`
/// for the same malformed-shape no-op contract `merge_agent_spawn_hook`
/// uses. Letting the caller match against an existing entry BEFORE
/// deciding whether to mutate `value` is the point of this being a
/// separate, read-only step: a skipped wiring (a non-absolute `exe`)
/// must never leave behind an empty `hooks`/`hooks.<trigger>` scaffold
/// just because this lookup ran.
fn read_existing_hook_entries<'a>(
    value: &'a serde_json::Value,
    trigger: &str,
) -> Result<&'a [serde_json::Value], ()> {
    let Some(root_obj) = value.as_object() else {
        return Err(());
    };
    let Some(hooks_val) = root_obj.get("hooks") else {
        return Ok(&[]);
    };
    let Some(hooks_obj) = hooks_val.as_object() else {
        return Err(());
    };
    let Some(entries_val) = hooks_obj.get(trigger) else {
        return Ok(&[]);
    };
    entries_val.as_array().map(Vec::as_slice).ok_or(())
}

/// Ensures `value["hooks"][trigger]` carries an entry running `exe
/// __telemetry-hook agent-invocation` -- creates `hooks`/`hooks.
/// <trigger>` fresh when either is absent, or merges into existing
/// content otherwise. Operates directly on an in-memory
/// `serde_json::Value` already parsed by the caller's `apply_all`; no
/// file to read/lock/write here.
///
/// Leaves `value` untouched (a documented no-op, not a panic) when its
/// top level, its pre-existing `"hooks"` key, or `"hooks.<trigger>"` is
/// not the JSON shape this expects -- `verify_agent_spawn_hook_command`
/// turns that no-op into a hard `Err` for the whole install.
///
/// Also leaves `value` untouched when the exe path could not be
/// resolved and there is no existing entry to self-heal or match:
/// `exe_is_absolute` is checked before any mutation, so a skipped
/// wiring never creates so much as an empty `"hooks"`/`"hooks.
/// <trigger>"` scaffold.
fn merge_agent_spawn_hook(value: &mut serde_json::Value, trigger: &str, exe: &str) {
    let quoted_exe = super::claude_settings::shell_quote_for_hook_command(exe);
    let command = format!(
        "{quoted_exe} __telemetry-hook {}",
        crate::cli::telemetry_hook::AGENT_INVOCATION
    );
    let exe_is_absolute = super::claude_settings::is_resolved_absolute_exe_path(exe);

    let Ok(existing_entries) = read_existing_hook_entries(value, trigger) else {
        return;
    };

    match find_agent_spawn_hook_entry(existing_entries, &command) {
        HookEntryMatch::UpToDate => {}
        HookEntryMatch::Stale { index } => {
            // Only self-heal when `exe` is a genuine absolute path: a
            // transient current_exe() failure must never downgrade an
            // already-correct absolute-path command to the bare
            // $PATH-dependent fallback.
            if exe_is_absolute {
                if let Some(entries_array) = value
                    .get_mut("hooks")
                    .and_then(|h| h.get_mut(trigger))
                    .and_then(|t| t.as_array_mut())
                {
                    entries_array[index]["command"] = serde_json::Value::String(command);
                }
            }
        }
        HookEntryMatch::Absent => {
            // Same absolute-path guard, applied to fresh creation: a
            // fresh entry has no prior command to fall back on, so
            // skipping the push here leaves the trigger's array with no
            // matching entry. `verify_agent_spawn_hook_command`
            // degrades that to a non-fatal warning (see this module's
            // header comment). `value`'s `hooks` structure is only
            // created/mutated past this guard.
            if exe_is_absolute {
                let Some(root_obj) = value.as_object_mut() else {
                    return;
                };
                let hooks = root_obj
                    .entry("hooks")
                    .or_insert_with(|| serde_json::Value::Object(serde_json::Map::new()));
                let Some(hooks_obj) = hooks.as_object_mut() else {
                    return;
                };
                let entries = hooks_obj
                    .entry(trigger)
                    .or_insert_with(|| serde_json::Value::Array(Vec::new()));
                let Some(entries_array) = entries.as_array_mut() else {
                    return;
                };
                entries_array.push(serde_json::json!({ "command": command }));
            }
        }
    }
}

/// Confirms `value["hooks"][trigger]` carries an entry whose stable
/// command suffix ends with `__telemetry-hook agent-invocation`.
fn hooks_array_has_telemetry_entry(value: &serde_json::Value, trigger: &str) -> bool {
    let entries = value
        .get("hooks")
        .and_then(|hooks| hooks.get(trigger))
        .and_then(|entries| entries.as_array());
    entries.is_some_and(|entries| {
        entries.iter().any(|entry| {
            entry
                .get("command")
                .and_then(|c| c.as_str())
                .is_some_and(|c| {
                    super::claude_settings::stable_hook_command_suffix(c).is_some_and(|suffix| {
                        suffix.ends_with(&format!(
                            "__telemetry-hook {}",
                            crate::cli::telemetry_hook::AGENT_INVOCATION
                        ))
                    })
                })
        })
    })
}

/// Checks `hooks_array_has_telemetry_entry` above and, when it comes
/// back `false`, tells apart the two reasons that can happen:
///
/// - `current_exe()` could not be resolved to a genuine absolute path
///   this run (re-checked here, since `apply_all` runs `rewrite` and
///   `verify` back-to-back against the same `value`). The missing entry
///   is the expected consequence of that transient, environment-level
///   condition, so this degrades to a non-fatal warning and `Ok(())`,
///   matching how `apply_v3_standalone_telemetry_hook_with_exe` and
///   `claude_settings.rs`'s `apply_claude_settings_grant_and_hooks`
///   treat the identical root cause.
/// - `current_exe()` resolved fine, yet the entry is still missing: the
///   agent file's own pre-existing `"hooks"`/`"hooks.<trigger>"` field
///   was not the JSON shape `merge_agent_spawn_hook` expects -- a real,
///   fixable problem with this agent's content, so this remains a hard
///   `Err` that fails the whole install.
fn verify_agent_spawn_hook_command(
    value: &serde_json::Value,
    trigger: &str,
    agent_file: &Path,
) -> Result<(), String> {
    verify_agent_spawn_hook_command_with_exe(
        value,
        trigger,
        agent_file,
        &super::claude_settings::resolve_konductor_exe_path(),
    )
}

/// Same as `verify_agent_spawn_hook_command`, but takes the resolved
/// `konductor` exe path as a parameter rather than resolving it
/// internally -- lets a test exercise the non-fatal-degradation branch
/// deterministically, without needing to force a real
/// `std::env::current_exe()` failure (not reproducible from within a
/// test process).
fn verify_agent_spawn_hook_command_with_exe(
    value: &serde_json::Value,
    trigger: &str,
    agent_file: &Path,
    exe: &str,
) -> Result<(), String> {
    if hooks_array_has_telemetry_entry(value, trigger) {
        return Ok(());
    }
    if !super::claude_settings::is_resolved_absolute_exe_path(exe) {
        eprintln!(
            "konductor install: warning: telemetry hook wiring skipped for agent '{}' \
             (hooks.{trigger}, __telemetry-hook {}) -- could not resolve the running \
             konductor binary's own absolute path (current_exe() failed); the rest of this \
             install is unaffected",
            agent_file.display(),
            crate::cli::telemetry_hook::AGENT_INVOCATION,
        );
        return Ok(());
    }
    Err(format!(
        "agent '{}' was supposed to have a telemetry hook wired into hooks.{trigger}, but no \
         entry invoking '__telemetry-hook {}' is present -- this means the agent file's \
         pre-existing \"hooks\" or \"hooks.{trigger}\" field is not the JSON shape this pass \
         expects (an object and an array, respectively) -- fix the agent file's hooks shape \
         (or remove the hand-edited override) and run `konductor install` again",
        agent_file.display(),
        crate::cli::telemetry_hook::AGENT_INVOCATION,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn matches_only_ctx() -> RewriteContext<'static> {
        RewriteContext {
            context_dir: Path::new(""),
            skills_dir: Path::new(""),
            bin_dir: Path::new(""),
            bin_files: &[],
            agent_sop_names: empty_map(),
            agent_skill_names: empty_map(),
        }
    }

    fn empty_map() -> &'static std::collections::HashMap<String, Vec<String>> {
        static EMPTY: std::sync::OnceLock<std::collections::HashMap<String, Vec<String>>> =
            std::sync::OnceLock::new();
        EMPTY.get_or_init(std::collections::HashMap::new)
    }

    // ── matches() is unconditional ───────────────────────────────────

    #[test]
    fn telemetry_hook_pass_matches_every_agent_regardless_of_content() {
        assert!(TelemetryHookPass.matches(&serde_json::json!({}), &matches_only_ctx()));
        assert!(TelemetryHookPass.matches(
            &serde_json::json!({"name": "k-example", "resources": []}),
            &matches_only_ctx()
        ));
    }

    // ── V2: fresh creation, trigger name, no matcher ─────────────────

    #[test]
    fn v2_rewrite_creates_hooks_agent_spawn_fresh() {
        let mut value = serde_json::json!({"name": "k-example"});
        merge_agent_spawn_hook(
            &mut value,
            AGENT_SPAWN_TRIGGER_V2,
            "/usr/local/bin/konductor",
        );
        assert_eq!(
            value["hooks"]["agentSpawn"],
            serde_json::json!([{"command": "/usr/local/bin/konductor __telemetry-hook agent-invocation"}])
        );
    }

    #[test]
    fn v2_rewrite_creates_hooks_fresh_through_full_pass() {
        let mut value = serde_json::json!({"name": "k-example"});
        let ctx = matches_only_ctx();
        TelemetryHookPass.rewrite(&mut value, &ctx);
        assert!(
            value["hooks"]["agentSpawn"].is_array(),
            "the agent-invocation entry must be present, got: {value:?}"
        );
    }

    // ── Idempotent reinstall: no duplicate entry on a second merge ───

    #[test]
    fn v2_rewrite_is_idempotent_across_two_merges() {
        let mut value = serde_json::json!({});
        merge_agent_spawn_hook(
            &mut value,
            AGENT_SPAWN_TRIGGER_V2,
            "/usr/local/bin/konductor",
        );
        merge_agent_spawn_hook(
            &mut value,
            AGENT_SPAWN_TRIGGER_V2,
            "/usr/local/bin/konductor",
        );
        assert_eq!(
            value["hooks"]["agentSpawn"].as_array().unwrap().len(),
            1,
            "a second merge with the same resolved exe path must not duplicate the entry"
        );
    }

    // ── Self-heal: a relocated binary rewrites the stale entry in place ──

    #[test]
    fn rewrite_self_heals_a_relocated_binarys_stale_command() {
        let mut value = serde_json::json!({
            "hooks": {
                "agentSpawn": [
                    {"command": "/old/relocated/path/to/konductor __telemetry-hook agent-invocation"}
                ]
            }
        });
        merge_agent_spawn_hook(
            &mut value,
            AGENT_SPAWN_TRIGGER_V2,
            "/new/current/path/konductor",
        );
        let entries = value["hooks"]["agentSpawn"].as_array().unwrap();
        assert_eq!(
            entries.len(),
            1,
            "self-heal must rewrite the existing entry in place, never append a duplicate"
        );
        assert_eq!(
            entries[0]["command"],
            serde_json::json!("/new/current/path/konductor __telemetry-hook agent-invocation")
        );
    }

    #[test]
    fn rewrite_never_downgrades_an_absolute_command_to_a_non_absolute_fallback() {
        let mut value = serde_json::json!({
            "hooks": {
                "agentSpawn": [
                    {"command": "/already/correct/konductor __telemetry-hook agent-invocation"}
                ]
            }
        });
        merge_agent_spawn_hook(&mut value, AGENT_SPAWN_TRIGGER_V2, "konductor");
        let entries = value["hooks"]["agentSpawn"].as_array().unwrap();
        assert_eq!(entries.len(), 1, "must not append a duplicate entry");
        assert_eq!(
            entries[0]["command"],
            serde_json::json!("/already/correct/konductor __telemetry-hook agent-invocation"),
            "the already-absolute entry must survive untouched, not be downgraded to the bare \
             fallback"
        );
    }

    #[test]
    fn rewrite_skips_fresh_creation_when_exe_is_the_bare_fallback() {
        let mut value = serde_json::json!({});
        merge_agent_spawn_hook(&mut value, AGENT_SPAWN_TRIGGER_V2, "konductor");
        assert_eq!(
            value,
            serde_json::json!({}),
            "a non-absolute exe path must not create a hooks key at all, let alone a fresh entry"
        );
        assert!(verify_agent_spawn_hook_command(
            &value,
            AGENT_SPAWN_TRIGGER_V2,
            Path::new("/tmp/agent.json")
        )
        .is_err());
    }

    // ── V2/V3 parity: a current_exe()-unresolvable missing entry is
    //    non-fatal ────────────────────────────────────────────────────

    #[test]
    fn verify_agent_spawn_hook_command_degrades_gracefully_like_v3_when_exe_is_unresolved() {
        let value = serde_json::json!({});
        assert!(
            verify_agent_spawn_hook_command_with_exe(
                &value,
                AGENT_SPAWN_TRIGGER_V2,
                Path::new("/tmp/agent.json"),
                "konductor",
            )
            .is_ok(),
            "a current_exe()-unresolvable missing entry must be a non-fatal warning, not an \
             install-aborting Err, matching V3/Claude Code's own handling of this exact \
             condition"
        );
    }

    #[test]
    fn verify_agent_spawn_hook_command_with_exe_still_errors_when_exe_is_absolute_and_entry_is_missing(
    ) {
        let value = serde_json::json!({"name": "k-example"});
        let err = verify_agent_spawn_hook_command_with_exe(
            &value,
            AGENT_SPAWN_TRIGGER_V2,
            Path::new("/tmp/agent.json"),
            "/usr/local/bin/konductor",
        )
        .expect_err("a resolvable exe with a missing entry is the genuine malformed-shape case");
        assert!(err.contains("hooks.agentSpawn"));
    }

    // ── Defensive no-op on malformed pre-existing shape ──────────────

    #[test]
    fn rewrite_leaves_value_untouched_when_hooks_key_is_not_an_object() {
        let mut value = serde_json::json!({"hooks": "not-an-object"});
        merge_agent_spawn_hook(
            &mut value,
            AGENT_SPAWN_TRIGGER_V2,
            "/usr/local/bin/konductor",
        );
        assert_eq!(
            value,
            serde_json::json!({"hooks": "not-an-object"}),
            "a malformed pre-existing \"hooks\" key must be left untouched, not clobbered"
        );
    }

    #[test]
    fn rewrite_leaves_value_untouched_when_trigger_array_is_not_an_array() {
        let mut value = serde_json::json!({"hooks": {"agentSpawn": "not-an-array"}});
        merge_agent_spawn_hook(
            &mut value,
            AGENT_SPAWN_TRIGGER_V2,
            "/usr/local/bin/konductor",
        );
        assert_eq!(
            value,
            serde_json::json!({"hooks": {"agentSpawn": "not-an-array"}}),
            "a malformed pre-existing \"hooks.agentSpawn\" key must be left untouched"
        );
    }

    // ── verify(): the CRITICAL check that turns the no-op into an Err ─

    #[test]
    fn verify_ok_after_a_real_rewrite() {
        let mut value = serde_json::json!({});
        merge_agent_spawn_hook(
            &mut value,
            AGENT_SPAWN_TRIGGER_V2,
            "/usr/local/bin/konductor",
        );
        verify_agent_spawn_hook_command(
            &value,
            AGENT_SPAWN_TRIGGER_V2,
            Path::new("/tmp/agent.json"),
        )
        .expect("verify must succeed immediately after a real rewrite");
    }

    #[test]
    fn verify_errors_when_rewrite_no_opd_on_malformed_hooks_key() {
        let value = serde_json::json!({"hooks": "not-an-object"});
        let err = verify_agent_spawn_hook_command(
            &value,
            AGENT_SPAWN_TRIGGER_V2,
            Path::new("/tmp/agent.json"),
        )
        .expect_err("verify must fail the whole install when rewrite could not wire the hook");
        assert!(err.contains("hooks.agentSpawn"));
    }

    #[test]
    fn verify_errors_when_hooks_key_entirely_absent() {
        let value = serde_json::json!({"name": "k-example"});
        assert!(verify_agent_spawn_hook_command(
            &value,
            AGENT_SPAWN_TRIGGER_V2,
            Path::new("/tmp/agent.json")
        )
        .is_err());
    }

    // ── End-to-end through apply_all/ResourceRewritePass trait (V2) ──

    #[test]
    fn apply_all_style_rewrite_then_verify_round_trip_for_v2() {
        let mut value = serde_json::json!({"name": "k-example"});
        let ctx = matches_only_ctx();
        assert!(TelemetryHookPass.matches(&value, &ctx));
        TelemetryHookPass.rewrite(&mut value, &ctx);
        TelemetryHookPass
            .verify(&value, &ctx, Path::new("/tmp/agent.json"))
            .expect("verify must succeed after rewrite");
        assert!(value["hooks"]["agentSpawn"].is_array());
    }

    // ── V3: standalone hooks file ─────────────────────────────────────

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-v3-standalone-hook-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn v3_standalone_hook_document_uses_session_start_trigger() {
        let document = build_v3_standalone_hook_document(
            "/usr/local/bin/konductor __telemetry-hook agent-invocation".to_string(),
        );
        assert_eq!(
            document["hooks"][0]["trigger"],
            serde_json::json!("SessionStart")
        );
        assert_eq!(document["hooks"][0]["enabled"], serde_json::json!(true));
    }

    #[test]
    fn v3_standalone_hook_document_golden_exact_shape() {
        let document = build_v3_standalone_hook_document(
            "/opt/konductor/bin/konductor __telemetry-hook agent-invocation".to_string(),
        );
        assert_eq!(
            document,
            serde_json::json!({
                "version": "v1",
                "hooks": [
                    {
                        "name": "konductor-telemetry-session-start",
                        "trigger": "SessionStart",
                        "action": {
                            "type": "command",
                            "command": "/opt/konductor/bin/konductor __telemetry-hook agent-invocation"
                        },
                        "enabled": true
                    }
                ]
            })
        );
    }

    #[test]
    fn v3_standalone_hook_file_written_fresh_at_documented_path() {
        let dir = scratch_dir("fresh");
        let bytes = write_v3_standalone_telemetry_hook_file(&dir, "/usr/local/bin/konductor")
            .expect("write must succeed on a fresh target");
        let on_disk = std::fs::read(dir.join(V3_STANDALONE_HOOKS_RELATIVE_PATH))
            .expect("the file must exist at the documented relative path");
        assert_eq!(
            bytes, on_disk,
            "returned bytes must match what was actually written"
        );
        let parsed: serde_json::Value = serde_json::from_slice(&on_disk).unwrap();
        assert_eq!(
            parsed["hooks"][0]["action"]["command"],
            serde_json::json!("/usr/local/bin/konductor __telemetry-hook agent-invocation")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn v3_standalone_hook_file_reinstall_is_idempotent_no_duplicate_entry_or_file() {
        let dir = scratch_dir("idempotent");
        let first = write_v3_standalone_telemetry_hook_file(&dir, "/usr/local/bin/konductor")
            .expect("first write must succeed");
        let second = write_v3_standalone_telemetry_hook_file(&dir, "/usr/local/bin/konductor")
            .expect("second write (reinstall) must succeed");
        assert_eq!(
            first, second,
            "reinstalling with the same exe must reproduce identical bytes"
        );

        let parsed: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.join(V3_STANDALONE_HOOKS_RELATIVE_PATH)).unwrap(),
        )
        .unwrap();
        assert_eq!(
            parsed["hooks"].as_array().unwrap().len(),
            1,
            "reinstalling must never duplicate the hook entry within the file"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn v3_standalone_hook_file_self_heals_a_relocated_binary() {
        let dir = scratch_dir("relocated");
        write_v3_standalone_telemetry_hook_file(&dir, "/old/relocated/path/konductor")
            .expect("first write must succeed");
        write_v3_standalone_telemetry_hook_file(&dir, "/new/current/path/konductor")
            .expect("second write after relocation must succeed");

        let parsed: serde_json::Value = serde_json::from_slice(
            &std::fs::read(dir.join(V3_STANDALONE_HOOKS_RELATIVE_PATH)).unwrap(),
        )
        .unwrap();
        let hooks = parsed["hooks"].as_array().unwrap();
        assert_eq!(
            hooks.len(),
            1,
            "must not append a second copy of the entry for a relocated binary"
        );
        assert_eq!(
            hooks[0]["action"]["command"],
            serde_json::json!("/new/current/path/konductor __telemetry-hook agent-invocation")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_v3_standalone_telemetry_hook_returns_documented_path_and_valid_sha256() {
        let dir = scratch_dir("apply");
        let (path, sha256) =
            apply_v3_standalone_telemetry_hook(&dir).expect("apply must succeed on a fresh target");
        assert_eq!(path, V3_STANDALONE_HOOKS_RELATIVE_PATH);
        assert_eq!(sha256.len(), 64, "sha256 hex digest must be 64 chars");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn apply_v3_standalone_telemetry_hook_refuses_the_bare_fallback_exe() {
        let dir = scratch_dir("apply-bare-fallback");
        let err = apply_v3_standalone_telemetry_hook_with_exe(&dir, "konductor")
            .expect_err("a non-absolute exe path must be refused, not written");
        assert!(err.contains("current_exe"));
        assert!(
            !dir.join(V3_STANDALONE_HOOKS_RELATIVE_PATH).exists(),
            "the standalone hook file must not be created when the guard refuses the write"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_v3_standalone_telemetry_hook_file_contends_with_a_concurrent_writer() {
        let dir = scratch_dir("lock-contention");
        let hooks_dir = dir.join(".kiro/hooks");
        let _held =
            crate::cli::config_lock::acquire_named(&hooks_dir, V3_STANDALONE_HOOK_LOCK_FILE_NAME)
                .expect("the test's own lock acquisition must succeed while nothing else holds it");

        let err = write_v3_standalone_telemetry_hook_file(&dir, "/usr/local/bin/konductor")
            .expect_err("a concurrent writer must be refused while the lock is held");
        assert!(err.contains("failed to lock"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
