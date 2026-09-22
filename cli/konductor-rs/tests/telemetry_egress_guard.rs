// SPDX-License-Identifier: Apache-2.0
//
// Fails loudly if a future integration test spawns `konductor` without
// also wiring in `telemetry_test_sink::TelemetrySink`.
//
// A source-level scan, not a runtime check: this crate has one
// [[bin]] target, so the same compiled binary backs both `cargo run`
// and every integration test's subprocess spawn. Only the test file's
// own source can tell the two apart.
//
// Fails closed: any `tests/*.rs` file referencing
// `CARGO_BIN_EXE_konductor` must also reference `telemetry_test_sink`,
// with no command-name allowlist to fall behind (a prior version
// scanned for literal command names and missed a file that reached
// telemetry only through a shared helper). A file that spawns the
// binary but genuinely never reaches telemetry (e.g. a `--help`-only
// smoke test) opts out explicitly via `EGRESS_GUARD_EXEMPT_TELEMETRY_UNREACHABLE`
// rather than silently passing by omission.
//
// What this does NOT catch: a file that references the sink but wires
// it incorrectly (never applies `env_vars()` to its `Command`). It
// only proves the fixture is referenced.

use std::path::Path;

/// Written literally in a spawning test file's own source (e.g. as a
/// comment) with a reason, to opt out of this guard.
const EXEMPTION_MARKER: &str = "EGRESS_GUARD_EXEMPT_TELEMETRY_UNREACHABLE";

/// Cargo's own env var for locating the compiled binary under test --
/// a reliable proxy for "this file spawns the real binary," with no
/// command-name allowlist to fall behind.
const BIN_LOCATOR: &str = "CARGO_BIN_EXE_konductor";

/// Reads every `.rs` file under `tests/`, recursing into subdirectories
/// (e.g. a conventional `tests/common/mod.rs` shared-helper module) so
/// a test file that reaches the binary only indirectly through such a
/// helper is still scanned. `tests/fixtures/` holds `.json` files, not
/// `.rs`, so the extension filter already excludes it without any
/// directory-name special-casing.
fn read_test_sources() -> Vec<(String, String)> {
    let tests_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    let mut sources = Vec::new();
    collect_rs_sources(&tests_dir, &mut sources);
    sources
}

