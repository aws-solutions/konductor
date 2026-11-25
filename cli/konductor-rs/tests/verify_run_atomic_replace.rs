// SPDX-License-Identifier: Apache-2.0
//
// verify_run_atomic_replace.rs: a writer thread replaces a k-full-sdlc session
// file by temp-file-and-rename while the real binary's `verify-run` reads it
// in a loop. Every read must match, exit code and stdout, the verdict for one
// of the two whole files, except that a read may also be refused fail-closed
// (exit 65, "changed while it was opened"). Refusals count toward the reads
// but never as either verdict. A torn read shows up as any other output, usually
// a nonzero exit with different reasons. Failure messages include the child's
// stderr, which carries the cause when the run fails before printing a verdict.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const SESSIONS: &str = ".konductor/sessions";
const SESSION: &str = ".konductor/sessions/k-full-sdlc-20250101T000000Z-abcd.yml";
/// verify-run refuses, rather than reads, a file replaced between its checks
/// and its open. That refusal is fail-closed and never a partial read.
const REPLACED_WHILE_OPENING: &str = "session file changed while it was opened";
const MIN_READS: usize = 100;
const MIN_WRITES: u64 = 50;
const SAMPLE_DEADLINE: Duration = Duration::from_secs(60);
const CHILD_TIMEOUT: Duration = Duration::from_secs(30);
const WRITE_PAUSE: Duration = Duration::from_micros(200);

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
const PASSING_SESSION: &str = include_str!("fixtures/verify_run_sessions/passing.yml");
const GATE_MISSING_SESSION: &str = include_str!("fixtures/verify_run_sessions/gate_missing.yml");

/// A scratch project and `HOME`, canonicalized so macOS's `/var` to
/// `/private/var` link never splits the root check. The tree is removed on
/// drop, except while a test is failing, so the failing bytes stay on disk.
struct ScratchProject {
    base: PathBuf,
    root: PathBuf,
    home: PathBuf,
}

impl ScratchProject {
    fn new(name: &str) -> Self {
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
        ScratchProject {
            base: base.canonicalize().unwrap(),
            root: root.canonicalize().unwrap(),
            home: home.canonicalize().unwrap(),
        }
    }
}

impl Drop for ScratchProject {
    fn drop(&mut self) {
        if thread::panicking() {
            eprintln!(
                "scratch project kept for inspection: {}",
                self.base.display()
            );
        } else {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }
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

/// One run: the verdict that is compared, and stderr, which is only shown.
struct Observed {
    verdict: Verdict,
    stderr: String,
}

impl std::fmt::Display for Observed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "verdict={:?} stderr={:?}", self.verdict, self.stderr)
    }
}

fn read_pipe(pipe: Option<impl Read>) -> String {
    let mut text = String::new();
    if let Some(mut pipe) = pipe {
        let _ = pipe.read_to_string(&mut text);
    }
    text
}

fn verify_run(project: &ScratchProject, sink: &telemetry_test_sink::TelemetrySink) -> Observed {
    let mut command = Command::new(env!("CARGO_BIN_EXE_konductor"));
    command
        .args(["verify-run", "--session", SESSION])
        .current_dir(&project.root)
        .env("HOME", &project.home)
        .env_remove("KONDUCTOR_LOG")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    let mut child = command.spawn().expect("failed to spawn konductor");
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("failed to poll konductor") {
            break status;
        }
        if started.elapsed() > CHILD_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            panic!(
                "konductor verify-run did not exit within {CHILD_TIMEOUT:?}; stderr: {}",
                read_pipe(child.stderr.take())
            );
        }
        thread::sleep(Duration::from_millis(2));
    };
    Observed {
        verdict: (status.code(), read_pipe(child.stdout.take())),
        stderr: read_pipe(child.stderr.take()),
    }
}

/// Writes `text` and runs `verify-run` on it.
fn verdict_of(
    project: &ScratchProject,
    sink: &telemetry_test_sink::TelemetrySink,
    text: &str,
) -> Observed {
    replace_atomically(&project.root, text);
    verify_run(project, sink)
}

