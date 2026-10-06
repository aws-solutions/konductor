// SPDX-License-Identifier: Apache-2.0
//
// cli.rs - Konductor CLI command surface (clap derive macros, no separate
// spec file). The hidden `__dump_schema` command (see cli/schema.rs) dumps
// the live command tree as JSON for external validation.
//
// `metrics` is a stub: it parses and exits 0 but has no real logic yet.
// Every other command has real behavior in its own module (cli/install.rs,
// cli/update.rs, cli/uninstall.rs, cli/synth/mod.rs, cli/config.rs,
// cli/init.rs, cli/doctor.rs).
//
// ── Exit-code contract (Engineering Design §6) ─────────────────────────────
//   0 = all passed        1 = halted        2 = unresolved CRITICAL gate
//   3 = budget exceeded    4 = user aborted a paused verdict
//
// ── Usage-error remap (PITFALL) ────────────────────────────────────────────
// clap defaults usage errors to exit code 2, which collides with this
// contract's "unresolved CRITICAL gate" signal. `Cli::try_parse()` catches
// that and remaps it to `EX_USAGE` (64, BSD sysexits.h); `--help`/`--version`
// keep clap's normal exit 0.

use clap::builder::Styles;
use clap::{ArgAction, Parser, Subcommand};
use std::process::ExitCode;

pub(crate) mod atomic_write;
pub(crate) mod config;
pub(crate) mod config_lock;
mod dispatch;
pub(crate) mod doctor;
pub(crate) mod harness_select;
pub(crate) mod init;
pub(crate) mod install;
mod logging;
pub(crate) mod output;
pub(crate) mod report;
pub(crate) mod schema;
pub(crate) mod synth;
mod telemetry;
mod telemetry_hook;
mod time;
mod trace;
mod uninstall;
mod update;

/// Test-only shared lock for every test in this crate that mutates the
/// process-global `HOME` env var, since `std::env::set_var` has no
/// per-thread scoping. Must be crate-wide, not per-module: two
/// HOME-mutating tests in different modules running concurrently can
/// still stomp on each other's value otherwise.
#[cfg(test)]
pub(crate) mod test_home_lock {
    use std::sync::{Mutex, MutexGuard};

    pub(crate) static HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Acquires `HOME_ENV_LOCK`, recovering the guard even if a previous
    /// holder panicked while holding it, so one failed assertion doesn't
    /// cascade into every later HOME-mutating test failing with
    /// `PoisonError`.
    pub(crate) fn lock_home() -> MutexGuard<'static, ()> {
        HOME_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Exit code the workflow contract reserves for "unresolved CRITICAL gate".
/// Never emit this for a CLI usage error.
const EXIT_CRITICAL_GATE: u8 = 2;

/// Remapped exit code for CLI usage errors (bad flag, unknown subcommand,
/// missing required argument). Traditional BSD sysexits.h EX_USAGE.
const EXIT_USAGE_ERROR: u8 = 64;

/// `konductor install`'s artifact checksum verification failed (corrupt or
/// tampered download). BSD sysexits.h EX_DATAERR. Also reused by
/// `uninstall`/`update` for their own manifest/index/bin-link failure
/// cases, the same "state/verification failure" kind.
#[allow(dead_code)]
const EXIT_VERIFY_FAILED: u8 = 65;

/// Exit code for an otherwise-successful lifecycle command that hit a
/// non-fatal warning-level failure (e.g. `uninstall --link-bin`'s
/// symlink-removal failing while every tracked file was still handled
/// correctly). Reserved here, alongside the other exit codes, rather
/// than in the owning module, so no future command can claim 6 for
/// something unrelated. See `cli/README.md`'s exit-code contract table.
pub(crate) const EXIT_SUCCESS_WITH_WARNINGS: u8 = 6;

const EXIT_HALTED: u8 = 1;

/// `--help` text styling (clap's own `Command::styles()`). Independent of
/// `--no-color`/`NO_COLOR`: clap does its own TTY detection for `--help`
/// output, separate from this crate's own color wiring.
fn help_styles() -> Styles {
    use clap::builder::styling::{AnsiColor, Effects};
    Styles::styled()
        .header(AnsiColor::Yellow.on_default() | Effects::BOLD)
        .usage(AnsiColor::Yellow.on_default() | Effects::BOLD)
        .literal(AnsiColor::Green.on_default() | Effects::BOLD)
        .placeholder(AnsiColor::Cyan.on_default())
        .error(AnsiColor::Red.on_default() | Effects::BOLD)
        .valid(AnsiColor::Green.on_default())
        .invalid(AnsiColor::Yellow.on_default())
}

#[derive(Parser, Debug)]
#[command(
    name = "konductor",
    version,
    about = "Konductor CLI",
    disable_version_flag = true,
    styles = help_styles()
)]
pub struct Cli {
    /// Enable verbose output.
    #[arg(short, long, global = true, action = ArgAction::SetTrue)]
    pub verbose: bool,

    /// Emit machine-readable JSON output instead of human text.
    #[arg(long, global = true, action = ArgAction::SetTrue)]
    pub json: bool,

    /// Print the CLI version and exit 0.
    #[arg(long, action = ArgAction::SetTrue)]
    pub version: bool,

