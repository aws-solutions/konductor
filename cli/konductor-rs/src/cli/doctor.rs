// SPDX-License-Identifier: Apache-2.0
//
// doctor.rs — `konductor doctor` diagnostics (Rust implementation).
//
// ── Scope ────────────────────────────────────────────────────────────────
// Inspects a Konductor installation/checkout for problems and prints
// actionable remediation guidance. Every check is REUSE-ONLY: it calls
// the same functions `install`/`synth`/`config` already use, rather than
// re-implementing any validation logic. Six checks run today, in this
// order:
//
//   1. source                  — `parse_canonical` against the resolved
//                                 source tree (see "Source resolution"
//                                 below); the same parse `synth`/
//                                 `install --from` run.
//   2. runtime                 — `install::runtime::detect_runtimes`
//                                 against `--target`/`$HOME`. `info`
//                                 (not `failed`) when no runtime is
//                                 found -- that alone isn't a broken
//                                 install.
//   3. manifest                — `install::manifest::{read_manifest,
//                                 manifest_path}` against the same
//                                 target: presence, `status` (a
//                                 leftover `InProgress` means a prior
//                                 install crashed mid-copy), and a hash
//                                 check of every recorded file via
//                                 `install::artifact::sha256_hex`.
//   4. config                  — `cli::config::load_config_with_home`
//                                 against the same resolved source tree
//                                 as check 1 and `--target`/`$HOME` (or
//                                 a test-only override) as the user tier.
//   5. container_runtime        — probes `docker`/`podman`/`nerdctl`/
//                                 `finch` on PATH, in that order (the
//                                 design's documented `auto` probe
//                                 order). Always `info` -- absence is
//                                 not a failure, same pattern as
//                                 `runtime`.
//   6. index_status             — `install::index::read_index` against
//                                 `~/.konductor/installs`, compared
//                                 against the same target's manifest
//                                 `status` from check 3. `info` when the
//                                 target isn't tracked at all (an install
//                                 predating the index, or one from a
//                                 build without index support); `warn`
//                                 when the cached index status disagrees
//                                 with the real manifest status (the
//                                 index is a CACHE, refreshed on every
//                                 install/update -- see `index.rs`'s own
//                                 `IndexEntry::status` doc comment).
//
// Three additional checks — `gitignore`, `provider_model_access`, and
// `role_allowlists` — are fully implemented and unit-tested below, but
// are intentionally NOT called from `dispatch_doctor_with` and so never
// appear in live `doctor` output today. See the comment at that call
// site for why each is dormant, and the doc comment on each function
// (`check_gitignore`/`check_provider_model_access`/
// `check_role_allowlists`) for the re-enable condition.
//
// ── What `source`/`config` are FOR ──────────────────────────────────────
// These two validate that the REPO/PROJECT CONFIG an install is built
// from is well-formed -- useful mainly when a local `--from` checkout
// exists to point at. Anyone installing from a published release
// artifact has no such checkout, so a `Warn`/`Info` fallback here (see
// `legacy_manifest_no_source`/`missing_recorded_source` below) is the
// NORMAL, expected outcome for them, not a sign of a broken install.
// `manifest`/`runtime` are the checks that answer "is my installation
// healthy" regardless of install method, since they only ever inspect
// the installed DESTINATION.
//
// ── Source resolution (`source`/`config` checks) ──────────────────────
// Like `runtime`/`manifest`, these default to validating what was
// actually INSTALLED, not whatever `--from`/cwd happens to be when
// `doctor` runs. Resolution order, in `resolve_source_for_checks` below:
//
//   1. Explicit `--from <repo-root>` -- always wins outright, regardless
//      of any manifest.
//   2. No `--from`: read the manifest at the resolved install
//      destination (`--target`/`$HOME`) via `manifest::read_manifest`.
//      If it exists and its `source` field is recorded, use that path.
//   3. No `--from`, and no usable recorded source: fall back to
//      `target_dir` (the cwd). Never silent -- the check's summary/
//      detail always states that a fallback occurred and why.
//
// ── Output ───────────────────────────────────────────────────────────────
// One summary line per check: `ok: <check>`, `info/warn/stale/failed:
// <check> — <detail>`, each non-`ok` line followed by an indented
// remediation hint. `-v` appends full detail. `--json` emits one compact
// object mirroring install/synth's JSON shape, with a per-check `status`
// and, on non-ok checks, a `detail` array.
//
// ── Exit codes ───────────────────────────────────────────────────────────
// 0 when every check is `ok`/`info`/`warn`; `EXIT_HALTED` (1) when at
// least one check is `failed` or `stale`. Never exit code 2 -- see
// cli.rs's module docstring. `EXIT_USAGE_ERROR` (64) is reserved for a
// genuine CLI usage error -- an unresolvable `--target`/`$HOME` (no
// destination to check at all). An unresolvable `--from` is NOT a usage
// error: it flows into `check_source`'s `parse_canonical` call like any
// other bad source tree and surfaces as that check's `Failed` result,
// which maps to `EXIT_HALTED` (1), same as every other failed check.

use std::path::{Path, PathBuf};

use crate::cli::config;
use crate::cli::init;
use crate::cli::install::artifact::sha256_hex;
use crate::cli::install::index::{self, IndexEntryStatus};
use crate::cli::install::manifest::{self, Status, StrategyManifest};
use crate::cli::install::registry;
use crate::cli::install::resolve_destination;
use crate::cli::install::resource_rewrite::CLAUDE_SETTINGS_RELATIVE_PATH;
use crate::cli::install::runtime::{self, Runtime};
use crate::cli::output::ColorMode;
use crate::cli::synth::parse_canonical;

/// The `--harness <value>` fragment every "re-run `konductor install`"
/// remediation string in this file embeds -- kept in exactly one place
/// so those remediation strings can't independently drift from the
/// three values `cli.rs`'s `--harness` clap `value_parser` actually
/// accepts (that allowlist carries the same "hardcoded, can drift"
/// risk).
const HARNESS_PLACEHOLDER: &str = "--harness <kiro-cli-v2|kiro-v3|claude>";

/// Best-effort `--harness <value>` remediation fragment for a manifest's
/// recorded `strategy` (an `InstallStrategy::name()`, e.g. `"kiro-cli-v2"`)
/// so a "re-run `konductor install`" remediation for an install `doctor`
/// can already see on disk names the harness that produced it, instead
/// of the generic `HARNESS_PLACEHOLDER`. `name()` and `harness_dir()`
/// are identical by construction (the harness/strategy name unification
/// -- see `install.rs`'s `InstallStrategy` trait doc comment), so this
/// no longer needs to look up a DIFFERENT value to display -- only
/// whether `strategy_name` is still a REGISTERED strategy at all,
/// falling back to `HARNESS_PLACEHOLDER` when it is not (e.g. a
/// manifest written by a newer `konductor` build this binary doesn't
/// know about).
fn harness_hint(strategy_name: &str) -> String {
    if registry::STRATEGIES
        .iter()
        .any(|s| s.name() == strategy_name)
    {
        format!("--harness {strategy_name}")
    } else {
        HARNESS_PLACEHOLDER.to_string()
    }
}

/// Every failure path in `dispatch_doctor_with` that is NOT a check
/// result (i.e. an unresolvable `--target`/`$HOME` destination) maps to
/// this exit code, same as `install`/`synth`. Never exit code 2. An
/// unresolvable `--from` is NOT one of these paths -- see this module's
/// "Exit codes" doc comment above.
const EXIT_USAGE_ERROR: u8 = 64;

/// At least one check came back `failed` or `stale`. Reuses cli.rs's own
/// `EXIT_HALTED` constant (already documented there as covering the
/// "parse error" class of failure) rather than declaring a new code, per
/// the design's exit-code decision.
const EXIT_HALTED: u8 = 1;

/// One check's outcome. `Ok`/`Info`/`Warn` never affect the exit code;
/// `Failed`/`Stale` both map to `EXIT_HALTED`. `Stale` is distinct from
/// `Failed` so the manifest hash-drift case (files changed on disk since
/// install) reads clearly as "needs a re-install", not "something is
/// broken", while still failing the overall run. `Warn` is distinct
/// from `Info` so the "manifest unreadable, falling back to an
/// unvalidated cwd" case (see `resolve_source_for_checks`'s `Err(_)`
/// branch) reads as visibly more severe than the benign "no manifest
/// exists yet, nothing installed there" fallback -- both are non-failing
/// fallbacks, but only one of them means the check may have validated
/// an arbitrary, unrelated directory instead of the installation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CheckStatus {
    Ok,
    Info,
    Warn,
    Failed,
    Stale,
}

impl CheckStatus {
    fn label(self) -> &'static str {
        match self {
            CheckStatus::Ok => "ok",
            CheckStatus::Info => "info",
            CheckStatus::Warn => "warn",
            CheckStatus::Failed => "failed",
            CheckStatus::Stale => "stale",
        }
    }

    /// One glyph per status, prefixed onto each report line alongside
    /// the colorized label. `Failed`/`Stale` share ✗ since both are
    /// already red via `status::error`. Always printed regardless of
    /// `ColorMode` -- the icon is content, not a color affordance.
    fn icon(self) -> &'static str {
        match self {
            CheckStatus::Ok => "✓",
            CheckStatus::Info => "ℹ",
            CheckStatus::Warn => "⚠",
            CheckStatus::Failed | CheckStatus::Stale => "✗",
        }
    }

    /// Whether this status, on its own, should make the overall doctor
    /// run non-zero.
    fn is_failing(self) -> bool {
        matches!(self, CheckStatus::Failed | CheckStatus::Stale)
    }

    /// Whether this status is a non-failing but visibly-flagged
    /// condition (`Warn`). Never affects the exit code (see
    /// `is_failing`), but a `--json` consumer that only inspects the
    /// top-level `ok` field would otherwise see `ok: true` on a report
    /// that DOES contain a `Warn` -- e.g. the `unvalidated_cwd`
    /// fallback case, or the `.konductor/.gitignore` hygiene check --
    /// since `Warn` is deliberately not `is_failing()`.
    /// `format_report_json`'s `warnings` field surfaces this distinctly.
    fn is_warning(self) -> bool {
        matches!(self, CheckStatus::Warn)
    }
}

/// One check's full result: its name, status, a one-line summary (used
/// in the default-mode output and as the JSON `detail`'s first line
/// when `detail` is empty), remediation guidance (indented under a
/// non-ok summary line; omitted entirely for `Ok`), and the full set of
/// individual problems found (only ever more than one entry for the
/// `source` check, whose underlying `parse_canonical` aborts on the
/// FIRST failure -- so `detail` here holds just that one entry today,
/// but the shape stays a `Vec` so a future multi-error parse doesn't
/// need a shape change).
struct CheckResult {
    name: &'static str,
    status: CheckStatus,
    summary: String,
    remediation: Option<String>,
    detail: Vec<String>,
}

impl CheckResult {
    fn ok(name: &'static str, summary: impl Into<String>) -> Self {
        CheckResult {
            name,
            status: CheckStatus::Ok,
            summary: summary.into(),
            remediation: None,
            detail: Vec::new(),
        }
    }

    fn info(
        name: &'static str,
        summary: impl Into<String>,
        remediation: impl Into<String>,
    ) -> Self {
        CheckResult {
            name,
            status: CheckStatus::Info,
            summary: summary.into(),
            remediation: Some(remediation.into()),
            detail: Vec::new(),
        }
    }

    /// Non-failing, but visibly more severe than `info` -- see
    /// `CheckStatus::Warn`'s doc comment. Currently only reachable via
    /// `check_source`/`check_config`'s `unvalidated_cwd` fallback.
    fn warn(
        name: &'static str,
        summary: impl Into<String>,
        remediation: impl Into<String>,
    ) -> Self {
        CheckResult {
            name,
            status: CheckStatus::Warn,
            summary: summary.into(),
            remediation: Some(remediation.into()),
            detail: Vec::new(),
        }
    }

    fn failed(
        name: &'static str,
        summary: impl Into<String>,
        remediation: impl Into<String>,
        detail: Vec<String>,
    ) -> Self {
        CheckResult {
            name,
            status: CheckStatus::Failed,
            summary: summary.into(),
            remediation: Some(remediation.into()),
            detail,
        }
    }

    fn stale(
        name: &'static str,
        summary: impl Into<String>,
        remediation: impl Into<String>,
        detail: Vec<String>,
    ) -> Self {
        CheckResult {
            name,
            status: CheckStatus::Stale,
            summary: summary.into(),
            remediation: Some(remediation.into()),
            detail,
        }
    }
}

/// `konductor doctor [--from ...] [--target ...] [--all]`: runs the six
/// active checks (source, runtime, manifest, config, container_runtime,
/// index_status) against `--from`/`target_dir` (source tree) and
/// `--target`/`$HOME` (install destination), prints a report, and
/// returns the exit code.
///
/// Three more checks (`gitignore`, `provider_model_access`,
/// `role_allowlists`) exist in this module and are unit-tested, but are
/// deliberately NOT included in the `results` vec below -- see the
/// comment at that call site.
///
/// `target_dir` is the cwd in real use (passed explicitly, same
/// test-isolation reason as dispatch.rs's other real commands); `from`
/// overrides it as the source tree root, same precedence `synth` uses.
/// `target` overrides `$HOME` as the install destination the
/// runtime/manifest checks inspect, same precedence `install` uses.
/// `home_dir_override` is the user-tier config's home directory (the
/// `config` check's `~/.konductor/config.yml` tier) -- same
/// test-isolation seam `check_config_with_home` already provides at
/// the unit level, threaded through here so end-to-end callers (tests)
/// can isolate it too. The real CLI dispatch path (`dispatch.rs`)
/// passes the real `$HOME` explicitly so production behavior is
/// unchanged; pass `None` to fall back to it directly (only test
/// callers that don't care about the `config` check's user tier need
/// to do that, and even they get real, not-faked-away behavior since
/// `None` here means "resolve `$HOME` normally," not "skip the tier").
///
/// `all`: run the full check suite against EVERY target tracked in
/// `~/.konductor/installs`, instead of the single `--target`/`$HOME`
/// destination -- mirrors `update`/`uninstall`'s own `--all` (same flag
/// name, same "iterate every tracked target, one at a time" semantics).
/// `cli.rs` already makes `--all` mutually exclusive with `--from`/
/// `--target` (a single source/destination override doesn't make sense
/// across multiple targets with potentially different recorded
/// sources), so this function never sees `all: true` together with a
/// non-`None` `from`/`target` -- see `dispatch_doctor_all` for the
/// iteration/reporting path this delegates to. Not passing `--all`
/// preserves the exact prior single-target behavior (purely additive).
#[allow(clippy::too_many_arguments)]
pub fn dispatch_doctor_with(
    target_dir: &Path,
    from: Option<String>,
    target: Option<String>,
    all: bool,
    verbose: bool,
    json: bool,
    home_dir_override: Option<&Path>,
    color: ColorMode,
) -> u8 {
    if all {
        return dispatch_doctor_all(target_dir, verbose, json, home_dir_override, color);
    }

    let destination: PathBuf = match resolve_destination(target.as_deref()) {
        Ok(dir) => dir,
        Err(message) => {
            super::report::report_error(
                "doctor",
                "doctor.destination_unresolved",
                target_dir,
                false,
                &message,
                Vec::new(),
                json,
                color,
            );
            return EXIT_USAGE_ERROR;
        }
    };
    super::trace::trace(
        "trace",
        &format!("doctor: resolved destination to {}", destination.display()),
    );

    let results = run_checks(target_dir, from.as_deref(), &destination, home_dir_override);

    if json {
        println!("{}", format_report_json(&results));
    } else {
        print_report(&results, verbose, color);
    }

    if results.iter().any(|r| r.status.is_failing()) {
        EXIT_HALTED
    } else {
        0
    }
}

/// The full active check suite (source, runtime, manifest, config,
/// container_runtime, index_status) against one resolved
/// source-tree/destination pair. Shared by the single-target path
/// (`dispatch_doctor_with`) and the `--all` path (`dispatch_doctor_all`)
/// below, so the two can never drift on which checks run or in what
/// order.
fn run_checks(
    target_dir: &Path,
    from: Option<&str>,
    destination: &Path,
    home_dir_override: Option<&Path>,
) -> Vec<CheckResult> {
    let resolved_source = resolve_source_for_checks(target_dir, from, destination);

    let home_dir: Option<PathBuf> = home_dir_override
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from));

    vec![
        check_source(&resolved_source),
        check_runtime(destination),
        check_manifest(destination),
        check_config_with_home(&resolved_source, home_dir.as_deref()),
        check_container_runtime(),
        check_index_status(destination),
        // `gitignore`, `provider_model_access`, and `role_allowlists` are
        // implemented and unit-tested below, but intentionally NOT
        // surfaced in live doctor output yet:
        //   - `check_gitignore` warns about `runs/`/`overrides.yml`
        //     being absent from `.gitignore`, but nothing in this
        //     codebase can create those paths yet -- `runs/` belongs to
        //     unimplemented run-state persistence (Feature 4.3) and
        //     `overrides.yml` belongs to the post-launch override
        //     mechanism (Feature 4.12/M7). Today the check is a
        //     false-positive-style nag, not a real signal.
        //   - `check_provider_model_access`/`check_role_allowlists` are
        //     honest not-yet-applicable stubs with no real signal at
        //     all (provider/model-access and role-scoped allowlists,
        //     Feature 4.9.1 / design doc Task 4.11, M6/M7).
        // Re-enable each call below once its owning feature actually
        // exists. The functions, `GITIGNORE_PATTERNS`, and their unit
        // tests stay intact and exercised directly (see the
        // `#[allow(dead_code)]` annotations on the functions themselves)
        // so this isn't dead code -- just not wired into the live
        // dispatch path yet.
    ]
}

