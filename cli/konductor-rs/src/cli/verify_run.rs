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
}
