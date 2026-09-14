// SPDX-License-Identifier: Apache-2.0
//
// dispatch.rs — command dispatch for the Konductor CLI (Rust implementation).
//
// Structural extraction of the top-level `match command { ... }` out of
// cli.rs::run() into its own module, so cli.rs stays focused on argument
// parsing / the command surface, and dispatch stays focused on "what each
// parsed command does." Init/Config's exit-code behavior is unchanged;
// Install/Synth gained a new resolve_cwd()-failure exit path (EXIT_USAGE_ERROR)
// they did not have as inline stub arms. Install no longer resolves cwd at
// all -- its destination comes from `--target`/`$HOME` (see install.rs's
// `resolve_destination`), independent of the process's cwd.
//
// TODO(design): this is a static `match` over a fixed `Commands` enum, not
// a dynamic Command+Strategy registry. That is intentional at this
// milestone, not an oversight — the rationale: the conformance harness
// depends on `__dump_schema` reflecting the *static* command tree clap
// derives from `Commands`, and a dynamic registry would risk that
// introspection for no payoff at 8 stub commands. Revisit once commands
// have real (non-stub) behavior and/or the command count grows enough
// that a registry's indirection starts paying for itself.

use std::path::PathBuf;

use crate::cli::{config, init, Commands, ConfigAction};

/// Entry point called by `cli::run()` once argument parsing has produced a
/// concrete `command` to dispatch. `Init`, `Config`, `Install`, `Synth`,
/// and `Doctor` have real behavior (see cli/init.rs, cli/config.rs,
/// cli/install.rs, cli/synth/mod.rs, cli/doctor.rs); every other command
/// is a stub.
///
/// `verbose`/`json` (the global `-v`/`--json` flags) are threaded through
/// to `Install`/`Synth`/`Doctor` only -- the commands with real,
/// reportable output at this milestone. Every other arm ignores them; a
/// future stub-to-real transition should thread them to its own arm the
/// same way, not add a new flag.
///
/// Returns the raw numeric exit code rather than `std::process::ExitCode`
/// (which offers no way to read the value back out again) so callers can
/// both log the code and construct the real `ExitCode` from it.
pub fn dispatch(command: Commands, verbose: bool, json: bool) -> u8 {
    // TODO(design): static match, not a dynamic Command+Strategy registry.
    // See the module header above for the rationale (conformance harness
    // depends on the static command tree).
    match command {
        Commands::Install {
            from,
            target,
            harness,
            link_bin,
            no_telemetry,
            use_github_token,
        } => crate::cli::install::dispatch_install_with(
            from,
            target,
            harness,
            link_bin,
            no_telemetry,
            use_github_token,
            verbose,
            json,
        ),
        Commands::Update {
            from,
            target,
            all,
            no_telemetry,
        } => {
            crate::cli::update::dispatch_update_with(from, target, all, no_telemetry, verbose, json)
        }
        Commands::Uninstall { target, all, yes } => {
            crate::cli::uninstall::dispatch_uninstall(target, all, yes, json)
        }
        Commands::Synth { from } => {
            let cwd = match resolve_cwd_reporting_json("synth", json) {
                Ok(dir) => dir,
                Err(code) => return code,
            };
            crate::cli::synth::dispatch_synth_with(&cwd, from, verbose, json)
        }
        Commands::Init { preset, force } => {
            let cwd = match resolve_cwd("init") {
                Ok(dir) => dir,
                Err(code) => return code,
            };
            dispatch_init(&cwd, preset, force)
        }
        Commands::Doctor { from, target, all } => crate::cli::doctor::dispatch_doctor_with(
            &match resolve_cwd_reporting_json("doctor", json) {
                Ok(dir) => dir,
                Err(code) => return code,
            },
            from,
            target,
            all,
            verbose,
            json,
            std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .as_deref(),
        ),
        Commands::Config { action } => {
            let cwd = match resolve_cwd("config") {
                Ok(dir) => dir,
                Err(code) => return code,
            };
            dispatch_config(&cwd, action)
        }
        Commands::Metrics { since } => {
            print_not_implemented("metrics", &[("--since", opt(&since))]);
            0
        }
        Commands::DumpSchema => {
            println!("{}", crate::cli::schema::dump_schema_json());
            0
        }
        Commands::TelemetryHook { event_type } => {
            // Unlike every other arm above, a cwd-resolution failure
            // here must never surface at all: the `__telemetry-hook`
            // contract (see telemetry_hook.rs's module docstring)
            // requires this subcommand's own failures stay invisible
            // to the harness that invoked it -- no stderr output, no
            // telemetry event, not just a suppressed exit code.
            // `resolve_cwd()` cannot be reused here (even with its
            // `Err` discarded) because it unconditionally prints to
            // stderr and fires a `dispatch.cwd_unavailable` `cli_error`
            // event as side effects of producing that `Err` -- both
            // visible before this arm ever sees the return value.
            // Resolve cwd directly instead, falling back to `$HOME`
            // (the same scope-agnostic identity lookup `resolve_cwd`
            // itself falls back to) with no side effects either way.
            let cwd = std::env::current_dir().unwrap_or_else(|_| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .unwrap_or_default()
            });
            crate::cli::telemetry_hook::dispatch_telemetry_hook(&cwd, &event_type);
            0
        }
    }
}