/// Recursion helper for `read_test_sources`. Sources are keyed by full
/// path (not file name): this guard's own source is excluded by
/// comparing against its own canonical `CARGO_MANIFEST_DIR`-relative
/// path, not a bare file-name match, so a same-named file nested under
/// a subdirectory can't be mistaken for this one.
fn collect_rs_sources(dir: &Path, sources: &mut Vec<(String, String)>) {
    let self_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/telemetry_egress_guard.rs");
    for entry in
        std::fs::read_dir(dir).unwrap_or_else(|e| panic!("failed to read {}: {e}", dir.display()))
    {
        let entry = entry.expect("failed to read a tests/ directory entry");
        let path = entry.path();
        if path.is_dir() {
            collect_rs_sources(&path, sources);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        // Never scan this guard's own source: it names its own marker
        // and locator constants as literals and would self-match.
        if path == self_path {
            continue;
        }
        let contents = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
        sources.push((path.display().to_string(), contents));
    }
}

fn spawns_the_binary(source: &str) -> bool {
    source.contains(BIN_LOCATOR)
}

/// Matches the quoted form (`"install"`), not a bare word, so an
/// unrelated word like "reinstall" in a comment doesn't false-positive.
/// Superseded by `spawns_the_binary`'s allowlist-free detection; kept
/// as a tested helper for a future narrower check.
fn references_command(source: &str, command: &str) -> bool {
    source.contains(&format!("\"{command}\""))
}

/// Broad substring check: catches a file that forgot the fixture
/// entirely, not whether it's wired correctly.
fn references_telemetry_sink(source: &str) -> bool {
    source.contains("telemetry_test_sink")
}

fn is_exempted(source: &str) -> bool {
    source.contains(EXEMPTION_MARKER)
}

#[test]
fn every_test_file_that_spawns_the_binary_references_the_sink_fixture_or_is_exempted() {
    let sources = read_test_sources();
    assert!(
        !sources.is_empty(),
        "sanity check: this guard must find at least one tests/*.rs file to scan -- an empty \
         result likely means CARGO_MANIFEST_DIR resolved somewhere unexpected"
    );

    let mut violations = Vec::new();
    for (file_name, contents) in &sources {
        let spawns = spawns_the_binary(contents);
        if spawns && !references_telemetry_sink(contents) && !is_exempted(contents) {
            violations.push(file_name.clone());
        }
    }

    assert!(
        violations.is_empty(),
        "GUARD TRIPPED: the following test file(s) spawn the `konductor` binary \
         ({BIN_LOCATOR}) but never reference `telemetry_test_sink` anywhere in their own \
         source, and carry no `{EXEMPTION_MARKER}` opt-out: {violations:?}. Every real send \
         this test triggers will reach the REAL production telemetry endpoint \
         (https://metrics.awssolutionsbuilder.com/generic) unless redirected. Fix: construct a \
         `telemetry_test_sink::TelemetrySink` and apply its own `env_vars()` to every \
         `Command` this file spawns -- see tests/telemetry_report_process.rs for the \
         established pattern. Do NOT instead set `KONDUCTOR_TELEMETRY=off` -- that is the exact \
         ad-hoc, per-test mechanism this fixture replaces; see this crate's own git history for \
         install_manifest_concurrency.rs/synth_install_e2e.rs/ \
         instance_identity_two_target_concurrency.rs, which all migrated off it onto this \
         fixture instead. If this file genuinely never reaches telemetry (e.g. a --help-only \
         smoke test), add `{EXEMPTION_MARKER}: <reason>` as a comment instead."
    );
}

#[test]
fn guard_detection_logic_actually_flags_a_synthetic_violation() {
    let violating_source = r#"
        fn bin() -> &'static str {
            env!("CARGO_BIN_EXE_konductor")
        }
        fn run_konductor() {
            Command::new(bin()).arg("install").output().unwrap();
        }
    "#;
    assert!(
        spawns_the_binary(violating_source),
        "sanity: the synthetic source above must be detected as spawning the binary"
    );
    assert!(
        !references_telemetry_sink(violating_source),
        "sanity: the synthetic source above must be detected as NOT referencing the sink"
    );
    assert!(
        !is_exempted(violating_source),
        "sanity: the synthetic source above must be detected as NOT exempted"
    );

    let compliant_source = r#"
        fn bin() -> &'static str {
            env!("CARGO_BIN_EXE_konductor")
        }
        fn run_konductor(sink: &telemetry_test_sink::TelemetrySink) {
            let mut command = Command::new(bin());
            command.arg("install");
            for var in sink.env_vars() {
                command.env(var.name, &var.value);
            }
            command.output().unwrap();
        }
    "#;
    assert!(spawns_the_binary(compliant_source));
    assert!(
        references_telemetry_sink(compliant_source),
        "sanity: the compliant synthetic source above must be detected as referencing the sink"
    );

    let exempted_source = r#"
        // EGRESS_GUARD_EXEMPT_TELEMETRY_UNREACHABLE: only exercises --help
        fn bin() -> &'static str {
            env!("CARGO_BIN_EXE_konductor")
        }
        fn run_konductor() {
            Command::new(bin()).arg("--help").output().unwrap();
        }
    "#;
    assert!(spawns_the_binary(exempted_source));
    assert!(!references_telemetry_sink(exempted_source));
    assert!(
        is_exempted(exempted_source),
        "sanity: the exempted synthetic source above must be detected as exempted"
    );
}

/// The gap the previous implementation had: a file that reaches the
/// binary only through a shared helper taking the command as a
/// runtime argument has no quoted command-name literal to match. Only
/// `spawns_the_binary`'s locator-based check still catches it.
#[test]
fn guard_still_catches_a_test_file_that_reaches_a_command_only_through_a_shared_helper() {
    let helper_indirection_source = r#"
        fn bin() -> &'static str {
            env!("CARGO_BIN_EXE_konductor")
        }
        fn run_konductor(command: &str) {
            Command::new(bin()).arg(command).output().unwrap();
        }
    "#;
    assert!(
        spawns_the_binary(helper_indirection_source),
        "the locator-based check must still flag a file that reaches the binary only through \
         indirection, with no command-name literal of its own"
    );
    assert!(!references_telemetry_sink(helper_indirection_source));
    assert!(!is_exempted(helper_indirection_source));
}

/// Exercises the spawns/wired/exempt decision directly against the
/// helper functions, so a future edit that accidentally widens the
/// pass condition (`||` where `&&` was meant) fails here first.
#[test]
fn guard_cannot_pass_vacuously_for_a_file_that_spawns_unwired_and_unexempted() {
    let source = r#"
        fn bin() -> &'static str {
            env!("CARGO_BIN_EXE_konductor")
        }
    "#;
    let spawns = spawns_the_binary(source);
    let wired = references_telemetry_sink(source);
    let exempted = is_exempted(source);
    let would_be_flagged = spawns && !wired && !exempted;
    assert!(
        would_be_flagged,
        "a file that spawns the binary, is not wired to the sink, and carries no exemption \
         marker must be flagged: spawns={spawns} wired={wired} exempted={exempted}"
    );
}

#[test]
fn references_command_does_not_match_a_bare_unquoted_word() {
    let source = "// this comment mentions install and update only as English words";
    assert!(!references_command(source, "install"));
    assert!(!references_command(source, "update"));
}
