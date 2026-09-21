// SPDX-License-Identifier: Apache-2.0
//
// cli.rs — Konductor CLI command surface (Rust / clap implementation).
//
// There is no separate hand-authored spec file. This file defines the
// command surface directly via clap derive macros. The hidden
// `__dump_schema` command (see cli/schema.rs) exposes the live command
// tree as JSON so external tooling can validate the surface structurally
// rather than re-declaring it by hand. If you change the command
// surface, update this file (and any consumer of the schema dump).
//
// `init` and `config get/set/list` have real behavior (see cli/config.rs
// and cli/init.rs) -- `init` scaffolds `.konductor/` and writes a starter
// config.yml; `config get/set/list` read/report the effective merged
// configuration. `install`, `synth`, `update`, `uninstall`, and `doctor`
// also have real behavior (see cli/install.rs, cli/synth/mod.rs,
// cli/update.rs, cli/uninstall.rs, cli/doctor.rs) -- `doctor` inspects an
// install/checkout for problems via the same functions those commands
// already use, reporting a per-check ok/info/failed/stale status with
// remediation guidance. The remaining command (metrics) is a STUB at
// this milestone: it parses correctly and prints a "not yet
// implemented" message, then exits 0. No real business logic, no
// network calls, no filesystem mutation for it.
//
// ── Exit-code contract (Engineering Design §6) ─────────────────────────────
//   0 = all passed        1 = halted        2 = unresolved CRITICAL gate
//   3 = budget exceeded    4 = user aborted a paused verdict
//
// ── Usage-error remap (PITFALL) ────────────────────────────────────────────
// clap defaults CLI usage errors (bad flag, unknown subcommand, missing
// required arg) to exit code 2. That collides with this contract's
// "unresolved CRITICAL gate" signal. We intercept parse failures via
// `Cli::try_parse()` and exit with `EX_USAGE` (64, BSD sysexits.h) instead,
// so a malformed invocation is never mistaken for a gate failure. `--help`
// and `--version` (clap's own "DisplayHelp"/"DisplayVersion" outcomes) are
// NOT usage errors and keep clap's normal exit-0 behavior.

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
/// process-global `HOME` env var. `std::env::set_var` has no per-thread
/// scoping -- it mutates one process-wide table shared by every thread,
/// including the default multi-threaded `cargo test` harness. Each of
/// `install.rs`/`uninstall.rs`/`update.rs`/`logging.rs` used to keep its
/// own MODULE-PRIVATE `HOME_ENV_LOCK`, which only serialized tests
/// WITHIN that one module -- two of those tests, in different modules,
/// running concurrently could still both point `HOME` at their own
/// scratch dir at the same instant, each overwriting the other's value
/// process-wide (confirmed directly: `update.rs`'s
/// `dispatch_update_ambiguity_still_returns_usage_error_after_fix_3`
/// intermittently read a different module's scratch dir's -- empty --
/// index and failed an assertion that only holds against ITS OWN two
/// freshly-written entries). This single crate-wide lock is the fix:
/// every `HomeGuard` in every module acquires the SAME mutex, so no two
/// HOME-mutating tests anywhere in this crate can run concurrently,
/// regardless of which module they live in.
#[cfg(test)]
pub(crate) mod test_home_lock {
    use std::sync::{Mutex, MutexGuard};