/// Resolves the current working directory, shared by every dispatch arm
/// that needs a `target_dir` to pass into a real (non-stub) command
/// handler. On failure, prints the same error message every call site
/// used before this was extracted (the bare `konductor:
/// <message>` prefix -- this path is command-agnostic, so it never
/// gets the `konductor {command}: ` form other errors use), fires a
/// `dispatch.cwd_unavailable` telemetry event against
/// `$HOME` -- the closest scope-agnostic identity lookup available when
/// cwd itself cannot be resolved -- and returns `EXIT_USAGE_ERROR`.
///
/// `command` is the ACTUAL subcommand this call is being made on behalf
/// of (`"synth"`/`"init"`/`"doctor"`/`"config"`) -- reported verbatim as
/// `report_cli_error`'s own `command` argument (which becomes the wire
/// event's `targetName`), not the literal string `"dispatch"`.
/// `docs/telemetry-schema.json`'s own `targetName` description for
/// `cli_error` events enumerates exactly `init/install/update/uninstall/
/// synth/doctor/config` -- `"dispatch"` is not one of them, and every
/// one of Synth/Init/Doctor/Config's distinct cwd-resolution failures
/// collapsing onto that one non-enumerated value made them
/// indistinguishable from each other AND schema-invalid. Passing the
/// real subcommand name here keeps this shared helper's own error
/// event attributed to whichever command actually failed -- this is
/// deliberately NOT the same value the plain-text prefix above uses
/// (which stays command-agnostic); see
/// `resolve_cwd_reporting_json`'s own doc comment for why its `--json`
/// envelope's `command` field diverges from this telemetry attribution
/// the same way.
fn resolve_cwd(command: &str) -> Result<PathBuf, u8> {
    let cwd = std::env::current_dir().map_err(|err| {
        eprintln!("konductor: could not determine the current directory: {err}");
        let home_dir_fallback = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_default();
        crate::cli::telemetry::report_cli_error(
            &home_dir_fallback,
            command,
            "dispatch.cwd_unavailable",
            false,
        );
        EXIT_USAGE_ERROR
    })?;
    crate::cli::trace::trace(
        "trace",
        &format!("resolved current working directory to {}", cwd.display()),
    );
    Ok(cwd)
}