    /// Disable ANSI color in output.
    #[arg(long = "no-color", global = true, action = ArgAction::SetTrue)]
    pub no_color: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

/// Builds the `--harness` value parser from `synth::registry::TRANSFORMERS`,
/// so accepted values always match registered transformers with no
/// separate list to keep in sync. A harness name absent here is rejected
/// before `install::report_no_strategy_for_harness` ever runs.
fn harness_value_parser() -> clap::builder::PossibleValuesParser {
    clap::builder::PossibleValuesParser::new(
        synth::registry::TRANSFORMERS
            .iter()
            .map(|transformer| transformer.name()),
    )
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Install Konductor into a repository.
    Install {
        /// REQUIRED: which synthed harness output to install. Accepts the
        /// same identifier `konductor synth` registers each transformer
        /// under; the accepted set is derived from that registry at parse
        /// time rather than duplicated here. No default and no
        /// destination-marker auto-detection: every invocation must say
        /// explicitly which harness it means.
        #[arg(long, value_parser = harness_value_parser(), display_order = 0)]
        harness: String,

        /// SOURCE: path to a local repo root to install previously-built
        /// (synthed) content from. Installing from a published release is
        /// not yet available, so this is currently required. Distinct from
        /// `--target`, the install DESTINATION.
        #[arg(long, display_order = 1)]
        from: Option<String>,

        /// DESTINATION: directory to install into (agents/context under
        /// `<dir>/.kiro/`, skills under `<dir>/.konductor/skills/`, SOPs
        /// under `<dir>/.konductor/sops/` plus a Kiro-discoverable
        /// `sop-<name>/SKILL.md` conversion for the Kiro harnesses).
        /// Defaults to `$HOME` when omitted; pass `.` for the cwd.
        #[arg(long, display_order = 2)]
        target: Option<String>,

        /// Also symlink the currently-running `konductor` binary to
        /// `$HOME/.local/bin/konductor` so it's callable from anywhere on
        /// `$PATH`. Idempotent: an existing symlink pointing at a
        /// different binary is repointed; a foreign non-symlink file is
        /// never overwritten. `konductor uninstall` removes a symlink
        /// this flag created.
        #[arg(long = "link-bin", action = ArgAction::SetTrue, display_order = 3)]
        link_bin: bool,

        /// Opt out of usage-analytics telemetry for this install. No
        /// install record or telemetry hook is written, and any record a
        /// prior install at this target wrote is removed.
        ///
        /// Scoped to the whole target directory, NOT to `--harness`:
        /// `install-info.json` is one file per target, shared by every
        /// harness installed there, so `--harness <name> --no-telemetry`
        /// still removes the ENTIRE target's record, including the
        /// opt-in a different, coexisting harness at that same target
        /// wrote -- there is no per-harness telemetry setting to opt
        /// only one of them out of.
        #[arg(long, display_order = 4)]
        no_telemetry: bool,

        /// Opt in to reading `GITHUB_TOKEN` from the environment for the
        /// no-`--from` remote install path. Without this flag,
        /// `GITHUB_TOKEN` is never read even if set in the shell. Has no
        /// effect on a `--from <repo-root>` install.
        #[arg(long = "use-github-token", action = ArgAction::SetTrue, display_order = 5)]
        use_github_token: bool,

        /// Fetch this specific release instead of the latest one.
        /// Mutually exclusive with `--from`: a local source has no
        /// release-version concept.
        #[arg(long = "version", value_name = "V", conflicts_with = "from")]
        release_version: Option<String>,

        /// Overwrite even when the target is already at the requested
        /// content version.
        #[arg(long, action = ArgAction::SetTrue)]
        force: bool,
    },

    /// Update an existing Konductor installation: overwrites every tracked
    /// file with fresh content from a fresh `--from <repo-root>` synth
    /// source, the same file-copy path `install` uses. Without `--from`,
    /// tries the same remote fallback chain `install` uses (GitHub Release
    /// first, falling back to `main`'s `dist/` tree). There is no `--force`
    /// flag: a hand-edited file is overwritten like any other tracked
    /// file. `--dry-run` reports hash-based divergence per file without
    /// writing anything or making any network call.
    Update {
        /// SOURCE: path to a local repo root to re-synth from, same
        /// meaning as `install --from`. When omitted, tries the remote
        /// fallback chain instead.
        #[arg(long)]
        from: Option<String>,

        /// DESTINATION: the tracked install to update. Required when 2+
        /// installs are tracked; matched against the index by
        /// canonicalized path. Mutually exclusive with `--all`.
        #[arg(long, conflicts_with = "all")]
        target: Option<String>,

        /// Update every tracked install, one at a time. Mutually
        /// exclusive with `--target`.
        #[arg(long, action = ArgAction::SetTrue, conflicts_with = "target")]
        all: bool,

        /// Which tracked strategy to update, when the resolved target
        /// tracks 2+. Same values as `install --harness`; selects exactly
        /// ONE tracked strategy per run. A value that doesn't match the
        /// resolved target's tracked strategies is a usage error, not a
        /// silent no-op. With `--all`, a target that doesn't track the
        /// requested harness is skipped rather than failing the whole
        /// batch. Required non-interactively (no TTY, or `--json`) when
        /// 2+ are tracked; otherwise an interactive picker lists them.
        #[arg(long, value_parser = harness_value_parser())]
        harness: Option<String>,

        /// Opt out of usage-analytics telemetry for this update run, and
        /// durably: if the target's own `.konductor/install-info.json`
        /// currently exists (telemetry was enabled), this run deletes it,
        /// so the opt-out carries forward to a LATER plain `update` (no
        /// flag re-passed) too, instead of silently re-enabling telemetry
        /// the moment this flag is omitted. When NOT passed, `update`
        /// carries forward the target's earlier choice the same way: the
        /// absence of `.konductor/install-info.json` on an existing
        /// install means it is opted out, with nothing left to carry
        /// forward differently. Pass `--enable-telemetry` to reverse an
        /// opt-out. An `--all` batch resolves this independently per
        /// target. Mutually exclusive with `--enable-telemetry`.
        ///
        /// Scoped to the whole target directory, NOT to `--harness`:
        /// `install-info.json` is one file per target, shared by every
        /// harness installed there, so `--harness <name> --no-telemetry`
        /// still opts the ENTIRE target out, including every other
        /// harness coexisting at that same target -- there is no
        /// per-harness telemetry setting to opt only one of them out of.
        #[arg(long, conflicts_with = "enable_telemetry")]
        no_telemetry: bool,

        /// Opt in to usage-analytics telemetry for this update run,
        /// overriding any carried-forward opt-out (an absent or broken
        /// `.konductor/install-info.json`) regardless of the target's own
        /// history. Durably re-creates the record, the same way a fresh
        /// `install` without `--no-telemetry` would, so a LATER plain
        /// `update` also sees telemetry as enabled, not just this one
        /// run -- the mirror image of `--no-telemetry`'s own
        /// sticky-delete. An `--all` batch resolves this independently
        /// per target. Mutually exclusive with `--no-telemetry`.
        ///
        /// Scoped to the whole target directory, NOT to `--harness`, for
        /// the same reason `--no-telemetry` is: `--harness <name>
        /// --enable-telemetry` opts the ENTIRE target back in, not just
        /// the named harness.
        #[arg(long = "enable-telemetry", action = ArgAction::SetTrue, conflicts_with = "no_telemetry")]
        enable_telemetry: bool,

        /// Report exactly what would be overwritten for each selected
        /// target without touching the filesystem or making any network
        /// call. Mutually exclusive with `--cli`: self-replacing the CLI
        /// binary has no preview mode.
        #[arg(long = "dry-run", action = ArgAction::SetTrue)]
        dry_run: bool,

        /// Opt in to reading `GITHUB_TOKEN` from the environment for the
        /// no-`--from` remote update path. Identical in meaning to
        /// `install --use-github-token`; has no effect on a `--from
        /// <repo-root>` update.
        #[arg(long = "use-github-token", action = ArgAction::SetTrue)]
        use_github_token: bool,

        /// Self-replace the `konductor` binary on `PATH` from a GitHub
        /// release instead of updating installed content. Machine-wide,
        /// so it conflicts with every target-selection/content flag on
        /// this command: `--dry-run` has no self-replace equivalent, and
        /// combining it with `--cli` would silently mutate the live
        /// binary despite `--dry-run`'s non-destructive guarantee.
        #[arg(
            long,
            action = ArgAction::SetTrue,
            conflicts_with_all = ["from", "target", "all", "harness", "dry_run"]
        )]
        cli: bool,