    pub(crate) static HOME_ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Acquires `HOME_ENV_LOCK`, recovering the guard even if a previous
    /// holder panicked while it was held -- a prior test failing an
    /// assertion while holding this lock must not cascade into every
    /// later HOME-mutating test in the crate also failing with
    /// `PoisonError`, which would mask which test's assertion actually
    /// failed first.
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

/// `konductor install`'s artifact checksum verification failed. A runtime
/// failure (corrupt/tampered download), not a usage error -- distinct
/// from `EXIT_USAGE_ERROR` (64) and never one of the reserved 0-4
/// workflow codes. BSD sysexits.h EX_DATAERR: "input data was incorrect
/// in some way". Also reused by `uninstall`/`update` (see `uninstall.rs`)
/// for their own `ManifestError`/`IndexError`/`BinLinkError`
/// `UnsupportedSchemaVersion`/`RollbackAlsoFailed` cases, which are the
/// same "state/verification failure" kind of thing this code names, not
/// an unrelated reuse.
#[allow(dead_code)]
const EXIT_VERIFY_FAILED: u8 = 65;

/// Exit code for an otherwise-successful lifecycle command that hit a
/// non-fatal warning-level failure -- e.g. `uninstall`'s own
/// `--link-bin` symlink-removal failure (see `uninstall.rs`'s
/// `UninstallCounts.bin_link_error`/`exit_code_for_counts`), where every
/// file the command was responsible for was still handled correctly,
/// but the caller should know one non-critical step did not fully
/// succeed. Distinct from 0 (no warnings) and from
/// `EXIT_USAGE_ERROR`/`EXIT_VERIFY_FAILED` (a real failure, not a
/// warning on top of a success). Reservation documented in
/// `cli/README.md`'s exit-code contract table alongside this file's own
/// codes -- CR comment r1p10's fix: this constant used to live in
/// `uninstall.rs`, a private module, even though the contract it
/// belongs to sits here beside `EXIT_CRITICAL_GATE`/`EXIT_USAGE_ERROR`/
/// `EXIT_VERIFY_FAILED` -- nothing there stopped a future command from
/// claiming 6 for something unrelated.
pub(crate) const EXIT_SUCCESS_WITH_WARNINGS: u8 = 6;

const EXIT_HALTED: u8 = 1;

/// `--help` text styling (clap's own `Command::styles()`). Independent
/// of `ColorMode`/`--no-color`/`NO_COLOR`: clap's styled-output writer
/// does its own TTY/`NO_COLOR` detection, and this crate's own
/// `--no-color` wiring only applies to its own `println!`/`eprintln!`
/// call sites, not clap's `--help`/`--version` output.
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
    /// Path to the Konductor config file.
    #[arg(long, global = true, default_value = ".konductor/config.yml")]
    pub config: String,

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

/// Builds the `--harness` value parser directly from
/// `synth::registry::TRANSFORMERS`, so the accepted values always match
/// the registered transformers with no separate literal list to keep in
/// sync by hand. This matters beyond tidiness: a harness name absent from
/// this parser is rejected by clap as an "invalid choice" before
/// `install::report_no_strategy_for_harness` ever runs, so that function's
/// more informative "real, synthed harness with no install strategy yet"
/// message can only fire for a value clap already accepts. Deriving the
/// accepted set from the registry means every registered transformer is
/// selectable immediately, keeping that distinction reachable for it too.
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
        /// REQUIRED: which synthed harness output to install. Accepts
        /// the same harness identifier `konductor synth` registers each
        /// transformer under (`synth::registry::TRANSFORMERS`'s
        /// `name()` values) -- the accepted set is derived from that
        /// registry at parse time (`harness_value_parser`) rather than
        /// duplicated here as a literal list, so a newly-registered
        /// transformer becomes selectable immediately, without a
        /// matching edit to this attribute. There is no default and no
        /// destination-marker auto-detection any more -- every `install`
        /// invocation must say explicitly which harness it means, so a
        /// destination that happens to carry both a `.kiro` and a
        /// `.claude` marker (see `runtime.rs`'s own `detects_both` test)
        /// is never silently resolved by registration order.
        ///
        /// `display_order = 0`: the only clap-required field on this
        /// command, so it is pinned first in `install --help`'s
        /// Options: list rather than left to clap's default
        /// alphabetical ordering, which would otherwise bury it
        /// between `--from` and `--link-bin`.
        #[arg(long, value_parser = harness_value_parser(), display_order = 0)]
        harness: String,

        /// SOURCE: path to a local repo root to install previously-built
        /// (synthed) content from. Currently required: installing from a
        /// published release is not yet available. Distinct from
        /// `--target`, which is the install DESTINATION.
        #[arg(long, display_order = 1)]
        from: Option<String>,

        /// DESTINATION: directory to install into (agents/context under
        /// `<dir>/.kiro/`, skills under `<dir>/.konductor/skills/`,
        /// SOPs under `<dir>/.konductor/sops/` plus a Kiro-discoverable
        /// `sop-<name>/SKILL.md` conversion under `<dir>/.kiro/skills/`
        /// for the Kiro harnesses). Defaults to `$HOME` when omitted.
        /// Pass `.` to install into the current working directory.
        /// Distinct from `--from`, which is the install SOURCE.
        #[arg(long, display_order = 2)]
        target: Option<String>,