/// Json-aware variant of `resolve_cwd()`, used by the `Synth`/`Doctor`
/// arms above, which report through the `--json` error envelope.
/// `resolve_cwd()` itself always prints its plain-text message
/// unconditionally, so it cannot be reused as-is when `--json` is set
/// (that would print the plain-text line to stderr as well as the
/// envelope to stdout). `Init`/`Config` do not take part in the
/// `--json` envelope at this milestone and keep calling `resolve_cwd()`
/// directly, unaffected by this function.
///
/// `command` is the real subcommand (`"synth"`/`"doctor"`), passed
/// through to the non-`--json` branch's `resolve_cwd(command)` call
/// unchanged. The `--json` branch below does NOT reuse that same value
/// for the envelope: `resolve_cwd()` failing is one of the
/// command-agnostic paths, so the envelope's own `"command"`
/// field stays the literal string
/// `"konductor"`, matching the same bare `konductor: <message>`
/// prefix for the same path -- NOT `command`, which is reserved for
/// telemetry attribution here (see below). This is exactly why this
/// branch calls `crate::cli::telemetry::report_cli_error` directly
/// instead of going through `report.rs::report_error`: that shared
/// helper's single `command` parameter drives BOTH the envelope's
/// `"command"` field AND the telemetry event's attribution, and here
/// those two deliberately diverge (`"konductor"` vs. the real
/// subcommand) -- a divergence `report_error` has no way to express.
fn resolve_cwd_reporting_json(command: &str, json: bool) -> Result<PathBuf, u8> {
    if !json {
        return resolve_cwd(command);
    }
    match std::env::current_dir() {
        Ok(cwd) => {
            crate::cli::trace::trace(
                "trace",
                &format!("resolved current working directory to {}", cwd.display()),
            );
            Ok(cwd)
        }
        Err(err) => {
            let message = format!("could not determine the current directory: {err}");
            println!(
                "{}",
                crate::cli::report::build_error_json("konductor", &message, Vec::new())
            );
            let home_dir_fallback = std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_default();
            crate::cli::telemetry::report_cli_error(
                &home_dir_fallback,
                command,
                "dispatch.cwd_unavailable",
                false,
            );
            Err(EXIT_USAGE_ERROR)
        }
    }
}

/// `konductor init [--preset ...] [--force]`: scaffolds `.konductor/` in
/// `target_dir` (the current working directory in real use; passed
/// explicitly rather than resolved internally so tests can point at a
/// scratch directory without mutating the process-global cwd via
/// `std::env::set_current_dir`, which is unsafe to do from parallel
/// `cargo test` threads). `preset` is accepted and echoed for forward
/// compatibility (a future milestone may vary the starter config by
/// preset) but does not yet change the scaffolded output -- every preset
/// produces the same starter `.konductor/config.yml` at this milestone,
/// since cli/gate-config/config.yml does not yet define per-preset
/// variants.
///
/// Exit-code contract: any `InitError` is a USAGE ERROR (64), never exit
/// code 2 -- see cli/init.rs's module docstring.
fn dispatch_init(target_dir: &std::path::Path, preset: Option<String>, force: bool) -> u8 {
    match init::run_init(target_dir, force) {
        Ok(result) => {
            println!(
                "Initialized Konductor project at {}",
                result.konductor_dir.display()
            );
            println!("Wrote starter config: {}", result.config_path.display());
            if result.gitignore_written {
                println!("Wrote gitignore: {}", result.gitignore_path.display());
            } else {
                println!(
                    "Gitignore already exists, left untouched: {}",
                    result.gitignore_path.display()
                );
            }
            if let Some(preset) = preset {
                println!("(preset '{preset}' requested; all presets currently produce the same starter config)");
            }
            0
        }
        Err(err) => {
            eprintln!("konductor init: {err}");
            crate::cli::telemetry::report_cli_error(target_dir, "init", err.error_code(), false);
            EXIT_USAGE_ERROR
        }
    }
}

/// `konductor config get/set/list`: reads the effective merged
/// configuration (`target_dir`'s `.konductor/config.yml` over the preset
/// defaults) via cli/config.rs. `target_dir` is passed explicitly for the
/// same test-isolation reason as `dispatch_init` above.
///
/// `Set` is handled FIRST, before any call to `load_config`: it writes
/// the new value back to `.konductor/config.yml` atomically via
/// `config::set_config_value`, which already performs its own internal
/// load/merge/validate/write cycle. Gating `Set` behind a prior
/// `load_config` call would reject `config set` outright on an existing
/// config.yml that already has a validation error -- even when the
/// value being set is exactly what would fix that error. `Get`/`List`
/// have their own load path, so they still call `load_config` up front,
/// preserving their existing pre-load-and-validate behavior.
///
/// Exit-code contract: a `ConfigError` (malformed/invalid config,
/// unknown key, invalid value, or write failure) is a USAGE ERROR (64),
/// never exit code 2 -- see cli/config.rs's module docstring.
fn dispatch_config(target_dir: &std::path::Path, action: ConfigAction) -> u8 {
    if let ConfigAction::Set { key, value } = &action {
        return match config::set_config_value(target_dir, key, value) {
            Ok(_) => {
                println!("Set {key} = {value}");
                0
            }
            Err(err) => {
                eprintln!("konductor config: {err}");
                crate::cli::telemetry::report_cli_error(
                    target_dir,
                    "config",
                    err.error_code(),
                    false,
                );
                EXIT_USAGE_ERROR
            }
        };
    }

    let loaded = match config::load_config(target_dir) {
        Ok(config) => config,
        Err(err) => {
            eprintln!("konductor config: {err}");
            crate::cli::telemetry::report_cli_error(target_dir, "config", err.error_code(), false);
            return EXIT_USAGE_ERROR;
        }
    };

    match action {
        ConfigAction::Get { key } => match get_field(&loaded, &key) {
            Some(value) => {
                println!("{value}");
                0
            }
            None => {
                eprintln!("konductor config: unknown config key '{key}'");
                crate::cli::telemetry::report_cli_error(
                    target_dir,
                    "config",
                    "dispatch.config_unknown_key",
                    false,
                );
                EXIT_USAGE_ERROR
            }
        },
        ConfigAction::List => {
            for (key, value) in list_fields(&loaded) {
                println!("{key} = {value}");
            }
            0
        }
        ConfigAction::Set { .. } => unreachable!("Set handled above"),
    }
}