#[test]
fn verify_run_never_sees_a_partial_session_during_atomic_replace() {
    let project = ScratchProject::new("never_sees_a_partial_session");
    let sink = telemetry_test_sink::TelemetrySink::start();
    let gate_missing = verdict_of(&project, &sink, GATE_MISSING_SESSION);
    let passing = verdict_of(&project, &sink, PASSING_SESSION);
    assert_eq!(passing.verdict.0, Some(0), "{passing}");
    assert_ne!(gate_missing.verdict.0, Some(0), "{gate_missing}");
    assert!(
        gate_missing.verdict.1.contains("GATE_MISSING: "),
        "{gate_missing}"
    );

    let stop = Arc::new(AtomicBool::new(false));
    let writes = Arc::new(AtomicU64::new(0));
    let writer = {
        let (stop, writes, root) = (Arc::clone(&stop), Arc::clone(&writes), project.root.clone());
        thread::spawn(move || {
            let mut next_is_passing = false;
            while !stop.load(Ordering::Relaxed) {
                let text = if next_is_passing {
                    PASSING_SESSION
                } else {
                    GATE_MISSING_SESSION
                };
                replace_atomically(&root, text);
                next_is_passing = !next_is_passing;
                writes.fetch_add(1, Ordering::Relaxed);
                thread::sleep(WRITE_PAUSE);
            }
        })
    };

    let (mut passed, mut gate_missing_seen, mut refused, mut other) =
        (0usize, 0usize, 0usize, Vec::new());
    let started = Instant::now();
    let mut reads = 0usize;
    while started.elapsed() < SAMPLE_DEADLINE {
        let observed = verify_run(&project, &sink);
        if observed.verdict == passing.verdict {
            passed += 1;
        } else if observed.verdict == gate_missing.verdict {
            gate_missing_seen += 1;
        } else if observed.stderr.contains(REPLACED_WHILE_OPENING) {
            refused += 1;
        } else {
            other.push(observed);
            break;
        }
        reads += 1;
        if reads >= MIN_READS && passed > 0 && gate_missing_seen > 0 {
            break;
        }
    }
    stop.store(true, Ordering::Relaxed);
    writer.join().expect("writer thread panicked");
    let write_count = writes.load(Ordering::Relaxed);

    eprintln!(
        "atomic replace: reads={reads} passing={passed} gate_missing={gate_missing_seen} \
         refused={refused} other={} writes={write_count} elapsed_ms={}",
        other.len(),
        started.elapsed().as_millis()
    );

    assert!(
        other.is_empty(),
        "partial or unexpected read: {}",
        other
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("; ")
    );
    assert!(
        write_count >= MIN_WRITES,
        "writer replaced the file only {write_count} times (need {MIN_WRITES}); \
         the run did not exercise concurrent replacement"
    );
    assert!(
        passed > 0 && gate_missing_seen > 0,
        "after {reads} reads in {:?} and {write_count} writes, saw passing={passed} \
         gate_missing={gate_missing_seen}; both states are needed for the run to mean anything",
        started.elapsed()
    );
}

/// The three cuts of one session, counted from its end: mid-line, mid-value,
/// and just before the final newline.
fn cut_points(text: &str) -> [usize; 3] {
    let last_line = text
        .rfind("      gate_testing_result")
        .expect("fixture must end with a gate_testing_result line");
    [
        last_line + "      gate_testing_re".len(),
        text.len() - "ne\n".len(),
        text.len() - 1,
    ]
}

/// Ties the oracle above to the real binary with three cuts of each whole
/// session. The per-byte sweep over both sessions runs in-process in
/// `src/cli/verify_run.rs`.
#[test]
fn truncated_sessions_differ_from_the_whole_file_except_before_the_final_newline() {
    let project = ScratchProject::new("truncated_sessions");
    let sink = telemetry_test_sink::TelemetrySink::start();
    let texts = [PASSING_SESSION, GATE_MISSING_SESSION];
    let baselines: Vec<Observed> = texts
        .iter()
        .map(|text| verdict_of(&project, &sink, text))
        .collect();
    assert_eq!(baselines[0].verdict.0, Some(0), "{}", baselines[0]);
    assert_ne!(baselines[1].verdict.0, Some(0), "{}", baselines[1]);
    assert_ne!(baselines[0].verdict, baselines[1].verdict);

    for (index, text) in texts.iter().enumerate() {
        let other = 1 - index;
        for cut in cut_points(text) {
            let observed = verdict_of(&project, &sink, &text[..cut]);
            if cut == text.len() - 1 {
                assert_eq!(
                    observed.verdict, baselines[index].verdict,
                    "text {index} cut at byte {cut}: {observed}"
                );
            } else {
                assert_ne!(
                    observed.verdict, baselines[index].verdict,
                    "text {index} cut at byte {cut}: {observed}"
                );
            }
            assert_ne!(
                observed.verdict, baselines[other].verdict,
                "text {index} cut at byte {cut} matches the other session: {observed}"
            );
        }
    }
}
