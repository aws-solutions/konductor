// SPDX-License-Identifier: Apache-2.0
//
// verify_run.rs: `konductor verify-run --session <path>`. Reads one SOP
// session file and the project config, judges the session with `gate_eval`,
// and prints one verdict. Writes nothing and sends nothing.
//
// The current directory is the project: it alone supplies the policy
// (`<cwd>/.konductor/config.yml` over the user tier). `--root` only bounds
// where the session file and the evidence paths may resolve.
//
// The restricted loader rejects local tags (`!custom`) and non-string keys.
// serde_yaml resolves a `!!` tag such as `!!python/object` to its untagged
// value, so that file parses as plain data: no object is ever constructed.

use std::fs::{File, Metadata};
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};

use serde_json::json;
use serde_yaml::Value;

use super::config::{self, Severity, CONFIG_FILE_NAME, KONDUCTOR_DIR_NAME};
use super::gate_config::{gate_map, severity_table, GateMap};
use super::gate_eval::{
    evaluate_value, EvalContext, Info, InfoCode, Reason, ReasonCode, SeverityPolicy, Verdict,
};
use super::install::index::env_home_dir;
use super::output::{self, ColorMode};
use super::{EXIT_USAGE_ERROR, EXIT_VERIFY_FAILED};

const PREFIX: &str = "konductor verify-run:";
const COMMAND: &str = "verify-run";
const MAX_SESSION_BYTES: u64 = 1_048_576;

/// Runs the check and prints the verdict. Returns the process exit code.
pub(crate) fn run(
    cwd: io::Result<PathBuf>,
    root: Option<&Path>,
    session: &Path,
    allow_running: bool,
    json: bool,
    color: ColorMode,
) -> u8 {
    match check(cwd, root, session, allow_running) {
        Ok(verdict) => {
            if json {
                println!("{}", verdict_json(&verdict));
            } else {
                print_plain(&verdict, color);
            }
            verdict.exit
        }
        Err(invalid) => {
            let verdict = invalid.into_verdict();
            if json {
                println!("{}", verdict_json(&verdict));
            } else {
                print_invalid(&verdict, color);
            }
            verdict.exit
        }
    }
}

/// The `--json` envelope for an argument error clap reported before `run`
/// could start, so the `--json` contract holds for parse failures too.
pub(crate) fn usage_error_json(message: &str) -> serde_json::Value {
    let reasons = vec![Reason {
        code: ReasonCode::ArgumentInvalid,
        detail: message.to_string(),
    }];
    envelope(EXIT_USAGE_ERROR, &reasons, &[])
}

/// A V1 failure: the file or the config could not be used at all. An
/// argument problem is exit 64; a content failure is exit 65.
struct Invalid {
    exit: u8,
    reasons: Vec<Reason>,
}

impl Invalid {
    fn one(exit: u8, code: ReasonCode, detail: String) -> Self {
        Invalid {
            exit,
            reasons: vec![Reason { code, detail }],
        }
    }

    fn session(detail: impl Into<String>) -> Self {
        Self::one(
            EXIT_VERIFY_FAILED,
            ReasonCode::SessionInvalid,
            detail.into(),
        )
    }

    fn config(detail: impl std::fmt::Display) -> Self {
        Self::one(
            EXIT_VERIFY_FAILED,
            ReasonCode::ConfigInvalid,
            detail.to_string(),
        )
    }

    fn argument(detail: impl Into<String>) -> Self {
        Self::one(EXIT_USAGE_ERROR, ReasonCode::ArgumentInvalid, detail.into())
    }

    fn into_verdict(self) -> Verdict {
        Verdict {
            exit: self.exit,
            reasons: self.reasons,
            info: Vec::new(),
        }
    }
}

fn check(
    cwd: io::Result<PathBuf>,
    root: Option<&Path>,
    session: &Path,
    allow_running: bool,
) -> Result<Verdict, Invalid> {
    let cwd = cwd.map_err(|err| {
        Invalid::argument(format!("could not resolve the current directory: {err}"))
    })?;
    let root = resolve_root(&cwd, root)?;
    let path = locate_session(&root, session)?;
    let value = read_session(&path)?;
    let (threshold, configured) = configured_threshold(&cwd)?;
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
    let mut verdict = evaluate_value(&value, &ctx);
    if verdict
        .reasons
        .iter()
        .any(|r| r.code == ReasonCode::SessionInvalid)
    {
        // The evaluator reports a rejected tag or key as its own usage-class
        // exit; here it is a content failure like any other V1 row.
        return Err(Invalid {
            exit: EXIT_VERIFY_FAILED,
            reasons: verdict.reasons,
        });
    }
    verdict.info.insert(
        0,
        Info {
            code: InfoCode::ConfigSource,
            detail: format!(
                "fail_on_severity_at_or_above={configured} from {}",
                config_source(&cwd)
            ),
        },
    );
    Ok(verdict)
}