/// Looks up a single dotted config key against the loaded `Config`. Only
/// the flat top-level field names are supported at this milestone (no
/// nested dotted paths exist yet in `Config`'s shape).
fn get_field(config: &config::Config, key: &str) -> Option<String> {
    match key {
        "version" => Some(config.version.to_string()),
        "severities_source" => Some(config.severities_source.clone()),
        "tiers_source" => Some(config.tiers_source.clone()),
        "tier" => Some(config.tier.clone()),
        "default_severity" => Some(config.default_severity.clone()),
        "fail_on_severity_at_or_above" => Some(config.fail_on_severity_at_or_above.clone()),
        _ => None,
    }
}

/// All fields of the loaded `Config`, in a stable order, for `config
/// list`.
fn list_fields(config: &config::Config) -> Vec<(&'static str, String)> {
    vec![
        ("version", config.version.to_string()),
        ("severities_source", config.severities_source.clone()),
        ("tiers_source", config.tiers_source.clone()),
        ("tier", config.tier.clone()),
        ("default_severity", config.default_severity.clone()),
        (
            "fail_on_severity_at_or_above",
            config.fail_on_severity_at_or_above.clone(),
        ),
    ]
}

/// Remapped exit code for CLI usage errors, matching cli.rs's own
/// `EXIT_USAGE_ERROR` constant. Duplicated here (rather than imported)
/// because cli.rs's constant is private to that module; both must stay
/// equal to 64 -- enforced by cli.rs's own
/// `usage_error_exit_code_is_not_critical_gate` test plus this module's
/// tests below exercising real 64-returning paths.
const EXIT_USAGE_ERROR: u8 = 64;

fn opt(value: &Option<String>) -> String {
    match value {
        Some(v) => v.clone(),
        None => "<none>".to_string(),
    }
}