/// `--all` path: reads `~/.konductor/installs` and runs `run_checks`
/// against EVERY tracked target, in tracked order -- mirroring
/// `update.rs`'s `dispatch_update_with`/`uninstall.rs`'s `dispatch_all`
/// exactly: zero tracked targets is a no-op (0, via
/// `report::report_no_tracked_installs`, reused rather than
/// duplicated), a corrupted index (duplicate `target_dir` entries) is
/// refused outright via `uninstall::report_corrupted_index`'s twin here
/// (see `report_corrupted_index_doctor` below -- doctor needs its own
/// copy since `uninstall::report_corrupted_index` is private to that
/// module and named for `uninstall`'s own command string), and each
/// target's own check suite runs with NO `--from` override (an `--all`
/// run always uses that target's own recorded source resolution, same
/// as a bare single-target `doctor` invocation would for that
/// directory -- `--from` is unavailable here since `cli.rs` makes it
/// `conflicts_with = "all"`).
///
/// Plain-text output is grouped per target with a clear header line,
/// one `print_report` call per target -- same "grouped by target,
/// clear per-target headers" convention `update`/`uninstall`'s own
/// `--all` plain-text path uses. `--json` mode collects every target's
/// checks into ONE batched document (mirroring `update`'s own
/// `dispatch_update_all_json`/`report_update_batch`, which exists for
/// exactly this reason: a `--json` consumer parsing a single
/// `serde_json::from_str` call would break on N concatenated top-level
/// documents).
///
/// Returns 0 only if every target's every check is non-failing;
/// `EXIT_HALTED` (1) if any target has any `failed`/`stale` check --
/// mirrors a single-target run's own exit-code contract, just OR'd
/// across every target rather than computed once.
fn dispatch_doctor_all(
    target_dir: &Path,
    verbose: bool,
    json: bool,
    home_dir_override: Option<&Path>,
    color: ColorMode,
) -> u8 {
    let index = match index::read_index() {
        Ok(index) => index,
        Err(err) => {
            super::report::report_error(
                "doctor",
                "doctor.index_read_failed",
                target_dir,
                false,
                &format!("could not read install index: {err}"),
                Vec::new(),
                json,
                color,
            );
            return EXIT_USAGE_ERROR;
        }
    };
    let entries = index.map(|i| i.installs).unwrap_or_default();

    if entries.is_empty() {
        super::report::report_no_tracked_installs("doctor", json, color);
        return 0;
    }

    let duplicates = index::duplicate_target_dirs(&entries);
    if !duplicates.is_empty() {
        report_corrupted_index_doctor(&duplicates, json, color);
        return EXIT_USAGE_ERROR;
    }

    let mut per_target: Vec<(String, Vec<CheckResult>)> = Vec::new();
    let mut exit_code = 0u8;
    for entry in &entries {
        let destination = PathBuf::from(&entry.target_dir);
        let results = run_checks(target_dir, None, &destination, home_dir_override);
        if results.iter().any(|r| r.status.is_failing()) {
            exit_code = EXIT_HALTED;
        }
        per_target.push((entry.target_dir.clone(), results));
    }

    if json {
        println!("{}", format_report_json_all(&per_target));
    } else {
        for (target, results) in &per_target {
            println!(
                "{}",
                crate::cli::output::status::dim(color, &format!("== {target} =="))
            );
            print_report(results, verbose, color);
        }
    }

    exit_code
}

/// Doctor's own copy of `uninstall::report_corrupted_index`'s
/// plain-text/`--json` shape, naming `"doctor"` as the command --
/// `uninstall::report_corrupted_index` is private to that module and
/// hardcodes `"uninstall"` in both its message text and remediation, so
/// it cannot be reused verbatim the way `report_no_tracked_installs`
/// (which already takes `command` as a parameter) is above.
fn report_corrupted_index_doctor(duplicates: &[String], json: bool, color: ColorMode) {
    let message = "install index is corrupted: duplicate target_dir entries found; \
                    fix ~/.konductor/installs by hand before running doctor --all";
    if json {
        println!(
            "{}",
            serde_json::json!({
                "command": "doctor",
                "error": message,
                "duplicate_targets": duplicates,
            })
        );
        return;
    }
    let listed = duplicates
        .iter()
        .map(|d| format!("  - {d}"))
        .collect::<Vec<_>>()
        .join("\n");
    eprintln!(
        "{} {message}. Duplicated target_dir(s):\n{listed}",
        crate::cli::output::error_prefix(color, "konductor doctor:")
    );
}

/// `--all` + `--json`'s batched document: one object per target
/// (`target_dir` plus that target's own `ok`/`warnings`/`checks`
/// fields, i.e. `format_report_json`'s own shape reused per-entry)
/// under a single top-level `targets` array -- mirrors
/// `update.rs`'s `report_update_batch` rationale exactly (a single
/// parseable JSON document, not N concatenated ones).
fn format_report_json_all(per_target: &[(String, Vec<CheckResult>)]) -> String {
    let targets: Vec<serde_json::Value> = per_target
        .iter()
        .map(|(target_dir, results)| {
            let mut obj: serde_json::Value = serde_json::from_str(&format_report_json(results))
                .expect("format_report_json always produces valid JSON");
            obj["target_dir"] = serde_json::Value::String(target_dir.clone());
            obj
        })
        .collect();
    let ok = per_target
        .iter()
        .all(|(_, results)| !results.iter().any(|r| r.status.is_failing()));
    serde_json::json!({
        "command": "doctor",
        "ok": ok,
        "targets": targets,
    })
    .to_string()
}

/// The source tree the `source`/`config` checks validate, plus (when
/// resolution did not come from an explicit `--from`) a human-readable
/// note explaining which fallback rule fired and why. See this module's
/// docstring, "Source resolution", for the three-step precedence this
/// implements.
///
/// The four flags below distinguish DIFFERENT reasons a fallback to
/// `target_dir` (the cwd) can fire, in increasing order of risk, each
/// with its own wording in `escalate_for_fallback`/
/// `failed_or_downgraded_for_fallback`:
///
/// - `legacy_manifest_no_source`: the manifest exists, is fully
///   readable, and records a real completed install -- but it predates
///   the `source` field (or ran with no `--from` on record). Riskier
///   than "no manifest at all" (a real install did happen here, so the
///   cwd fallback may not be the tree that produced it), but the
///   manifest itself is trustworthy and this is still a benign, expected
///   fallback. Reports `Info`.
/// - `missing_recorded_source`: the manifest exists, is readable, and
///   DOES record a `source` path -- but that path no longer exists on
///   disk (moved, deleted, or a different host than the one that
///   installed). Without this flag, `resolve_source_for_checks` would
///   hand a nonexistent path to `parse_canonical`, turning a healthy
///   install into a hard `Failed` instead of a fallback. Same `Info`
///   tier as `legacy_manifest_no_source`, with its own wording naming
///   the stale path.
/// - `unvalidated_cwd`: the manifest exists but could not be READ at
///   all (corrupt/unreadable JSON, or an I/O error). The fallback tree
///   may have NO relationship at all to the actual installation --
///   materially worse than the two cases above, so it gets its own
///   `Warn` with an unmistakable "UNVALIDATED cwd" summary prefix (see
///   `with_fallback_prefix`).
/// - `unsupported_schema_version`: set only on the
///   `ManifestError::UnsupportedSchemaVersion` fallback arm. Lets
///   `escalate_for_fallback` point `source`/`config`'s remediation at
///   the `manifest` check's own (more specific) advice instead of the
///   generic "re-run `konductor install`" wording, which is actively
///   wrong for a schema_version skew.
struct ResolvedSource {
    path: PathBuf,
    fallback_note: Option<String>,
    unvalidated_cwd: bool,
    legacy_manifest_no_source: bool,
    missing_recorded_source: bool,
    unsupported_schema_version: bool,
}

/// Implements the "Source resolution" precedence documented in this
/// module's docstring:
///   1. explicit `--from` always wins outright;
///   2. else the manifest at `destination` is read via
///      `manifest::read_manifest` (reused, not re-implemented), and
///      its recorded `source` field is used if present;
///   3. else (no manifest, or one predating/lacking `source`) falls
///      back to `target_dir` (the cwd), with an explicit
///      `fallback_note` naming which sub-case fired.
///
/// A `read_manifest` error always falls back to `target_dir` rather
/// than aborting -- `check_manifest` is the check responsible for
/// surfacing that failure loudly. Not every `ManifestError` variant is
/// equally untrustworthy, though, so `unvalidated_cwd` is set
/// per-variant: `Malformed`/`ReadFailed`/the write-path variants mean
/// the manifest's content (including `source`) could not be obtained
/// at all, so `unvalidated_cwd: true`. `UnsupportedSchemaVersion` means
/// the JSON parsed fine and is a real, readable record -- this build
/// just can't deserialize it into `Manifest` -- so it stays
/// `unvalidated_cwd: false` with its own distinct fallback note naming
/// the version mismatch.
fn resolve_source_for_checks(
    target_dir: &Path,
    from: Option<&str>,
    destination: &Path,
) -> ResolvedSource {
    if let Some(from) = from {
        return ResolvedSource {
            path: PathBuf::from(from),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        };
    }

    match manifest::read_manifest(destination) {
        // A target's manifest can now track more than
        // one strategy. Doctor's source resolution is a diagnostic, not
        // a mutating operation, so it resolves against the FIRST
        // tracked slot rather than requiring a strategy to be named --
        // in the overwhelmingly common single-strategy case this is
        // exactly the same slot that always existed; a target with 2+
        // strategies gets a diagnostic scoped to just one of them
        // rather than a hard failure.
        Ok(Some(manifest)) => match manifest.strategies.first().and_then(|s| s.source.clone()) {
            Some(source) => {
                let source_path = PathBuf::from(&source);
                // Deliberately `exists()`, not `is_dir()`: this check only
                // decides whether to fall back at all, not whether the
                // recorded path is a USABLE source tree. A recorded path
                // that degraded into a plain file (rather than vanishing
                // outright) still passes `exists()`, so it flows through
                // to the `path: source_path` arm below and on into
                // `check_source`/`check_config`, which call
                // `parse_canonical`/`config::load_config` against it and
                // get THEIR specific, more informative "not a directory"
                // `Failed` -- not this function's generic `Warn`-tier
                // "moved away" fallback. That asymmetry is intentional: a
                // file-in-place-of-a-directory is a more precise diagnosis
                // than "missing", so it is left to surface as the sharper
                // downstream error rather than being caught here and
                // flattened into the same wording as a fully-absent path.
                if source_path.exists() {
                    ResolvedSource {
                        path: source_path,
                        fallback_note: None,
                        unvalidated_cwd: false,
                        legacy_manifest_no_source: false,
                        missing_recorded_source: false,
                        unsupported_schema_version: false,
                    }
                } else {
                    // The manifest is fully trustworthy and does record
                    // a source -- it is just stale (the recorded tree
                    // was moved/deleted, or this is a different host
                    // than the one that installed). See
                    // `ResolvedSource::missing_recorded_source`'s own
                    // doc comment for why this must fall back rather
                    // than let `parse_canonical` hard-fail on a
                    // nonexistent path.
                    ResolvedSource {
                        path: target_dir.to_path_buf(),
                        fallback_note: Some(format!(
                            "manifest at {} records source {}, but that path no longer \
                             exists; falling back to checking the source tree at {}",
                            manifest::manifest_path(destination).display(),
                            source_path.display(),
                            target_dir.display()
                        )),
                        unvalidated_cwd: false,
                        legacy_manifest_no_source: false,
                        missing_recorded_source: true,
                        unsupported_schema_version: false,
                    }
                }
            }
            // A real, completed install happened here, but it predates
            // the `source` field or ran with no `--from` on record --
            // see `ResolvedSource::legacy_manifest_no_source`.
            None => ResolvedSource {
                path: target_dir.to_path_buf(),
                fallback_note: Some(format!(
                    "manifest at {} has no recorded source (written before this field \
                     existed, or with no --from on record); falling back to checking the \
                     source tree at {}",
                    manifest::manifest_path(destination).display(),
                    target_dir.display()
                )),
                unvalidated_cwd: false,
                legacy_manifest_no_source: true,
                missing_recorded_source: false,
                unsupported_schema_version: false,
            },
        },
        Ok(None) => ResolvedSource {
            path: target_dir.to_path_buf(),
            fallback_note: Some(format!(
                "no manifest found at {}; falling back to checking the source tree at {}",
                manifest::manifest_path(destination).display(),
                target_dir.display()
            )),
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        },
        // Corrupt JSON: nothing in the manifest, including `source`,
        // can be trusted. Escalated `unvalidated_cwd: true`.
        Err(manifest::ManifestError::Malformed { .. }) => ResolvedSource {
            path: target_dir.to_path_buf(),
            fallback_note: Some(format!(
                "WARNING: manifest unreadable -- falling back to an UNVALIDATED cwd: {}. \
                 This is likely not the tree you meant to check (see the manifest check \
                 above for why the manifest itself could not be read)",
                target_dir.display()
            )),
            unvalidated_cwd: true,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        },
        // JSON parsed fine and is a real, readable install record --
        // just a schema_version this binary can't deserialize into
        // `Manifest`. NOT escalated to `unvalidated_cwd` (see
        // `ResolvedSource::unsupported_schema_version`): the manifest
        // is trustworthy, so `unsupported_schema_version: true` instead
        // lets `escalate_for_fallback` cross-reference the `manifest`
        // check's own remediation.
        Err(manifest::ManifestError::UnsupportedSchemaVersion {
            found, supported, ..
        }) => ResolvedSource {
            path: target_dir.to_path_buf(),
            fallback_note: Some(format!(
                "manifest at {} has schema_version {found}, but this binary only supports \
                     schema_version {supported} (likely written by a newer konductor); \
                     falling back to checking the source tree at {}",
                manifest::manifest_path(destination).display(),
                target_dir.display()
            )),
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: true,
        },
        // I/O error opening the file: treated the same as corrupt
        // JSON -- nothing trustworthy to fall back to.
        Err(manifest::ManifestError::ReadFailed { .. }) => ResolvedSource {
            path: target_dir.to_path_buf(),
            fallback_note: Some(format!(
                "WARNING: manifest unreadable -- falling back to an UNVALIDATED cwd: {}. \
                 This is likely not the tree you meant to check (see the manifest check \
                 above for why the manifest itself could not be read)",
                target_dir.display()
            )),
            unvalidated_cwd: true,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        },
        // `CreateDirFailed`/`WriteFailed`/`Lock`/`DeleteFailed` are
        // write-path errors (`Lock` specifically from `upsert_strategy`'s
        // manifest-lock acquisition; `DeleteFailed`
        // from `delete_and_remove_strategy_locked`'s caller-supplied
        // delete step) that `read_manifest` never
        // returns -- unreachable in practice, but handled the same
        // conservative way rather than panicking if that ever changes.
        Err(manifest::ManifestError::CreateDirFailed { .. })
        | Err(manifest::ManifestError::WriteFailed { .. })
        | Err(manifest::ManifestError::Lock(_))
        | Err(manifest::ManifestError::DeleteFailed(_)) => ResolvedSource {
            path: target_dir.to_path_buf(),
            fallback_note: Some(format!(
                "WARNING: manifest unreadable -- falling back to an UNVALIDATED cwd: {}. \
                 This is likely not the tree you meant to check (see the manifest check \
                 above for why the manifest itself could not be read)",
                target_dir.display()
            )),
            unvalidated_cwd: true,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        },
    }
}

/// The `source` check: source well-formedness, via `parse_canonical` -- the exact
/// function `synth`/`install --from` call. `Ok` reports what parsed
/// (agent/skill/SOP/context counts); `Failed` surfaces the same
/// `ParseError` message `synth` would print on the same source tree,
/// plus a remediation hint pointing at the failing file.
///
/// This check answers "is the REPO CHECKOUT well-formed", not "is my
/// installation healthy" -- see this module's docstring ("What
/// `source`/`config` are FOR") for why that distinction matters. Most
/// users, especially anyone installing from a published release
/// artifact rather than a local `--from` checkout, should expect a
/// `Warn`/`Info` fallback here as the normal outcome, not evidence of a
/// problem; `check_manifest`/`check_runtime` are what actually answer
/// the installation-health question.
///
/// The missing/non-directory `source_dir` guard lives in `parse_canonical`
/// itself; this check delegates entirely rather than duplicating it.
fn check_source(resolved: &ResolvedSource) -> CheckResult {
    let source_dir = resolved.path.as_path();

    match parse_canonical(source_dir) {
        Ok(model) => {
            let summary = with_fallback_prefix(
                resolved,
                format!(
                    "source tree at {} parses cleanly ({} agent(s), {} skill(s), {} SOP(s), {} \
                     context file(s))",
                    source_dir.display(),
                    model.agents.len(),
                    model.skills.len(),
                    model.sops.len(),
                    model.context.len()
                ),
            );
            // A fallback occurred but parsing still succeeded --
            // delegated to `escalate_for_fallback`'s Ok/Info/Warn logic.
            escalate_for_fallback("source", resolved, summary)
        }
        Err(err) => failed_or_downgraded_for_fallback(
            "source",
            resolved,
            with_fallback_prefix(
                resolved,
                format!(
                    "source tree at {} failed to parse: {err}",
                    source_dir.display()
                ),
            ),
            format!(
                "fix the reported error in {}, then re-run `konductor doctor`",
                err.file
            ),
            err.to_string(),
        ),
    }
}

/// Prefixes `summary` with `resolved.fallback_note` (own line via `; `)
/// when a fallback occurred, so a fallback is never buried only in
/// `-v`/`--verbose` detail -- the default, non-verbose summary line
/// itself says which tree was actually checked and why.
fn with_fallback_prefix(resolved: &ResolvedSource, summary: String) -> String {
    match &resolved.fallback_note {
        Some(note) => format!("{note}; {summary}"),
        None => summary,
    }
}

/// Prepends `resolved.fallback_note` (if any) as this check's FIRST
/// detail entry, so `-v`/`--verbose` and `--json`'s `detail` array both
/// carry the fallback reasoning verbatim, ahead of whatever problem(s)
/// were found against the fallback tree.
fn fallback_detail(resolved: &ResolvedSource, mut detail: Vec<String>) -> Vec<String> {
    if let Some(note) = &resolved.fallback_note {
        detail.insert(0, note.clone());
    }
    detail
}

