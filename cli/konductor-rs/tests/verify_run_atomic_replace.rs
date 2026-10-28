// SPDX-License-Identifier: Apache-2.0
//
// verify_run_atomic_replace.rs: a writer thread replaces a k-full-sdlc session
// file by temp-file-and-rename while the real binary's `verify-run` reads it
// in a loop. Every read must match, exit code and stdout, the verdict for one
// of the two whole files. A torn read shows up as any other output, usually
// exit 65 RECORD_INTEGRITY.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

const SESSIONS: &str = ".konductor/sessions";
const SESSION: &str = ".konductor/sessions/k-full-sdlc-20250101T000000Z-abcd.yml";
const MAX_READS: usize = 200;
const MAX_WALL: Duration = Duration::from_secs(10);

const PHASES: [&str; 12] = [
    "elicitation",
    "codebase-analysis",
    "requirements",
    "design",
    "design-review",
    "feature-splitting",
    "specs",
    "implementation",
    "code-review",
    "testing",
    "documentation",
    "final-summary",
];

const EVIDENCE: [&str; 5] = [
    "out/design/principal-engineer-review.md",
    "out/feature-split/feature-split.md",
    "out/specs/login/tasks.md",
    "out/login/code-review/report.md",
    "out/login/testing/test-coverage-review-report.md",
];

/// Session text that passes, or with `gate_code-review_result` left out so
/// it fails with GATE_MISSING. A result word is checked strictly, so
/// `gate_testing_result` goes last: a cut inside it changes the verdict.
fn session_text(with_code_review_result: bool) -> String {
    let phases: String = PHASES
        .iter()
        .map(|id| {
            format!("  {id}: {{name: n, status: COMPLETED, skip_reason: null, summary: done}}\n")
        })
        .collect();
    let code_review_result = if with_code_review_result {
        "      gate_code-review_result: approved\n"
    } else {
        ""
    };
    format!(
        "run:
  schema_version: 1
  project_signature: sig
  run_status: completed
  counters: {{}}
  data:
    max_fix_cycles: 2
    gate_design-review_result: none
    gate_design-review_evidence: {}
    gate_design-review_checker: k-architect
    gate_feature-splitting_result: approved
    gate_feature-splitting_evidence: {}
    gate_feature-splitting_checker: user
phases:
{phases}features:
  login:
    counters: {{fix_cycles_used: 0}}
    data:
      gate_specs_result: approved
      gate_specs_evidence: {}
      gate_specs_checker: user
{code_review_result}      gate_code-review_evidence: {}
      gate_code-review_checker: user
      gate_testing_checker: k-quality-assurance
      gate_testing_evidence: {}
      gate_testing_result: none
",
        EVIDENCE[0], EVIDENCE[1], EVIDENCE[2], EVIDENCE[3], EVIDENCE[4]
    )
}

/// Builds a scratch project and `HOME`, canonicalized so macOS's `/var` to
/// `/private/var` link never splits the root check. Returns (base, root, home).
fn scratch_project() -> (PathBuf, PathBuf, PathBuf) {
    let base = std::env::temp_dir().join(format!(
        "konductor-verify-run-atomic-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
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
    let (base, root, home) = scratch_project();
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

/// Checks the oracle above: a file cut at any byte, except just before the
/// trailing newline, must not reproduce either whole-file verdict.
#[test]
fn every_truncated_session_differs_from_both_whole_file_verdicts() {
    let (base, root, home) = scratch_project();
    let sink = telemetry_test_sink::TelemetrySink::start();
    let texts = [session_text(true), session_text(false)];
    let mut baselines = Vec::new();
    for text in &texts {
        replace_atomically(&root, text);
        baselines.push(verify_run(&root, &home, &sink));
    }
    let mut matches = Vec::new();
    for (index, text) in texts.iter().enumerate() {
        for len in 0..text.len() {
            replace_atomically(&root, &text[..len]);
            if baselines.contains(&verify_run(&root, &home, &sink)) {
                matches.push((index, len));
            }
        }
    }
    let _ = std::fs::remove_dir_all(&base);

    let expected: Vec<(usize, usize)> = texts
        .iter()
        .enumerate()
        .map(|(index, text)| (index, text.len() - 1))
        .collect();
    assert_eq!(
        matches, expected,
        "prefixes (text, bytes) that match a baseline"
    );
}