fn print_not_implemented(command: &str, args: &[(&str, String)]) {
    print!("konductor {command}: not yet implemented");
    if !args.is_empty() {
        print!(" (");
        print!(
            "{}",
            args.iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
        print!(")");
    }
    println!();
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser as _;
    use std::fs;
    use std::path::PathBuf;

    // Some `config get`/`config list` tests below exercise `dispatch_config`
    // end to end, which calls `config::load_config` internally -- that
    // function reads the real process-global `HOME` env var
    // (`config::dirs_home_dir`). Reading `HOME` concurrently with another
    // test's `set_var`/`remove_var` (install.rs/uninstall.rs/update.rs/
    // logging.rs's `HomeGuard`-holding tests) is a data race under
    // `cargo test`'s default parallelism -- see `test_home_lock`'s own
    // doc comment. Every test in this module that reaches `load_config`
    // (directly or via `dispatch_config`) must take this crate-wide lock.
    use crate::cli::test_home_lock::lock_home;

    fn scratch_cwd(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-dispatch-test-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Guards this module's own duplicated `EXIT_USAGE_ERROR` constant
    /// against silent drift from cli.rs's canonical value (64).
    #[test]
    fn exit_usage_error_constant_is_64() {
        assert_eq!(EXIT_USAGE_ERROR, 64);
    }

    /// `resolve_cwd()` returns `Ok` with a real, existing directory under
    /// normal conditions. Only the success path is covered: there is no
    /// portable way to force `std::env::current_dir()` to fail from a
    /// `cargo test` thread (a deleted-cwd trick works on some Unix
    /// targets but is process-global state, unsafe to mutate from
    /// parallel test threads, and not portable to Windows).
    #[test]
    fn resolve_cwd_succeeds_with_an_existing_directory() {
        let result = resolve_cwd("synth");
        assert!(result.is_ok(), "resolve_cwd() must succeed: {result:?}");
        assert!(
            result.unwrap().is_dir(),
            "resolve_cwd() must return a real, existing directory"
        );
    }

    #[test]
    fn dispatch_init_then_config_list_round_trips() {
        // `ConfigAction::List` reaches `config::load_config`, which reads
        // the real $HOME -- see this module's `lock_home` import comment.
        let _lock = lock_home();
        let target = scratch_cwd("round-trip");

        let init_code = dispatch_init(&target, None, false);
        assert_eq!(init_code, 0, "init on an empty target must succeed");

        let list_code = dispatch_config(&target, ConfigAction::List);
        assert_eq!(
            list_code, 0,
            "config list must succeed against a freshly-initialized project"
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_init_without_force_on_existing_dir_is_usage_error() {
        let target = scratch_cwd("clobber-guard");

        assert_eq!(dispatch_init(&target, None, false), 0);
        assert_eq!(dispatch_init(&target, None, false), EXIT_USAGE_ERROR);

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_persists_value_and_succeeds() {
        // `config set` moved from stub (always EXIT_USAGE_ERROR) to real
        // behavior: a valid key/value must now succeed (exit 0) and the
        // written value must round-trip through `config get`.
        //
        // The round-trip check below calls `config::load_config` directly,
        // which reads the real $HOME -- see this module's `lock_home`
        // import comment.
        let _lock = lock_home();
        let target = scratch_cwd("config-set-real");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let set_code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "default_severity".to_string(),
                value: "LOW".to_string(),
            },
        );
        assert_eq!(set_code, 0, "a valid config set must succeed");
        assert_ne!(
            set_code, 2,
            "must never emit the reserved CRITICAL-gate code"
        );

        let loaded = config::load_config(&target).expect("config must still load after set");
        assert_eq!(loaded.default_severity, "LOW");

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_unknown_key_is_usage_error_not_critical_gate() {
        let target = scratch_cwd("config-set-unknown-key");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "not_a_real_field".to_string(),
                value: "anything".to_string(),
            },
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_invalid_value_is_usage_error_not_critical_gate() {
        let target = scratch_cwd("config-set-invalid-value");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "default_severity".to_string(),
                value: "NOT_A_SEVERITY".to_string(),
            },
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_fixes_the_broken_field_on_an_already_invalid_config() {
        // A `.konductor/config.yml` that already fails validation (a
        // valid `default_severity` but an OUT-OF-ENUM
        // `fail_on_severity_at_or_above`) must still allow `config set`
        // to fix the broken field, rather than being rejected by a
        // whole-config re-validation before the fix is even applied.
        //
        // The post-fix check below calls `config::load_config` directly,
        // which reads the real $HOME -- see this module's `lock_home`
        // import comment.
        let _lock = lock_home();
        let target = scratch_cwd("config-set-fixes-broken-field");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let config_path = target
            .join(config::KONDUCTOR_DIR_NAME)
            .join(config::CONFIG_FILE_NAME);
        fs::write(
            &config_path,
            "version: 1\ndefault_severity: MEDIUM\nfail_on_severity_at_or_above: NOT_A_SEVERITY\n",
        )
        .unwrap();

        // `config set` on the actually-broken field, with a valid
        // value, must now SUCCEED (exit 0).
        let set_code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "fail_on_severity_at_or_above".to_string(),
                value: "LOW".to_string(),
            },
        );
        assert_eq!(
            set_code, 0,
            "config set must succeed when fixing the field that was invalid, even though \
             the config was already broken before this call"
        );
        assert_ne!(
            set_code, 2,
            "must never emit the reserved CRITICAL-gate code"
        );

        let loaded =
            config::load_config(&target).expect("config must now load cleanly after the fix");
        assert_eq!(loaded.default_severity, "MEDIUM");
        assert_eq!(loaded.fail_on_severity_at_or_above, "LOW");

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_get_and_list_still_reject_the_same_broken_config() {
        // Companion to the test above: confirms the `Set`-first
        // reordering did NOT accidentally weaken `Get`/`List`'s
        // pre-load-and-validate behavior. Against the SAME broken fixture
        // (valid `default_severity`, invalid
        // `fail_on_severity_at_or_above`), `config get` and `config
        // list` must still call `load_config` up front and correctly
        // fail with EXIT_USAGE_ERROR (64) -- never exit 0, and never the
        // reserved exit code 2.
        //
        // Both `Get` and `List` reach `config::load_config`, which reads
        // the real $HOME -- see this module's `lock_home` import comment.
        let _lock = lock_home();
        let target = scratch_cwd("config-get-list-reject-broken");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let config_path = target
            .join(config::KONDUCTOR_DIR_NAME)
            .join(config::CONFIG_FILE_NAME);
        fs::write(
            &config_path,
            "version: 1\ndefault_severity: MEDIUM\nfail_on_severity_at_or_above: NOT_A_SEVERITY\n",
        )
        .unwrap();

        let get_code = dispatch_config(
            &target,
            ConfigAction::Get {
                key: "default_severity".to_string(),
            },
        );
        assert_eq!(
            get_code, EXIT_USAGE_ERROR,
            "config get against an already-invalid config must still fail"
        );
        assert_ne!(
            get_code, 2,
            "must never emit the reserved CRITICAL-gate code"
        );

        let list_code = dispatch_config(&target, ConfigAction::List);
        assert_eq!(
            list_code, EXIT_USAGE_ERROR,
            "config list against an already-invalid config must still fail"
        );
        assert_ne!(
            list_code, 2,
            "must never emit the reserved CRITICAL-gate code"
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_unknown_key_does_not_write_config() {
        // `config set` on an unknown key must fail BEFORE touching disk
        // at all -- config.rs's `set_config_value` checks
        // `_CONFIG_FIELDS` membership up front, prior to any read/write.
        // Regression guard: an unknown-key rejection must never leave a
        // `.konductor/config.yml` behind that wasn't already there.
        let target = scratch_cwd("config-set-unknown-key-no-write");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let config_path = target
            .join(config::KONDUCTOR_DIR_NAME)
            .join(config::CONFIG_FILE_NAME);
        let before = fs::read(&config_path).unwrap();

        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "not_a_real_field".to_string(),
                value: "anything".to_string(),
            },
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        let after = fs::read(&config_path).unwrap();
        assert_eq!(
            before, after,
            "config.yml must be byte-identical after a rejected set"
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_invalid_value_does_not_write_config() {
        // Same guard as the unknown-key case above, but for a
        // known-key/wrong-type value: `apply_field`'s per-field
        // validation (and the subsequent re-`validate()` of the merged
        // config) must reject the write before `write_atomic` is ever
        // called.
        let target = scratch_cwd("config-set-invalid-value-no-write");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let config_path = target
            .join(config::KONDUCTOR_DIR_NAME)
            .join(config::CONFIG_FILE_NAME);
        let before = fs::read(&config_path).unwrap();

        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "default_severity".to_string(),
                value: "NOT_A_SEVERITY".to_string(),
            },
        );
        assert_eq!(code, EXIT_USAGE_ERROR);

        let after = fs::read(&config_path).unwrap();
        assert_eq!(
            before, after,
            "config.yml must be byte-identical after a rejected set"
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_leaves_no_leftover_tmp_file() {
        // Verifies `config set`'s atomic-write mechanics end-to-end:
        // after a successful `set`, no `.tmp-`-suffixed file
        // (atomic_write.rs's temp-file naming convention) remains in
        // `.konductor/`. Complements atomic_write.rs's own
        // `leaves_no_temp_file_behind_on_success` unit test by proving
        // the guarantee holds through the full `config set` call path.
        let target = scratch_cwd("config-set-no-leftover-tmp");

        assert_eq!(dispatch_init(&target, None, false), 0);
        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "default_severity".to_string(),
                value: "LOW".to_string(),
            },
        );
        assert_eq!(code, 0, "a valid config set must succeed");

        let konductor_dir = target.join(config::KONDUCTOR_DIR_NAME);
        let leftovers: Vec<_> = fs::read_dir(&konductor_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "no .tmp- files should remain in .konductor/ after a successful config set, found: {:?}",
            leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>()
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn get_field_and_list_fields_match_config_fields() {
        // Guards against get_field/list_fields drifting from
        // config::_CONFIG_FIELDS: both hand-type the same 6 field names
        // independently of that list, so a future field addition missed
        // here would otherwise only surface as a runtime `config get`/
        // `config list` gap, not a build/test failure.
        let sample = config::Config {
            version: 1,
            severities_source: String::new(),
            tiers_source: String::new(),
            tier: "full".to_string(),
            default_severity: "LOW".to_string(),
            fail_on_severity_at_or_above: "LOW".to_string(),
        };

        let declared: std::collections::BTreeSet<&str> =
            config::_CONFIG_FIELDS.iter().copied().collect();

        let get_field_keys: std::collections::BTreeSet<&str> = declared
            .iter()
            .filter(|key| get_field(&sample, key).is_some())
            .copied()
            .collect();
        assert_eq!(
            get_field_keys, declared,
            "get_field must recognize exactly config::_CONFIG_FIELDS's key set"
        );

        let list_field_keys: std::collections::BTreeSet<&str> = list_fields(&sample)
            .into_iter()
            .map(|(key, _)| key)
            .collect();
        assert_eq!(
            list_field_keys, declared,
            "list_fields must emit exactly config::_CONFIG_FIELDS's key set"
        );
    }

    #[test]
    fn config_get_set_list_help_text_no_longer_says_stub() {
        // `config get`/`set`/`list` used to be documented (and behave)
        // as stubs; now that all three perform real work, their clap
        // doc comments (which become `--help` text) must not claim
        // otherwise. Greps the ACTUAL rendered help text via clap's
        // `--help` output, so a doc-only edit that reintroduces stale
        // "(stub)"/"not yet supported" wording is caught the same way
        // a user reading `--help` would notice it.
        for args in [
            [
                "konductor",
                crate::cli::Commands::CONFIG,
                crate::cli::ConfigAction::GET,
                "--help",
            ],
            [
                "konductor",
                crate::cli::Commands::CONFIG,
                crate::cli::ConfigAction::SET,
                "--help",
            ],
            [
                "konductor",
                crate::cli::Commands::CONFIG,
                crate::cli::ConfigAction::LIST,
                "--help",
            ],
        ] {
            let err = crate::cli::Cli::try_parse_from(args)
                .expect_err("--help always returns a DisplayHelp \"error\"");
            let help_text = err.to_string();
            let lower = help_text.to_lowercase();
            assert!(
                !lower.contains("(stub)"),
                "{:?} --help text unexpectedly still says (stub): {help_text}",
                args
            );
            assert!(
                !lower.contains("not yet supported"),
                "{:?} --help text unexpectedly still says 'not yet supported': {help_text}",
                args
            );
        }
    }

    // ── `install --link-bin` end-to-end wiring ──────────────────────────
    //
    // These exercise the FULL `dispatch(Commands::Install { link_bin, .. })`
    // path (not just `install::bin_link`'s own unit tests, which inject a
    // home directory and exe path directly) -- confirming the real `$PATH`
    // symlink lands at `$HOME/.local/bin/konductor` for the real process
    // `$HOME`, and that `dispatch(Commands::Uninstall { .. })` removes it
    // again. Mirrors install.rs's/uninstall.rs's own per-module `HomeGuard`
    // pattern (mutating the real `HOME` env var under the crate-wide
    // `test_home_lock`, restored on `Drop`) rather than introducing a new
    // one.

    use crate::cli::install::manifest;
    use std::sync::MutexGuard;

    struct HomeGuard {
        _lock: MutexGuard<'static, ()>,
        scratch: PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new(label: &str) -> Self {
            let lock = lock_home();
            let scratch = scratch_cwd(label);
            let original_home = std::env::var_os("HOME");
            // SAFETY: held for this guard's entire lifetime under the
            // crate-wide HOME_ENV_LOCK, so no other HOME-mutating test
            // anywhere in this crate observes an interleaved value;
            // restored on Drop before the lock releases.
            unsafe {
                std::env::set_var("HOME", &scratch);
            }
            Self {
                _lock: lock,
                scratch,
                original_home,
            }
        }
    }

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            // SAFETY: see HomeGuard::new.
            unsafe {
                match &self.original_home {
                    Some(home) => std::env::set_var("HOME", home),
                    None => std::env::remove_var("HOME"),
                }
            }
            let _ = fs::remove_dir_all(&self.scratch);
        }
    }

    fn seed_synthed_agent(repo_root: &std::path::Path, name: &str) {
        let dir = repo_root.join("dist").join("kiro-cli-v2").join("agents");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.json")), b"{}\n").unwrap();
    }

    /// A fresh `install --link-bin` (defaulting to `$HOME`, no
    /// `--target`) must both succeed the underlying install AND create
    /// a real symlink at `$HOME/.local/bin/konductor` pointing at the
    /// currently-running test binary's own `current_exe()`.
    #[test]
    fn dispatch_install_with_link_bin_creates_the_path_symlink() {
        let home = HomeGuard::new("link-bin-fresh-home");
        let repo_root = scratch_cwd("link-bin-fresh-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch(
            Commands::Install {
                from: Some(repo_root.to_str().unwrap().to_string()),
                target: None,
                harness: "kiro-cli-v2".to_string(),
                link_bin: true,
                no_telemetry: false,
                use_github_token: false,
            },
            false,
            false,
        );
        assert_eq!(code, 0, "install itself must still succeed");

        let link_path = home.scratch.join(".local").join("bin").join("konductor");
        assert!(
            link_path.is_symlink(),
            "--link-bin must create a real symlink at $HOME/.local/bin/konductor"
        );
        assert_eq!(
            fs::read_link(&link_path).unwrap(),
            std::env::current_exe().unwrap(),
            "the symlink must point at the CURRENTLY-RUNNING binary's own resolved path"
        );

        fs::remove_dir_all(&repo_root).ok();
    }

    /// The complement: a plain `install` with no `--link-bin` must leave
    /// `$HOME/.local/bin/konductor` untouched -- confirms the flag is
    /// genuinely opt-in, not a silent default-on behavior change.
    #[test]
    fn dispatch_install_without_link_bin_creates_no_symlink() {
        let home = HomeGuard::new("link-bin-absent-home");
        let repo_root = scratch_cwd("link-bin-absent-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let code = dispatch(
            Commands::Install {
                from: Some(repo_root.to_str().unwrap().to_string()),
                target: None,
                harness: "kiro-cli-v2".to_string(),
                link_bin: false,
                no_telemetry: false,
                use_github_token: false,
            },
            false,
            false,
        );
        assert_eq!(code, 0);

        let link_path = home.scratch.join(".local").join("bin").join("konductor");
        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "without --link-bin, no symlink must be created"
        );

        fs::remove_dir_all(&repo_root).ok();
    }

    /// `konductor uninstall` on a target that ran `install --link-bin`
    /// must remove the tracked symlink as part of removing that target
    /// -- the corresponding-removal half of `install::bin_link`'s module
    /// docstring.
    #[test]
    fn dispatch_uninstall_removes_the_link_bin_symlink_it_tracked() {
        let home = HomeGuard::new("link-bin-uninstall-home");
        let repo_root = scratch_cwd("link-bin-uninstall-repo");
        seed_synthed_agent(&repo_root, "k-example");

        let install_code = dispatch(
            Commands::Install {
                from: Some(repo_root.to_str().unwrap().to_string()),
                target: None,
                harness: "kiro-cli-v2".to_string(),
                link_bin: true,
                no_telemetry: false,
                use_github_token: false,
            },
            false,
            false,
        );
        assert_eq!(install_code, 0);
        let link_path = home.scratch.join(".local").join("bin").join("konductor");
        assert!(
            link_path.is_symlink(),
            "sanity check: link must exist first"
        );
        assert!(
            manifest::read_manifest(&home.scratch).unwrap().is_some(),
            "sanity check: the target must actually be tracked"
        );

        let uninstall_code = dispatch(
            Commands::Uninstall {
                target: None,
                all: false,
                yes: false,
            },
            false,
            false,
        );
        assert_eq!(uninstall_code, 0);

        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "uninstall must remove the --link-bin symlink it tracked for this target"
        );

        fs::remove_dir_all(&repo_root).ok();
    }
}