        /// Fetch this specific release instead of the latest one, on
        /// whichever axis this invocation is on (`--cli` or content).
        /// Mutually exclusive with `--from`.
        #[arg(long = "version", value_name = "V", conflicts_with = "from")]
        release_version: Option<String>,

        /// Overwrite even when the target is already at the requested
        /// content version. Has no effect on the `--cli` axis.
        #[arg(long, action = ArgAction::SetTrue)]
        force: bool,
    },

    /// Remove Konductor from a repository.
    Uninstall {
        /// Uninstall exactly this target directory (canonicalized the same
        /// way `install --target` is). Required when 2+ installs are
        /// tracked. Mutually exclusive with `--all`.
        #[arg(long, conflicts_with = "all")]
        target: Option<String>,

        /// Uninstall every tracked install, continuing past a per-target
        /// failure and reporting which targets succeeded or failed.
        /// Mutually exclusive with `--target`.
        #[arg(long, action = ArgAction::SetTrue, conflicts_with = "target")]
        all: bool,

        /// Which tracked strategy to uninstall, when the resolved target
        /// tracks 2+. Same values as `install --harness`; selects exactly
        /// ONE tracked strategy per run. A non-matching value is a usage
        /// error, not a silent no-op. With `--all`, a target that doesn't
        /// track the requested harness is skipped rather than failing the
        /// whole batch. Required non-interactively when 2+ are tracked;
        /// otherwise an interactive picker lists them.
        #[arg(long, value_parser = harness_value_parser())]
        harness: Option<String>,

        /// Report exactly what would be removed for each selected target
        /// without touching the filesystem.
        #[arg(long = "dry-run", action = ArgAction::SetTrue)]
        dry_run: bool,
    },

    /// Synthesize Konductor pipeline/config artifacts.
    Synth {
        /// Path to a local repo root to synthesize against, instead of the cwd.
        #[arg(long)]
        from: Option<String>,
    },

    /// Initialize a new Konductor project: creates `.konductor/` in the
    /// current working directory and writes a starter
    /// `.konductor/config.yml` derived from the CLI's preset defaults.
    Init {
        /// Initialization preset to apply.
        #[arg(long, value_parser = ["solo", "team", "org"])]
        preset: Option<String>,

        /// Overwrite an existing `.konductor/` directory instead of
        /// failing when one is already present.
        #[arg(long, action = ArgAction::SetTrue)]
        force: bool,
    },

    /// Inspect a Konductor installation/checkout for problems and print
    /// actionable remediation guidance.
    Doctor {
        /// SOURCE: path to a local repo root to check instead of the cwd.
        /// Mutually exclusive with `--all`: a single source override
        /// doesn't make sense across multiple targets that may have
        /// recorded different sources.
        #[arg(long, conflicts_with = "all")]
        from: Option<String>,

        /// DESTINATION: install directory to check. Defaults to `$HOME`
        /// when omitted. Mutually exclusive with `--all`.
        #[arg(long, conflicts_with = "all")]
        target: Option<String>,

        /// Run every check against every tracked install, one at a time.
        /// Mutually exclusive with `--from`/`--target`.
        #[arg(long, action = ArgAction::SetTrue, conflicts_with_all = ["from", "target"])]
        all: bool,

        /// Skip the network call that determines the latest available
        /// release tag, used by both the `cli_version` and
        /// `content_version` checks. Independent of telemetry opt-out:
        /// this call carries no UUID.
        #[arg(long = "no-version-check", action = ArgAction::SetTrue)]
        no_version_check: bool,
    },

    /// Read or write Konductor configuration.
    ///
    /// Temporarily hidden from normal --help and dispatch while the
    /// implementation stays fully intact and tested. Re-enable by removing
    /// `#[command(hide = true)]` here and the gating check in dispatch.rs's
    /// `Commands::Config` arm.
    #[command(hide = true)]
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },

    /// Show Konductor usage/run metrics (stub).
    ///
    /// Hidden from normal --help since it has no real implementation yet;
    /// stays fully invokable, only its --help listing is suppressed.
    #[command(hide = true)]
    Metrics {
        /// Time window to report metrics for, e.g. "7d", "24h".
        #[arg(long)]
        since: Option<String>,
    },

    /// Dump the live command tree as JSON (internal, for schema tooling).
    ///
    /// Not one of the public commands. Hidden from --help; exists so
    /// external tooling can walk the real `clap::Command` tree without
    /// re-declaring the surface by hand.
    #[command(hide = true, name = "__dump_schema")]
    DumpSchema,

    /// Parses a runtime hook's stdin payload and reports an
    /// agent/sub-agent invocation event.
    ///
    /// Not one of the public commands. Hidden from --help. `event_type` is
    /// `agent-invocation` or `subagent-invocation`.
    #[command(hide = true, name = "__telemetry-hook")]
    TelemetryHook {
        /// Which event this hook firing represents.
        event_type: String,
        /// The agent this hook belongs to, for harnesses whose payload
        /// does not name it (Kiro CLI v2 embeds the hook in each agent's
        /// own config, so install knows the name).
        #[arg(long)]
        agent: Option<String>,
        /// The install that wired this hook. When a harness loads hooks
        /// from more than one install, only the nearest install that
        /// owns the agent reports, so each invocation counts once.
        #[arg(long)]
        install_root: Option<std::path::PathBuf>,
    },
}

#[derive(Subcommand, Debug)]
pub enum ConfigAction {
    /// Get a single config value.
    Get {
        /// Dotted config key to read, e.g. "default_severity".
        key: String,
    },
    /// Set a single config value.
    Set {
        /// Dotted config key to write.
        key: String,
        /// Value to write for the given key.
        value: String,
    },
    /// List all config values.
    List,
}