/// The canonical containment root: `--root` (a relative one against the
/// current directory), or the current directory when it is not given.
fn resolve_root(cwd: &Path, root: Option<&Path>) -> Result<PathBuf, Invalid> {
    let shown = root.map_or_else(
        || "(current directory)".to_string(),
        |r| r.display().to_string(),
    );
    let given = match root {
        Some(root) => cwd.join(root),
        None => cwd.to_path_buf(),
    };
    let canonical = given
        .canonicalize()
        .map_err(|err| Invalid::argument(format!("--root {shown} cannot be used: {err}")))?;
    if !canonical.is_dir() {
        return Err(Invalid::argument(format!(
            "--root {shown} is not a directory"
        )));
    }
    Ok(canonical)
}

/// Resolves `session` against `root` and returns its canonical path. A
/// symlink, a file outside `root`, or anything but a regular file is refused.
fn locate_session(root: &Path, session: &Path) -> Result<PathBuf, Invalid> {
    let shown = session.display();
    let given = root.join(session);
    let link_metadata = std::fs::symlink_metadata(&given)
        .map_err(|err| Invalid::session(format!("cannot read session file {shown}: {err}")))?;
    if link_metadata.file_type().is_symlink() {
        return Err(Invalid::session(format!(
            "session file {shown} is a symlink"
        )));
    }
    if !link_metadata.is_file() {
        return Err(Invalid::session(format!(
            "session file {shown} is not a regular file"
        )));
    }
    let canonical = given
        .canonicalize()
        .map_err(|err| Invalid::session(format!("cannot resolve session file {shown}: {err}")))?;
    if !canonical.starts_with(root) {
        return Err(Invalid::session(format!(
            "session file {shown} is outside the root"
        )));
    }
    Ok(canonical)
}

/// Opens the canonical path once and refuses it when the opened file is not
/// the file `locate_session` checked. A file swapped in between the check
/// and the open is the only seam; the read then uses this one handle.
fn read_session(path: &Path) -> Result<Value, Invalid> {
    let unreadable = |err: io::Error| Invalid::session(format!("cannot read session file: {err}"));
    let file = File::open(path).map_err(unreadable)?;
    let opened = file.metadata().map_err(unreadable)?;
    let on_disk = std::fs::symlink_metadata(path).map_err(unreadable)?;
    if !opened.is_file() || on_disk.file_type().is_symlink() || !same_file(&opened, &on_disk) {
        return Err(Invalid::session("session file changed while it was opened"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_SESSION_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(unreadable)?;
    if bytes.len() as u64 > MAX_SESSION_BYTES {
        return Err(Invalid::session(format!(
            "session file is larger than {MAX_SESSION_BYTES} bytes"
        )));
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| Invalid::session("session file is not valid UTF-8"))?;
    serde_yaml::from_str(&text)
        .map_err(|err| Invalid::session(format!("session file is not valid YAML: {err}")))
}

#[cfg(unix)]
fn same_file(a: &Metadata, b: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(not(unix))]
fn same_file(_a: &Metadata, _b: &Metadata) -> bool {
    true
}

/// The `fail_on_severity_at_or_above` that applies to the project at `cwd`,
/// parsed and as written. A present but invalid config fails the check
/// rather than falling back to the preset.
fn configured_threshold(cwd: &Path) -> Result<(Severity, String), Invalid> {
    let config = config::load_config(cwd).map_err(Invalid::config)?;
    let configured = config.fail_on_severity_at_or_above;
    let threshold = configured
        .parse::<Severity>()
        .map_err(|()| Invalid::config(format!("unknown severity '{configured}'")))?;
    Ok((threshold, configured))
}

/// The config file that sets the threshold: the project file, else the user
/// file, else the shipped defaults. Mirrors the layering in `load_config`.
fn config_source(cwd: &Path) -> String {
    let project = cwd.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME);
    let user = env_home_dir().map(|home| home.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME));
    [Some(project), user]
        .into_iter()
        .flatten()
        .find(|path| sets_threshold(path))
        .map_or_else(|| "defaults".to_string(), |path| path.display().to_string())
}

fn sets_threshold(path: &Path) -> bool {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_yaml::from_str::<Value>(&text).ok())
        .and_then(|doc| doc.get("fail_on_severity_at_or_above").cloned())
        .is_some_and(|value| !value.is_null())
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
/// `root` after symlinks resolve, spelled exactly as it is on disk.
fn is_project_file(root: &Path, recorded: &str) -> bool {
    let relative = Path::new(recorded);
    if recorded.is_empty() || relative.is_absolute() || !spelled_exactly(root, relative) {
        return false;
    }
    root.join(relative)
        .canonicalize()
        .is_ok_and(|path| path.starts_with(root) && path.metadata().is_ok_and(|m| m.is_file()))
}

/// True when every component of `relative` matches a directory entry byte
/// for byte, so a case variant fails on a case-insensitive host as it does
/// on a case-sensitive one.
fn spelled_exactly(root: &Path, relative: &Path) -> bool {
    let mut dir = root.to_path_buf();
    for component in relative.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => dir.push(".."),
            Component::Normal(name) => {
                let listed = std::fs::read_dir(&dir).is_ok_and(|mut entries| {
                    entries.any(|e| e.is_ok_and(|e| e.file_name() == name))
                });
                if !listed {
                    return false;
                }
                dir.push(name);
            }
            Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    true
}

fn verdict_json(verdict: &Verdict) -> serde_json::Value {
    envelope(verdict.exit, &verdict.reasons, &verdict.info)
}

fn envelope(exit: u8, reasons: &[Reason], info: &[Info]) -> serde_json::Value {
    let reason_list: Vec<_> = reasons
        .iter()
        .map(|r| json!({"code": r.code.code(), "detail": r.detail}))
        .collect();
    let info_list: Vec<_> = info
        .iter()
        .map(|i| json!({"code": i.code.code(), "detail": i.detail}))
        .collect();
    let mut doc = json!({
        "command": COMMAND,
        "exit": exit,
        "reasons": reason_list,
        "info": info_list,
    });
    if exit == EXIT_USAGE_ERROR || exit == EXIT_VERIFY_FAILED {
        let error = reasons.first().map_or("", |r| r.detail.as_str());
        doc["error"] = json!(error);
    }
    doc
}

/// Session-controlled text must not forge lines or drive the terminal:
/// control characters print as visible escapes.
fn escape_control(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            c if c.is_control() => escaped.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => escaped.push(c),
        }
    }
    escaped
}

