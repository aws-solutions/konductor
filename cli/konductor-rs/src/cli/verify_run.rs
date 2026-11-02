// SPDX-License-Identifier: Apache-2.0
//
// verify_run.rs: `konductor verify-run --session <path>`. Reads one SOP
// session file and the project config, judges the session with `gate_eval`,
// and prints one verdict. Writes nothing and sends nothing.
//
// The restricted loader rejects local tags (`!custom`) and non-string keys.
// serde_yaml resolves a `!!` tag such as `!!python/object` to its untagged
// value, so that file parses as plain data: no object is ever constructed.

use std::io;
use std::path::{Path, PathBuf};

use serde_json::json;
use serde_yaml::Value;

use super::config::{self, Severity};
use super::gate_config::{gate_map, severity_table, GateMap};
use super::gate_eval::{evaluate_value, EvalContext, Reason, ReasonCode, SeverityPolicy, Verdict};
use super::output::{self, ColorMode};
use super::EXIT_USAGE_ERROR;

const PREFIX: &str = "konductor verify-run:";

/// Runs the check and prints the verdict. Returns the process exit code.
pub(crate) fn run(
    cwd: io::Result<PathBuf>,
    session: &Path,
    allow_running: bool,
    json: bool,
    color: ColorMode,
) -> u8 {
    let verdict = check(cwd, session, allow_running).unwrap_or_else(Invalid::into_verdict);
    if json {
        println!("{}", verdict_json(&verdict));
    } else {
        print_plain(&verdict, color);
    }
    verdict.exit
}

/// A V1 failure: the file or the config could not be used at all.
struct Invalid {
    code: ReasonCode,
    detail: String,
}

impl Invalid {
    fn session(detail: impl Into<String>) -> Self {
        Invalid {
            code: ReasonCode::SessionInvalid,
            detail: detail.into(),
        }
    }

    fn config(detail: impl std::fmt::Display) -> Self {
        Invalid {
            code: ReasonCode::ConfigInvalid,
            detail: detail.to_string(),
        }
    }

    fn into_verdict(self) -> Verdict {
        Verdict {
            exit: EXIT_USAGE_ERROR,
            reasons: vec![Reason {
                code: self.code,
                detail: self.detail,
            }],
            info: Vec::new(),
        }
    }
}

fn check(
    cwd: io::Result<PathBuf>,
    session: &Path,
    allow_running: bool,
) -> Result<Verdict, Invalid> {
    let root = cwd.and_then(|dir| dir.canonicalize()).map_err(|err| {
        Invalid::session(format!("could not resolve the current directory: {err}"))
    })?;
    let path = locate_session(&root, session)?;
    let value = read_session(&path)?;
    let threshold = configured_threshold(&root)?;
    let gate_map = gate_map().map_err(Invalid::config)?;
    let policy = SeverityPolicy {
        table: severity_table().map_err(Invalid::config)?,
        threshold,
    };
    let prefix = session_prefix(&path, &gate_map);
    let evidence_exists = |recorded: &str| is_project_file(&root, recorded);
    let ctx = EvalContext {
        session_prefix: &prefix,
        gate_map: &gate_map,
        policy: &policy,
        evidence_exists: &evidence_exists,
        allow_running,
    };
    Ok(evaluate_value(&value, &ctx))
}

/// Resolves `session` against `root` and returns its canonical path. A
/// symlink, a file outside `root`, or anything but a regular file is refused.
fn locate_session(root: &Path, session: &Path) -> Result<PathBuf, Invalid> {
    let shown = session.display();
    let given = root.join(session);
    let metadata = std::fs::symlink_metadata(&given)
        .map_err(|err| Invalid::session(format!("cannot read session file {shown}: {err}")))?;
    if metadata.file_type().is_symlink() {
        return Err(Invalid::session(format!(
            "session file {shown} is a symlink"
        )));
    }
    let canonical = given
        .canonicalize()
        .map_err(|err| Invalid::session(format!("cannot resolve session file {shown}: {err}")))?;
    if !canonical.starts_with(root) {
        return Err(Invalid::session(format!(
            "session file {shown} is outside the project root"
        )));
    }
    if !metadata.is_file() {
        return Err(Invalid::session(format!(
            "session file {shown} is not a regular file"
        )));
    }
    Ok(canonical)
}

fn read_session(path: &Path) -> Result<Value, Invalid> {
    let bytes = std::fs::read(path)
        .map_err(|err| Invalid::session(format!("cannot read session file: {err}")))?;
    let text = String::from_utf8(bytes)
        .map_err(|_| Invalid::session("session file is not valid UTF-8"))?;
    serde_yaml::from_str(&text)
        .map_err(|err| Invalid::session(format!("session file is not valid YAML: {err}")))
}

/// The project's `fail_on_severity_at_or_above`. A present but invalid
/// config fails the check rather than falling back to the preset.
fn configured_threshold(root: &Path) -> Result<Severity, Invalid> {
    let config = config::load_config(root).map_err(Invalid::config)?;
    config
        .fail_on_severity_at_or_above
        .parse::<Severity>()
        .map_err(|()| {
            Invalid::config(format!(
                "unknown severity '{}'",
                config.fail_on_severity_at_or_above
            ))
        })
}