impl Commands {
    /// The subcommand name clap parses this variant from, e.g.
    /// `Commands::Init { .. }` -> `"init"`. Single source of truth for
    /// these literals so call sites reference this instead of repeating
    /// the bare string.
    #[allow(dead_code)]
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Commands::Install { .. } => Self::INSTALL,
            Commands::Update { .. } => Self::UPDATE,
            Commands::Uninstall { .. } => Self::UNINSTALL,
            Commands::Synth { .. } => Self::SYNTH,
            Commands::Init { .. } => Self::INIT,
            Commands::Doctor { .. } => Self::DOCTOR,
            Commands::Config { .. } => Self::CONFIG,
            Commands::Metrics { .. } => Self::METRICS,
            Commands::DumpSchema => "__dump_schema",
            Commands::TelemetryHook { .. } => "__telemetry-hook",
        }
    }

    // Subcommand name constants, usable without constructing a `Commands`
    // value (e.g. in test argv). Kept in sync with `as_str()`'s match arms.
    pub(crate) const INSTALL: &'static str = "install";
    #[allow(dead_code)]
    pub(crate) const UPDATE: &'static str = "update";
    #[allow(dead_code)]
    pub(crate) const UNINSTALL: &'static str = "uninstall";
    #[allow(dead_code)]
    pub(crate) const SYNTH: &'static str = "synth";
    pub(crate) const INIT: &'static str = "init";
    pub(crate) const DOCTOR: &'static str = "doctor";
    pub(crate) const CONFIG: &'static str = "config";
    #[allow(dead_code)]
    pub(crate) const METRICS: &'static str = "metrics";
}

impl ConfigAction {
    /// The subcommand name clap parses this variant from, e.g.
    /// `ConfigAction::Get { .. }` -> `"get"`.
    #[allow(dead_code)]
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            ConfigAction::Get { .. } => Self::GET,
            ConfigAction::Set { .. } => Self::SET,
            ConfigAction::List => Self::LIST,
        }
    }

    // Subcommand name constants, usable without constructing a
    // `ConfigAction` value (e.g. in test argv). Kept in sync with
    // `as_str()`'s match arms.
    pub(crate) const GET: &'static str = "get";
    pub(crate) const SET: &'static str = "set";
    pub(crate) const LIST: &'static str = "list";
}

/// Parse argv, remapping clap's usage-error exit code (2) to EX_USAGE (64)
/// so it never collides with the workflow contract's "unresolved CRITICAL
/// gate" code. `--help`/`--version` clap outcomes still exit 0.
///
/// Every invocation is logged under ~/.konductor/logs/, including the exit
/// paths below that terminate the process directly before `run()` ever
/// gets a `Cli` to log from.
pub fn parse_or_exit() -> Cli {
    let argv: Vec<String> = std::env::args().collect();
    match Cli::try_parse() {
        Ok(cli) => cli,
        Err(err) => {
            use clap::error::ErrorKind;
            match err.kind() {
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => {
                    // clap's own `Error::exit()` flushes stdout correctly;
                    // a manual print + `process::exit()` would truncate
                    // piped output.
                    logging::log_invocation(&argv, 0);
                    err.exit();
                }
                ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
                    // A command group invoked with no subcommand (e.g.
                    // bare `konductor config`). `Error::exit()` would exit
                    // 2 here, colliding with the reserved CRITICAL-gate
                    // code, so flush and exit 0 manually instead.
                    use std::io::Write as _;
                    print!("{err}");
                    let _ = std::io::stdout().flush();
                    logging::log_invocation(&argv, 0);
                    std::process::exit(0);
                }
                _ => {
                    eprint!("{err}");
                    logging::log_invocation(&argv, EXIT_USAGE_ERROR);
                    std::process::exit(EXIT_USAGE_ERROR.into());
                }
            }
        }
    }
}

pub fn run(cli: Cli) -> ExitCode {
    let argv: Vec<String> = std::env::args().collect();
    let exit_code = run_inner(cli);
    // Logged after dispatch so the recorded code is the final one;
    // fail-open (a log-write failure never changes the exit code).
    logging::log_invocation(&argv, exit_code);
    ExitCode::from(exit_code)
}

/// Runs the parsed `Cli`, returning the raw numeric exit code (rather than
/// `std::process::ExitCode`, which has no `From<ExitCode> for u8`) so
/// `run()` can both construct the real `ExitCode` and pass the same value
/// to `logging::log_invocation`.
fn run_inner(cli: Cli) -> u8 {
    if cli.version {
        println!("konductor {}", env!("CARGO_PKG_VERSION"));
        return 0;
    }

    let color = output::ColorMode::resolve_from_env(cli.no_color);

    let Some(command) = cli.command else {
        // `command` is Optional, so handle the "no subcommand" case
        // explicitly here rather than relying on clap's
        // arg_required_else_help, to keep the exit-code remap centralized.
        eprintln!(
            "{} no command given. Run `konductor --help` for usage.",
            output::error_prefix(color, "konductor:")
        );
        return EXIT_USAGE_ERROR;
    };

    dispatch::dispatch(command, cli.verbose, cli.json, color)
}

