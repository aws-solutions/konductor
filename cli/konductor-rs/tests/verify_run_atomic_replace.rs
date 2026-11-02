// SPDX-License-Identifier: Apache-2.0
//
// verify_run_atomic_replace.rs: a writer thread replaces a k-full-sdlc session
// file by temp-file-and-rename while the real binary's `verify-run` reads it
// in a loop. Every read must match, exit code and stdout, the verdict for one
// of the two whole files. A torn read shows up as any other output, usually
// exit 65 RECORD_INTEGRITY.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const SESSIONS: &str = ".konductor/sessions";
const SESSION: &str = ".konductor/sessions/k-full-sdlc-20250101T000000Z-abcd.yml";
const MAX_READS: usize = 200;
const MAX_WALL: Duration = Duration::from_secs(10);

static SCRATCH_COUNTER: AtomicUsize = AtomicUsize::new(0);

const EVIDENCE: [&str; 5] = [
    "out/design/principal-engineer-review.md",
    "out/feature-split/feature-split.md",
    "out/specs/login/tasks.md",
    "out/login/code-review/report.md",
    "out/login/testing/test-coverage-review-report.md",
];

/// The two whole-file sessions, shared with the in-process truncation sweep
/// in `src/cli/verify_run.rs`. The second one leaves out
/// `gate_code-review_result`, so it fails with GATE_MISSING.
fn session_text(with_code_review_result: bool) -> String {
    let text = if with_code_review_result {
        include_str!("fixtures/verify_run_sessions/passing.yml")
    } else {
        include_str!("fixtures/verify_run_sessions/gate_missing.yml")
    };
    text.to_string()
}

/// Builds a scratch project and `HOME`, canonicalized so macOS's `/var` to
/// `/private/var` link never splits the root check. Returns (base, root, home).
fn scratch_project(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    let base = std::env::temp_dir().join(format!(
        "konductor-verify-run-atomic-{name}-{}-{}",
        std::process::id(),
        SCRATCH_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let root = base.join("project");
    let home = base.join("home");
    std::fs::create_dir_all(root.join(SESSIONS).join(".tmp")).unwrap();
    std::fs::create_dir_all(&home).unwrap();
    for evidence in EVIDENCE {
        let path = root.join(evidence);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, "report\n").unwrap();
    }
    (
        base.canonicalize().unwrap(),
        root.canonicalize().unwrap(),
        home.canonicalize().unwrap(),
    )
}

/// Replaces the session file the way the session-state skill requires: write
/// a temp file under `sessions/.tmp/`, then rename it over the real file.
fn replace_atomically(root: &Path, text: &str) {
    let temp = root.join(SESSIONS).join(".tmp/session.yml");
    std::fs::write(&temp, text).unwrap();
    std::fs::rename(&temp, root.join(SESSION)).unwrap();
}

/// Exit code and stdout of one `verify-run` on the session file.
type Verdict = (Option<i32>, String);

fn verify_run(root: &Path, home: &Path, sink: &telemetry_test_sink::TelemetrySink) -> Verdict {
    let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
    command
        .args(["verify-run", "--session", SESSION])
        .current_dir(root)
        .env("HOME", home)
        .env_remove("KONDUCTOR_LOG");
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    let output = command.output().expect("failed to spawn konductor");
    (
        output.status.code(),
        String::from_utf8_lossy(&output.stdout).into_owned(),
    )
}

#[test]
fn verify_run_never_sees_a_partial_session_during_atomic_replace() {
    let (base, root, home) = scratch_project("never_sees_a_partial_session");
    let sink = telemetry_test_sink::TelemetrySink::start();
    let passing = session_text(true);
    let gate_missing = session_text(false);
    replace_atomically(&root, &gate_missing);
    let gate_missing_verdict = verify_run(&root, &home, &sink);
    replace_atomically(&root, &passing);
    let passing_verdict = verify_run(&root, &home, &sink);
    assert_eq!(passing_verdict.0, Some(0), "{passing_verdict:?}");
    assert_eq!(gate_missing_verdict.0, Some(65), "{gate_missing_verdict:?}");
    assert!(
        gate_missing_verdict.1.contains("GATE_MISSING: "),
        "{gate_missing_verdict:?}"
    );

    let stop = Arc::new(AtomicBool::new(false));
    let writes = Arc::new(AtomicU64::new(0));
    let writer = {
        let (stop, writes, root) = (Arc::clone(&stop), Arc::clone(&writes), root.clone());
        thread::spawn(move || {
            let mut next_is_passing = false;
            while !stop.load(Ordering::Relaxed) {
                let text = if next_is_passing {
                    &passing
                } else {
                    &gate_missing
                };
                replace_atomically(&root, text);
                next_is_passing = !next_is_passing;
                writes.fetch_add(1, Ordering::Relaxed);
            }
        })
    };

    let (mut passed, mut gate_missing_seen, mut other) = (0usize, 0usize, Vec::new());
    let started = Instant::now();
    let mut reads = 0usize;
    while reads < MAX_READS && started.elapsed() < MAX_WALL {
        let verdict = verify_run(&root, &home, &sink);
        if verdict == passing_verdict {
            passed += 1;
        } else if verdict == gate_missing_verdict {
            gate_missing_seen += 1;
        } else {
            other.push(verdict);
        }
        reads += 1;
    }
    stop.store(true, Ordering::Relaxed);
    writer.join().expect("writer thread panicked");

    eprintln!(
        "atomic replace: reads={reads} passing={passed} gate_missing={gate_missing_seen} \
         other={} writes={} elapsed_ms={}",
        other.len(),
        writes.load(Ordering::Relaxed),
        started.elapsed().as_millis()
    );
    let _ = std::fs::remove_dir_all(&base);

    assert!(other.is_empty(), "partial or unexpected reads: {other:#?}");
    assert!(passed > 0, "no read saw the passing session");
    assert!(
        gate_missing_seen > 0,
        "no read saw the GATE_MISSING session"
    );
}

/// Ties the oracle above to the real binary with three cuts of the passing
/// session. The per-byte sweep over both sessions runs in-process in
/// `src/cli/verify_run.rs`.
#[test]
fn truncated_sessions_differ_from_the_whole_file_except_before_the_final_newline() {
    let (base, root, home) = scratch_project("truncated_sessions");
    let sink = telemetry_test_sink::TelemetrySink::start();
    let text = session_text(true);
    replace_atomically(&root, &text);
    let whole = verify_run(&root, &home, &sink);
    assert_eq!(whole.0, Some(0), "{whole:?}");

    let last_line = text.rfind("      gate_testing_result").unwrap();
    let mid_line = last_line + "      gate_testing_re".len();
    let mid_value = text.len() - "ne\n".len();
    let before_final_newline = text.len() - 1;
    let mut verdicts = Vec::new();
    for cut in [mid_line, mid_value, before_final_newline] {
        replace_atomically(&root, &text[..cut]);
        verdicts.push((cut, verify_run(&root, &home, &sink)));
    }
    let _ = std::fs::remove_dir_all(&base);

    let (mid_line_cut, mid_value_cut, final_newline_cut) =
        (&verdicts[0], &verdicts[1], &verdicts[2]);
    assert_ne!(mid_line_cut.1, whole, "cut at byte {}", mid_line_cut.0);
    assert_ne!(mid_value_cut.1, whole, "cut at byte {}", mid_value_cut.0);
    assert_eq!(
        final_newline_cut.1, whole,
        "cut at byte {}",
        final_newline_cut.0
    );
}
