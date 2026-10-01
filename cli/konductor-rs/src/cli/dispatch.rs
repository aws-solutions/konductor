// SPDX-License-Identifier: Apache-2.0
//
// dispatch.rs - command dispatch for the Konductor CLI (Rust implementation).
//
// Structural extraction of the top-level `match command { ... }` out of
// cli.rs::run() into its own module, so cli.rs stays focused on argument
// parsing and dispatch stays focused on what each parsed command does.
//
// TODO(design): this is a static `match` over a fixed `Commands` enum, not
// a dynamic Command+Strategy registry. The conformance harness depends on
// `__dump_schema` reflecting the static command tree clap derives from
// `Commands`, and a dynamic registry would risk that introspection for no
// payoff at this command count. Revisit once a registry's indirection
// starts paying for itself.

use std::path::PathBuf;

use crate::cli::{config, init, output::ColorMode, Commands, ConfigAction};

/// Entry point called by `cli::run()` once argument parsing has produced a
/// concrete `command` to dispatch. `Init`, `Config`, `Install`, `Synth`,
/// and `Doctor` have real behavior; every other command is a stub.
///
/// `verbose`/`json` are threaded through to `Install`/`Synth`/`Doctor`
/// only -- the commands with real, reportable output at this milestone.
/// `color` is threaded through to every arm that can print an error
/// prefix or a colorized status report.
///
/// Returns the raw numeric exit code rather than `std::process::ExitCode`
/// so callers can both log the code and construct the real `ExitCode`
/// from it.
pub fn dispatch(command: Commands, verbose: bool, json: bool, color: ColorMode) -> u8 {
    match command {
        Commands::Install {
            from,
            target,
            harness,
            link_bin,
            no_telemetry,
            use_github_token,
            release_version,
            force,
        } => crate::cli::install::dispatch_install_with(
            from,
            target,
            harness,
            link_bin,
            no_telemetry,
            use_github_token,
            release_version,
            force,
            verbose,
            json,
            color,
        ),
        Commands::Update {
            from,
            target,
            all,
            harness,
            no_telemetry,
            enable_telemetry,
            dry_run,
            use_github_token,
            cli,
            release_version,
            force,
        } => crate::cli::update::dispatch_update_with(
            from,
            target,
            all,
            harness,
            no_telemetry,
            enable_telemetry,
            dry_run,
            use_github_token,
            cli,
            release_version,
            force,
            verbose,
            json,
            color,
        ),
        Commands::Uninstall {
            target,
            all,
            harness,
            dry_run,
        } => crate::cli::uninstall::dispatch_uninstall(target, all, harness, dry_run, json, color),
        Commands::Synth { from } => {
            let cwd = match resolve_cwd_reporting_json("synth", json, color) {
                Ok(dir) => dir,
                Err(code) => return code,
            };
            crate::cli::synth::dispatch_synth_with(&cwd, from, verbose, json, color)
        }
        Commands::Init { preset, force } => {
            let cwd = match resolve_cwd("init", color) {
                Ok(dir) => dir,
                Err(code) => return code,
            };
            dispatch_init(&cwd, preset, force, color)
        }
        Commands::Doctor {
            from,
            target,
            all,
            no_version_check,
        } => crate::cli::doctor::dispatch_doctor_with(
            &match resolve_cwd_reporting_json("doctor", json, color) {
                Ok(dir) => dir,
                Err(code) => return code,
            },
            from,
            target,
            all,
            verbose,
            json,
            // Empty (not just unset) `HOME` must resolve the same as
            // unset -- otherwise `index_path` treats it as a relative
            // `.konductor/installs` and `doctor --all` silently sees
            // zero tracked installs instead of refusing, unlike
            // `update --all`/`uninstall --all`, which already go
            // through this same filter.
            crate::cli::install::index::env_home_dir().as_deref(),
            no_version_check,
            color,
        ),
        Commands::Config { action } => {
            if !config_dispatch_allowed() {
                print_not_currently_available("config");
                return EXIT_USAGE_ERROR;
            }
            let cwd = match resolve_cwd("config", color) {
                Ok(dir) => dir,
                Err(code) => return code,
            };
            dispatch_config(&cwd, action, color)
        }
        Commands::Metrics { since } => {
            print_not_implemented("metrics", &[("--since", opt(&since))]);
            0
        }
        Commands::DumpSchema => {
            println!("{}", crate::cli::schema::dump_schema_json());
            0
        }
        Commands::TelemetryHook {
            event_type,
            agent,
            install_root,
        } => {
            // Unlike every other arm above, a cwd-resolution failure
            // here must stay invisible to the harness that invoked it
            // (see telemetry_hook.rs's module docstring): no stderr
            // output, no telemetry event. `resolve_cwd()` can't be
            // reused here even with its `Err` discarded, since it
            // unconditionally prints and fires a telemetry event as
            // side effects before returning. Resolve cwd directly
            // instead, falling back to `$HOME` with no side effects.
            let cwd = std::env::current_dir().unwrap_or_else(|_| {
                std::env::var_os("HOME")
                    .map(PathBuf::from)
                    .unwrap_or_default()
            });
            crate::cli::telemetry_hook::dispatch_telemetry_hook(
                &cwd,
                &event_type,
                agent.as_deref(),
                install_root.as_deref(),
            );
            0
        }
    }
}