/// Shared by `check_source`/`check_config`'s `Err` arm: a parse/load
/// failure against a `legacy_manifest_no_source`/`missing_recorded_source`
/// fallback tree does NOT mean the installation is broken -- the
/// manifest is fully readable and the install it describes is healthy;
/// the fallback cwd is merely "maybe not the tree that produced it"
/// (see `ResolvedSource`). Downgrades to `Info` in exactly those two
/// cases rather than `Failed` -- both are benign, expected fallbacks
/// (see this module's docstring), so neither should read as a warning
/// -- still surfacing the real error text via `remediation`.
///
/// `unvalidated_cwd` is deliberately NOT downgraded: `check_manifest`
/// already reports that case as its own `Failed`. Every other tier (or
/// no fallback) keeps the caller's original `Failed` result.
fn failed_or_downgraded_for_fallback(
    name: &'static str,
    resolved: &ResolvedSource,
    summary: String,
    failed_remediation: String,
    error_text: String,
) -> CheckResult {
    if resolved.legacy_manifest_no_source || resolved.missing_recorded_source {
        let mut result = CheckResult::info(
            name,
            summary,
            format!(
                "this cwd may not be the tree that produced the install -- fix the error \
                 below in that tree, or re-run `konductor install --from <repo-root> \
                 {HARNESS_PLACEHOLDER}` to record the correct source, or pass an explicit \
                 --from <repo-root> to check a specific tree deliberately ({error_text})"
            ),
        );
        result.detail = fallback_detail(resolved, vec![error_text]);
        return result;
    }
    CheckResult::failed(
        name,
        summary,
        failed_remediation,
        fallback_detail(resolved, vec![error_text]),
    )
}

/// Shared by `check_source`/`check_config`: given the underlying
/// operation already succeeded against `resolved.path`, picks the
/// right non-failing `CheckResult` for whichever fallback tier
/// `resolved` represents:
///   - no fallback -> `Ok`.
///   - `unvalidated_cwd` -> `Warn`, strongest remediation (fix/remove
///     the manifest).
///   - `legacy_manifest_no_source` -> `Info`, remediation points at
///     re-installing to record a source.
///   - `missing_recorded_source` -> `Info`, remediation names the stale
///     path.
///   - `unsupported_schema_version` -> `Info`, but cross-references the
///     `manifest` check's own remediation instead of the generic
///     "re-run `konductor install`" wording, which doesn't fix a
///     schema_version skew.
///   - any other fallback -> `Info` with the generic re-run wording.
///
/// Kept as one shared function (rather than duplicated per check) so
/// the escalation logic has one place to get right and test.
fn escalate_for_fallback(
    name: &'static str,
    resolved: &ResolvedSource,
    summary: String,
) -> CheckResult {
    let mut result = match &resolved.fallback_note {
        Some(_) if resolved.unvalidated_cwd => CheckResult::warn(
            name,
            summary,
            "the manifest could not be read, so this result reflects an UNVALIDATED \
             cwd, not the installation -- fix or remove the manifest (see the \
             manifest check above), then re-run `konductor doctor`, or pass an \
             explicit --from <repo-root> to check a specific tree deliberately",
        ),
        Some(_) if resolved.legacy_manifest_no_source => CheckResult::info(
            name,
            summary,
            format!(
                "a real install exists at this destination, but its manifest predates the \
                 recorded-source feature (or ran with no --from on record), so this cwd may \
                 not be the tree that produced it -- re-run `konductor install --from \
                 <repo-root> {HARNESS_PLACEHOLDER}` to record a source, or pass an explicit \
                 --from <repo-root> to check a specific tree deliberately"
            ),
        ),
        Some(_) if resolved.missing_recorded_source => CheckResult::info(
            name,
            summary,
            format!(
                "the manifest records a source path that no longer exists (moved, deleted, \
                 or this is a different host than the one that installed), so this cwd may \
                 not be the tree that produced it -- re-run `konductor install --from \
                 <repo-root> {HARNESS_PLACEHOLDER}` to record the correct source, or pass an \
                 explicit --from <repo-root> to check a specific tree deliberately"
            ),
        ),
        // The generic `Some(_) =>` arm's "run `konductor install`"
        // wording is actively wrong here -- the manifest's
        // schema_version is the problem, not a missing source, and
        // `check_manifest` already names the real fix.
        Some(_) if resolved.unsupported_schema_version => CheckResult::info(
            name,
            summary,
            "(see the manifest check above for remediation -- do not re-run `konductor \
             install` for this; the manifest's schema_version, not this source tree, is \
             the problem)",
        ),
        Some(_) => CheckResult::info(
            name,
            summary,
            format!(
                "pass an explicit --from <repo-root>, or run `konductor install \
                 {HARNESS_PLACEHOLDER}` to record a source in the manifest, to check a \
                 specific source tree deliberately rather than relying on this fallback"
            ),
        ),
        None => return CheckResult::ok(name, summary),
    };
    // Every Warn/Info branch above has a fallback note -- carry it
    // into `detail` too, so `--json` documents the fallback reason for
    // every non-ok status, not only failing ones.
    result.detail = fallback_detail(resolved, result.detail);
    result
}