/// The SOP name in `<sop>-<digit>...`: the longest gated name that fits.
/// For any other file, the text before the first `-<digit>`, so the
/// evaluator can report it as not gated.
fn session_prefix(path: &Path, gate_map: &GateMap) -> String {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let digit_follows = |rest: &str| rest.starts_with(|c: char| c.is_ascii_digit());
    let fits = |sop: &str| {
        name.strip_prefix(sop)
            .and_then(|rest| rest.strip_prefix('-'))
            .is_some_and(digit_follows)
    };
    if let Some(sop) = gate_map
        .gated
        .keys()
        .filter(|sop| fits(sop))
        .max_by_key(|sop| sop.len())
    {
        return sop.clone();
    }
    name.match_indices('-')
        .find(|(index, _)| digit_follows(&name[index + 1..]))
        .map_or(name, |(index, _)| &name[..index])
        .to_string()
}

/// True when `recorded` is a relative path naming a regular file inside
/// `root` after symlinks resolve.
fn is_project_file(root: &Path, recorded: &str) -> bool {
    let relative = Path::new(recorded);
    if recorded.is_empty() || relative.is_absolute() {
        return false;
    }
    root.join(relative)
        .canonicalize()
        .is_ok_and(|path| path.starts_with(root) && path.is_file())
}

fn verdict_json(verdict: &Verdict) -> serde_json::Value {
    let reasons: Vec<_> = verdict
        .reasons
        .iter()
        .map(|r| json!({"code": r.code.code(), "detail": r.detail}))
        .collect();
    let info: Vec<_> = verdict
        .info
        .iter()
        .map(|i| json!({"code": i.code.code(), "detail": i.detail}))
        .collect();
    json!({"exit": verdict.exit, "reasons": reasons, "info": info})
}