/// A V1 failure goes to stderr, one line per reason.
fn print_invalid(verdict: &Verdict, color: ColorMode) {
    for reason in &verdict.reasons {
        eprintln!(
            "{} {}: {}",
            output::error_prefix(color, PREFIX),
            reason.code.code(),
            escape_control(&reason.detail)
        );
    }
}

/// Any other verdict prints a summary line, then one line per reason and
/// note, on stdout.
fn print_plain(verdict: &Verdict, color: ColorMode) {
    let prefix = if verdict.exit == 0 {
        output::success_prefix(color, PREFIX)
    } else {
        output::error_prefix_stdout(color, PREFIX)
    };
    let first = verdict.reasons.first().map_or("PASSED", |r| r.code.code());
    println!("{prefix} {first} (exit {})", verdict.exit);
    for reason in &verdict.reasons {
        println!("{}: {}", reason.code.code(), escape_control(&reason.detail));
    }
    for info in &verdict.info {
        println!("{}: {}", info.code.code(), escape_control(&info.detail));
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
    fn a_root_that_is_not_a_directory_is_a_usage_error() {
        let file = std::env::current_exe().unwrap();
        let err = resolve_root(Path::new("/"), Some(&file)).unwrap_err();
        assert_eq!(err.exit, EXIT_USAGE_ERROR);
    }

    #[test]
    fn a_relative_root_resolves_against_the_current_directory() {
        let base = std::env::temp_dir().canonicalize().unwrap();
        let root = resolve_root(&base, Some(Path::new("."))).ok().unwrap();
        assert_eq!(root, base);
    }

    #[test]
    fn an_absolute_or_empty_evidence_path_is_not_a_project_file() {
        let root = std::env::temp_dir().canonicalize().unwrap();
        assert!(!is_project_file(&root, ""));
        assert!(!is_project_file(&root, "/etc/hosts"));
    }

    #[test]
    fn control_characters_print_as_visible_escapes() {
        assert_eq!(
            escape_control("a\nPASSED\r\u{1b}[31m\u{7f}é"),
            "a\\nPASSED\\r\\u{1b}[31m\\u{7f}é"
        );
    }

    #[test]
    fn a_file_is_not_the_same_file_as_another_file() {
        let dir = std::env::temp_dir().join(format!("verify-run-same-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (a, b) = (dir.join("a"), dir.join("b"));
        std::fs::write(&a, "x").unwrap();
        std::fs::write(&b, "x").unwrap();
        let (meta_a, meta_b) = (a.metadata().unwrap(), b.metadata().unwrap());
        assert!(same_file(&meta_a, &meta_a));
        #[cfg(unix)]
        assert!(!same_file(&meta_a, &meta_b));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_case_variant_of_an_evidence_path_is_not_a_project_file() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("verify-run-case-{}", std::process::id()));
        std::fs::create_dir_all(root.join("Dir")).unwrap();
        std::fs::write(root.join("Dir/a.md"), "x").unwrap();
        assert!(is_project_file(&root, "Dir/a.md"));
        assert!(!is_project_file(&root, "dir/a.md"));
        assert!(!is_project_file(&root, "Dir/A.md"));
        std::fs::remove_dir_all(&root).ok();
    }
}