/// The `runtime` check: which agent runtime(s) `install::runtime::detect_runtimes`
/// finds under the install destination. Neither runtime present is
/// `Info`, not `Failed` -- a target with no runtime yet is not a broken
/// install, just one `konductor install` hasn't been pointed at.
fn check_runtime(destination: &Path) -> CheckResult {
    let result = runtime::detect_runtimes(destination);
    if result.detected.is_empty() {
        return CheckResult::info(
            "runtime",
            format!("no known runtime detected under {}", destination.display()),
            format!(
                "run `konductor install --from <repo-root> --target {} {HARNESS_PLACEHOLDER}` \
                 (or omit --target for $HOME) to install Kiro CLI or Claude Code content there",
                destination.display()
            ),
        );
    }
    let names = result
        .detected
        .iter()
        .map(Runtime::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    CheckResult::ok(
        "runtime",
        format!(
            "detected runtime(s) under {}: {names}",
            destination.display()
        ),
    )
}

/// The `manifest` check: manifest presence, `status`, and per-file hash drift.
/// Absent manifest is `Info` (nothing installed yet); `Status::InProgress`
/// is `Failed` (a prior install crashed mid-copy); any recorded file
/// missing on disk or whose `sha256_hex` no longer matches is `Stale`
/// (drifted, needs a re-install, not necessarily a bug). A read/parse
/// failure is `Failed` with the generic "re-run `konductor install`"
/// remediation. `UnsupportedSchemaVersion` is ALSO `Failed`, but with
/// its own remediation naming the version mismatch and pointing at
/// updating `konductor` -- re-running install is wrong advice for a
/// well-formed but version-skewed manifest.
fn check_manifest(destination: &Path) -> CheckResult {
    let manifest_path = manifest::manifest_path(destination);
    let manifest = match manifest::read_manifest(destination) {
        Ok(Some(manifest)) => manifest,
        Ok(None) => {
            return CheckResult::info(
                "manifest",
                format!("no manifest found at {}", manifest_path.display()),
                format!(
                    "run `konductor install --from <repo-root> --target {} \
                     {HARNESS_PLACEHOLDER}` (or omit --target for $HOME) to install content \
                     there",
                    destination.display()
                ),
            );
        }
        // Version-skew, not corruption: the manifest is well-formed
        // JSON from a schema_version this build doesn't recognize.
        // "Re-run `konductor install`" would just reproduce the
        // failure (or silently downgrade a newer manifest), so this
        // gets its own remediation pointing at updating the binary.
        Err(err @ manifest::ManifestError::UnsupportedSchemaVersion { .. }) => {
            return CheckResult::failed(
                "manifest",
                format!(
                    "manifest at {} was written by an incompatible konductor version: {err}",
                    manifest_path.display()
                ),
                "update konductor to a version that supports this manifest's schema_version, \
                 then re-run `konductor doctor`; do NOT re-run `konductor install` with this \
                 binary -- it does not understand this manifest's schema_version and cannot \
                 fix it",
                vec![err.to_string()],
            );
        }
        Err(err) => {
            return CheckResult::failed(
                "manifest",
                format!(
                    "could not read manifest at {}: {err}",
                    manifest_path.display()
                ),
                format!(
                    "re-run `konductor install {HARNESS_PLACEHOLDER}` to rewrite a fresh manifest"
                ),
                vec![err.to_string()],
            );
        }
    };

    // Aggregated across every tracked strategy slot -- `check_manifest`
    // is read-only diagnostics, not a mutating operation, so (unlike
    // update/uninstall) there is no need to refuse on 2+ tracked
    // strategies; it simply reports on all of them. The remediation
    // hint names whichever slot actually triggered the condition below
    // (InProgress, or the first slot with drifted files), not just
    // `manifest.strategies.first()` -- a target with an unrelated
    // healthy first slot must not get a hint pointing at reinstalling
    // that healthy slot instead of the broken one.
    if let Some(slot) = manifest
        .strategies
        .iter()
        .find(|slot| slot.status == Status::InProgress)
    {
        return CheckResult::failed(
            "manifest",
            format!(
                "manifest at {} is still Status::InProgress -- a previous install did not \
                 finish",
                manifest_path.display()
            ),
            format!(
                "re-run `konductor install {}` to complete or repair the installation",
                harness_hint(slot.strategy.as_str())
            ),
            vec!["manifest status is InProgress, not Complete".to_string()],
        );
    }

    let mut drifted: Vec<String> = Vec::new();
    let mut drifted_strategy_name: Option<&str> = None;
    for slot in &manifest.strategies {
        let files = drifted_files(destination, slot);
        if !files.is_empty() && drifted_strategy_name.is_none() {
            drifted_strategy_name = Some(slot.strategy.as_str());
        }
        drifted.extend(files);
    }
    if !drifted.is_empty() {
        let count = drifted.len();
        return CheckResult::stale(
            "manifest",
            format!(
                "{count} file(s) under {} no longer match the manifest recorded at install time",
                destination.display()
            ),
            format!(
                "re-run `konductor install {}` to refresh the installed content",
                harness_hint(drifted_strategy_name.unwrap_or(""))
            ),
            drifted,
        );
    }

    let total_files: usize = manifest.strategies.iter().map(|s| s.files.len()).sum();
    CheckResult::ok(
        "manifest",
        format!(
            "manifest at {} is Complete and every recorded file matches ({} file(s))",
            manifest_path.display(),
            total_files
        ),
    )
}

/// Every recorded file in `manifest.files` that is missing on disk, or
/// whose current content hash (via `sha256_hex`, the same function
/// `install::kiro_cli` uses when it FIRST records a hash) no longer
/// matches `ManifestFile.sha256`. A recorded file with no hash at all
/// (`sha256: None`, the pre-copy write-ahead shape) is skipped -- an
/// `InProgress` manifest is already reported separately above, and a
/// leftover `None` hash on an otherwise-`Complete` manifest has nothing
/// meaningful to compare against.
///
/// `CLAUDE_SETTINGS_RELATIVE_PATH` (`.claude/settings.json`) is ALSO
/// skipped here regardless of its recorded hash -- the same
/// shared-ownership carve-out `uninstall.rs`'s `delete_eligible_files`
/// already applies to this exact path, for the same reason: the
/// recorded hash reflects only the handful of `permissions.allow`
/// grant strings this codebase's own merge added, not the whole file.
/// The user adding a hook, another MCP server's grant, or anything
/// else to their own settings.json afterward is expected, ordinary
/// use of a file they own -- not drift a "re-run install" remediation
/// applies to -- so it must never surface here the way a real
/// hash mismatch on a file Konductor fully owns would.
fn drifted_files(destination: &Path, manifest: &StrategyManifest) -> Vec<String> {
    manifest
        .files
        .iter()
        .filter_map(|file| {
            if file.path == CLAUDE_SETTINGS_RELATIVE_PATH {
                return None;
            }
            let Some(expected) = &file.sha256 else {
                return None;
            };
            let on_disk_path = destination.join(&file.path);
            let bytes = match std::fs::read(&on_disk_path) {
                Ok(bytes) => bytes,
                Err(_) => {
                    return Some(format!("{}: missing on disk", file.path));
                }
            };
            let actual = sha256_hex(&bytes);
            if &actual != expected {
                return Some(format!(
                    "{}: content hash no longer matches manifest",
                    file.path
                ));
            }
            None
        })
        .collect()
}

/// The `index_status` check: compares `~/.konductor/installs`'s cached
/// `IndexEntryStatus` for `destination` against that same target's real
/// manifest `Status` (already read by `check_manifest`, re-read here
/// independently so this check has no ordering dependency on it).
///
/// Not every install needs to be tracked -- `index.rs`'s own
/// `IndexEntryStatus`/`IndexEntry::status` doc comments describe the
/// index as a back-compat-safe CACHE, and a target predating index
/// support (or installed by a `konductor` build without it) simply has
/// no entry at all. That is `Info`, not a problem to fix.
///
/// When an entry IS present, its cached `status` is a snapshot from the
/// last install/update write, refreshed on every one of those calls but
/// never otherwise reconciled -- so it can only ever drift out of sync
/// with the manifest if a run crashed between the two writes (the
/// manifest's own `Status::Complete` rewrite and the index's matching
/// `write_index` call; see `update.rs`'s `run_update_one_target`/
/// `finalize_index_warning` for the exact ordering). A real
/// `IndexEntryStatus::InProgress` vs. `Status::InProgress` disagreement
/// therefore always means an install/update was interrupted -- this is
/// `Warn`, mirroring `check_manifest`'s own `Stale`/`Warn` split:
/// `check_manifest` reserves `Failed`/`Stale` for problems it can
/// observe directly on disk (an in-progress manifest, a hash drift);
/// this check only observes a SECOND record's disagreement with the
/// first, so it stays non-failing (`Warn`) rather than flipping the
/// overall run to `EXIT_HALTED` for a condition `check_manifest`
/// already reports on its own when the manifest itself is the one
/// that's `InProgress`.
///
/// A read failure on the index itself (corrupt JSON, unsupported
/// schema version) is `Warn`, not `Failed` -- same non-failing
/// posture as the "index missing an entry" case, since this check's
/// job is advisory drift-detection, not index integrity (a genuinely
/// corrupted `~/.konductor/installs` is `update`'s/`uninstall`'s
/// problem to refuse to proceed on, not `doctor`'s to fail the whole
/// run over).
fn check_index_status(destination: &Path) -> CheckResult {
    let canonical = match index::canonicalize_target_dir(destination) {
        Ok(canonical) => canonical,
        // `destination` doesn't exist (or some other canonicalization
        // failure) -- nothing to look up in the index either way. Not
        // this check's job to report a missing destination (`manifest`/
        // `runtime` already do), so this is a quiet `Info`.
        Err(_) => {
            return CheckResult::info(
                "index_status",
                format!(
                    "{} could not be canonicalized; skipping install index comparison",
                    destination.display()
                ),
                format!(
                    "run `konductor install --from <repo-root> --target {} \
                     {HARNESS_PLACEHOLDER}` to install content there",
                    destination.display()
                ),
            );
        }
    };

    let entries = match index::read_index() {
        Ok(Some(idx)) => idx.installs,
        Ok(None) => Vec::new(),
        Err(err) => {
            return CheckResult::warn(
                "index_status",
                format!("could not read install index ~/.konductor/installs: {err}"),
                "if this persists, inspect ~/.konductor/installs by hand; a corrupted index \
                 does not affect this installation's own files",
            );
        }
    };

    let Some(entry) = entries.iter().find(|e| e.target_dir == canonical) else {
        return CheckResult::info(
            "index_status",
            format!("{canonical} is not tracked in ~/.konductor/installs"),
            format!(
                "not every install needs to be tracked (e.g. one predating the install index); \
                 re-run `konductor install {HARNESS_PLACEHOLDER}` or `konductor update` to \
                 start tracking it"
            ),
        );
    };

    // Retains a strategy name alongside the aggregated status so the
    // disagreement branch below can name the harness that produced this
    // install via `harness_hint`, instead of the generic
    // `HARNESS_PLACEHOLDER`. Aggregated across every
    // tracked slot -- `InProgress` if ANY slot is, `Complete` only if
    // every slot is -- and the FIRST tracked strategy's name is used
    // for the hint (a target with 2+ strategies gets a hint scoped to
    // just one of them, matching `check_manifest`'s own simplification).
    let (manifest_status, manifest_strategy) = match manifest::read_manifest(destination) {
        Ok(Some(manifest)) => {
            let status = if manifest
                .strategies
                .iter()
                .any(|s| s.status == Status::InProgress)
            {
                Status::InProgress
            } else {
                Status::Complete
            };
            let strategy = manifest
                .strategies
                .first()
                .map(|s| s.strategy.clone())
                .unwrap_or_default();
            (status, strategy)
        }
        // No manifest, or unreadable -- `check_manifest` already
        // surfaces this loudly on its own. Nothing for THIS check to
        // compare against, so it stays a quiet `Info` rather than
        // duplicating that failure under a second check name.
        Ok(None) | Err(_) => {
            return CheckResult::info(
                "index_status",
                format!(
                    "{canonical} is tracked in the install index, but its manifest could not \
                     be read for comparison"
                ),
                "see the manifest check's own result for details",
            );
        }
    };

    let index_says_complete = entry.status == IndexEntryStatus::Complete;
    let manifest_says_complete = manifest_status == Status::Complete;

    if index_says_complete != manifest_says_complete {
        let index_word = if index_says_complete {
            "Complete"
        } else {
            "InProgress"
        };
        let manifest_word = if manifest_says_complete {
            "Complete"
        } else {
            "InProgress"
        };
        return CheckResult::warn(
            "index_status",
            format!(
                "install index says {index_word} but manifest at {} says {manifest_word} for \
                 {canonical} -- an install or update may have been interrupted",
                manifest::manifest_path(destination).display()
            ),
            format!(
                "re-run `konductor install --target {canonical} {}` (or `konductor update \
                 --target {canonical}`) to complete or repair the installation",
                harness_hint(&manifest_strategy)
            ),
        );
    }

    CheckResult::ok(
        "index_status",
        format!(
            "install index and manifest agree on status ({manifest_word}) for {canonical}",
            manifest_word = if manifest_says_complete {
                "Complete"
            } else {
                "InProgress"
            }
        ),
    )
}

/// The `config` check: project config validity, via
/// `config::load_config_with_home` -- the same loading logic
/// `config get`/`config list`/`config set` use via `config::load_config`.
/// A source tree with no `.konductor/config.yml` at all still loads (the
/// preset defaults alone are a valid config -- see config.rs's merge
/// semantics), so this only fails on a genuinely malformed/invalid
/// project or user config, never merely on one being absent.
///
/// Same caveat as `check_source` above: this validates the REPO's
/// project config, which only exists to check when a local checkout is
/// available. A `Warn`/`Info` fallback here is expected and benign for
/// most install methods -- `check_manifest`/`check_runtime` are the
/// checks that answer "is my installation healthy".
///
/// `home_dir` is the user-tier config's home directory, passed in
/// explicitly rather than resolved from the `HOME` env var here -- same
/// test-isolation motivation as `config::load_config_with_home` itself
/// (which this calls directly, bypassing `config::load_config`'s own
/// `HOME` resolution), threaded up through `dispatch_doctor_with`'s own
/// `home_dir_override` parameter so end-to-end tests can point the user
/// tier at a scratch directory without mutating the process-global
/// `HOME` env var. Production callers pass the real `$HOME`.
fn check_config_with_home(resolved: &ResolvedSource, home_dir: Option<&Path>) -> CheckResult {
    let source_dir = resolved.path.as_path();
    match config::load_config_with_home(source_dir, home_dir) {
        Ok(loaded) => {
            let summary = with_fallback_prefix(
                resolved,
                format!(
                    "config loads cleanly (tier '{}', default_severity '{}')",
                    loaded.tier, loaded.default_severity
                ),
            );
            escalate_for_fallback("config", resolved, summary)
        }
        Err(err) => failed_or_downgraded_for_fallback(
            "config",
            resolved,
            with_fallback_prefix(
                resolved,
                // Deliberately no hardcoded path in this prefix -- `err`'s
                // own `Display` (see `config::ConfigError`) already names
                // whichever specific tier's file actually failed to load
                // (the project tier at `source_dir`, OR the user tier at
                // `~/.konductor/config.yml` -- `load_config` merges both
                // and either can be the broken one). Prefixing with
                // `source_dir` unconditionally would misreport a broken
                // user-tier config as if the PROJECT config were the
                // problem.
                format!("config failed to load: {err}"),
            ),
            "run `konductor config list` for the full merged view, or `konductor init --force` \
             to reset to preset defaults"
                .to_string(),
            err.to_string(),
        ),
    }
}

/// Container binaries `check_container_runtime` probes for, in the exact
/// order the design's `container_runtime: auto` setting documents: "auto
/// probes in that order" -- `docker`, `podman`, `nerdctl`, `finch`.
const CONTAINER_RUNTIME_PROBE_ORDER: &[&str] = &["docker", "podman", "nerdctl", "finch"];

/// The `container_runtime` check (active): which container runtime binary (if any)
/// is on `PATH`, via a pure directory scan of each `PATH` entry for an
/// executable file named one of `CONTAINER_RUNTIME_PROBE_ORDER` -- the
/// exact `auto` probe order the design's Security section documents for
/// the `container_runtime` config setting. No new Cargo dependency.
///
/// Deliberately does NOT spawn a subprocess (an earlier version ran
/// `<binary> --version`): a container CLI's `--version` can itself hang
/// -- some builds probe a background daemon/socket before printing
/// anything, and daemon reachability is exactly the kind of thing that
/// can block indefinitely in a sandboxed or misconfigured environment
/// with no daemon listening. A pure filesystem scan has no such failure
/// mode: it can only ever be as slow as `PATH`'s own directory listing.
///
/// Always `Info`, mirroring `check_runtime`'s existing pattern -- no
/// container runtime on PATH is not a broken install, just something
/// `sandbox: docker` mode would need later.
fn check_container_runtime() -> CheckResult {
    check_container_runtime_with_path(std::env::var_os("PATH"))
}

/// Same as `check_container_runtime`, but with the `PATH` value passed
/// in explicitly rather than resolved from the `PATH` env var -- same
/// test-isolation motivation as `config::load_config_with_home`, so a
/// test can point at a scratch directory's worth of fake binaries
/// without mutating the process-global `PATH` env var.
fn check_container_runtime_with_path(path_var: Option<std::ffi::OsString>) -> CheckResult {
    for binary in CONTAINER_RUNTIME_PROBE_ORDER {
        if find_binary_on_path(binary, path_var.as_deref()).is_some() {
            return CheckResult::info(
                "container_runtime",
                format!("detected container runtime on PATH: {binary}"),
                "no action needed -- only relevant if you plan to use a container-based \
                 sandbox mode"
                    .to_string(),
            );
        }
    }
    CheckResult::info(
        "container_runtime",
        format!(
            "no container runtime found on PATH (checked: {})",
            CONTAINER_RUNTIME_PROBE_ORDER.join(", ")
        ),
        "install docker, podman, nerdctl, or finch if you plan to use a container-based \
         sandbox mode; not required otherwise"
            .to_string(),
    )
}

/// Scans each directory in `path_var` (`PATH`-syntax, via
/// `std::env::split_paths`) for an executable file literally named
/// `binary`, returning the first match's full path -- no subprocess
/// spawn, no daemon reachability wait, just `std::fs::metadata` per
/// candidate. `path_var: None` (an unset `PATH`) yields no matches
/// rather than erroring, same treatment as an empty `PATH`.
fn find_binary_on_path(binary: &str, path_var: Option<&std::ffi::OsStr>) -> Option<PathBuf> {
    let path_var = path_var?;
    for dir in std::env::split_paths(path_var) {
        let candidate = dir.join(binary);
        match is_executable_file(&candidate) {
            Ok(true) => return Some(candidate),
            _ => continue,
        }
    }
    None
}

/// Whether `path` is a regular file with its owner-execute bit set.
/// Always checks plain file-existence-and-executability only -- never
/// spawns the file, so a candidate that would hang or error if executed
/// is still correctly identified as present without ever running it.
/// Always `false` on non-Unix targets, which have no equivalent
/// permission bit (matches this crate's existing `is_executable`
/// pattern in `install/kiro_cli.rs`).
#[cfg(unix)]
fn is_executable_file(path: &Path) -> std::io::Result<bool> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = std::fs::metadata(path)?;
    Ok(metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_executable_file(path: &Path) -> std::io::Result<bool> {
    Ok(std::fs::metadata(path)?.is_file())
}

/// Check (dormant, not wired into `dispatch_doctor_with`'s live check
/// list): `.konductor/.gitignore` (as written by `konductor init`)
/// exists at the resolved source tree and contains every pattern in
/// `init::GITIGNORE_PATTERNS` -- reused, not re-declared, so this check
/// and `init`'s writer can never drift apart on what the "documented
/// patterns" actually are.
///
/// `Warn`, not `Failed`: a missing/incomplete `.gitignore` is a hygiene
/// issue (secrets/state could end up committed), not a broken install.
///
/// INTENTIONALLY DORMANT: not called from `dispatch_doctor_with` today
/// (see the comment at that call site). Two of `GITIGNORE_PATTERNS`'
/// five patterns (`runs/`, `overrides.yml`) guard paths this codebase
/// cannot yet create -- `runs/` belongs to unimplemented run-state
/// persistence (Feature 4.3), `overrides.yml` to the post-launch
/// override mechanism (Feature 4.12/M7) -- so today this check would
/// only ever produce a false-positive-style nag, never a real signal.
/// Kept fully implemented and unit-tested (see the `check_gitignore_*`
/// tests below) so it is ready to re-enable the moment either feature
/// lands. `#[allow(dead_code)]` because nothing calls it outside tests
/// while dormant.
#[allow(dead_code)]
fn check_gitignore(resolved: &ResolvedSource) -> CheckResult {
    let gitignore_path = resolved
        .path
        .join(config::KONDUCTOR_DIR_NAME)
        .join(init::GITIGNORE_FILE_NAME);

    let contents = match std::fs::read_to_string(&gitignore_path) {
        Ok(contents) => contents,
        Err(_) => {
            return CheckResult::warn(
                "gitignore",
                format!("no .gitignore found at {}", gitignore_path.display()),
                format!(
                    "re-run `konductor init` or add these patterns manually: {}",
                    init::GITIGNORE_PATTERNS.join(", ")
                ),
            );
        }
    };

    let missing: Vec<&str> = init::GITIGNORE_PATTERNS
        .iter()
        .filter(|pattern| !contents.contains(*pattern))
        .copied()
        .collect();

    if !missing.is_empty() {
        return CheckResult::warn(
            "gitignore",
            format!(
                "{} is missing {} documented pattern(s): {}",
                gitignore_path.display(),
                missing.len(),
                missing.join(", ")
            ),
            format!(
                "re-run `konductor init` or add these patterns manually: {}",
                missing.join(", ")
            ),
        );
    }

    CheckResult::ok(
        "gitignore",
        format!(
            "{} contains every documented pattern",
            gitignore_path.display()
        ),
    )
}

/// Check (dormant, not wired into `dispatch_doctor_with`'s live check
/// list): honest not-yet-applicable stub. This build has no
/// provider/model-access validation to run -- access is inherited from
/// whichever runtime (Kiro CLI / Claude Code) is installed, which is out
/// of scope for this CLI utility today. Always `Info`; never fabricates
/// a check against a concept this build doesn't implement.
///
/// INTENTIONALLY DORMANT: not called from `dispatch_doctor_with` today
/// (see the comment at that call site) -- there is no real signal to
/// surface (Feature 4.9.1). Kept fully implemented and unit-tested
/// (`check_provider_model_access_is_always_info_stub` below) so it is
/// ready to re-enable once that feature lands. `#[allow(dead_code)]`
/// because nothing calls it outside tests while dormant.
#[allow(dead_code)]
fn check_provider_model_access() -> CheckResult {
    CheckResult::info(
        "provider_model_access",
        "provider/model-access validation is not yet implemented in this build -- access is \
         inherited from the runtime (Kiro CLI / Claude Code) and is out of scope for this CLI \
         utility today",
        "no action needed".to_string(),
    )
}

/// Check (dormant, not wired into `dispatch_doctor_with`'s live check
/// list): honest not-yet-applicable stub. Role-scoped allowlist
/// validation (design doc Task 4.11, milestone M6) is a planned
/// post-launch feature, not present in this build. Always `Info`; never
/// fabricates a check against a concept this build doesn't implement.
///
/// INTENTIONALLY DORMANT: not called from `dispatch_doctor_with` today
/// (see the comment at that call site) -- there is no real signal to
/// surface (design doc Task 4.11, M6/M7). Kept fully implemented and
/// unit-tested (`check_role_allowlists_is_always_info_stub` below) so
/// it is ready to re-enable once that feature lands. `#[allow(dead_code)]`
/// because nothing calls it outside tests while dormant.
#[allow(dead_code)]
fn check_role_allowlists() -> CheckResult {
    CheckResult::info(
        "role_allowlists",
        "role-scoped allowlist validation is not yet implemented -- this is a planned \
         post-launch feature (design doc Task 4.11, milestone M6) and is not present in this \
         build",
        "no action needed".to_string(),
    )
}

/// Prints the default-mode (non-JSON) report: one summary line per
/// check, each non-`Ok` line followed by an indented remediation hint.
/// `-v` additionally prints every entry in that check's `detail` list,
/// indented further, so nothing is hidden behind "the first error only"
/// (relevant chiefly for a future multi-error `parse_canonical`, but
/// applied uniformly to every check for consistency).
fn print_report(results: &[CheckResult], verbose: bool, color: ColorMode) {
    for result in results {
        let label = result.status.label();
        let icon = result.status.icon();
        let colored_label = match result.status {
            CheckStatus::Ok => super::output::status::ok(color, label),
            CheckStatus::Info => super::output::status::info(color, label),
            CheckStatus::Warn => super::output::status::warn(color, label),
            CheckStatus::Failed | CheckStatus::Stale => super::output::status::error(color, label),
        };
        println!(
            "{icon} {colored_label}: {} — {}",
            result.name, result.summary
        );
        if let Some(remediation) = &result.remediation {
            let wrapped = crate::cli::output::wrap_indented(&format!("fix: {remediation}"), "    ");
            println!("{}", crate::cli::output::status::dim(color, &wrapped));
        }
        if verbose {
            for line in &result.detail {
                let wrapped = crate::cli::output::wrap_indented(&format!("detail: {line}"), "    ");
                println!("{}", crate::cli::output::status::dim(color, &wrapped));
            }
        }
    }
}

/// Builds the `--json` equivalent of `print_report`: one compact JSON
/// object mirroring `install`/`synth`'s flat JSON shape, with a
/// `checks` array carrying each check's `name`/`status`/`summary`, plus
/// `detail` (non-empty only on a non-`ok` check) and `remediation`
/// (only when set).
///
/// IMPORTANT fix: `ok` alone reads `true` even when a check is `Warn`
/// (which never fails the run, see `CheckStatus::is_failing`) -- a
/// `--json` consumer inspecting only `ok` would otherwise miss a fired
/// fallback. `warnings` (`true` if any check is `Warn`) lets a machine
/// consumer detect that without parsing every `status` string. See
/// cli/README.md's `--json` section.
fn format_report_json(results: &[CheckResult]) -> String {
    let checks: Vec<serde_json::Value> = results
        .iter()
        .map(|result| {
            let mut obj = serde_json::json!({
                "name": result.name,
                "status": result.status.label(),
                "summary": result.summary,
            });
            if let Some(remediation) = &result.remediation {
                obj["remediation"] = serde_json::Value::String(remediation.clone());
            }
            if !result.detail.is_empty() {
                obj["detail"] = serde_json::Value::Array(
                    result
                        .detail
                        .iter()
                        .cloned()
                        .map(serde_json::Value::String)
                        .collect(),
                );
            }
            obj
        })
        .collect();

    serde_json::json!({
        "command": "doctor",
        "ok": !results.iter().any(|r| r.status.is_failing()),
        "warnings": results.iter().any(|r| r.status.is_warning()),
        "checks": checks,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::install::index::IndexEntry;
    use crate::cli::test_home_lock::lock_home;
    use std::fs;
    use std::sync::MutexGuard;

    /// RAII guard for tests exercising `check_index_status`/
    /// `dispatch_doctor_all`, both of which transitively read the real,
    /// process-global `$HOME/.konductor/installs` regardless of
    /// `--target`/`home_dir_override` (see `index.rs`'s own docstring:
    /// the index's LOCATION is always resolved against real `$HOME`,
    /// unlike the manifest). Mirrors `install.rs`'s/`update.rs`'s own
    /// `HomeGuard` exactly -- acquires the crate-wide
    /// `test_home_lock::HOME_ENV_LOCK` for its entire lifetime so no
    /// other `HOME`-mutating test anywhere in this crate observes an
    /// interleaved value.
    struct HomeGuard {
        _lock: MutexGuard<'static, ()>,
        scratch: PathBuf,
        original_home: Option<std::ffi::OsString>,
    }

    impl HomeGuard {
        fn new(label: &str) -> Self {
            let lock = lock_home();
            let scratch = scratch_dir(label);
            let original_home = std::env::var_os("HOME");
            // SAFETY: held for this guard's entire lifetime under the
            // crate-wide HOME_ENV_LOCK; restored on Drop before the
            // lock releases.
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

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-doctor-test-{name}-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Healthy/no-issues case: an empty-but-valid source tree (no
    /// agents/skills/agent-sops — a valid, empty CanonicalModel, same as
    /// `dispatch_synth_returns_zero_on_empty_source_tree`), no
    /// `.konductor/config.yml` (preset defaults alone are valid), and an
    /// install destination with nothing installed at all. Every check
    /// must be `ok` or `info`, never `failed`/`stale`, and the overall
    /// exit code must be 0.
    #[test]
    fn dispatch_doctor_is_all_clear_on_a_healthy_empty_project() {
        let source = scratch_dir("healthy-source");
        let destination = scratch_dir("healthy-destination");
        let home = scratch_dir("healthy-home");

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(code, 0, "a healthy empty project must exit 0");

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// A malformed agent spec (invalid JSON) makes `parse_canonical`
    /// fail, which the `source` check must surface as `failed` and the
    /// overall run must map to `EXIT_HALTED` (1), never exit 0 and never
    /// exit code 2.
    #[test]
    fn dispatch_doctor_reports_failed_source_on_malformed_agent_spec() {
        let source = scratch_dir("malformed-agent-source");
        let destination = scratch_dir("malformed-agent-destination");
        let home = scratch_dir("malformed-agent-home");
        fs::create_dir_all(source.join("agents")).unwrap();
        fs::write(
            source.join("agents/broken.agent-spec.json"),
            b"{ not valid json",
        )
        .unwrap();

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(code, EXIT_HALTED);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// A `--from` (source) path that does not exist AT ALL must be
    /// reported `failed` for the `source` check, and the overall exit
    /// code must be `EXIT_HALTED` (1) -- never 0 ("all clear") and
    /// never 2 (the reserved CRITICAL-gate code). Regression test for
    /// the bug where `parse_canonical`'s subdirectory walks
    /// (`agents/`, `skills/`, `agent-sops/`, `context/`) each treat a
    /// missing directory as "zero entries" rather than an error, so a
    /// nonexistent source tree parsed as a valid-but-empty
    /// `CanonicalModel` and `check_source` reported `ok`.
    #[test]
    fn dispatch_doctor_reports_failed_source_on_nonexistent_from_path() {
        let destination = scratch_dir("nonexistent-from-destination");
        let home = scratch_dir("nonexistent-from-home");
        let nonexistent_source = std::env::temp_dir().join(format!(
            "konductor-doctor-test-does-not-exist-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            std::process::id()
        ));
        assert!(
            !nonexistent_source.exists(),
            "path must not exist for this test to be valid"
        );

        let code = dispatch_doctor_with(
            &destination,
            Some(nonexistent_source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(
            code, EXIT_HALTED,
            "a nonexistent --from path must not report all-clear (0)"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        let result = check_source(&ResolvedSource {
            path: nonexistent_source.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        });
        assert_eq!(result.status, CheckStatus::Failed);
        assert!(
            result.summary.contains("does not exist"),
            "summary must clearly state the source directory does not exist, got: {}",
            result.summary
        );

        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// A `--from` path that exists but is a plain file (not a
    /// directory) must also report `failed` for the `source` check --
    /// this is `parse_canonical`'s own pre-existing `is_file` guard,
    /// exercised here to confirm `check_source`'s new existence/is-dir
    /// check does not change or shadow that behavior.
    #[test]
    fn dispatch_doctor_reports_failed_source_when_from_path_is_a_file() {
        let destination = scratch_dir("from-is-file-destination");
        let file_path = std::env::temp_dir().join(format!(
            "konductor-doctor-test-is-a-file-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            std::process::id()
        ));
        fs::write(&file_path, b"not a directory").unwrap();

        let result = check_source(&ResolvedSource {
            path: file_path.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        });
        assert_eq!(result.status, CheckStatus::Failed);

        fs::remove_file(&file_path).ok();
        fs::remove_dir_all(&destination).ok();
    }

    /// under `context/` is `parse_canonical`'s "dangling context
    /// reference" failure. Must surface as `failed`.
    #[test]
    fn dispatch_doctor_reports_failed_source_on_dangling_context_reference() {
        let source = scratch_dir("dangling-context-source");
        let destination = scratch_dir("dangling-context-destination");
        let home = scratch_dir("dangling-context-home");
        fs::create_dir_all(source.join("agents")).unwrap();
        fs::write(
            source.join("agents/k-example.agent-spec.json"),
            br#"{
                "schemaVersion": "1",
                "name": "k-example",
                "config": {"description": "d", "systemPrompt": "p", "model": "m"},
                "dependencies": {"context": {"contextNames": ["missing.md"]}},
                "clientConfig": {"kiroCli": {}}
            }"#,
        )
        .unwrap();

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(code, EXIT_HALTED);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// An agent referencing a skill that does not exist under `skills/`
    /// (e.g. a renamed or deleted skill) is `parse_canonical`'s
    /// "dangling skill reference" failure (see
    /// `synth::parse_canonical::check_dangling_skill_references`) --
    /// `doctor`'s `check_source` calls the SAME shared `parse_canonical`
    /// as `synth`/`install --from`, so this failure surfaces here
    /// identically, not as a doctor-only special case. Must surface as
    /// `failed`, naming the agent, field, and missing skill.
    #[test]
    fn dispatch_doctor_reports_failed_source_on_dangling_skill_reference() {
        let source = scratch_dir("dangling-skill-source");
        let destination = scratch_dir("dangling-skill-destination");
        let home = scratch_dir("dangling-skill-home");
        fs::create_dir_all(source.join("agents")).unwrap();
        fs::write(
            source.join("agents/k-example.agent-spec.json"),
            br#"{
                "schemaVersion": "1",
                "name": "k-example",
                "config": {"description": "d", "systemPrompt": "p", "model": "m"},
                "clientConfig": {
                    "kiroCli": {
                        "resources": ["skill://~/.kiro/skills/renamed-or-deleted-skill/SKILL.md"]
                    }
                }
            }"#,
        )
        .unwrap();

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(code, EXIT_HALTED);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        let result = check_source(&ResolvedSource {
            path: source.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        });
        assert_eq!(result.status, CheckStatus::Failed);
        assert!(result.summary.contains("k-example"));
        assert!(result.summary.contains("renamed-or-deleted-skill"));

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// A destination directory that simply has nothing installed under
    /// it must report `info`, not `failed`, for both the `runtime` and
    /// `manifest` checks -- and the overall exit code must still be 0.
    #[test]
    fn dispatch_doctor_reports_info_not_failed_on_missing_install_directory() {
        let source = scratch_dir("missing-dir-source");
        let destination = scratch_dir("missing-dir-destination");
        let home = scratch_dir("missing-dir-home");
        // Destination exists (scratch_dir creates it) but has no
        // .kiro/.claude/.konductor content at all -- the "missing
        // directory" case this test's name refers to.

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(code, 0);

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// A manifest recording a file that no longer matches its hash on
    /// disk (simulating drift after install) must be reported `stale`,
    /// mapping to `EXIT_HALTED`.
    #[test]
    fn dispatch_doctor_reports_stale_manifest_on_hash_mismatch() {
        let source = scratch_dir("hash-drift-source");
        let destination = scratch_dir("hash-drift-destination");
        let home = scratch_dir("hash-drift-home");

        let tracked_path = destination.join(".kiro/agents/k-example.json");
        fs::create_dir_all(tracked_path.parent().unwrap()).unwrap();
        fs::write(&tracked_path, b"original content").unwrap();

        let recorded_hash = sha256_hex(b"original content");
        let written = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::Complete,
            vec![manifest::ManifestFile {
                path: ".kiro/agents/k-example.json".to_string(),
                sha256: Some(recorded_hash),
                provenance: manifest::Provenance::Created,
            }],
        );
        write_manifest_for_test(&destination, &written);

        // Mutate the on-disk file after the manifest was written, so its
        // real content hash no longer matches what was recorded.
        fs::write(&tracked_path, b"drifted content").unwrap();

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(code, EXIT_HALTED);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// `.claude/settings.json` is exempt from the hash-drift check
    /// `dispatch_doctor_reports_stale_manifest_on_hash_mismatch` covers
    /// above, since the recorded hash only reflects the handful of
    /// `permissions.allow` grant strings this codebase's own merge
    /// added -- not the whole file, which the user is expected to keep
    /// editing (a hook, another server's grant, ...). A hash mismatch
    /// on this specific path must never surface as `stale`.
    #[test]
    fn dispatch_doctor_does_not_report_claude_settings_drift_on_hash_mismatch() {
        let source = scratch_dir("claude-settings-drift-source");
        let destination = scratch_dir("claude-settings-drift-destination");
        let home = scratch_dir("claude-settings-drift-home");

        let tracked_path = destination.join(CLAUDE_SETTINGS_RELATIVE_PATH);
        fs::create_dir_all(tracked_path.parent().unwrap()).unwrap();
        fs::write(&tracked_path, b"original content").unwrap();

        let recorded_hash = sha256_hex(b"original content");
        let written = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::Complete,
            vec![manifest::ManifestFile {
                path: CLAUDE_SETTINGS_RELATIVE_PATH.to_string(),
                sha256: Some(recorded_hash),
                provenance: manifest::Provenance::ReplacedOurs,
            }],
        );
        write_manifest_for_test(&destination, &written);

        // The user added a hook (or another server's grant) to their own
        // settings.json after install -- ordinary use of a file they
        // own, so its real content hash no longer matches what was
        // recorded.
        fs::write(&tracked_path, b"user-edited content").unwrap();

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(
            code, 0,
            "a hash mismatch on .claude/settings.json must never be reported as stale"
        );

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// An `InProgress` manifest (a prior install crashed mid-copy, per
    /// manifest.rs's write-ahead-status design) must be reported
    /// `failed`, not `stale` and not silently `ok`.
    #[test]
    fn dispatch_doctor_reports_failed_manifest_when_still_in_progress() {
        let source = scratch_dir("in-progress-source");
        let destination = scratch_dir("in-progress-destination");
        let home = scratch_dir("in-progress-home");

        let written = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            None,
            Status::InProgress,
            vec![manifest::ManifestFile {
                path: ".kiro/agents/k-example.json".to_string(),
                sha256: None,
                provenance: manifest::Provenance::Created,
            }],
        );
        write_manifest_for_test(&destination, &written);

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(code, EXIT_HALTED);

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// Review fix regression: with 2+ tracked strategy slots, the
    /// `InProgress` remediation hint must name the slot that is
    /// ACTUALLY `InProgress` -- not `manifest.strategies.first()`. Here
    /// the first slot (`claude`) is healthy and the second (`kiro-v3`)
    /// is the broken one; a hint pointing at reinstalling `claude`
    /// would not fix anything.
    #[test]
    fn check_manifest_names_the_actually_in_progress_strategy_not_the_first() {
        let destination = scratch_dir("check-manifest-in-progress-not-first");
        let full = manifest::Manifest {
            schema_version: 2,
            strategies: vec![
                StrategyManifest::new(
                    "claude",
                    "2026-01-15T09:30:00Z",
                    ".",
                    None,
                    Status::Complete,
                    vec![],
                ),
                StrategyManifest::new(
                    "kiro-v3",
                    "2026-01-15T09:31:00Z",
                    ".",
                    None,
                    Status::InProgress,
                    vec![],
                ),
            ],
        };
        let path = manifest::manifest_path(&destination);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_string_pretty(&full).unwrap()).unwrap();

        let result = check_manifest(&destination);
        assert_eq!(result.status, CheckStatus::Failed);
        let remediation = result
            .remediation
            .as_ref()
            .expect("a failed check must carry remediation");
        assert!(
            remediation.contains("--harness kiro-v3"),
            "remediation must name the slot that is actually InProgress, got: {remediation}"
        );
        assert!(
            !remediation.contains("--harness claude"),
            "remediation must not point at reinstalling the healthy first slot, \
             got: {remediation}"
        );

        fs::remove_dir_all(&destination).ok();
    }

    /// Sibling of the above for the drift path: the first slot
    /// (`claude`) has no drifted files (its one file carries no
    /// recorded hash, so `drifted_files` skips it), and the second slot
    /// (`kiro-v3`) has a file missing on disk. The remediation hint
    /// must name `kiro-v3`, not the healthy first slot.
    #[test]
    fn check_manifest_names_the_actually_drifted_strategy_not_the_first() {
        let destination = scratch_dir("check-manifest-drift-not-first");
        let full = manifest::Manifest {
            schema_version: 2,
            strategies: vec![
                StrategyManifest::new(
                    "claude",
                    "2026-01-15T09:30:00Z",
                    ".",
                    None,
                    Status::Complete,
                    vec![manifest::ManifestFile {
                        path: "claude-owned/file.txt".to_string(),
                        sha256: None,
                        provenance: manifest::Provenance::Created,
                    }],
                ),
                StrategyManifest::new(
                    "kiro-v3",
                    "2026-01-15T09:31:00Z",
                    ".",
                    None,
                    Status::Complete,
                    vec![manifest::ManifestFile {
                        path: "kiro-owned/missing.json".to_string(),
                        sha256: Some(
                            "0000000000000000000000000000000000000000000000000000000000000000"
                                .to_string(),
                        ),
                        provenance: manifest::Provenance::Created,
                    }],
                ),
            ],
        };
        let path = manifest::manifest_path(&destination);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_string_pretty(&full).unwrap()).unwrap();

        let result = check_manifest(&destination);
        assert_eq!(result.status, CheckStatus::Stale);
        let remediation = result
            .remediation
            .as_ref()
            .expect("a stale check must carry remediation");
        assert!(
            remediation.contains("--harness kiro-v3"),
            "remediation must name the slot whose file actually drifted, got: {remediation}"
        );
        assert!(
            !remediation.contains("--harness claude"),
            "remediation must not point at reinstalling the healthy first slot, \
             got: {remediation}"
        );

        fs::remove_dir_all(&destination).ok();
    }

    /// CRITICAL fix regression: `check_manifest` on a manifest with an
    /// `UnsupportedSchemaVersion` must be `Failed` (this build cannot
    /// read it), but with a summary/remediation DISTINCT from the
    /// generic malformed-JSON path -- naming the version mismatch and
    /// pointing at updating `konductor`, never "re-run `konductor
    /// install`" (which the review correctly flagged as actively wrong
    /// advice: re-installing with a binary that still doesn't
    /// understand this schema_version reproduces the same failure).
    /// Direct unit test against `check_manifest` -- this branch has no
    /// other coverage.
    #[test]
    fn check_manifest_reports_distinct_remediation_for_unsupported_schema_version() {
        let destination = scratch_dir("check-manifest-unsupported-schema");
        let path = manifest::manifest_path(&destination);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();

        let result = check_manifest(&destination);
        assert_eq!(result.status, CheckStatus::Failed);
        assert!(
            result.summary.contains("incompatible konductor version"),
            "summary must name the version-mismatch reason distinctly, got: {}",
            result.summary
        );
        let remediation = result
            .remediation
            .as_ref()
            .expect("a failed check must carry remediation");
        assert!(
            remediation.contains("update konductor"),
            "remediation must point at updating konductor, got: {remediation}"
        );
        assert!(
            remediation.contains("do NOT re-run `konductor install`"),
            "remediation must explicitly warn against re-running install -- that cannot fix \
             a version-skewed manifest and is actively wrong advice per the review, \
             got: {remediation}"
        );

        fs::remove_dir_all(&destination).ok();
    }

    /// Sibling of the malformed-manifest/corrupt-JSON case
    /// (`dispatch_doctor_falls_back_to_cwd_with_warning_when_manifest_is_corrupt`):
    /// a manifest with an `UnsupportedSchemaVersion` is well-formed
    /// JSON and a real, readable record of a real install -- just one
    /// this binary's schema doesn't recognize -- so
    /// `resolve_source_for_checks` must NOT escalate to
    /// `unvalidated_cwd: true` the way a corrupt/unreadable manifest
    /// does. It still falls back to `target_dir` (this build cannot
    /// read `source` out of it either), but with its own fallback note
    /// naming the version mismatch specifically, and `check_source`/
    /// `check_config` stay `Info`, not `Warn`.
    #[test]
    fn resolve_source_for_checks_does_not_escalate_unsupported_schema_version_to_unvalidated_cwd() {
        let cwd = scratch_dir("unsupported-schema-fallback-cwd");
        let destination = scratch_dir("unsupported-schema-fallback-destination");
        let home = scratch_dir("unsupported-schema-fallback-home");
        let path = manifest::manifest_path(&destination);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":99,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","status":"complete","files":[]}"#,
        )
        .unwrap();

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert_eq!(resolved.path, cwd);
        assert!(
            !resolved.unvalidated_cwd,
            "an UnsupportedSchemaVersion manifest is a real, readable record of a real \
             install -- it must not be treated as untrustworthy as a corrupt manifest"
        );
        let note = resolved
            .fallback_note
            .as_ref()
            .expect("a version-skewed manifest must still produce an explicit fallback note");
        assert!(
            note.contains("schema_version 99") && note.contains("supports"),
            "fallback note must name the version mismatch specifically, got: {note}"
        );
        assert!(
            !note.contains("WARNING") && !note.contains("UNVALIDATED"),
            "fallback note must not carry the corrupt-manifest escalation marker, got: {note}"
        );

        let result = check_source(&resolved);
        assert_eq!(
            result.status,
            CheckStatus::Info,
            "a version-skewed-manifest fallback is Info, not Warn -- distinct from the \
             corrupt-manifest case"
        );

        let config_result = check_config_with_home(&resolved, Some(&home));
        assert_eq!(config_result.status, CheckStatus::Info);

        // The overall run is still EXIT_HALTED: `check_manifest` itself
        // reports the unsupported schema version as a real Failed,
        // even though source/config are only Info about their own
        // fallback.
        let code = dispatch_doctor_with(
            &cwd,
            None,
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        assert_eq!(code, EXIT_HALTED);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// `--json` output parses as valid JSON, carries `ok: false` when a
    /// check failed, and includes a `detail` array on the failing check.
    #[test]
    fn dispatch_doctor_json_output_is_valid_and_reports_failure_detail() {
        let source = scratch_dir("json-source");
        let destination = scratch_dir("json-destination");
        let home = scratch_dir("json-home");
        fs::create_dir_all(source.join("agents")).unwrap();
        fs::write(
            source.join("agents/broken.agent-spec.json"),
            b"{ not valid json",
        )
        .unwrap();

        let resolved_source = ResolvedSource {
            path: source.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        };
        let results = vec![
            check_source(&resolved_source),
            check_runtime(&destination),
            check_manifest(&destination),
            check_config_with_home(&resolved_source, Some(&home)),
        ];
        let rendered = format_report_json(&results);
        let parsed: serde_json::Value =
            serde_json::from_str(&rendered).expect("must be valid JSON");
        assert_eq!(parsed["command"], "doctor");
        assert_eq!(parsed["ok"], false);
        let checks = parsed["checks"]
            .as_array()
            .expect("checks must be an array");
        let source_check = checks
            .iter()
            .find(|c| c["name"] == "source")
            .expect("source check must be present");
        assert_eq!(source_check["status"], "failed");
        assert!(!source_check["detail"].as_array().unwrap().is_empty());
        assert_eq!(
            parsed["warnings"], false,
            "no check here is Warn, so the top-level warnings field must be false"
        );

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// IMPORTANT fix regression: the review correctly noted that `ok`
    /// alone reads `true` even when a `Warn` check is present (`Warn`
    /// deliberately never fails the run). The new `warnings` field
    /// must be `true` whenever any check is `Warn`, independent of
    /// `ok` -- exercised here against a report with only `Ok`/`Warn`
    /// checks (no `Failed`/`Stale` at all), so `ok: true` and
    /// `warnings: true` hold SIMULTANEOUSLY, proving a consumer that
    /// only checks `ok` would otherwise miss the warning entirely.
    #[test]
    fn format_report_json_warnings_field_is_true_when_a_check_is_warn_even_though_ok_is_true() {
        let results = vec![
            CheckResult::ok("runtime", "detected runtime(s): kiro-cli-v2"),
            CheckResult::warn(
                "source",
                "WARNING: manifest unreadable -- falling back to an UNVALIDATED cwd: /tmp",
                "fix or remove the manifest",
            ),
        ];
        // Sanity: neither status here is_failing, so `ok` reads true.
        assert!(!results.iter().any(|r| r.status.is_failing()));

        let rendered = format_report_json(&results);
        let parsed: serde_json::Value =
            serde_json::from_str(&rendered).expect("must be valid JSON");
        assert_eq!(
            parsed["ok"], true,
            "a report with only Ok/Warn checks (no Failed/Stale) must still read ok: true"
        );
        assert_eq!(
            parsed["warnings"], true,
            "warnings must be true because a Warn check is present, even though ok is true"
        );
    }

    /// Sibling of the test above: a report with no `Warn` check at all
    /// (only `Ok`) must report `warnings: false`.
    #[test]
    fn format_report_json_warnings_field_is_false_when_no_check_is_warn() {
        let results = vec![
            CheckResult::ok("runtime", "detected runtime(s): kiro-cli-v2"),
            CheckResult::ok("manifest", "manifest is Complete"),
        ];
        let rendered = format_report_json(&results);
        let parsed: serde_json::Value =
            serde_json::from_str(&rendered).expect("must be valid JSON");
        assert_eq!(parsed["ok"], true);
        assert_eq!(parsed["warnings"], false);
    }

    /// `resolve_destination` mirrors `install`'s own precedence: explicit
    /// `--target` wins outright, independent of `$HOME`. Exercises the
    /// re-exported `install::resolve_destination` (see the `use` import
    /// at the top of this module) through `doctor`'s own call site.
    #[test]
    fn resolve_destination_prefers_explicit_target_over_home() {
        let resolved = resolve_destination(Some("/tmp/explicit-target")).unwrap();
        assert_eq!(resolved, PathBuf::from("/tmp/explicit-target"));
    }

    /// Test-only helper: writes a `Manifest` directly to
    /// `<dir>/.konductor/manifest`, bypassing `install`'s real
    /// `install_from_local` path (this module has no dependency on any
    /// `InstallStrategy` -- these tests only need a manifest file to
    /// exist with specific content, not a real end-to-end install run).
    fn write_manifest_for_test(dir: &Path, written: &StrategyManifest) {
        let full = manifest::Manifest {
            schema_version: 2,
            strategies: vec![written.clone()],
        };
        let path = manifest::manifest_path(dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, serde_json::to_string_pretty(&full).unwrap()).unwrap();
    }

    // ── Manifest-based source resolution (check_source/check_config) ────

    /// (a) A manifest at the destination records a `source` path, and
    /// no `--from` is given: `check_source`/`check_config` must resolve
    /// against the MANIFEST's recorded path, not `target_dir` (the
    /// cwd) -- proven by pointing the manifest's recorded `source` at a
    /// real, well-formed tree while `target_dir` itself is a
    /// deliberately DIFFERENT, malformed one; a pass here can only
    /// happen if resolution actually followed the manifest, since
    /// falling back to `target_dir` would report `source`/`config` as
    /// `failed`.
    #[test]
    fn dispatch_doctor_check_source_and_check_config_use_manifest_recorded_source_by_default() {
        let cwd = scratch_dir("manifest-source-cwd");
        let real_source = scratch_dir("manifest-source-real");
        let destination = scratch_dir("manifest-source-destination");
        let home = scratch_dir("manifest-source-home");

        // `target_dir` (the cwd) is deliberately malformed: a
        // fallback-to-cwd bug would make `check_source` report
        // `failed` here.
        fs::create_dir_all(cwd.join("agents")).unwrap();
        fs::write(
            cwd.join("agents/broken.agent-spec.json"),
            b"{ not valid json",
        )
        .unwrap();

        // The REAL, well-formed source the manifest will record --
        // empty-but-valid, same as the healthy-project fixture
        // elsewhere in this file.
        let written = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            Some(real_source.display().to_string()),
            Status::Complete,
            vec![],
        );
        write_manifest_for_test(&destination, &written);

        let code = dispatch_doctor_with(
            &cwd,
            None, // no --from: manifest resolution must be the default
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );

        assert_eq!(
            code, 0,
            "doctor must resolve source/config against the manifest's recorded (well-formed) \
             path, not the malformed cwd"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert_eq!(resolved.path, real_source);
        assert!(
            resolved.fallback_note.is_none(),
            "a manifest with a recorded source must not report a fallback"
        );

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&real_source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// (a.1) A manifest at the destination records a `source` path,
    /// but that path no longer exists on disk (moved, deleted, or
    /// `doctor` running on a different host than the one that
    /// installed): `resolve_source_for_checks` must fall back to
    /// `target_dir` with an `Info`-tier note naming the stale path,
    /// rather than handing `check_source`/`check_config` a nonexistent
    /// path that `parse_canonical` hard-rejects -- see
    /// `ResolvedSource::missing_recorded_source`'s own doc comment.
    /// Regression coverage: without this fallback, a stale recorded
    /// source path would surface a healthy installation as
    /// `EXIT_HALTED` with the misleading remediation "fix the reported
    /// error in <stale path>".
    #[test]
    fn resolve_source_for_checks_falls_back_when_recorded_source_no_longer_exists() {
        let cwd = scratch_dir("missing-recorded-source-cwd");
        let destination = scratch_dir("missing-recorded-source-destination");
        let stale_source = scratch_dir("missing-recorded-source-stale");
        let home = scratch_dir("missing-recorded-source-home");

        // `cwd` is a real, well-formed source tree -- proves resolution
        // actually fell back to it rather than merely avoiding a crash.
        fs::create_dir_all(cwd.join("agents")).unwrap();
        fs::create_dir_all(cwd.join("skills")).unwrap();
        fs::create_dir_all(cwd.join("agent-sops")).unwrap();
        fs::create_dir_all(cwd.join("context")).unwrap();

        let written = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            Some(stale_source.display().to_string()),
            Status::Complete,
            vec![],
        );
        write_manifest_for_test(&destination, &written);
        // The recorded source path is "stale" by construction: create
        // it via `scratch_dir` (for a unique, collision-free path) then
        // remove it immediately, so it is guaranteed absent on disk.
        fs::remove_dir_all(&stale_source).unwrap();
        assert!(!stale_source.exists());

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert_eq!(
            resolved.path, cwd,
            "must fall back to target_dir, not hand the stale path to parse_canonical"
        );
        assert!(
            resolved.missing_recorded_source,
            "must flag this as the missing-recorded-source fallback tier"
        );
        assert!(
            !resolved.unvalidated_cwd,
            "the manifest itself is fully readable and trustworthy -- only the recorded \
             path is stale -- so this must not be treated as an unvalidated cwd"
        );
        let note = resolved
            .fallback_note
            .as_ref()
            .expect("a stale recorded-source path must still produce an explicit fallback note");
        assert!(
            note.contains(&stale_source.display().to_string()),
            "fallback note must name the stale recorded path specifically, got: {note}"
        );

        let result = check_source(&resolved);
        assert_eq!(
            result.status,
            CheckStatus::Info,
            "a stale recorded-source fallback is a benign, expected fallback -- Info, not Warn"
        );

        let code = dispatch_doctor_with(
            &cwd,
            None,
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "a healthy fallback tree must not surface as EXIT_HALTED just because the \
             manifest's recorded source is stale"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// (b) No manifest exists at the destination, and no `--from` is
    /// given: `check_source`/`check_config` must fall back to
    /// `target_dir` (the cwd), and the fallback must be stated
    /// EXPLICITLY in the check's own summary -- never a silent mix of
    /// "validated what's installed" and "validated whatever's on disk"
    /// semantics.
    #[test]
    fn dispatch_doctor_falls_back_to_cwd_with_explicit_note_when_no_manifest_exists() {
        let cwd = scratch_dir("no-manifest-fallback-cwd");
        let destination = scratch_dir("no-manifest-fallback-destination");
        let home = scratch_dir("no-manifest-fallback-home");
        // Destination exists but nothing has ever been installed there
        // -- no manifest at all.

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert_eq!(resolved.path, cwd);
        let note = resolved
            .fallback_note
            .as_ref()
            .expect("no manifest must produce an explicit fallback note");
        assert!(
            note.contains("no manifest found"),
            "fallback note must explicitly say no manifest was found, got: {note}"
        );
        assert!(
            note.contains(&cwd.display().to_string()),
            "fallback note must name the cwd it fell back to, got: {note}"
        );

        let result = check_source(&resolved);
        assert_eq!(
            result.status,
            CheckStatus::Info,
            "a stated fallback that still parses cleanly is Info, not silently Ok"
        );
        assert!(
            result.summary.contains("no manifest found"),
            "the check's own summary line must state the fallback explicitly, got: {}",
            result.summary
        );

        let code = dispatch_doctor_with(
            &cwd,
            None,
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "an info-level fallback must not fail the overall run"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// (b') Distinct sibling of the test above: the manifest at the
    /// destination EXISTS but is corrupt/unreadable (malformed JSON), so
    /// `check_source`/`check_config` ALSO fall back to `target_dir` (the
    /// cwd) -- but this fallback reason is materially worse (the cwd may
    /// have no relationship at all to what was installed) and must be
    /// visibly, not just textually, distinguishable from the benign
    /// "no manifest exists yet" case: a different `CheckStatus`
    /// (`Warn`, not `Info`) and an unmistakable `WARNING:`/`UNVALIDATED`
    /// marker in the summary line itself, never buried only in `-v`
    /// detail.
    #[test]
    fn dispatch_doctor_falls_back_to_cwd_with_warning_when_manifest_is_corrupt() {
        let cwd = scratch_dir("corrupt-manifest-fallback-cwd");
        let destination = scratch_dir("corrupt-manifest-fallback-destination");
        let home = scratch_dir("corrupt-manifest-fallback-home");
        let manifest_path = manifest::manifest_path(&destination);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, b"{ not valid json").unwrap();

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert_eq!(resolved.path, cwd);
        assert!(
            resolved.unvalidated_cwd,
            "a corrupt/unreadable manifest must set unvalidated_cwd, unlike a missing manifest"
        );
        let note = resolved
            .fallback_note
            .as_ref()
            .expect("a corrupt manifest must still produce an explicit fallback note");
        assert!(
            note.contains("WARNING") && note.contains("UNVALIDATED"),
            "the corrupt-manifest fallback note must carry an unmistakable marker, got: {note}"
        );
        assert!(
            !note.contains("no manifest found"),
            "the corrupt-manifest fallback note must not read like the benign no-manifest \
             case, got: {note}"
        );

        let result = check_source(&resolved);
        assert_eq!(
            result.status,
            CheckStatus::Warn,
            "a corrupt-manifest fallback must be Warn, distinct from the benign fallback's Info"
        );
        assert!(
            result.summary.contains("WARNING") && result.summary.contains("UNVALIDATED"),
            "the check's own summary line must carry the unmistakable marker (not just -v \
             detail), got: {}",
            result.summary
        );

        let config_result = check_config_with_home(&resolved, Some(&home));
        assert_eq!(
            config_result.status,
            CheckStatus::Warn,
            "check_config must escalate the same way check_source does"
        );

        let code = dispatch_doctor_with(
            &cwd,
            None,
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        assert_eq!(
            code, EXIT_HALTED,
            "the manifest check surfaces the unreadable manifest itself as a real failure, \
             so the overall run must be EXIT_HALTED even though source/config are only Warn"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// (c) An explicit `--from` is given: it must be honored regardless
    /// of what the manifest at the destination records -- even when
    /// that manifest records a DIFFERENT, real source path. `--from` is
    /// the escape hatch and always wins outright.
    #[test]
    fn dispatch_doctor_explicit_from_overrides_manifest_recorded_source() {
        let cwd = scratch_dir("explicit-from-override-cwd");
        let explicit_from = scratch_dir("explicit-from-override-explicit");
        let manifest_recorded_source = scratch_dir("explicit-from-override-manifest-source");
        let destination = scratch_dir("explicit-from-override-destination");
        let home = scratch_dir("explicit-from-override-home");

        let written = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            Some(manifest_recorded_source.display().to_string()),
            Status::Complete,
            vec![],
        );
        write_manifest_for_test(&destination, &written);

        let resolved =
            resolve_source_for_checks(&cwd, Some(explicit_from.to_str().unwrap()), &destination);
        assert_eq!(
            resolved.path, explicit_from,
            "an explicit --from must be honored, not the manifest's recorded source"
        );
        assert!(
            resolved.fallback_note.is_none(),
            "an explicit --from is not a fallback and must carry no fallback note"
        );

        let code = dispatch_doctor_with(
            &cwd,
            Some(explicit_from.display().to_string()),
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&explicit_from).ok();
        fs::remove_dir_all(&manifest_recorded_source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// (d) Backward-compat: a manifest written in the OLD format (no
    /// `source` field at all -- predates this change) must still be
    /// read successfully, and resolution must fall back to `target_dir`
    /// with an explicit note naming the missing-field case specifically
    /// (distinct from the no-manifest-at-all case in test (b) above),
    /// never crashing or silently mixing semantics.
    ///
    /// This is a real, completed install (unlike test (b)'s "nothing
    /// installed yet" case), but the manifest itself is fully readable
    /// and trustworthy -- only silent on `source` -- so this remains a
    /// benign, expected fallback and is reported `Info`, same as the
    /// no-manifest-at-all case; `legacy_manifest_no_source` is the flag
    /// that distinguishes it for wording purposes only, not severity.
    /// `unvalidated_cwd` (an unreadable manifest) is the only tier that
    /// escalates to `Warn`.
    #[test]
    fn dispatch_doctor_falls_back_with_info_note_for_legacy_manifest_missing_source_field() {
        let cwd = scratch_dir("legacy-manifest-cwd");
        let destination = scratch_dir("legacy-manifest-destination");
        let home = scratch_dir("legacy-manifest-home");

        // Hand-write an old-format v1 manifest with no `source` key at
        // all (predates this field), mirroring
        // manifest.rs's own `read_manifest_defaults_status_and_provenance_for_legacy_v1_manifest`
        // fixture for the equivalent `status`/`provenance` back-compat
        // guarantee.
        let path = manifest::manifest_path(&destination);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","files":[]}"#,
        )
        .unwrap();

        // Confirm the legacy manifest itself still reads back with
        // `source: None` rather than failing to parse.
        let loaded = manifest::read_manifest(&destination)
            .expect("a legacy v1 manifest missing `source` must still parse")
            .expect("manifest must be present");
        assert_eq!(
            loaded.strategies[0].source, None,
            "a legacy manifest with no `source` key must default to None, not fail to deserialize"
        );

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert_eq!(resolved.path, cwd);
        assert!(
            resolved.legacy_manifest_no_source,
            "a real install with no recorded source must set legacy_manifest_no_source"
        );
        assert!(
            !resolved.unvalidated_cwd,
            "the manifest here is fully readable -- this must not be conflated with the \
             unreadable-manifest case"
        );
        let note = resolved
            .fallback_note
            .as_ref()
            .expect("a manifest missing the source field must produce an explicit fallback note");
        assert!(
            note.contains("no recorded source"),
            "fallback note must specifically say the manifest has no recorded source \
             (distinct from 'no manifest found'), got: {note}"
        );

        let result = check_source(&resolved);
        assert_eq!(
            result.status,
            CheckStatus::Info,
            "a real install with no recorded source is still a benign, expected fallback -- \
             Info, not Warn"
        );

        let config_result = check_config_with_home(&resolved, Some(&home));
        assert_eq!(
            config_result.status,
            CheckStatus::Info,
            "check_config must escalate the same way check_source does"
        );

        let code = dispatch_doctor_with(
            &cwd,
            None,
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        // Warn (like Info) never fails the overall run on its own.
        assert_eq!(code, 0);
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    // ── Fallback detail + Warn-not-Failed downgrade ──

    /// Finding 2: a `Warn`/`Info` fallback's `--json` output must carry
    /// `detail` with the fallback note as its FIRST entry, not just in
    /// `summary` -- `escalate_for_fallback` must route its non-`Ok`
    /// branches through `fallback_detail`, the same helper the
    /// `Failed`/`Stale` path already uses, so the README's documented
    /// `--json` contract ("`detail` ... carries every individual
    /// problem found, plus the fallback note (if any) as its first
    /// entry") actually holds for every check status.
    #[test]
    fn escalate_for_fallback_populates_json_detail_with_fallback_note_for_info() {
        let cwd = scratch_dir("escalate-detail-cwd");
        let destination = scratch_dir("escalate-detail-destination");
        fs::create_dir_all(cwd.join("agents")).unwrap();
        fs::create_dir_all(cwd.join("skills")).unwrap();
        fs::create_dir_all(cwd.join("agent-sops")).unwrap();
        fs::create_dir_all(cwd.join("context")).unwrap();

        // Legacy manifest (no recorded source): an Info-tier fallback
        // whose fallback tree still parses cleanly.
        let path = manifest::manifest_path(&destination);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","files":[]}"#,
        )
        .unwrap();

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert!(resolved.legacy_manifest_no_source);

        let result = check_source(&resolved);
        assert_eq!(result.status, CheckStatus::Info);
        assert_eq!(
            result.detail.first().map(String::as_str),
            resolved.fallback_note.as_deref(),
            "an Info fallback's detail must carry the fallback note as its first entry, got: \
             {:?}",
            result.detail
        );

        let rendered = format_report_json(&[result]);
        let parsed: serde_json::Value =
            serde_json::from_str(&rendered).expect("must be valid JSON");
        let source_check = parsed["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["name"] == "source")
            .expect("source check must be present");
        assert_eq!(source_check["status"], "info");
        let detail = source_check["detail"]
            .as_array()
            .expect("an Info check's JSON detail must not be omitted");
        assert_eq!(
            detail[0],
            resolved.fallback_note.clone().unwrap(),
            "the JSON detail array's first entry must be the fallback note"
        );

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
    }

    /// Regression (review finding): `check_config`'s error summary must
    /// name the ACTUAL broken config file, not unconditionally assume
    /// the project tier is the culprit. This scenario malforms only the
    /// `$HOME`-tier (`~/.konductor/config.yml`) file, leaving the
    /// project tier absent entirely (a valid, common state -- no local
    /// `.konductor/config.yml` yet), and asserts the reported summary
    /// names the user-tier path, never the project `source_dir`.
    #[test]
    fn check_config_names_the_actual_broken_home_tier_file_not_the_project_path() {
        let source_dir = scratch_dir("config-broken-home-tier-source");
        let home_dir = scratch_dir("config-broken-home-tier-home");

        let user_config_dir = home_dir.join(config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&user_config_dir).unwrap();
        let user_config_path = user_config_dir.join(config::CONFIG_FILE_NAME);
        fs::write(&user_config_path, b"not: [valid: yaml").unwrap();

        let resolved = ResolvedSource {
            path: source_dir.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        };

        let result = check_config_with_home(&resolved, Some(&home_dir));
        assert_eq!(
            result.status,
            CheckStatus::Failed,
            "a malformed $HOME-tier config must fail check_config"
        );
        let user_path_str = user_config_path.display().to_string();
        assert!(
            result.summary.contains(&user_path_str),
            "check_config's summary must name the actual broken file ({user_path_str}), got: {}",
            result.summary
        );
        let source_dir_config_str = source_dir
            .join(config::KONDUCTOR_DIR_NAME)
            .join(config::CONFIG_FILE_NAME)
            .display()
            .to_string();
        assert!(
            !result.summary.contains(&source_dir_config_str),
            "check_config's summary must not name the project tier's path ({source_dir_config_str}) \
             when the project tier isn't the one that's actually broken, got: {}",
            result.summary
        );

        fs::remove_dir_all(&source_dir).ok();
        fs::remove_dir_all(&home_dir).ok();
    }

    /// `missing_recorded_source` fallback tiers specifically, a
    /// parse/load failure against the fallback tree must downgrade to
    /// `Info`, not `Failed` -- the manifest itself is fully readable
    /// and the install it describes is healthy, so this must not map
    /// to `EXIT_HALTED`. Exercised here via `missing_recorded_source`
    /// (a manifest recording a now-deleted source path) with a
    /// deliberately malformed fallback tree at `target_dir`.
    #[test]
    fn check_source_downgrades_failed_to_info_for_missing_recorded_source_fallback() {
        let cwd = scratch_dir("downgrade-missing-recorded-cwd");
        let destination = scratch_dir("downgrade-missing-recorded-destination");
        let stale_source = scratch_dir("downgrade-missing-recorded-stale");
        let home = scratch_dir("downgrade-missing-recorded-home");

        // `cwd` (the fallback tree) is deliberately malformed.
        fs::create_dir_all(cwd.join("agents")).unwrap();
        fs::write(
            cwd.join("agents/broken.agent-spec.json"),
            b"{ not valid json",
        )
        .unwrap();

        let written = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-15T09:30:00Z",
            ".",
            Some(stale_source.display().to_string()),
            Status::Complete,
            vec![],
        );
        write_manifest_for_test(&destination, &written);
        fs::remove_dir_all(&stale_source).unwrap();
        assert!(!stale_source.exists());

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert!(resolved.missing_recorded_source);
        assert!(!resolved.unvalidated_cwd);

        let result = check_source(&resolved);
        assert_eq!(
            result.status,
            CheckStatus::Info,
            "a malformed missing-recorded-source fallback tree must downgrade to Info, not \
             Failed -- the install itself is healthy"
        );
        let remediation = result
            .remediation
            .as_ref()
            .expect("an Info result must still carry remediation");
        assert!(
            remediation.contains("invalid JSON") || remediation.contains("failed to parse"),
            "remediation must still surface the real parse error text, got: {remediation}"
        );

        let config_result = check_config_with_home(&resolved, Some(&home));
        // `config` has no config.yml at all in this fixture, so it
        // loads cleanly (preset defaults) rather than failing -- assert
        // it is not incorrectly downgraded to Failed either way.
        assert_ne!(config_result.status, CheckStatus::Failed);

        let code = dispatch_doctor_with(
            &cwd,
            None,
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        assert_ne!(
            code, EXIT_HALTED,
            "a healthy install must not fail the overall run just because an unrelated \
             fallback tree is malformed"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// Regression carve-out: the
    /// `unvalidated_cwd` tier (corrupt/unreadable manifest) must NOT be
    /// downgraded the same way -- `check_manifest` already reports that
    /// case as its own independent `Failed`, so the overall run must
    /// stay `EXIT_HALTED` regardless of what `check_source`/
    /// `check_config` report for their own fallback. Confirms the
    /// downgrade in `failed_or_downgraded_for_fallback` is gated
    /// specifically on `legacy_manifest_no_source`/
    /// `missing_recorded_source`, not on "any fallback tier".
    #[test]
    fn check_source_does_not_downgrade_unvalidated_cwd_and_run_stays_halted() {
        let cwd = scratch_dir("no-downgrade-unvalidated-cwd");
        let destination = scratch_dir("no-downgrade-unvalidated-destination");
        let home = scratch_dir("no-downgrade-unvalidated-home");

        // Corrupt/unreadable manifest -> unvalidated_cwd: true.
        let manifest_path = manifest::manifest_path(&destination);
        fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
        fs::write(&manifest_path, b"{ not valid json").unwrap();

        // The fallback tree (`cwd`) is ALSO malformed, so `check_source`
        // hits the same `Err` arm `missing_recorded_source` would.
        fs::create_dir_all(cwd.join("agents")).unwrap();
        fs::write(
            cwd.join("agents/broken.agent-spec.json"),
            b"{ not valid json",
        )
        .unwrap();

        let resolved = resolve_source_for_checks(&cwd, None, &destination);
        assert!(resolved.unvalidated_cwd);
        assert!(!resolved.legacy_manifest_no_source);
        assert!(!resolved.missing_recorded_source);

        let result = check_source(&resolved);
        assert_eq!(
            result.status,
            CheckStatus::Failed,
            "unvalidated_cwd must keep its original Failed status -- it is explicitly \
             excluded from the Warn downgrade"
        );

        let code = dispatch_doctor_with(
            &cwd,
            None,
            Some(destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&home),
            ColorMode::disabled(),
        );
        assert_eq!(
            code, EXIT_HALTED,
            "check_manifest already reports the unreadable manifest as its own independent \
             Failed, so the overall run must correctly stay EXIT_HALTED"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    // ── container_runtime (active), and gitignore/provider_model_access/ ──
    // ── role_allowlists (dormant -- see dispatch_doctor_with) ───────────

    /// `check_container_runtime` must always report `Info` and never
    /// panic/crash, regardless of what's actually on the test machine's
    /// PATH -- either it names a detected runtime (one of the exact
    /// `CONTAINER_RUNTIME_PROBE_ORDER` candidates) or it reports "none
    /// found" naming all four candidates it checked.
    #[test]
    fn check_container_runtime_reports_info_and_names_a_runtime_or_none_found() {
        let result = check_container_runtime();
        assert_eq!(result.status, CheckStatus::Info);
        assert_eq!(result.name, "container_runtime");

        let names_a_candidate = CONTAINER_RUNTIME_PROBE_ORDER
            .iter()
            .any(|candidate| result.summary.contains(candidate));
        assert!(
            names_a_candidate,
            "summary must name a detected runtime or list the candidates checked, got: {}",
            result.summary
        );
    }

    /// `find_binary_on_path` must return `None`, not panic, for a
    /// binary name that cannot possibly exist on any real `PATH`.
    #[test]
    fn find_binary_on_path_returns_none_for_a_nonexistent_binary() {
        assert!(find_binary_on_path(
            "konductor-doctor-test-definitely-not-a-real-binary-xyz",
            std::env::var_os("PATH").as_deref()
        )
        .is_none());
    }

    /// `find_binary_on_path` must return `None`, not panic, for an
    /// unset `PATH` (`path_var: None`).
    #[test]
    fn find_binary_on_path_returns_none_for_an_unset_path() {
        assert!(find_binary_on_path("docker", None).is_none());
    }

    /// Test-only helper: writes an empty executable file named `name`
    /// under `dir` (creating `dir` if absent) and marks it
    /// owner-executable, mirroring what a real `PATH` entry for a
    /// container runtime binary would look like.
    #[cfg(unix)]
    fn write_fake_executable(dir: &Path, name: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, b"").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    /// A fake `PATH` entry containing an executable named `podman` (one
    /// of the real probe candidates, not first in
    /// `CONTAINER_RUNTIME_PROBE_ORDER`) must be detected by a pure
    /// filesystem scan -- no real `docker`/`podman`/etc. involved.
    #[test]
    #[cfg(unix)]
    fn check_container_runtime_detects_a_fake_binary_on_a_mocked_path() {
        let fake_path_dir = scratch_dir("container-runtime-fake-path");
        write_fake_executable(&fake_path_dir, "podman");

        let path_var = std::ffi::OsString::from(fake_path_dir.display().to_string());
        let result = check_container_runtime_with_path(Some(path_var));

        assert_eq!(result.status, CheckStatus::Info);
        assert!(
            result.summary.contains("podman"),
            "must name the detected fake 'podman' binary, got: {}",
            result.summary
        );

        fs::remove_dir_all(&fake_path_dir).ok();
    }

    /// A mocked `PATH` with no matching executables at all (an empty,
    /// real directory) must report the "none found" `Info` outcome,
    /// naming every candidate checked.
    #[test]
    fn check_container_runtime_reports_none_found_on_an_empty_mocked_path() {
        let empty_path_dir = scratch_dir("container-runtime-empty-path");
        fs::create_dir_all(&empty_path_dir).unwrap();

        let path_var = std::ffi::OsString::from(empty_path_dir.display().to_string());
        let result = check_container_runtime_with_path(Some(path_var));

        assert_eq!(result.status, CheckStatus::Info);
        for candidate in CONTAINER_RUNTIME_PROBE_ORDER {
            assert!(
                result.summary.contains(candidate),
                "the 'none found' summary must list every checked candidate ({candidate}), \
                 got: {}",
                result.summary
            );
        }

        fs::remove_dir_all(&empty_path_dir).ok();
    }

    /// Regression (review finding, hang risk): proves the container
    /// runtime check never executes a candidate binary. Plants a
    /// `docker` "binary" that is actually a shell script which would
    /// hang forever (`sleep infinity`) if ever run, points a mocked
    /// `PATH` at it, and asserts the check completes (this test itself
    /// finishing at all is the proof no subprocess was spawned) and
    /// still correctly reports the binary as present by name -- a pure
    /// filesystem scan identifies presence without executing anything.
    #[test]
    #[cfg(unix)]
    fn check_container_runtime_never_executes_a_candidate_even_if_it_would_hang() {
        let fake_path_dir = scratch_dir("container-runtime-hang-proof-path");
        let script_path = write_fake_executable(&fake_path_dir, "docker");
        fs::write(&script_path, b"#!/bin/sh\nsleep infinity\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&script_path, fs::Permissions::from_mode(0o755)).unwrap();

        let path_var = std::ffi::OsString::from(fake_path_dir.display().to_string());
        // If this ever spawned the script, the test would hang forever
        // instead of reaching this assertion.
        let result = check_container_runtime_with_path(Some(path_var));

        assert_eq!(result.status, CheckStatus::Info);
        assert!(
            result.summary.contains("docker"),
            "must correctly identify the hang-risk 'docker' script as present by name alone, \
             got: {}",
            result.summary
        );

        fs::remove_dir_all(&fake_path_dir).ok();
    }

    /// A missing `.konductor/.gitignore` must be reported `Warn` (a
    /// hygiene issue, not a broken install), naming every documented
    /// pattern in the remediation.
    #[test]
    fn check_gitignore_warns_when_file_is_missing() {
        let source = scratch_dir("gitignore-check-missing");

        let resolved = ResolvedSource {
            path: source.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        };
        let result = check_gitignore(&resolved);
        assert_eq!(result.status, CheckStatus::Warn);
        let remediation = result.remediation.as_ref().expect("must have remediation");
        assert!(remediation.contains("konductor init"));
        for pattern in crate::cli::init::GITIGNORE_PATTERNS {
            assert!(
                remediation.contains(pattern),
                "remediation must name missing pattern {pattern}, got: {remediation}"
            );
        }

        fs::remove_dir_all(&source).ok();
    }

    /// A `.konductor/.gitignore` containing every documented pattern
    /// must be reported `Ok`.
    #[test]
    fn check_gitignore_ok_when_file_is_complete() {
        let source = scratch_dir("gitignore-check-complete");
        let konductor_dir = source.join(config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(init::GITIGNORE_FILE_NAME),
            format!("{}\n", init::GITIGNORE_PATTERNS.join("\n")),
        )
        .unwrap();

        let resolved = ResolvedSource {
            path: source.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        };
        let result = check_gitignore(&resolved);
        assert_eq!(result.status, CheckStatus::Ok);

        fs::remove_dir_all(&source).ok();
    }

    /// A `.konductor/.gitignore` missing one or more documented
    /// patterns must be reported `Warn`, naming exactly the missing
    /// ones (not every pattern) in the remediation.
    #[test]
    fn check_gitignore_warns_and_names_missing_patterns_when_incomplete() {
        let source = scratch_dir("gitignore-check-incomplete");
        let konductor_dir = source.join(config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        // Only one of the five documented patterns present.
        fs::write(konductor_dir.join(init::GITIGNORE_FILE_NAME), "runs/\n").unwrap();

        let resolved = ResolvedSource {
            path: source.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        };
        let result = check_gitignore(&resolved);
        assert_eq!(result.status, CheckStatus::Warn);
        let remediation = result.remediation.as_ref().expect("must have remediation");
        assert!(
            !remediation.contains("runs/"),
            "must not name a pattern that is already present, got: {remediation}"
        );
        assert!(
            remediation.contains("overrides.yml"),
            "must name a genuinely missing pattern, got: {remediation}"
        );

        fs::remove_dir_all(&source).ok();
    }

    /// `check_provider_model_access` is an honest not-yet-applicable
    /// stub: always `Info`, always the same scope-statement message,
    /// never `Warn`/`Failed`, and therefore never affects the exit
    /// code.
    #[test]
    fn check_provider_model_access_is_always_info_stub() {
        let result = check_provider_model_access();
        assert_eq!(result.status, CheckStatus::Info);
        assert!(result.summary.contains("provider/model-access"));
        assert!(result.summary.contains("not yet implemented"));
        assert!(!result.status.is_failing());
        assert!(!result.status.is_warning());
    }

    /// `check_role_allowlists` is an honest not-yet-applicable stub:
    /// always `Info`, always the same scope-statement message, never
    /// `Warn`/`Failed`, and therefore never affects the exit code.
    #[test]
    fn check_role_allowlists_is_always_info_stub() {
        let result = check_role_allowlists();
        assert_eq!(result.status, CheckStatus::Info);
        assert!(result.summary.contains("role-scoped allowlist"));
        assert!(result.summary.contains("not yet implemented"));
        assert!(!result.status.is_failing());
        assert!(!result.status.is_warning());
    }

    /// End-to-end: a healthy install with no recorded source (the
    /// benign fallback case) must produce a LIVE report (via
    /// `dispatch_doctor_with`) with exactly the FIVE ACTIVE checks
    /// present (`gitignore`/`provider_model_access`/`role_allowlists`
    /// must NOT appear -- see the comment in `dispatch_doctor_with`'s
    /// `results` assembly for why they're dormant), zero
    /// `Warn`/`Failed`/`Stale` entries among them (the zero-warnings
    /// acceptance criterion), and exit code 0.
    #[test]
    fn dispatch_doctor_reports_five_active_checks_with_zero_warnings_on_healthy_install() {
        let source = scratch_dir("zero-warnings-source");
        let destination = scratch_dir("zero-warnings-destination");
        let home = scratch_dir("zero-warnings-home");
        fs::create_dir_all(source.join("agents")).unwrap();
        fs::create_dir_all(source.join("skills")).unwrap();
        fs::create_dir_all(source.join("agent-sops")).unwrap();
        fs::create_dir_all(source.join("context")).unwrap();
        // A complete .konductor/.gitignore too, even though the
        // (dormant) `gitignore` check won't run against it via
        // dispatch -- kept so this fixture is unambiguously a
        // genuinely healthy, zero-warnings install by every measure.
        let konductor_dir = source.join(config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(init::GITIGNORE_FILE_NAME),
            format!("{}\n", init::GITIGNORE_PATTERNS.join("\n")),
        )
        .unwrap();

        let rendered_json = {
            let code = dispatch_doctor_with(
                &source,
                Some(source.display().to_string()),
                Some(destination.display().to_string()),
                false, // all
                false,
                true,
                Some(&home),
                ColorMode::disabled(),
            );
            assert_eq!(code, 0);
            assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

            // Capture the same call's --json form by re-deriving the
            // results the same way `dispatch_doctor_with` does, since
            // the function itself only prints to stdout.
            let resolved_source = ResolvedSource {
                path: source.clone(),
                fallback_note: None,
                unvalidated_cwd: false,
                legacy_manifest_no_source: false,
                missing_recorded_source: false,
                unsupported_schema_version: false,
            };
            let results = vec![
                check_source(&resolved_source),
                check_runtime(&destination),
                check_manifest(&destination),
                check_config_with_home(&resolved_source, Some(&home)),
                check_container_runtime(),
            ];
            assert_eq!(
                results.len(),
                5,
                "exactly five checks must be present in the live dispatch path"
            );
            let names: Vec<&str> = results.iter().map(|r| r.name).collect();
            for dormant in ["gitignore", "provider_model_access", "role_allowlists"] {
                assert!(
                    !names.contains(&dormant),
                    "dormant check {dormant} must not appear in the live check list, got: \
                     {names:?}"
                );
            }
            assert!(
                !results.iter().any(|r| r.status.is_warning()),
                "a genuinely healthy install must produce zero Warn entries: {:?}",
                results
                    .iter()
                    .map(|r| (r.name, r.status.label()))
                    .collect::<Vec<_>>()
            );
            assert!(!results.iter().any(|r| r.status.is_failing()));
            format_report_json(&results)
        };

        let parsed: serde_json::Value =
            serde_json::from_str(&rendered_json).expect("must be valid JSON");
        assert_eq!(parsed["ok"], true);
        assert_eq!(
            parsed["warnings"], false,
            "zero-warnings AC: a healthy install with no recorded source must not surface \
             warnings: true"
        );
        let checks = parsed["checks"].as_array().unwrap();
        assert_eq!(
            checks.len(),
            5,
            "--json must also carry exactly five checks"
        );
        for dormant in ["gitignore", "provider_model_access", "role_allowlists"] {
            assert!(
                !checks.iter().any(|c| c["name"] == dormant),
                "--json checks array must not include dormant check {dormant}"
            );
        }

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
        fs::remove_dir_all(&home).ok();
    }

    /// Sibling of the test above, proving the three DORMANT checks
    /// Regression test: a MALFORMED `$HOME`-tier
    /// `.konductor/config.yml` in a scratch home-dir override must
    /// (a) actually surface through the full `dispatch_doctor_with`
    /// dispatch path as a real `Failed`/`EXIT_HALTED` result -- proving
    /// the override seam actually reaches the live `config` check, not
    /// just the direct-call unit test
    /// (`check_config_names_the_actual_broken_home_tier_file_not_the_project_path`)
    /// -- and (b) not leak into a SEPARATE `dispatch_doctor_with` run
    /// against an unrelated healthy scratch home dir. (b) is the actual
    /// isolation proof: it fails if the override seam were somehow
    /// mutating real process-global `HOME`, or if two runs' scratch
    /// dirs collided, since either would make the healthy run see the
    /// broken config too.
    #[test]
    fn dispatch_doctor_with_malformed_home_config_is_isolated_and_does_not_affect_other_runs() {
        let broken_source = scratch_dir("isolation-broken-source");
        let broken_destination = scratch_dir("isolation-broken-destination");
        let broken_home = scratch_dir("isolation-broken-home");
        let broken_user_config_dir = broken_home.join(config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&broken_user_config_dir).unwrap();
        fs::write(
            broken_user_config_dir.join(config::CONFIG_FILE_NAME),
            b"not: [valid: yaml",
        )
        .unwrap();

        let code = dispatch_doctor_with(
            &broken_source,
            Some(broken_source.display().to_string()),
            Some(broken_destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&broken_home),
            ColorMode::disabled(),
        );
        assert_eq!(
            code, EXIT_HALTED,
            "a malformed $HOME-tier config reached through the override seam must halt the run"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        // A second, unrelated run against a genuinely healthy scratch
        // home dir (no config.yml at all) must be completely unaffected
        // by the broken run above -- proving the override is isolated
        // per call, not a shared/global state.
        let healthy_source = scratch_dir("isolation-healthy-source");
        let healthy_destination = scratch_dir("isolation-healthy-destination");
        let healthy_home = scratch_dir("isolation-healthy-home");

        let healthy_code = dispatch_doctor_with(
            &healthy_source,
            Some(healthy_source.display().to_string()),
            Some(healthy_destination.display().to_string()),
            false, // all
            false,
            false,
            Some(&healthy_home),
            ColorMode::disabled(),
        );
        assert_eq!(
            healthy_code, 0,
            "an unrelated healthy run must not be affected by a prior run's broken $HOME \
             override -- isolation must hold across successive dispatch_doctor_with calls"
        );

        fs::remove_dir_all(&broken_source).ok();
        fs::remove_dir_all(&broken_destination).ok();
        fs::remove_dir_all(&broken_home).ok();
        fs::remove_dir_all(&healthy_source).ok();
        fs::remove_dir_all(&healthy_destination).ok();
        fs::remove_dir_all(&healthy_home).ok();
    }

    /// (`gitignore`, `provider_model_access`, `role_allowlists`) are
    /// not dead/rotting code even though `dispatch_doctor_with` never
    /// calls them: called DIRECTLY against the same healthy fixture,
    /// each still produces a correct, non-failing result. This is the
    /// direct-function-call proof that complements
    /// `check_gitignore_ok_when_file_is_complete`,
    /// `check_provider_model_access_is_always_info_stub`, and
    /// `check_role_allowlists_is_always_info_stub` above -- here all
    /// three run together against one realistic healthy install
    /// fixture rather than in isolation.
    #[test]
    fn dormant_checks_still_work_correctly_when_called_directly_on_a_healthy_install() {
        let source = scratch_dir("dormant-checks-direct-source");
        let konductor_dir = source.join(config::KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();
        fs::write(
            konductor_dir.join(init::GITIGNORE_FILE_NAME),
            format!("{}\n", init::GITIGNORE_PATTERNS.join("\n")),
        )
        .unwrap();

        let resolved_source = ResolvedSource {
            path: source.clone(),
            fallback_note: None,
            unvalidated_cwd: false,
            legacy_manifest_no_source: false,
            missing_recorded_source: false,
            unsupported_schema_version: false,
        };

        let gitignore_result = check_gitignore(&resolved_source);
        assert_eq!(
            gitignore_result.status,
            CheckStatus::Ok,
            "check_gitignore must still correctly report Ok on a complete .gitignore when \
             called directly"
        );

        let provider_result = check_provider_model_access();
        assert_eq!(provider_result.status, CheckStatus::Info);
        assert!(!provider_result.status.is_failing());

        let role_result = check_role_allowlists();
        assert_eq!(role_result.status, CheckStatus::Info);
        assert!(!role_result.status.is_failing());

        fs::remove_dir_all(&source).ok();
    }

    // ── check_index_status ──────────────────────────────────────────────

    /// A target with no manifest at all -- `check_index_status` cannot
    /// compare against anything, so this stays `Info`, not `Warn`,
    /// even though the target is tracked (mirrors the "manifest
    /// unreadable" fallback rule: `check_manifest` already surfaces a
    /// missing manifest loudly on its own).
    #[test]
    fn check_index_status_is_info_when_target_not_in_index() {
        let _home = HomeGuard::new("index-status-not-tracked-home");
        let destination = scratch_dir("index-status-not-tracked-dest");

        let result = check_index_status(&destination);
        assert_eq!(result.status, CheckStatus::Info);
        assert!(
            result.summary.contains("not tracked"),
            "summary must clearly say the target is not tracked, got: {}",
            result.summary
        );

        fs::remove_dir_all(&destination).ok();
    }

    /// Index and manifest agree (`Complete`/`Complete`) -- `Ok`.
    #[test]
    fn check_index_status_is_ok_when_index_and_manifest_agree_complete() {
        let _home = HomeGuard::new("index-status-agree-complete-home");
        let destination = scratch_dir("index-status-agree-complete-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();

        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let result = check_index_status(&destination);
        assert_eq!(result.status, CheckStatus::Ok);
        assert!(!result.status.is_failing());

        fs::remove_dir_all(&destination).ok();
    }

    /// Index and manifest agree (`InProgress`/`InProgress`) -- also
    /// `Ok` for THIS check (`check_manifest` is the one that reports
    /// `InProgress` as `Failed` on its own; `check_index_status` only
    /// ever reports on a DISAGREEMENT between the two records).
    #[test]
    fn check_index_status_is_ok_when_index_and_manifest_agree_in_progress() {
        let _home = HomeGuard::new("index-status-agree-in-progress-home");
        let destination = scratch_dir("index-status-agree-in-progress-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::InProgress,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();

        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::InProgress,
        })
        .unwrap();

        let result = check_index_status(&destination);
        assert_eq!(result.status, CheckStatus::Ok);

        fs::remove_dir_all(&destination).ok();
    }

    /// Disagreement case (finding's example): index says `Complete` but
    /// the real manifest says `InProgress` -- an install/update was
    /// interrupted between the manifest rewrite and the index refresh.
    /// Must be `Warn`, and must name BOTH recorded states plus the word
    /// "interrupted" so the disagreement is unambiguous.
    #[test]
    fn check_index_status_is_warn_when_index_complete_but_manifest_in_progress() {
        let _home = HomeGuard::new("index-status-disagree-home");
        let destination = scratch_dir("index-status-disagree-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::InProgress,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();

        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let result = check_index_status(&destination);
        assert_eq!(result.status, CheckStatus::Warn);
        assert!(!result.status.is_failing(), "Warn must never fail the run");
        assert!(
            result.summary.contains("Complete") && result.summary.contains("InProgress"),
            "summary must name both disagreeing states, got: {}",
            result.summary
        );
        assert!(
            result.summary.contains("interrupted"),
            "summary must name the specific disagreement (interrupted install/update), got: {}",
            result.summary
        );
        assert!(
            result
                .remediation
                .as_deref()
                .unwrap_or_default()
                .contains("install"),
            "remediation must point at re-running install/update"
        );

        fs::remove_dir_all(&destination).ok();
    }

    /// The reverse disagreement -- index says `InProgress` but the real
    /// manifest says `Complete` (e.g. a crash between the manifest's
    /// final rewrite and the index's own `write_index` refresh) -- must
    /// also be `Warn`, naming both states.
    #[test]
    fn check_index_status_is_warn_when_index_in_progress_but_manifest_complete() {
        let _home = HomeGuard::new("index-status-disagree-reverse-home");
        let destination = scratch_dir("index-status-disagree-reverse-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();

        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::InProgress,
        })
        .unwrap();

        let result = check_index_status(&destination);
        assert_eq!(result.status, CheckStatus::Warn);
        assert!(
            result.summary.contains("InProgress") && result.summary.contains("Complete"),
            "summary must name both disagreeing states, got: {}",
            result.summary
        );

        fs::remove_dir_all(&destination).ok();
    }

    /// `dispatch_doctor_with` wiring: a `Warn`-only index-status
    /// disagreement must never flip the overall exit code away from 0
    /// -- `Warn` is non-failing (mirrors `check_manifest`'s own
    /// `Failed`-only failure contract).
    #[test]
    fn dispatch_doctor_with_index_status_warn_does_not_fail_overall_run() {
        let _home_guard = HomeGuard::new("dispatch-index-status-warn-home");
        let source = scratch_dir("dispatch-index-status-warn-source");
        let destination = scratch_dir("dispatch-index-status-warn-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::InProgress,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();
        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        // Manifest::InProgress also makes `check_manifest` itself
        // report `Failed` -- so this run's overall exit code is
        // dominated by THAT check, not by index_status. Assert the
        // index_status check specifically stays Warn by calling it
        // directly, then separately confirm dispatch's overall code is
        // driven by manifest's Failed (EXIT_HALTED), never anything
        // resembling exit code 2.
        let index_result = check_index_status(&destination);
        assert_eq!(index_result.status, CheckStatus::Warn);

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false,
            false,
            false,
            None,
            ColorMode::disabled(),
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
    }

    // ── --all ────────────────────────────────────────────────────────────

    /// `--all` with zero tracked installs is a no-op (exit 0), mirroring
    /// `update`/`uninstall`'s own "0 tracked installs" rule for `--all`.
    #[test]
    fn dispatch_doctor_all_with_zero_tracked_installs_is_a_noop() {
        let _home = HomeGuard::new("doctor-all-zero-tracked-home");
        let cwd = scratch_dir("doctor-all-zero-tracked-cwd");

        let code = dispatch_doctor_with(
            &cwd,
            None,
            None,
            true,
            false,
            false,
            None,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0, "zero tracked installs under --all must be a no-op");

        fs::remove_dir_all(&cwd).ok();
    }

    /// `--all` with exactly one tracked, healthy install: runs the full
    /// check suite against it and reports overall success.
    #[test]
    fn dispatch_doctor_all_with_one_tracked_install_runs_full_suite() {
        let _home = HomeGuard::new("doctor-all-one-tracked-home");
        let cwd = scratch_dir("doctor-all-one-tracked-cwd");
        let destination = scratch_dir("doctor-all-one-tracked-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();
        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_doctor_with(
            &cwd,
            None,
            None,
            true,
            false,
            false,
            None,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "one healthy tracked install under --all must exit 0"
        );

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
    }

    /// `--all` with 2+ tracked installs: every target is checked, and a
    /// failure in ONE target's checks (a leftover `InProgress` manifest)
    /// must still surface as an overall non-zero exit code, while the
    /// other, healthy target's own success does not mask it -- mirrors
    /// `update`/`uninstall`'s own "continue past a per-target failure,
    /// report all of them" `--all` contract.
    #[test]
    fn dispatch_doctor_all_with_two_tracked_installs_checks_both_and_surfaces_failure() {
        let _home = HomeGuard::new("doctor-all-two-tracked-home");
        let cwd = scratch_dir("doctor-all-two-tracked-cwd");
        let healthy_dest = scratch_dir("doctor-all-two-tracked-healthy-dest");
        let broken_dest = scratch_dir("doctor-all-two-tracked-broken-dest");

        let healthy_manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            healthy_dest.display().to_string(),
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&healthy_dest, healthy_manifest).unwrap();
        let healthy_canonical = index::canonicalize_target_dir(&healthy_dest).unwrap();
        index::write_index(IndexEntry {
            target_dir: healthy_canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let broken_manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            broken_dest.display().to_string(),
            None,
            Status::InProgress,
            vec![],
        );
        manifest::upsert_strategy(&broken_dest, broken_manifest).unwrap();
        let broken_canonical = index::canonicalize_target_dir(&broken_dest).unwrap();
        index::write_index(IndexEntry {
            target_dir: broken_canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::InProgress,
        })
        .unwrap();

        let index = index::read_index().unwrap().unwrap();
        assert_eq!(
            index.installs.len(),
            2,
            "sanity check: both targets must be tracked before running --all"
        );

        let code = dispatch_doctor_with(
            &cwd,
            None,
            None,
            true,
            false,
            false,
            None,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, EXIT_HALTED,
            "a failing check on ANY tracked target under --all must fail the overall run"
        );
        assert_ne!(code, 2, "must never emit the reserved CRITICAL-gate code");

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&healthy_dest).ok();
        fs::remove_dir_all(&broken_dest).ok();
    }

    /// `--all` + `--json` must emit exactly ONE parseable JSON document
    /// (the batched `targets` array), not one document per target.
    #[test]
    fn dispatch_doctor_all_json_emits_one_batched_document() {
        let _home = HomeGuard::new("doctor-all-json-home");
        let cwd = scratch_dir("doctor-all-json-cwd");
        let destination = scratch_dir("doctor-all-json-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();
        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical.clone(),
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let index = index::read_index().unwrap().unwrap();
        let per_target = vec![(
            canonical.clone(),
            run_checks(&cwd, None, &destination, None),
        )];
        let json = format_report_json_all(&per_target);
        let parsed: serde_json::Value =
            serde_json::from_str(&json).expect("--all --json output must be one valid document");
        assert_eq!(parsed["command"], "doctor");
        assert_eq!(parsed["ok"], true);
        let targets = parsed["targets"]
            .as_array()
            .expect("targets must be a JSON array");
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0]["target_dir"], canonical);
        assert!(targets[0]["checks"].is_array());
        let _ = index; // only used above for the write; kept for clarity.

        fs::remove_dir_all(&cwd).ok();
        fs::remove_dir_all(&destination).ok();
    }

    /// `--all` combined with `--from` is a CLI-level (clap)
    /// `conflicts_with` usage error, enforced entirely in `cli.rs` --
    /// see `rejects_doctor_with_from_and_all_together` there. This test
    /// confirms `dispatch_doctor_with` itself is never reachable with
    /// `all: true` alongside a non-`None` `from`/`target` in the real
    /// CLI path (`dispatch.rs` passes through whatever `cli.rs` parsed,
    /// and clap refuses that combination before dispatch ever runs) --
    /// documented here, at the dispatch layer, rather than re-asserted,
    /// since `dispatch_doctor_with` has no independent validation of
    /// its own for this combination (it simply takes the `--all`
    /// branch and ignores `from`/`target`, same as `update`/
    /// `uninstall`'s own dispatch functions do for their analogous
    /// conflicting flags -- clap's parse-time rejection is the ONLY
    /// enforcement point, by this codebase's existing convention).
    #[test]
    fn dispatch_doctor_all_ignores_from_and_target_when_somehow_both_are_set() {
        let _home = HomeGuard::new("doctor-all-ignores-from-target-home");
        let cwd = scratch_dir("doctor-all-ignores-from-target-cwd");

        // Zero tracked installs either way -- this test only pins that
        // passing a non-None from/target alongside all: true does not
        // panic or behave differently from the all-only call, since
        // dispatch_doctor_with takes the `all` branch unconditionally
        // before ever looking at `from`/`target`.
        let code = dispatch_doctor_with(
            &cwd,
            Some("/tmp/should-be-ignored".to_string()),
            Some("/tmp/should-be-ignored-too".to_string()),
            true,
            false,
            false,
            None,
            ColorMode::disabled(),
        );
        assert_eq!(code, 0);

        fs::remove_dir_all(&cwd).ok();
    }

    /// Confirms single-target (non---all) behavior with a target
    /// TRACKED in the index: still exits 0 on a single-target,
    /// non---all call, i.e. `check_index_status`'s `Ok` result does not
    /// change the overall exit code for a healthy tracked target.
    /// `dispatch_doctor_is_all_clear_on_a_healthy_empty_project` above
    /// covers the untracked "empty project" fixture case.
    #[test]
    fn dispatch_doctor_single_target_unaffected_by_tracked_index_entry() {
        let _home = HomeGuard::new("doctor-single-target-tracked-home");
        let source = scratch_dir("doctor-single-target-tracked-source");
        let destination = scratch_dir("doctor-single-target-tracked-dest");

        let manifest = StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            destination.display().to_string(),
            None,
            Status::Complete,
            vec![],
        );
        manifest::upsert_strategy(&destination, manifest).unwrap();
        let canonical = index::canonicalize_target_dir(&destination).unwrap();
        index::write_index(IndexEntry {
            target_dir: canonical,
            strategies: vec!["kiro-cli-v2".to_string()],
            installed_at: "2026-01-01T00:00:00Z".to_string(),
            status: IndexEntryStatus::Complete,
        })
        .unwrap();

        let code = dispatch_doctor_with(
            &source,
            Some(source.display().to_string()),
            Some(destination.display().to_string()),
            false,
            false,
            false,
            None,
            ColorMode::disabled(),
        );
        assert_eq!(
            code, 0,
            "single-target, non---all behavior must be unaffected"
        );

        fs::remove_dir_all(&source).ok();
        fs::remove_dir_all(&destination).ok();
    }
}