/// Resolves the current working directory, shared by every dispatch arm
/// that needs a `target_dir` to pass into a real command handler. On
/// failure, prints the command-agnostic `konductor: <message>` prefix,
/// fires a `dispatch.cwd_unavailable` telemetry event against `$HOME`
/// (the closest scope-agnostic fallback when cwd itself can't be
/// resolved), and returns `EXIT_USAGE_ERROR`.
///
/// `command` is the real subcommand this call is on behalf of, reported
/// as `report_cli_error`'s `command` argument (the wire event's
/// `targetName`) -- not the literal string `"dispatch"`, which is not
/// one of `docs/telemetry-schema.json`'s enumerated `targetName` values
/// for `cli_error`. This is deliberately not the same value the
/// plain-text prefix above uses, which stays command-agnostic; see
/// `resolve_cwd_reporting_json`'s doc comment for the same divergence
/// on its `--json` envelope.
fn resolve_cwd(command: &str, color: ColorMode) -> Result<PathBuf, u8> {
    let cwd = std::env::current_dir().map_err(|err| {
        eprintln!(
            "{} could not determine the current directory: {err}",
            crate::cli::output::error_prefix(color, "konductor:")
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
        EXIT_USAGE_ERROR
    })?;
    crate::cli::trace::trace(
        "trace",
        &format!("resolved current working directory to {}", cwd.display()),
    );
    Ok(cwd)
}

/// Json-aware variant of `resolve_cwd()`, used by the `Synth`/`Doctor`
/// arms, which report through the `--json` error envelope.
/// `resolve_cwd()` always prints its plain-text message unconditionally,
/// so it can't be reused as-is when `--json` is set. `Init`/`Config`
/// don't take part in the `--json` envelope and keep calling
/// `resolve_cwd()` directly.
///
/// The `--json` branch's envelope uses the literal `"command"` value
/// `"konductor"` (matching the bare `konductor: <message>` prefix for
/// this command-agnostic path), while telemetry attribution still uses
/// the real `command` -- a divergence `report.rs::report_error`'s single
/// `command` parameter can't express, which is why this calls
/// `crate::cli::telemetry::report_cli_error` directly instead.
fn resolve_cwd_reporting_json(command: &str, json: bool, color: ColorMode) -> Result<PathBuf, u8> {
    if !json {
        return resolve_cwd(command, color);
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
/// scratch directory without mutating the process-global cwd). `preset`
/// is accepted and echoed for forward compatibility but does not yet
/// change the scaffolded output.
///
/// Exit-code contract: any `InitError` is a USAGE ERROR (64), never exit
/// code 2 -- see cli/init.rs's module docstring.
fn dispatch_init(
    target_dir: &std::path::Path,
    preset: Option<String>,
    force: bool,
    color: ColorMode,
) -> u8 {
    match init::run_init(target_dir, force) {
        Ok(result) => {
            println!(
                "{} Initialized Konductor project at {}",
                crate::cli::output::success_prefix(color, "konductor init:"),
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
            eprintln!(
                "{} {err}",
                crate::cli::output::error_prefix(color, "konductor init:")
            );
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
/// `Set` is handled first, before any call to `load_config`: it writes
/// the new value back atomically via `config::set_config_value`, which
/// performs its own internal load/merge/validate/write cycle. Gating
/// `Set` behind a prior `load_config` call would reject `config set`
/// outright on an existing config that already has a validation error,
/// even when the value being set is exactly what would fix it. `Get`/
/// `List` keep their own pre-load-and-validate path.
///
/// Exit-code contract: a `ConfigError` is a USAGE ERROR (64), never exit
/// code 2 -- see cli/config.rs's module docstring.
fn dispatch_config(target_dir: &std::path::Path, action: ConfigAction, color: ColorMode) -> u8 {
    if let ConfigAction::Set { key, value } = &action {
        return match config::set_config_value(target_dir, key, value) {
            Ok(_) => {
                println!(
                    "{} Set {key} = {value}",
                    crate::cli::output::success_prefix(color, "konductor config:")
                );
                0
            }
            Err(err) => {
                eprintln!(
                    "{} {err}",
                    crate::cli::output::error_prefix(color, "konductor config:")
                );
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
            eprintln!(
                "{} {err}",
                crate::cli::output::error_prefix(color, "konductor config:")
            );
            crate::cli::telemetry::report_cli_error(target_dir, "config", err.error_code(), false);
            return EXIT_USAGE_ERROR;
        }
    };

    match action {
        // Styled with `status::info`, matching `config list`'s key
        // coloring below. `get` prints a single bare value, so that
        // value itself carries the color instead of a separate label.
        ConfigAction::Get { key } => match get_field(&loaded, &key) {
            Some(value) => {
                println!("{}", crate::cli::output::status::info(color, &value));
                0
            }
            None => {
                eprintln!(
                    "{} unknown config key '{key}'",
                    crate::cli::output::error_prefix(color, "konductor config:")
                );
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
            let fields = list_fields(&loaded);
            // Pad each key to the widest key's width so the '='
            // separators line up. Keys are colored via `status::info`;
            // values stay plain since they're the substantive content.
            let key_width = fields.iter().map(|(key, _)| key.len()).max().unwrap_or(0);
            for (key, value) in fields {
                let colored_key = crate::cli::output::status::info(color, key);
                let padding = " ".repeat(key_width.saturating_sub(key.len()));
                println!("{colored_key}{padding} = {value}");
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
/// `EXIT_USAGE_ERROR` constant. Duplicated here because cli.rs's
/// constant is private to that module; both must stay equal to 64.
const EXIT_USAGE_ERROR: u8 = 64;

fn opt(value: &Option<String>) -> String {
    match value {
        Some(v) => v.clone(),
        None => "<none>".to_string(),
    }
}

/// Gates `Commands::Config` dispatch while the subcommand is temporarily
/// hidden (see cli.rs's `#[command(hide = true)]` on `Commands::Config`).
/// The underlying dispatch logic is fully intact; this only decides
/// whether a normal CLI invocation may reach it.
///
/// `KONDUCTOR_ALLOW_CONFIG=1` is an internal-only escape hatch, not a
/// documented user-facing flag. It lets
/// `tests/config_set_concurrency.rs` -- which drives the real compiled
/// binary as a subprocess to reproduce a cross-process lock race --
/// keep exercising the real dispatch path while `config` is withheld
/// from ordinary end users. Any other value, or unset, keeps it gated.
fn config_dispatch_allowed() -> bool {
    config_dispatch_allowed_for(std::env::var("KONDUCTOR_ALLOW_CONFIG").ok())
}

/// Pure decision logic behind `config_dispatch_allowed`, split out so
/// tests can exercise every input value without mutating the real
/// process-global `KONDUCTOR_ALLOW_CONFIG` env var (which would race
/// against other tests reading process env concurrently).
fn config_dispatch_allowed_for(value: Option<String>) -> bool {
    value.as_deref() == Some("1")
}

/// Printed instead of running `dispatch_config` when `config` is gated.
/// Distinct from `print_not_implemented` above: `config`'s implementation
/// is complete, not a stub, so the message says "not currently available"
/// (temporary, operator-imposed) rather than "not yet implemented"
/// (permanent, until someone builds it).
fn print_not_currently_available(command: &str) {
    eprintln!("konductor {command}: not currently available");
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

    // `dispatch_config` reaches `config::load_config`, which reads the
    // real process-global `HOME` env var. Reading `HOME` concurrently
    // with another test's set_var/remove_var is a data race under
    // `cargo test`'s default parallelism, so every test here that
    // reaches `load_config` must take this crate-wide lock.
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

    /// Guards this module's duplicated `EXIT_USAGE_ERROR` constant
    /// against drifting from cli.rs's canonical value (64).
    #[test]
    fn exit_usage_error_constant_is_64() {
        assert_eq!(EXIT_USAGE_ERROR, 64);
    }

    /// `resolve_cwd()` returns `Ok` with a real, existing directory
    /// under normal conditions. There's no portable way to force
    /// `current_dir()` to fail from a test thread, so only the success
    /// path is covered.
    #[test]
    fn resolve_cwd_succeeds_with_an_existing_directory() {
        let result = resolve_cwd("synth", ColorMode::disabled());
        assert!(result.is_ok(), "resolve_cwd() must succeed: {result:?}");
        assert!(
            result.unwrap().is_dir(),
            "resolve_cwd() must return a real, existing directory"
        );
    }

    #[test]
    fn dispatch_init_then_config_list_round_trips() {
        // ConfigAction::List reaches config::load_config, which reads
        // the real $HOME -- see this module's lock_home import comment.
        let _lock = lock_home();
        let target = scratch_cwd("round-trip");

        let init_code = dispatch_init(&target, None, false, ColorMode::disabled());
        assert_eq!(init_code, 0, "init on an empty target must succeed");

        let list_code = dispatch_config(&target, ConfigAction::List, ColorMode::disabled());
        assert_eq!(
            list_code, 0,
            "config list must succeed against a freshly-initialized project"
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_init_without_force_on_existing_dir_is_usage_error() {
        let target = scratch_cwd("clobber-guard");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            EXIT_USAGE_ERROR
        );

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_persists_value_and_succeeds() {
        // config set moved from stub (always usage error) to real
        // behavior: a valid key/value must succeed and round-trip
        // through config get. The round-trip check calls load_config
        // directly, which reads the real $HOME -- see lock_home above.
        let _lock = lock_home();
        let target = scratch_cwd("config-set-real");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
        let set_code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "default_severity".to_string(),
                value: "LOW".to_string(),
            },
            ColorMode::disabled(),
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

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "not_a_real_field".to_string(),
                value: "anything".to_string(),
            },
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_invalid_value_is_usage_error_not_critical_gate() {
        let target = scratch_cwd("config-set-invalid-value");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "default_severity".to_string(),
                value: "NOT_A_SEVERITY".to_string(),
            },
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_USAGE_ERROR);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dispatch_config_set_fixes_the_broken_field_on_an_already_invalid_config() {
        // A config.yml that already fails validation (valid
        // default_severity, out-of-enum fail_on_severity_at_or_above)
        // must still allow config set to fix the broken field, rather
        // than being rejected by a whole-config re-validation first.
        // The post-fix check calls load_config directly, reading the
        // real $HOME -- see lock_home above.
        let _lock = lock_home();
        let target = scratch_cwd("config-set-fixes-broken-field");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
        let config_path = target
            .join(config::KONDUCTOR_DIR_NAME)
            .join(config::CONFIG_FILE_NAME);
        fs::write(
            &config_path,
            "version: 1\ndefault_severity: MEDIUM\nfail_on_severity_at_or_above: NOT_A_SEVERITY\n",
        )
        .unwrap();

        let set_code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "fail_on_severity_at_or_above".to_string(),
                value: "LOW".to_string(),
            },
            ColorMode::disabled(),
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
        // Companion to the test above: confirms the Set-first reordering
        // didn't weaken Get/List's pre-load-and-validate behavior. Both
        // reach config::load_config, which reads the real $HOME -- see
        // lock_home above.
        let _lock = lock_home();
        let target = scratch_cwd("config-get-list-reject-broken");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
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
            ColorMode::disabled(),
        );
        assert_eq!(
            get_code, EXIT_USAGE_ERROR,
            "config get against an already-invalid config must still fail"
        );
        assert_ne!(
            get_code, 2,
            "must never emit the reserved CRITICAL-gate code"
        );

        let list_code = dispatch_config(&target, ConfigAction::List, ColorMode::disabled());
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
        // config set on an unknown key must fail before touching disk;
        // config.rs's set_config_value checks field membership up
        // front. A rejection must never leave a config.yml behind that
        // wasn't already there.
        let target = scratch_cwd("config-set-unknown-key-no-write");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
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
            ColorMode::disabled(),
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
        // Same guard as the unknown-key case above, for a known-key
        // but wrong-type value: validation must reject the write
        // before write_atomic is ever called.
        let target = scratch_cwd("config-set-invalid-value-no-write");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
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
            ColorMode::disabled(),
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
        // After a successful set, no .tmp- suffixed file should remain
        // in .konductor/ -- proves atomic_write's guarantee holds
        // through the full config set call path.
        let target = scratch_cwd("config-set-no-leftover-tmp");

        assert_eq!(
            dispatch_init(&target, None, false, ColorMode::disabled()),
            0
        );
        let code = dispatch_config(
            &target,
            ConfigAction::Set {
                key: "default_severity".to_string(),
                value: "LOW".to_string(),
            },
            ColorMode::disabled(),
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
        // Guards against drifting from config::_CONFIG_FIELDS: both
        // hand-type the same field names independently of that list.
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
        // config get/set/list used to be documented as stubs; now that
        // all three do real work, their --help text must not claim
        // otherwise. Greps the real rendered help output.
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
    // Exercises the full `dispatch(Commands::Install { link_bin, .. })`
    // path, confirming the real $PATH symlink lands at
    // $HOME/.local/bin/konductor and that uninstall removes it again.

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
            // observes an interleaved value; restored on Drop.
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

    /// A fresh `install --link-bin` must both succeed and create a real
    /// symlink at `$HOME/.local/bin/konductor` pointing at the running
    /// test binary.
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
                release_version: None,
                force: false,
            },
            false,
            false,
            ColorMode::disabled(),
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
    /// `$HOME/.local/bin/konductor` untouched.
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
                release_version: None,
                force: false,
            },
            false,
            false,
            ColorMode::disabled(),
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
    /// must remove the tracked symlink too.
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
                release_version: None,
                force: false,
            },
            false,
            false,
            ColorMode::disabled(),
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
                harness: None,
                dry_run: false,
            },
            false,
            false,
            ColorMode::disabled(),
        );
        assert_eq!(uninstall_code, 0);

        assert!(
            std::fs::symlink_metadata(&link_path).is_err(),
            "uninstall must remove the --link-bin symlink it tracked for this target"
        );

        fs::remove_dir_all(&repo_root).ok();
    }

    /// Pure decision logic behind the `KONDUCTOR_ALLOW_CONFIG` gate.
    /// Exercised directly (no real env var mutation) to cover every input
    /// without racing other tests that read process env concurrently.
    #[test]
    fn config_dispatch_allowed_for_only_accepts_exact_value_one() {
        assert!(config_dispatch_allowed_for(Some("1".to_string())));
        assert!(!config_dispatch_allowed_for(None));
        assert!(!config_dispatch_allowed_for(Some("".to_string())));
        assert!(!config_dispatch_allowed_for(Some("true".to_string())));
        assert!(!config_dispatch_allowed_for(Some("0".to_string())));
    }

    /// `Commands::Config` must be gated by default: with
    /// `KONDUCTOR_ALLOW_CONFIG` unset, dispatching it must return
    /// `EXIT_USAGE_ERROR` and must NOT reach `dispatch_config` (proven by
    /// a `cwd` that would otherwise make a real `config list` succeed --
    /// if the gate were bypassed this would exit 0, not 64).
    #[test]
    fn dispatch_config_is_gated_without_the_allow_env_var() {
        let _guard = lock_home();
        let previous = std::env::var("KONDUCTOR_ALLOW_CONFIG").ok();
        std::env::remove_var("KONDUCTOR_ALLOW_CONFIG");

        let code = dispatch(
            Commands::Config {
                action: ConfigAction::List,
            },
            false,
            false,
            ColorMode::disabled(),
        );

        match previous {
            Some(value) => std::env::set_var("KONDUCTOR_ALLOW_CONFIG", value),
            None => std::env::remove_var("KONDUCTOR_ALLOW_CONFIG"),
        }

        assert_eq!(
            code, EXIT_USAGE_ERROR,
            "gated `config` dispatch must return EXIT_USAGE_ERROR (64)"
        );
    }

    /// The escape hatch: with `KONDUCTOR_ALLOW_CONFIG=1` set,
    /// `Commands::Config` must reach the real `dispatch_config` path --
    /// proven end to end via a real `config list` against a fresh
    /// project, which only succeeds (exit 0) past the gate.
    #[test]
    fn dispatch_config_reaches_real_dispatch_when_allow_env_var_is_set() {
        let _guard = lock_home();
        let previous = std::env::var("KONDUCTOR_ALLOW_CONFIG").ok();
        std::env::set_var("KONDUCTOR_ALLOW_CONFIG", "1");

        let cwd = scratch_cwd("config-gate-allowed");
        let previous_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", &cwd);

        let code = dispatch(
            Commands::Config {
                action: ConfigAction::List,
            },
            false,
            false,
            ColorMode::disabled(),
        );

        match previous {
            Some(value) => std::env::set_var("KONDUCTOR_ALLOW_CONFIG", value),
            None => std::env::remove_var("KONDUCTOR_ALLOW_CONFIG"),
        }
        match previous_home {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        fs::remove_dir_all(&cwd).ok();

        assert_eq!(
            code, 0,
            "with the escape hatch set, `config list` must reach dispatch_config and succeed"
        );
    }
}