/// `EXIT_CRITICAL_GATE` (2) is reserved for a future CRITICAL-gate feature
/// and isn't returned by any handler yet; `EXIT_HALTED` (1) is returned
/// today by `doctor`'s own local constant of the same value. This keeps
/// both referenced so neither is flagged dead code.
#[allow(dead_code)]
fn _contract_constants_reference() -> (u8, u8) {
    (EXIT_HALTED, EXIT_CRITICAL_GATE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{CommandFactory, Parser};

    #[test]
    fn parses_install_with_from_flag() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--from",
            "/tmp/repo",
            "--harness",
            "kiro-cli-v2",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Install {
                from,
                target,
                harness,
                link_bin,
                no_telemetry,
                use_github_token,
                ..
            }) => {
                assert_eq!(from, Some("/tmp/repo".to_string()));
                assert_eq!(target, None);
                assert_eq!(harness, "kiro-cli-v2".to_string());
                assert!(!link_bin, "--link-bin must default to false when omitted");
                assert!(
                    !no_telemetry,
                    "--no-telemetry must default to false when omitted"
                );
                assert!(
                    !use_github_token,
                    "--use-github-token must default to false when omitted"
                );
            }
            other => panic!("expected Install, got {other:?}"),
        }
    }

    /// `--harness` has no default: omitting it entirely must be a parse
    /// error, remapped by `parse_or_exit` to `EXIT_USAGE_ERROR` (64).
    #[test]
    fn parses_install_without_harness_flag_is_a_required_argument_error() {
        let result = Cli::try_parse_from(["konductor", Commands::INSTALL, "--from", "/tmp/repo"]);
        let err = result.expect_err("--harness must be required; omitting it must not parse");
        assert_eq!(
            err.kind(),
            clap::error::ErrorKind::MissingRequiredArgument,
            "the specific reason must be a missing required argument, not some other parse failure"
        );
        let rendered = err.to_string();
        assert!(
            rendered.contains("--harness"),
            "the error must name --harness so the caller knows what to add: {rendered:?}"
        );
    }

    #[test]
    fn parses_install_with_target_flag() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--from",
            "/tmp/repo",
            "--target",
            "/tmp/dest",
            "--harness",
            "kiro-cli-v2",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Install {
                from,
                target,
                harness,
                link_bin,
                no_telemetry,
                use_github_token,
                ..
            }) => {
                assert_eq!(from, Some("/tmp/repo".to_string()));
                assert_eq!(target, Some("/tmp/dest".to_string()));
                assert_eq!(harness, "kiro-cli-v2".to_string());
                assert!(!link_bin, "--link-bin must default to false when omitted");
                assert!(
                    !no_telemetry,
                    "--no-telemetry must default to false when omitted"
                );
                assert!(
                    !use_github_token,
                    "--use-github-token must default to false when omitted"
                );
            }
            other => panic!("expected Install, got {other:?}"),
        }
    }

    /// `--link-bin` itself must parse and set the flag; the tests above
    /// only pin the default (omitted) case.
    #[test]
    fn parses_install_with_link_bin_flag() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--from",
            "/tmp/repo",
            "--harness",
            "kiro-cli-v2",
            "--link-bin",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Install {
                from,
                target,
                link_bin,
                ..
            }) => {
                assert_eq!(from, Some("/tmp/repo".to_string()));
                assert_eq!(target, None);
                assert!(link_bin);
            }
            other => panic!("expected Install, got {other:?}"),
        }
    }

    #[test]
    fn parses_install_with_no_telemetry_flag() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--from",
            "/tmp/repo",
            "--harness",
            "kiro-cli-v2",
            "--no-telemetry",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Install { no_telemetry, .. }) => {
                assert!(no_telemetry);
            }
            other => panic!("expected Install, got {other:?}"),
        }
    }

    /// `--harness` must parse and carry each of its three documented
    /// choices through to `Commands::Install`.
    #[test]
    fn parses_install_with_harness_flag_for_each_choice() {
        for choice in ["kiro-cli-v2", "kiro-v3", "claude"] {
            let cli = Cli::try_parse_from([
                "konductor",
                Commands::INSTALL,
                "--from",
                "/tmp/repo",
                "--harness",
                choice,
            ])
            .unwrap();
            match cli.command {
                Some(Commands::Install { harness, .. }) => {
                    assert_eq!(harness, choice.to_string());
                }
                other => panic!("expected Install, got {other:?}"),
            }
        }
    }

    /// A `--harness` value outside the three documented choices must be
    /// rejected by clap at parse time, before dispatch ever sees it.
    #[test]
    fn parses_install_with_invalid_harness_flag_is_rejected() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--from",
            "/tmp/repo",
            "--harness",
            "not-a-real-harness",
        ]);
        assert!(
            result.is_err(),
            "an unsupported --harness value must be rejected at parse time"
        );
    }

    #[test]
    fn parses_uninstall_with_target_flag() {
        let cli = Cli::try_parse_from(["konductor", Commands::UNINSTALL, "--target", "/tmp/dest"])
            .unwrap();
        match cli.command {
            Some(Commands::Uninstall { target, all, .. }) => {
                assert_eq!(target, Some("/tmp/dest".to_string()));
                assert!(!all);
            }
            other => panic!("expected Uninstall, got {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_with_no_flags() {
        let cli = Cli::try_parse_from(["konductor", Commands::DOCTOR]).unwrap();
        match cli.command {
            Some(Commands::Doctor {
                from,
                target,
                all,
                no_version_check,
            }) => {
                assert_eq!(from, None);
                assert_eq!(target, None);
                assert!(!all);
                assert!(
                    !no_version_check,
                    "--no-version-check must default to false when omitted"
                );
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_with_from_flag() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::DOCTOR, "--from", "/tmp/repo"]).unwrap();
        match cli.command {
            Some(Commands::Doctor {
                from, target, all, ..
            }) => {
                assert_eq!(from, Some("/tmp/repo".to_string()));
                assert_eq!(target, None);
                assert!(!all);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_with_target_flag() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::DOCTOR, "--target", "/tmp/dest"]).unwrap();
        match cli.command {
            Some(Commands::Doctor {
                from, target, all, ..
            }) => {
                assert_eq!(from, None);
                assert_eq!(target, Some("/tmp/dest".to_string()));
                assert!(!all);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    #[test]
    fn parses_uninstall_with_all_flag() {
        let cli = Cli::try_parse_from(["konductor", Commands::UNINSTALL, "--all"]).unwrap();
        match cli.command {
            Some(Commands::Uninstall { target, all, .. }) => {
                assert_eq!(target, None);
                assert!(all);
            }
            other => panic!("expected Uninstall, got {other:?}"),
        }
    }

    /// `--target`/`--all` together on `update` must be rejected by clap
    /// itself at parse time, never silently letting `--all` win.
    #[test]
    fn rejects_update_with_target_and_all_together() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--target",
            "/tmp/dest",
            "--all",
        ]);
        let err = result.expect_err("--target and --all together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// Same conflict, flags given in the opposite order.
    #[test]
    fn rejects_update_with_all_and_target_together_reverse_order() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--all",
            "--target",
            "/tmp/dest",
        ]);
        let err = result.expect_err("--all and --target together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// `update --harness <name>` accepts the exact same
    /// values `install --harness` does (same `harness_value_parser()`).
    #[test]
    fn parses_update_with_harness_flag() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::UPDATE, "--harness", "claude"]).unwrap();
        match cli.command {
            Some(Commands::Update { harness, .. }) => {
                assert_eq!(harness, Some("claude".to_string()));
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    // ── update --no-telemetry / --enable-telemetry ──────────────────────

    #[test]
    fn parses_update_with_enable_telemetry_flag() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::UPDATE, "--enable-telemetry"]).unwrap();
        match cli.command {
            Some(Commands::Update {
                enable_telemetry,
                no_telemetry,
                ..
            }) => {
                assert!(enable_telemetry);
                assert!(
                    !no_telemetry,
                    "--enable-telemetry must not implicitly set --no-telemetry"
                );
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn update_enable_telemetry_defaults_to_false_when_omitted() {
        let cli = Cli::try_parse_from(["konductor", Commands::UPDATE]).unwrap();
        match cli.command {
            Some(Commands::Update {
                enable_telemetry, ..
            }) => {
                assert!(!enable_telemetry);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn update_no_telemetry_conflicts_with_enable_telemetry() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--no-telemetry",
            "--enable-telemetry",
        ]);
        let err = result
            .expect_err("--no-telemetry and --enable-telemetry together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// Same conflict, flags given in the opposite order.
    #[test]
    fn update_enable_telemetry_conflicts_with_no_telemetry_reverse_order() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--enable-telemetry",
            "--no-telemetry",
        ]);
        let err = result
            .expect_err("--enable-telemetry and --no-telemetry together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    // ── update --cli and its conflict matrix ────────────────────────────

    #[test]
    fn parses_update_with_cli_flag() {
        let cli = Cli::try_parse_from(["konductor", Commands::UPDATE, "--cli"]).unwrap();
        match cli.command {
            Some(Commands::Update {
                cli: cli_flag,
                from,
                target,
                all,
                harness,
                ..
            }) => {
                assert!(cli_flag);
                assert_eq!(from, None);
                assert_eq!(target, None);
                assert!(!all);
                assert_eq!(harness, None);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn update_cli_defaults_to_false_when_omitted() {
        let cli = Cli::try_parse_from(["konductor", Commands::UPDATE]).unwrap();
        match cli.command {
            Some(Commands::Update { cli: cli_flag, .. }) => {
                assert!(!cli_flag, "--cli must default to false when omitted");
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    /// `--cli` conflicts with each of `--from`, `--target`, `--all`,
    /// `--harness`, and `--dry-run` individually.
    #[test]
    fn update_cli_conflicts_with_from() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--cli",
            "--from",
            "/tmp/repo",
        ]);
        let err = result.expect_err("--cli and --from together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn update_cli_conflicts_with_target() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--cli",
            "--target",
            "/tmp/dest",
        ]);
        let err = result.expect_err("--cli and --target together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn update_cli_conflicts_with_all() {
        let result = Cli::try_parse_from(["konductor", Commands::UPDATE, "--cli", "--all"]);
        let err = result.expect_err("--cli and --all together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn update_cli_conflicts_with_harness() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--cli",
            "--harness",
            "claude",
        ]);
        let err = result.expect_err("--cli and --harness together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// `--dry-run` has no self-replace preview mode, so it joins the
    /// same conflict list as `--from`/`--target`/`--all`/`--harness`.
    #[test]
    fn update_cli_conflicts_with_dry_run() {
        let result = Cli::try_parse_from(["konductor", Commands::UPDATE, "--cli", "--dry-run"]);
        let err = result.expect_err("--cli and --dry-run together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// Reverse flag order for the same conflict.
    #[test]
    fn update_dry_run_conflicts_with_cli_reverse_order() {
        let result = Cli::try_parse_from(["konductor", Commands::UPDATE, "--dry-run", "--cli"]);
        let err = result.expect_err("--dry-run and --cli together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// Every conflict must also hold in the reverse flag order.
    #[test]
    fn update_from_conflicts_with_cli_reverse_order() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--from",
            "/tmp/repo",
            "--cli",
        ]);
        let err = result.expect_err("--from and --cli together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// `--cli` is compatible with `--version <v>` and
    /// `--use-github-token` -- neither is in the `conflicts_with_all`
    /// list.
    #[test]
    fn update_cli_is_compatible_with_version_and_use_github_token() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--cli",
            "--version",
            "v0.2.0",
            "--use-github-token",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Update {
                cli: cli_flag,
                release_version,
                use_github_token,
                ..
            }) => {
                assert!(cli_flag);
                assert_eq!(release_version, Some("v0.2.0".to_string()));
                assert!(use_github_token);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    /// `--cli` has no `install`-side existence at all in this design --
    /// `install` never declares this flag, so passing it there is an
    /// unrecognized-argument usage error, not a conflict.
    #[test]
    fn install_does_not_accept_a_cli_flag() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--from",
            "/tmp/repo",
            "--harness",
            "kiro-cli-v2",
            "--cli",
        ]);
        assert!(
            result.is_err(),
            "install must not accept --cli at all -- it is update-only"
        );
    }

    // ── --version <v> (release selector) on update/install ──────────────

    #[test]
    fn parses_update_with_version_flag() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::UPDATE, "--version", "v1.2.3"]).unwrap();
        match cli.command {
            Some(Commands::Update {
                release_version, ..
            }) => {
                assert_eq!(release_version, Some("v1.2.3".to_string()));
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn update_version_defaults_to_none_when_omitted() {
        let cli = Cli::try_parse_from(["konductor", Commands::UPDATE]).unwrap();
        match cli.command {
            Some(Commands::Update {
                release_version, ..
            }) => {
                assert_eq!(release_version, None);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    /// `--version <v>` is mutually exclusive with `--from` on `update`:
    /// a local source has no release-version concept.
    #[test]
    fn update_version_conflicts_with_from() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--version",
            "v1.2.3",
            "--from",
            "/tmp/repo",
        ]);
        let err = result.expect_err("--version and --from together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn parses_install_with_version_flag() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--harness",
            "kiro-cli-v2",
            "--version",
            "v1.2.3",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Install {
                release_version, ..
            }) => {
                assert_eq!(release_version, Some("v1.2.3".to_string()));
            }
            other => panic!("expected Install, got {other:?}"),
        }
    }

    /// Same mutual exclusivity on `install`.
    #[test]
    fn install_version_conflicts_with_from() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--harness",
            "kiro-cli-v2",
            "--from",
            "/tmp/repo",
            "--version",
            "v1.2.3",
        ]);
        let err = result.expect_err("--version and --from together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// The new subcommand-scoped `--version <v>` on `update`/`install`
    /// must never collide with the pre-existing top-level boolean
    /// `--version`/`-V` flag: the top-level flag still parses with no
    /// value and prints the binary's own version, unaffected by this
    /// addition.
    #[test]
    fn top_level_version_flag_still_parses_as_a_bare_boolean() {
        let cli = Cli::try_parse_from(["konductor", "--version"]).unwrap();
        assert!(cli.version);
        assert!(cli.command.is_none());
    }

    // ── --force on update/install ────────────────────────────────────────

    #[test]
    fn parses_update_with_force_flag() {
        let cli = Cli::try_parse_from(["konductor", Commands::UPDATE, "--force"]).unwrap();
        match cli.command {
            Some(Commands::Update { force, .. }) => assert!(force),
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn update_force_defaults_to_false_when_omitted() {
        let cli = Cli::try_parse_from(["konductor", Commands::UPDATE]).unwrap();
        match cli.command {
            Some(Commands::Update { force, .. }) => assert!(!force),
            other => panic!("expected Update, got {other:?}"),
        }
    }

    #[test]
    fn parses_install_with_force_flag() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::INSTALL,
            "--from",
            "/tmp/repo",
            "--harness",
            "kiro-cli-v2",
            "--force",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Install { force, .. }) => assert!(force),
            other => panic!("expected Install, got {other:?}"),
        }
    }

    /// `--force` is compatible with `--cli` at the clap level (no
    /// `conflicts_with` between them), even though `--force` has no
    /// effect on the `--cli` axis at runtime (see `update.rs`'s own
    /// dispatch, which never reads `force` when `cli` is true).
    #[test]
    fn update_force_is_compatible_with_cli_at_parse_time() {
        let cli = Cli::try_parse_from(["konductor", Commands::UPDATE, "--cli", "--force"]).unwrap();
        match cli.command {
            Some(Commands::Update {
                cli: cli_flag,
                force,
                ..
            }) => {
                assert!(cli_flag);
                assert!(force);
            }
            other => panic!("expected Update, got {other:?}"),
        }
    }

    /// An unsupported `--harness` value on `update` is rejected at parse
    /// time, exactly like `install --harness`'s own rejection.
    #[test]
    fn rejects_update_with_unsupported_harness_value() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--harness",
            "not-a-real-harness",
        ]);
        assert!(
            result.is_err(),
            "an unsupported --harness value must be rejected at parse time"
        );
    }

    /// `uninstall --harness <name>` accepts the exact
    /// same values `install --harness` does.
    #[test]
    fn parses_uninstall_with_harness_flag() {
        let cli = Cli::try_parse_from(["konductor", Commands::UNINSTALL, "--harness", "kiro-v3"])
            .unwrap();
        match cli.command {
            Some(Commands::Uninstall { harness, .. }) => {
                assert_eq!(harness, Some("kiro-v3".to_string()));
            }
            other => panic!("expected Uninstall, got {other:?}"),
        }
    }

    /// An unsupported `--harness` value on `uninstall` is rejected at
    /// parse time, exactly like `install --harness`'s own rejection.
    #[test]
    fn rejects_uninstall_with_unsupported_harness_value() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UNINSTALL,
            "--harness",
            "not-a-real-harness",
        ]);
        assert!(
            result.is_err(),
            "an unsupported --harness value must be rejected at parse time"
        );
    }

    /// `--harness` is orthogonal to `--target`/`--all` (it selects
    /// WHICH STRATEGY within a resolved target, not
    /// WHICH TARGET) -- combining it with either must parse cleanly,
    /// never conflict.
    #[test]
    fn parses_uninstall_with_harness_and_all_together() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::UNINSTALL,
            "--all",
            "--harness",
            "claude",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Uninstall { all, harness, .. }) => {
                assert!(all);
                assert_eq!(harness, Some("claude".to_string()));
            }
            other => panic!("expected Uninstall, got {other:?}"),
        }
    }

    /// Same conflict, `uninstall` variant.
    #[test]
    fn rejects_uninstall_with_target_and_all_together() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UNINSTALL,
            "--target",
            "/tmp/dest",
            "--all",
        ]);
        let err = result.expect_err("--target and --all together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn rejects_uninstall_with_all_and_target_together_reverse_order() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UNINSTALL,
            "--all",
            "--target",
            "/tmp/dest",
        ]);
        let err = result.expect_err("--all and --target together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn parses_doctor_with_all_flag() {
        let cli = Cli::try_parse_from(["konductor", Commands::DOCTOR, "--all"]).unwrap();
        match cli.command {
            Some(Commands::Doctor {
                from, target, all, ..
            }) => {
                assert_eq!(from, None);
                assert_eq!(target, None);
                assert!(all);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_with_no_version_check_flag() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::DOCTOR, "--no-version-check"]).unwrap();
        match cli.command {
            Some(Commands::Doctor {
                no_version_check, ..
            }) => {
                assert!(no_version_check);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    #[test]
    fn doctor_no_version_check_defaults_to_false_when_omitted() {
        let cli = Cli::try_parse_from(["konductor", Commands::DOCTOR]).unwrap();
        match cli.command {
            Some(Commands::Doctor {
                no_version_check, ..
            }) => {
                assert!(!no_version_check);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    /// `--no-version-check` is compatible with `--all` -- no
    /// `conflicts_with` between them.
    #[test]
    fn doctor_no_version_check_is_compatible_with_all() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::DOCTOR, "--all", "--no-version-check"])
                .unwrap();
        match cli.command {
            Some(Commands::Doctor {
                all,
                no_version_check,
                ..
            }) => {
                assert!(all);
                assert!(no_version_check);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    /// Same conflict `update`/`uninstall` already enforce between
    /// `--target`/`--all`, mirrored for `doctor`.
    #[test]
    fn rejects_doctor_with_target_and_all_together() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::DOCTOR,
            "--target",
            "/tmp/dest",
            "--all",
        ]);
        let err = result.expect_err("--target and --all together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn rejects_doctor_with_all_and_target_together_reverse_order() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::DOCTOR,
            "--all",
            "--target",
            "/tmp/dest",
        ]);
        let err = result.expect_err("--all and --target together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// `doctor` has no `update`/`uninstall` precedent for `--from`
    /// conflicting with `--all` -- a single source override doesn't
    /// make sense across multiple targets that may have recorded
    /// different sources, so this is enforced as a new, clearly-reasoned
    /// conflict (see `cli.rs`'s `Doctor::from` doc comment).
    #[test]
    fn rejects_doctor_with_from_and_all_together() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::DOCTOR,
            "--from",
            "/tmp/repo",
            "--all",
        ]);
        let err = result.expect_err("--from and --all together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    #[test]
    fn rejects_doctor_with_all_and_from_together_reverse_order() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::DOCTOR,
            "--all",
            "--from",
            "/tmp/repo",
        ]);
        let err = result.expect_err("--all and --from together must be a usage error");
        assert_eq!(err.kind(), clap::error::ErrorKind::ArgumentConflict);
    }

    /// `parse_or_exit`'s catch-all arm treats an `ArgumentConflict` the
    /// same as any other usage error. This is a static check on the
    /// error kind, not a subprocess exit-code check (`parse_or_exit`
    /// calls `std::process::exit` directly).
    #[test]
    fn argument_conflict_is_not_a_display_kind_and_falls_through_to_usage_remap() {
        let result = Cli::try_parse_from([
            "konductor",
            Commands::UPDATE,
            "--target",
            "/tmp/dest",
            "--all",
        ]);
        let kind = result.expect_err("must be a parse error").kind();
        use clap::error::ErrorKind;
        assert_ne!(kind, ErrorKind::DisplayHelp);
        assert_ne!(kind, ErrorKind::DisplayVersion);
        assert_ne!(kind, ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand);
    }

    #[test]
    fn parses_bare_uninstall_with_no_flags() {
        let cli = Cli::try_parse_from(["konductor", Commands::UNINSTALL]).unwrap();
        match cli.command {
            Some(Commands::Uninstall { target, all, .. }) => {
                assert_eq!(target, None);
                assert!(!all);
            }
            other => panic!("expected Uninstall, got {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_with_from_and_target_flags_together() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::DOCTOR,
            "--from",
            "/tmp/repo",
            "--target",
            "/tmp/dest",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Doctor {
                from, target, all, ..
            }) => {
                assert_eq!(from, Some("/tmp/repo".to_string()));
                assert_eq!(target, Some("/tmp/dest".to_string()));
                assert!(!all);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    #[test]
    fn parses_init_with_valid_preset() {
        let cli = Cli::try_parse_from(["konductor", Commands::INIT, "--preset", "solo"]).unwrap();
        match cli.command {
            Some(Commands::Init { preset, force }) => {
                assert_eq!(preset, Some("solo".to_string()));
                assert!(!force);
            }
            other => panic!("expected Init, got {other:?}"),
        }
    }

    #[test]
    fn parses_init_with_force_flag() {
        let cli = Cli::try_parse_from(["konductor", Commands::INIT, "--force"]).unwrap();
        match cli.command {
            Some(Commands::Init { force, .. }) => assert!(force),
            other => panic!("expected Init, got {other:?}"),
        }
    }

    #[test]
    fn rejects_init_with_invalid_preset() {
        let result = Cli::try_parse_from(["konductor", Commands::INIT, "--preset", "bogus"]);
        assert!(result.is_err());
    }

    #[test]
    fn parses_config_get() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::CONFIG,
            ConfigAction::GET,
            "workflow.timeout",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Config {
                action: ConfigAction::Get { key },
            }) => assert_eq!(key, "workflow.timeout"),
            other => panic!("expected Config Get, got {other:?}"),
        }
    }

    #[test]
    fn parses_config_set() {
        let cli = Cli::try_parse_from([
            "konductor",
            Commands::CONFIG,
            ConfigAction::SET,
            "workflow.timeout",
            "30",
        ])
        .unwrap();
        match cli.command {
            Some(Commands::Config {
                action: ConfigAction::Set { key, value },
            }) => {
                assert_eq!(key, "workflow.timeout");
                assert_eq!(value, "30");
            }
            other => panic!("expected Config Set, got {other:?}"),
        }
    }

    #[test]
    fn parses_global_options() {
        let cli = Cli::try_parse_from([
            "konductor",
            "--verbose",
            "--json",
            "--no-color",
            Commands::DOCTOR,
        ])
        .unwrap();
        assert!(cli.verbose);
        assert!(cli.json);
        assert!(cli.no_color);
    }

    #[test]
    fn unknown_command_is_usage_error() {
        let result = Cli::try_parse_from(["konductor", "not-a-real-command"]);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert_ne!(
            err.kind(),
            clap::error::ErrorKind::DisplayHelp,
            "unknown command must not be treated as a help display"
        );
    }

    #[test]
    fn missing_required_config_set_value_is_usage_error() {
        let result =
            Cli::try_parse_from(["konductor", Commands::CONFIG, ConfigAction::SET, "only-key"]);
        assert!(result.is_err());
    }

    #[test]
    fn usage_error_exit_code_is_not_critical_gate() {
        // Guards the pitfall documented at the top of this file: the
        // remapped usage-error code must never equal the contract's
        // "unresolved CRITICAL gate" code.
        assert_ne!(EXIT_USAGE_ERROR, EXIT_CRITICAL_GATE);
    }

    // ── Help-text regression: `config get`'s <KEY> example must be a real
    // field ──────────────────────────────────────────────────────────────
    //
    // `parses_config_get`/`parses_config_set` above still use
    // "workflow.timeout" as an unknown-key probe value for rejection
    // testing; that's separate from the --help text itself, which must
    // show a real, resolvable field name.

    #[test]
    fn config_get_help_does_not_show_workflow_timeout_example() {
        let mut cmd = Cli::command();
        let config_cmd = cmd
            .find_subcommand_mut(Commands::CONFIG)
            .expect("config subcommand must exist")
            .find_subcommand_mut(ConfigAction::GET)
            .expect("config get subcommand must exist");
        let help_text = config_cmd.render_help().to_string();
        assert!(
            !help_text.contains("workflow.timeout"),
            "config get --help must not show the fictional 'workflow.timeout' \
             example -- it is not a real config field (see gate-config/config.yml)"
        );
    }

    #[test]
    fn config_get_help_shows_a_real_config_field_example() {
        let mut cmd = Cli::command();
        let config_cmd = cmd
            .find_subcommand_mut(Commands::CONFIG)
            .expect("config subcommand must exist")
            .find_subcommand_mut(ConfigAction::GET)
            .expect("config get subcommand must exist");
        let help_text = config_cmd.render_help().to_string();
        assert!(
            help_text.contains("default_severity"),
            "config get --help must show a real config field as its example key, got: {help_text}"
        );
    }

    // ── display_order regression: --harness first in install --help ────

    /// `--harness` is the only clap-required field on `Install`, and
    /// `display_order` puts it first: this pins that `install --help`
    /// shows it before every other Install flag, rather than clap's
    /// default alphabetical ordering.
    #[test]
    fn install_help_shows_harness_before_every_other_flag() {
        let mut cmd = Cli::command();
        let install_cmd = cmd
            .find_subcommand_mut(Commands::INSTALL)
            .expect("install subcommand must exist");
        let help_text = install_cmd.render_help().to_string();
        let harness_pos = help_text
            .find("--harness")
            .expect("--harness must appear in install --help");
        for other_flag in [
            "--from",
            "--target",
            "--link-bin",
            "--no-telemetry",
            "--use-github-token",
        ] {
            let other_pos = help_text
                .find(other_flag)
                .unwrap_or_else(|| panic!("{other_flag} must appear in install --help"));
            assert!(
                harness_pos < other_pos,
                "--harness must appear before {other_flag} in install --help, got:\n{help_text}"
            );
        }
    }

    // ── `metrics` hidden-from-help regression ──────────────────────────

    /// Pins `#[command(hide = true)]` on `Commands::Metrics`.
    #[test]
    fn metrics_does_not_appear_in_top_level_help() {
        let help_text = Cli::command().render_help().to_string();
        assert!(
            !help_text.contains(Commands::METRICS),
            "konductor --help must not list 'metrics' -- it has no real \
             implementation yet, got:\n{help_text}"
        );
    }

    /// Hiding `metrics` from `--help` must never silently become removing
    /// it: `konductor metrics` still parses to `Commands::Metrics` and
    /// still dispatches to its not-implemented stub, exiting 0.
    #[test]
    fn metrics_still_parses_and_dispatches() {
        let cli = Cli::try_parse_from(["konductor", Commands::METRICS])
            .expect("`konductor metrics` must still parse even though it is hidden from --help");
        let command = cli
            .command
            .expect("a command must be present for `konductor metrics`");
        assert!(
            matches!(command, Commands::Metrics { since: None }),
            "expected Commands::Metrics {{ since: None }}, got {command:?}"
        );
        let exit_code = dispatch::dispatch(command, false, false, output::ColorMode::disabled());
        assert_eq!(
            exit_code, 0,
            "`konductor metrics` must still dispatch and exit 0 (its stub behavior is unchanged)"
        );
    }
}