        /// Also symlink the currently-running `konductor` binary to
        /// `$HOME/.local/bin/konductor`, so `konductor` is callable from
        /// anywhere on `$PATH` -- the same manual step
        /// `cli/README.md`'s "Getting started"/"Putting it on your PATH"
        /// sections and `make link` (`cli/Makefile`) already document,
        /// now available at install time. Independent of `--target`: the
        /// symlink always lands at the fixed `$PATH` location above,
        /// regardless of where content was installed. Idempotent -- an
        /// existing symlink pointing at a different `konductor` binary
        /// (e.g. after a rebuild/relocation) is repointed at the current
        /// one; a foreign non-symlink file at that path is never
        /// overwritten. `konductor uninstall` removes a symlink this
        /// flag created when the target it belongs to is uninstalled.
        #[arg(long = "link-bin", action = ArgAction::SetTrue, display_order = 3)]
        link_bin: bool,

        /// Opt out of usage-analytics telemetry for this install.
        /// Structural: when passed, the identity-file write and
        /// hook-injection steps are never reached at all -- there is no
        /// disabled artifact left behind to inspect.
        #[arg(long, display_order = 4)]
        no_telemetry: bool,

        /// Opt in to reading `GITHUB_TOKEN` from the environment for
        /// the no-`--from` remote install path (GitHub Release
        /// metadata lookup, and the main-branch-`dist/` fallback's
        /// Contents API requests). Without this flag, `GITHUB_TOKEN`
        /// is never read, even if it's set in the shell -- the
        /// environment variable is opt-in, not ambient. Has no effect
        /// on a `--from <repo-root>` install, which never touches
        /// GitHub's API at all.
        #[arg(long = "use-github-token", action = ArgAction::SetTrue, display_order = 5)]
        use_github_token: bool,
    },

    /// Update an existing Konductor installation: unconditionally
    /// overwrites every tracked file with fresh content from a fresh
    /// `--from <repo-root>` synth source -- the exact same file-copy
    /// path `install` itself uses. There is no `--force` flag; a
    /// hand-edited file is overwritten just like any other tracked
    /// file. `--dry-run` reports hash-based divergence per file (which
    /// tracked paths have local edits that would be destroyed) without
    /// writing anything; a real run only reports how many files had
    /// diverged, as an aggregate count, after unconditionally
    /// overwriting all of them -- the count never gates or alters the
    /// overwrite.
    Update {
        /// SOURCE: path to a local repo root to re-synth from, same
        /// meaning as `install --from`. Required to have anything fresh
        /// to re-copy.
        #[arg(long)]
        from: Option<String>,

        /// DESTINATION: the tracked install to update. Required when 2+
        /// installs are tracked in `~/.konductor/installs`; matched
        /// against the index by canonicalized path. Mutually exclusive
        /// with `--all`.
        #[arg(long, conflicts_with = "all")]
        target: Option<String>,

        /// Update every tracked install in `~/.konductor/installs`, one
        /// at a time. Mutually exclusive with `--target`.
        #[arg(long, action = ArgAction::SetTrue, conflicts_with = "target")]
        all: bool,

        /// Which tracked strategy to update, when the resolved target
        /// tracks 2+. Same values and meaning as
        /// `install --harness <name>` -- selects exactly ONE tracked
        /// strategy per run; there is no `all` value. Validated against
        /// the resolved target's tracked strategy name(s) even when only
        /// one is tracked -- a `--harness` value that does not match is
        /// a usage error, not a silent no-op (see
        /// `harness_select::select_harness`). With `--all`, a target
        /// that does not track the requested harness is skipped for
        /// that one target rather than failing the whole batch. Has no
        /// effect when the resolved target tracks 0 strategies. Required
        /// non-interactively (no TTY, or `--json`) when 2+ are tracked;
        /// otherwise an interactive picker lists them.
        #[arg(long, value_parser = harness_value_parser())]
        harness: Option<String>,

        /// Opt out of usage-analytics telemetry for this update run.
        /// Passing it always suppresses telemetry for this run,
        /// regardless of the target's own history -- an explicit
        /// override in either direction (it re-applies an opt-out on a
        /// target that already has an identity file just as readily as
        /// it applies one for the first time).
        ///
        /// When this flag is NOT passed, `update` still honors a
        /// target's earlier choice: on a target that already has a
        /// manifest (an existing install), the ABSENCE of
        /// `.konductor/telemetry-id.json` is read as "this target
        /// opted out at install time" and carried forward -- no need
        /// to re-pass the flag on every `update`. A target whose
        /// identity file IS present is read as opted in. An `--all`
        /// batch resolves this signal independently per target,
        /// matching how each target's own `.konductor/config.yml`
        /// opt-out is already resolved independently.
        ///
        /// Structural, same as `install --no-telemetry`: whenever the
        /// effective opt-out applies (explicit or carried forward), the
        /// Claude Code telemetry-hook re-wiring step is never reached
        /// at all for this run.
        #[arg(long)]
        no_telemetry: bool,

        /// Report exactly what would be overwritten (files, paths) for
        /// each selected target without touching the filesystem in any
        /// way -- no manifest write, no index write, no file copy.
        #[arg(long = "dry-run", action = ArgAction::SetTrue)]
        dry_run: bool,
    },

    /// Remove Konductor from a repository.
    Uninstall {
        /// Uninstall exactly this target directory (canonicalized the
        /// same way `install --target` is). Required when 2+ installs
        /// are tracked in `~/.konductor/installs` -- omitting it in
        /// that case is a usage error naming every tracked install,
        /// rather than defaulting to `$HOME`. With exactly one tracked
        /// install, omitting `--target` acts on that one directly.
        /// Mutually exclusive with `--all`.
        #[arg(long, conflicts_with = "all")]
        target: Option<String>,

        /// Uninstall every tracked install, continuing past a
        /// per-target failure and reporting which targets succeeded or
        /// failed rather than aborting on the first error. Mutually
        /// exclusive with `--target`.
        #[arg(long, action = ArgAction::SetTrue, conflicts_with = "target")]
        all: bool,

        /// Which tracked strategy to uninstall, when the resolved
        /// target tracks 2+. Same values and meaning
        /// as `install --harness <name>` -- selects exactly ONE tracked
        /// strategy per run; there is no `all` value (unaffected: the
        /// existing `--all` flag above still means "every tracked
        /// TARGET", not "every tracked strategy"). Validated against the
        /// resolved target's tracked strategy name(s) even when only one
        /// is tracked -- a `--harness` value that does not match is a
        /// usage error, not a silent no-op (see
        /// `harness_select::select_harness`). With `--all`, a target
        /// that does not track the requested harness is skipped for
        /// that one target rather than failing the whole batch (see
        /// `dispatch_all`). Has no effect when the resolved target
        /// tracks 0 strategies. Required non-interactively (no TTY, or
        /// `--json`) when 2+ are tracked; otherwise an interactive
        /// picker lists them.
        #[arg(long, value_parser = harness_value_parser())]
        harness: Option<String>,

        /// Report exactly what would be removed (files, paths) for each
        /// selected target without touching the filesystem in any way
        /// -- no file delete, no directory cleanup, no manifest/index
        /// write.
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
        /// SOURCE: path to a local repo root to check instead of the cwd
        /// (mirrors `synth --from`/`install --from`). Mutually exclusive
        /// with `--all` -- a single source override doesn't make sense
        /// across multiple targets that may have recorded different
        /// sources.
        #[arg(long, conflicts_with = "all")]
        from: Option<String>,

        /// DESTINATION: install directory to check for a runtime/manifest.
        /// Defaults to `$HOME` when omitted (mirrors `install --target`).
        /// Mutually exclusive with `--all`.
        #[arg(long, conflicts_with = "all")]
        target: Option<String>,

        /// Run every check against every tracked install in
        /// `~/.konductor/installs`, one at a time. Mutually exclusive
        /// with `--from`/`--target`.
        #[arg(long, action = ArgAction::SetTrue, conflicts_with_all = ["from", "target"])]
        all: bool,
    },

    /// Read or write Konductor configuration.
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },

    /// Show Konductor usage/run metrics (stub).
    ///
    /// Hidden from normal --help since it has no real implementation yet
    /// (see dispatch.rs's `print_not_implemented` handling) -- unlike
    /// `__dump_schema`/`__telemetry-hook` below, this keeps its plain
    /// `metrics` name and stays fully invokable; only its --help listing
    /// is suppressed.
    #[command(hide = true)]
    Metrics {
        /// Time window to report metrics for, e.g. "7d", "24h".
        #[arg(long)]
        since: Option<String>,
    },

    /// Dump the live command tree as JSON (internal, for schema
    /// tooling).
    ///
    /// NOT one of the 8 public commands. Hidden from normal --help so it
    /// does not appear as user-facing surface; exists only so external
    /// tooling can walk the REAL clap::Command tree (built by clap
    /// itself, not hand-copied) and structurally validate it, without
    /// re-declaring the surface by hand.
    #[command(hide = true, name = "__dump_schema")]
    DumpSchema,

    /// Parses a runtime hook's stdin payload and reports an
    /// agent/sub-agent invocation event.
    ///
    /// NOT one of the public commands. Hidden from normal --help; this
    /// is the one call site that genuinely needs a hook to be reached
    /// at all -- `konductor-rs` has no process running at the moment a
    /// runtime session starts, or a delegation begins, to observe that
    /// event any other way. `event_type` is `agent-invocation` or
    /// `subagent-invocation`.
    #[command(hide = true, name = "__telemetry-hook")]
    TelemetryHook {
        /// Which event this hook firing represents.
        event_type: String,
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
    /// these literals so call sites (tests included) reference this
    /// instead of repeating the bare string.
    ///
    /// `#[allow(dead_code)]`: exists as the complete, exhaustive mapping
    /// even though not every variant's constant is exercised by a test
    /// yet.
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
/// Every invocation is logged under ~/.konductor/logs/ (see
/// cli/logging.rs), including the three exit paths below that terminate
/// the process directly (before `run()` ever gets a `Cli` to log from) --
/// --help/--version, a bare command-group invocation, and a genuine usage
/// error. This keeps logging coverage consistent across every exit path,
/// not only the successful-parse dispatch path.
pub fn parse_or_exit() -> Cli {
    let argv: Vec<String> = std::env::args().collect();
    match Cli::try_parse() {
        Ok(cli) => cli,
        Err(err) => {
            use clap::error::ErrorKind;
            match err.kind() {
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion => {
                    // Genuine --help / --version. clap exits 0 for these, and
                    // its own `Error::exit()` flushes stdout correctly before
                    // exiting. (A manual `print!` + `std::process::exit()`
                    // would skip flushing Stdout's BufWriter, truncating piped
                    // output.)
                    logging::log_invocation(&argv, 0);
                    err.exit();
                }
                ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand => {
                    // A command group invoked with no subcommand (e.g. bare
                    // `konductor config`). clap DISPLAYS help for this variant,
                    // but `Error::exit()` would exit with code 2 here -- which
                    // collides with the reserved exit code 2 ("unresolved
                    // CRITICAL gate"). Keep exit 0 (help was successfully
                    // shown), but flush stdout explicitly first (same
                    // truncation concern noted for the --help/
                    // --version arm above; destructors that would normally
                    // flush do not run on process::exit).
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
    // Log every invocation under ~/.konductor/logs/ (see cli/logging.rs
    // for the convention this establishes). Logged AFTER dispatch so the
    // recorded code is the real, final one; fail-open (a log-write
    // failure never changes the exit code below it).
    logging::log_invocation(&argv, exit_code);
    ExitCode::from(exit_code)
}

/// Runs the parsed `Cli`, returning the raw numeric exit code (rather than
/// `std::process::ExitCode`, which is intentionally opaque and offers no
/// `From<ExitCode> for u8`) so `run()` above can both construct the real
/// `ExitCode` to return AND pass the same numeric value to
/// `logging::log_invocation` without re-deriving it.
fn run_inner(cli: Cli) -> u8 {
    if cli.version {
        println!("konductor {}", env!("CARGO_PKG_VERSION"));
        return 0;
    }

    let color = output::ColorMode::resolve_from_env(cli.no_color);

    let Some(command) = cli.command else {
        // No subcommand and no --version: this mirrors clap's "missing
        // subcommand" usage error, but since `command` is Optional we
        // handle it explicitly here rather than relying on clap's
        // arg_required_else_help, to keep the remap centralized.
        eprintln!(
            "{} no command given. Run `konductor --help` for usage.",
            output::error_prefix(color, "konductor:")
        );
        return EXIT_USAGE_ERROR;
    };

    dispatch::dispatch(command, cli.verbose, cli.json, color)
}

// Silence an unused-constant warning: EXIT_HALTED and EXIT_CRITICAL_GATE are
// part of the documented contract surface (referenced elsewhere in this file
// and conformance tests reason about them by value). `EXIT_CRITICAL_GATE`
// (2) is reserved for a future CRITICAL-gate feature and isn't returned by
// any handler yet. `EXIT_HALTED` (1) IS returned today, by `doctor`'s own
// local constant of the same value (see cli/doctor.rs), not this one
// directly. This function's only job is keeping `EXIT_CRITICAL_GATE`
// referenced so it isn't flagged dead code before its first real caller.
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

    /// `--harness` has no default -- omitting it entirely must be a
    /// parse error (clap's own `MissingRequiredArgument`), remapped by
    /// `parse_or_exit` to `EXIT_USAGE_ERROR` (64), never a silently
    /// auto-detected default.
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

    /// `--link-bin` itself must parse and set the flag -- the two tests
    /// above only pin the DEFAULT (omitted) case.
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
            Some(Commands::Doctor { from, target, all }) => {
                assert_eq!(from, None);
                assert_eq!(target, None);
                assert!(!all);
            }
            other => panic!("expected Doctor, got {other:?}"),
        }
    }

    #[test]
    fn parses_doctor_with_from_flag() {
        let cli =
            Cli::try_parse_from(["konductor", Commands::DOCTOR, "--from", "/tmp/repo"]).unwrap();
        match cli.command {
            Some(Commands::Doctor { from, target, all }) => {
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
            Some(Commands::Doctor { from, target, all }) => {
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

    /// `--target`/`--all` together on `update` must be rejected by
    /// clap itself at parse time (`conflicts_with`), never silently
    /// letting `--all` win. `parse_or_exit`'s catch-all arm (see this
    /// file's own usage-error remap) sends every non-Display* clap
    /// error to `EXIT_USAGE_ERROR` (64), so no further remapping is
    /// needed here -- this test only pins clap's own parse-time
    /// rejection.
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

    /// Same conflict, flags given in the opposite order -- clap's
    /// `conflicts_with` is symmetric, but pin both orderings directly
    /// rather than assuming.
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
            Some(Commands::Doctor { from, target, all }) => {
                assert_eq!(from, None);
                assert_eq!(target, None);
                assert!(all);
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

    /// Confirms `parse_or_exit`'s catch-all arm treats an
    /// `ArgumentConflict` the same as any other usage error (its match
    /// only special-cases `DisplayHelp`/`DisplayVersion`/
    /// `DisplayHelpOnMissingArgumentOrSubcommand`) -- i.e. it is NOT
    /// one of those three special-cased kinds, so it falls through to
    /// the `_` arm that remaps to `EXIT_USAGE_ERROR` (64). This is a
    /// static assertion on the error KIND, not a subprocess exit-code
    /// check (`parse_or_exit` calls `std::process::exit` directly, so
    /// it cannot be called from within a test process).
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
            Some(Commands::Doctor { from, target, all }) => {
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
            "--config",
            "custom.yml",
            Commands::DOCTOR,
        ])
        .unwrap();
        assert!(cli.verbose);
        assert!(cli.json);
        assert!(cli.no_color);
        assert_eq!(cli.config, "custom.yml");
    }

    #[test]
    fn config_default_matches_spec() {
        let cli = Cli::try_parse_from(["konductor", Commands::DOCTOR]).unwrap();
        assert_eq!(cli.config, ".konductor/config.yml");
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
    // CR review flagged that `config get --help` showed a fictional
    // "workflow.timeout" example. `parses_config_get`/`parses_config_set`
    // above intentionally still use "workflow.timeout" as an
    // unknown-key PROBE VALUE (testing rejection of an unrecognized
    // key) -- that is a different concern from the --help TEXT itself,
    // which must show a real, resolvable field name as its example.
    // These tests pin the fixed help text directly via clap's own
    // `render_help()`, so a future edit can't silently reintroduce the
    // fictional key without a test failure.

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
    /// `display_order` attributes on its fields put it first --
    /// regression test pinning that `install --help`'s Options: list
    /// shows `--harness` before every other Install flag, rather than
    /// clap's default alphabetical ordering (which would place
    /// `--from` first).
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