/// A V1 failure goes to stderr. Any other verdict prints a summary line,
/// then one line per reason and note, on stdout.
fn print_plain(verdict: &Verdict, color: ColorMode) {
    if verdict.exit == EXIT_USAGE_ERROR {
        for reason in &verdict.reasons {
            eprintln!(
                "{} {}: {}",
                output::error_prefix(color, PREFIX),
                reason.code.code(),
                reason.detail
            );
        }
        return;
    }
    let prefix = if verdict.exit == 0 {
        output::success_prefix(color, PREFIX)
    } else {
        output::error_prefix_stdout(color, PREFIX)
    };
    let first = verdict.reasons.first().map_or("PASSED", |r| r.code.code());
    println!("{prefix} {first} (exit {})", verdict.exit);
    for reason in &verdict.reasons {
        println!("{}: {}", reason.code.code(), reason.detail);
    }
    for info in &verdict.info {
        println!("{}: {}", info.code.code(), info.detail);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gated() -> GateMap {
        gate_map().unwrap()
    }

    #[test]
    fn prefix_is_the_gated_name_before_the_timestamp() {
        let path = Path::new("k-full-sdlc-20250101T000000Z-abcd.yml");
        assert_eq!(session_prefix(path, &gated()), "k-full-sdlc");
    }

    #[test]
    fn prefix_needs_a_digit_after_the_dash() {
        let path = Path::new("k-full-sdlc-x-20250101.yml");
        assert_eq!(session_prefix(path, &gated()), "k-full-sdlc-x");
    }

    #[test]
    fn prefix_of_an_ungated_file_is_the_text_before_the_timestamp() {
        let path = Path::new("k-plan-20250101T000000Z-abcd.yml");
        assert_eq!(session_prefix(path, &gated()), "k-plan");
    }

    #[test]
    fn an_absolute_or_empty_evidence_path_is_not_a_project_file() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        assert!(!is_project_file(&root, ""));
        assert!(!is_project_file(&root, "/etc/hosts"));
    }

    const PASSING_SESSION: &str =
        include_str!("../../tests/fixtures/verify_run_sessions/passing.yml");
    const GATE_MISSING_SESSION: &str =
        include_str!("../../tests/fixtures/verify_run_sessions/gate_missing.yml");
    const SESSION_NAME: &str = "k-full-sdlc-20250101T000000Z-abcd.yml";
    const EVIDENCE: [&str; 5] = [
        "out/design/principal-engineer-review.md",
        "out/feature-split/feature-split.md",
        "out/specs/login/tasks.md",
        "out/login/code-review/report.md",
        "out/login/testing/test-coverage-review-report.md",
    ];

    /// A scratch project holding the evidence files and one session file,
    /// so `check` runs exactly as the binary does. `HOME` points at an empty
    /// directory so no user config reaches the run; both are restored on drop.
    struct SweepProject {
        base: PathBuf,
        root: PathBuf,
        original_home: Option<std::ffi::OsString>,
        _home_lock: std::sync::MutexGuard<'static, ()>,
    }

    impl SweepProject {
        fn new() -> Self {
            let home_lock = crate::cli::test_home_lock::lock_home();
            let base = std::env::temp_dir()
                .join(format!("konductor-verify-run-sweep-{}", std::process::id()));
            let root = base.join("project");
            let home = base.join("home");
            std::fs::create_dir_all(root.join(".konductor/sessions")).unwrap();
            std::fs::create_dir_all(&home).unwrap();
            for evidence in EVIDENCE {
                let path = root.join(evidence);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(path, "report\n").unwrap();
            }
            let original_home = std::env::var_os("HOME");
            std::env::set_var("HOME", home.canonicalize().unwrap());
            SweepProject {
                root: root.canonicalize().unwrap(),
                base,
                original_home,
                _home_lock: home_lock,
            }
        }

        /// The verdict `run` would print for a session file holding `text`.
        fn verdict_of(&self, text: &str) -> Verdict {
            let session = Path::new(".konductor/sessions").join(SESSION_NAME);
            std::fs::write(self.root.join(&session), text).unwrap();
            check(Ok(self.root.clone()), &session, false).unwrap_or_else(Invalid::into_verdict)
        }
    }

    impl Drop for SweepProject {
        fn drop(&mut self) {
            match &self.original_home {
                Some(home) => std::env::set_var("HOME", home),
                None => std::env::remove_var("HOME"),
            }
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    /// True when `candidate` keeps every line of `text` that the evaluator
    /// reads. `gate_*_checker` lines are not read, so a hybrid that damages
    /// only those has the verdict of `text` and reproducing that baseline is
    /// correct. The whole text and the text without its final newline pass.
    fn keeps_every_read_line(candidate: &str, text: &str) -> bool {
        let lines: Vec<&str> = candidate.lines().collect();
        text.lines()
            .filter(|line| !line.contains("_checker:"))
            .all(|line| lines.contains(&line))
    }

    /// Describes `candidate` when its verdict equals the baseline of a text
    /// it is not allowed to match.
    fn stray_match(
        candidate: &str,
        verdict: &Verdict,
        texts: &[&str],
        baselines: &[Verdict],
    ) -> Option<String> {
        baselines
            .iter()
            .zip(texts)
            .enumerate()
            .find(|(_, (baseline, text))| {
                *baseline == verdict && !keeps_every_read_line(candidate, text)
            })
            .map(|(index, _)| {
                format!(
                    "baseline {index} reproduced by {} bytes: {candidate:?}",
                    candidate.len()
                )
            })
    }

    /// The atomic-replace test in `tests/verify_run_atomic_replace.rs` accepts
    /// only the two whole-file verdicts. Two kinds of torn file are modelled:
    /// a prefix of either session cut at any byte, and a prefix of one session
    /// followed by the tail of the other, which is what an in-place write
    /// that does not truncate leaves behind. Neither may reproduce a
    /// baseline unless the candidate keeps every line of that baseline's own
    /// text that the evaluator reads (see `keeps_every_read_line`). A hybrid
    /// that matches the other text's baseline, or has a read line cut or
    /// garbled, fails.
    #[test]
    fn every_truncated_session_differs_from_both_whole_file_verdicts() {
        let texts = [PASSING_SESSION, GATE_MISSING_SESSION];
        for (index, text) in texts.iter().enumerate() {
            assert!(
                text.ends_with('\n') && !text.ends_with("\n\n"),
                "fixture {index} must end with exactly one newline"
            );
        }
        let project = SweepProject::new();
        let baselines: Vec<Verdict> = texts.iter().map(|text| project.verdict_of(text)).collect();
        assert_eq!(baselines[0].exit, 0, "{:?}", baselines[0]);
        assert_ne!(baselines[1].exit, 0, "{:?}", baselines[1]);
        assert!(
            baselines[1]
                .reasons
                .iter()
                .any(|reason| reason.code.code() == "GATE_MISSING"),
            "{:?}",
            baselines[1]
        );
        for (index, text) in texts.iter().enumerate() {
            let trimmed = project.verdict_of(&text[..text.len() - 1]);
            assert_eq!(trimmed, baselines[index], "text {index} minus its newline");
        }

        let mut strays = Vec::new();
        let mut check_candidate = |candidate: &str| {
            let verdict = project.verdict_of(candidate);
            strays.extend(stray_match(candidate, &verdict, &texts, &baselines));
        };
        for text in &texts {
            for len in (0..text.len()).filter(|len| text.is_char_boundary(*len)) {
                check_candidate(&text[..len]);
            }
        }
        for (head_index, head) in texts.iter().enumerate() {
            for (tail_index, tail) in texts.iter().enumerate() {
                if head_index == tail_index {
                    continue;
                }
                for split in (0..=head.len()).filter(|split| {
                    head.is_char_boundary(*split) && tail.is_char_boundary(*split.min(&tail.len()))
                }) {
                    if let Some(rest) = tail.get(split..) {
                        check_candidate(&format!("{}{rest}", &head[..split]));
                    }
                }
            }
        }
        assert!(
            strays.is_empty(),
            "torn sessions matching a baseline: {strays:#?}"
        );
    }
}
