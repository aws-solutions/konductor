// SPDX-License-Identifier: Apache-2.0
//
// orchestration_hook.rs: `konductor __orchestration-hook`, run by a
// session-start hook. For a `konductor` session whose user config says
// `orchestration.mode: coordinator`, it prints the coordinator persona:
// a header, a line telling the agent to read the installed routing rules
// file, and the installed coordinator digest. Hook stdout is capped by
// the harnesses (about 3,000 bytes on Kiro CLI v3), so the full rules
// file is named, not printed.
//
// It never fails the harness: every path exits 0 and nothing goes to
// stderr. A session that is not Konductor's `konductor`, or whose mode is
// `auto` or unset, gets no output.

use std::io::Read as _;
use std::path::{Component, Path, PathBuf};

use super::install::index::env_home_dir;
use super::install::manifest::read_manifest;
use super::orchestration_mode::{resolve_user_mode, FallbackReason, Mode, ModeResolution};
use super::telemetry_hook::{
    candidate_install_roots, kiro_session_agent_mode, kiro_store_root, non_empty, read_capped,
    same_dir, HookPayload, InstallIndex,
};

/// The one agent the mode applies to: the agent that loads
/// `k-direct-work.md` (pinned by `tests/test_konductor_prompt_mode_neutral.py`).
pub(crate) const MODE_AGENT: &str = "konductor";

const ROUTING_RULES_FILE_NAME: &str = "k-orchestrator-routing-rules.md";
const DIGEST_FILE_NAME: &str = "k-coordinator-digest.md";

/// Header, pointer line and digest together stay under Kiro CLI v3's
/// observed hook-output cut (about 3,000 bytes).
const MAX_PERSONA_BYTES: usize = 2500;
const MAX_DIGEST_FILE_BYTES: u64 = 1024 * 1024;

const HEADER: &str = "Orchestration: coordinator\n\
For this session the coordinator rules below, and the file they name, replace the Direct Work \
section of your instructions; everything else still applies.\n\n";

const FALLBACK_PREFIX: &str = "Orchestration: auto (fallback: ";
const MAX_FALLBACK_LINE_BYTES: usize = 300;
const MAX_ECHOED_VALUE_CHARS: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HookOutput {
    Nothing,
    /// One line, newline-terminated when rendered.
    Line(String),
    /// Everything after the header: the pointer line and the digest.
    Persona(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PersonaError {
    NotInstalled { install_root: PathBuf },
    Unreadable { path: PathBuf },
    TooLarge { path: PathBuf },
}

/// `SessionStart` (Kiro CLI v3, Claude Code) and `agentSpawn` (Kiro CLI
/// v2) pass; so does a payload without the field. Any other event, such
/// as `SubagentStart`, would name a specialist's parent and must not
/// inject the persona.
fn event_passes(payload: &HookPayload) -> bool {
    matches!(
        payload.hook_event_name.as_deref(),
        None | Some("SessionStart") | Some("agentSpawn")
    )
}

/// The session's agent: `--agent`, then the payload's `agent_type`, then
/// the Kiro v3 session store. The same three steps as telemetry's
/// `AGENT_INVOCATION`; `CLAUDE_CODE_AGENT` is never read because child
/// processes inherit it.
fn resolve_session_agent(
    payload: &HookPayload,
    agent_arg: Option<&str>,
    kiro_session_agent: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
    if let Some(agent) = agent_arg.filter(|name| !name.is_empty()) {
        return Some(agent.to_string());
    }
    non_empty(payload.agent_type.clone()).or_else(|| {
        non_empty(payload.session_id.clone())
            .as_deref()
            .and_then(kiro_session_agent)
    })
}

/// Calls `load_persona` only for `coordinator`, so other sessions never
/// read the install's files.
fn decide(
    resolution: &ModeResolution,
    load_persona: impl FnOnce() -> Result<String, PersonaError>,
) -> HookOutput {
    match resolution {
        ModeResolution::Default | ModeResolution::Explicit(Mode::Auto) => HookOutput::Nothing,
        ModeResolution::Explicit(Mode::Coordinator) => match load_persona() {
            Ok(body) => HookOutput::Persona(body),
            Err(error) => HookOutput::Line(fallback_line(&persona_reason(&error))),
        },
        ModeResolution::Fallback(reason) => HookOutput::Line(fallback_line(&config_reason(reason))),
    }
}

fn config_reason(reason: &FallbackReason) -> String {
    let home = env_home_dir();
    let shown = |path: &Path| display_path(path, home.as_deref());
    match reason {
        FallbackReason::HomeUnresolved => {
            "HOME is not set, so ~/.konductor/config.yml could not be located".to_string()
        }
        FallbackReason::Unreadable { path, kind } => {
            format!("{} could not be read: {kind}", shown(path))
        }
        FallbackReason::Malformed { path, message } => {
            format!("{} could not be parsed: {}", shown(path), sanitize(message))
        }
        FallbackReason::UnknownValue { value } => {
            let value: String = sanitize(value)
                .chars()
                .take(MAX_ECHOED_VALUE_CHARS)
                .collect();
            format!("orchestration.mode is \"{value}\"; expected auto or coordinator")
        }
    }
}

fn persona_reason(error: &PersonaError) -> String {
    let home = env_home_dir();
    match error {
        PersonaError::NotInstalled { install_root } => format!(
            "the coordinator rules file is not installed under {}; run konductor update",
            display_path(install_root, home.as_deref())
        ),
        PersonaError::Unreadable { path } | PersonaError::TooLarge { path } => format!(
            "the coordinator rules file at {} could not be read; run konductor update",
            display_path(path, home.as_deref())
        ),
    }
}

/// `<home>/rest` as `~/rest`; any other path unchanged.
fn display_path(path: &Path, home: Option<&Path>) -> String {
    match home.and_then(|home| path.strip_prefix(home).ok()) {
        Some(rest) => format!("~/{}", rest.display()),
        None => path.display().to_string(),
    }
}

/// Control characters, plus the Unicode line and paragraph separators
/// and bidi controls that some renderers treat as line breaks or use to
/// reorder text.
fn breaks_a_line(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200E}' | '\u{200F}' | '\u{2028}'..='\u{202E}' | '\u{2066}'..='\u{2069}'
        )
}

/// Each run of line-breaking characters becomes one space, so
/// user-authored, parser or path text cannot break the one-line output.
fn sanitize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_control_run = false;
    for c in text.chars() {
        if breaks_a_line(c) {
            if !in_control_run {
                out.push(' ');
            }
            in_control_run = true;
        } else {
            out.push(c);
            in_control_run = false;
        }
    }
    out
}

/// The fallback line, cut to `MAX_FALLBACK_LINE_BYTES` on a char
/// boundary with its closing `)` kept.
fn fallback_line(reason: &str) -> String {
    let line = format!("{FALLBACK_PREFIX}{})", sanitize(reason));
    if line.len() <= MAX_FALLBACK_LINE_BYTES {
        return line;
    }
    let mut end = MAX_FALLBACK_LINE_BYTES - 1;
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    format!("{})", &line[..end])
}

fn render(output: &HookOutput) -> Vec<u8> {
    match output {
        HookOutput::Nothing => Vec::new(),
        HookOutput::Line(line) => format!("{line}\n").into_bytes(),
        HookOutput::Persona(body) => format!("{HEADER}{body}").into_bytes(),
    }
}

/// The first manifest file (any strategy) named `file_name`, as a path
/// under `root`. Paths that are absolute or climb out of `root` are
/// ignored.
fn installed_file(
    manifest: &super::install::manifest::Manifest,
    root: &Path,
    file_name: &str,
) -> Option<PathBuf> {
    manifest
        .strategies
        .iter()
        .flat_map(|strategy| strategy.files.iter())
        .map(|file| Path::new(&file.path))
        .filter(|path| {
            path.components()
                .all(|part| matches!(part, Component::Normal(_)))
        })
        .find(|path| path.file_name().is_some_and(|name| name == file_name))
        .map(|path| root.join(path))
}

/// The persona body for the install at `root`: the line naming its
/// routing rules file, then its digest.
fn load_persona(root: &Path) -> Result<String, PersonaError> {
    let not_installed = || PersonaError::NotInstalled {
        install_root: root.to_path_buf(),
    };
    let manifest = match read_manifest(root) {
        Ok(Some(manifest)) => manifest,
        _ => return Err(not_installed()),
    };
    let rules =
        installed_file(&manifest, root, ROUTING_RULES_FILE_NAME).ok_or_else(not_installed)?;
    let digest = installed_file(&manifest, root, DIGEST_FILE_NAME).ok_or_else(not_installed)?;
    if !rules.is_file() {
        return Err(PersonaError::Unreadable { path: rules });
    }
    let digest_text = read_digest(&digest)?;
    let rules = std::fs::canonicalize(&rules).unwrap_or(rules);
    let body = format!(
        "{}{}",
        pointer_line(&rules),
        with_trailing_newline(digest_text)
    );
    if HEADER.len() + body.len() > MAX_PERSONA_BYTES {
        return Err(PersonaError::TooLarge { path: digest });
    }
    Ok(body)
}

/// The imperative first step, followed by a blank line. The heading
/// request makes a skipped read visible in the first reply.
fn pointer_line(rules: &Path) -> String {
    format!(
        "Step 1, before any other action: read {} in full. It holds the complete coordinator \
         rules this digest summarizes. In your first reply, after the Orchestration line, name \
         that file's last `## ` heading.\n\n",
        sanitize(&rules.display().to_string())
    )
}

fn read_digest(path: &Path) -> Result<String, PersonaError> {
    let unreadable = || PersonaError::Unreadable {
        path: path.to_path_buf(),
    };
    let file = std::fs::File::open(path).map_err(|_| unreadable())?;
    let mut text = String::new();
    file.take(MAX_DIGEST_FILE_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| unreadable())?;
    if text.len() as u64 > MAX_DIGEST_FILE_BYTES {
        return Err(PersonaError::TooLarge {
            path: path.to_path_buf(),
        });
    }
    Ok(text)
}

fn with_trailing_newline(mut text: String) -> String {
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text
}

/// Event, identity and ownership are checked before the config file is
/// opened, so other agents' sessions cost no YAML parse. `own_install` is
/// the install that wired this hook; only the nearest install that owns
/// `konductor` prints, so two installs never inject twice.
pub(crate) fn dispatch_orchestration_hook(
    cwd: &Path,
    agent_arg: Option<&str>,
    own_install: Option<&Path>,
) {
    let Some(buf) = read_capped(std::io::stdin()) else {
        return;
    };
    let Ok(payload) = serde_json::from_str::<HookPayload>(&buf) else {
        return;
    };
    if !event_passes(&payload) {
        return;
    }
    let home = env_home_dir();
    let store_root = home.as_deref().map(kiro_store_root);
    let kiro_session_agent = |session_id: &str| {
        store_root
            .as_deref()
            .and_then(|root| kiro_session_agent_mode(root, session_id))
    };
    if resolve_session_agent(&payload, agent_arg, &kiro_session_agent).as_deref()
        != Some(MODE_AGENT)
    {
        return;
    }
    let index = InstallIndex::new(candidate_install_roots(cwd, home.as_deref()));
    let Some(owning_root) = index.install_for(MODE_AGENT) else {
        return;
    };
    if own_install.is_some_and(|own| !same_dir(own, owning_root)) {
        return;
    }
    let output = decide(&resolve_user_mode(home.as_deref()), || {
        load_persona(owning_root)
    });
    write_stdout(&render(&output));
}

/// `print!` panics on a closed pipe; this discards the error instead.
fn write_stdout(bytes: &[u8]) {
    use std::io::Write as _;
    if bytes.is_empty() {
        return;
    }
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(bytes);
    let _ = out.flush();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::install::manifest::{
        upsert_strategy, ManifestFile, Provenance, Status, StrategyManifest,
    };
    use crate::cli::telemetry_hook::{resolve_invocations, HookEnv, AGENT_INVOCATION};

    const KIRO_V3_PAYLOAD: &str = r#"{"session_id":"sess_8147fdc3-f3ec-4b32-a669-a0d26bd4cea0","hook_event_name":"SessionStart","cwd":"/private/tmp"}"#;
    const CLAUDE_PAYLOAD: &str = r#"{"session_id":"4a192073-b15a-4eaa-89d3-d0ca80107561","transcript_path":"/x.jsonl","cwd":"/private/tmp","agent_type":"konductor","hook_event_name":"SessionStart","source":"startup"}"#;
    const KIRO_V2_PAYLOAD: &str = r#"{"hook_event_name":"agentSpawn","cwd":"/private/tmp","session_id":"cb4556d5-1aa1-46c5-ba9d-235ef054295d"}"#;

    fn parse(json: &str) -> HookPayload {
        serde_json::from_str(json).expect("test payload must parse")
    }

    fn v3_store(session_id: &str) -> Option<String> {
        (session_id == "sess_8147fdc3-f3ec-4b32-a669-a0d26bd4cea0").then(|| "konductor".to_string())
    }

    fn no_store(_: &str) -> Option<String> {
        None
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-orchestration-hook-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // ── Event gate and identity ──────────────────────────────────────

    #[test]
    fn the_three_probe_payloads_pass_the_event_gate() {
        for payload in [
            KIRO_V3_PAYLOAD,
            CLAUDE_PAYLOAD,
            KIRO_V2_PAYLOAD,
            r#"{"session_id":"s"}"#,
        ] {
            assert!(event_passes(&parse(payload)), "{payload}");
        }
    }

    #[test]
    fn subagent_start_naming_konductor_is_gated_out() {
        let payload = parse(
            r#"{"session_id":"s","agent_type":"konductor","hook_event_name":"SubagentStart"}"#,
        );
        assert!(!event_passes(&payload));
        let payload = parse(r#"{"session_id":"s","hook_event_name":"PreToolUse"}"#);
        assert!(!event_passes(&payload));
    }

    #[test]
    fn identity_prefers_agent_arg_then_agent_type_then_the_store() {
        let v3 = parse(KIRO_V3_PAYLOAD);
        assert_eq!(
            resolve_session_agent(&v3, None, &v3_store).as_deref(),
            Some("konductor")
        );
        assert_eq!(resolve_session_agent(&v3, None, &no_store), None);
        assert_eq!(
            resolve_session_agent(&v3, Some("k-developer"), &v3_store).as_deref(),
            Some("k-developer")
        );
        let claude = parse(
            r#"{"session_id":"sess_8147fdc3-f3ec-4b32-a669-a0d26bd4cea0","agent_type":"k-developer"}"#,
        );
        assert_eq!(
            resolve_session_agent(&claude, None, &v3_store).as_deref(),
            Some("k-developer")
        );
    }

    #[test]
    fn claude_payload_without_agent_type_resolves_nothing_on_every_source() {
        for source in ["startup", "clear", "resume", "compact"] {
            let payload = parse(&format!(
                r#"{{"session_id":"4a192073","hook_event_name":"SessionStart","source":"{source}"}}"#
            ));
            assert_eq!(
                resolve_session_agent(&payload, None, &no_store),
                None,
                "{source}"
            );
        }
    }

    #[test]
    fn identity_agrees_with_telemetrys_session_start_resolver() {
        let cases: [(&str, Option<&str>); 3] = [
            (KIRO_V3_PAYLOAD, None),
            (CLAUDE_PAYLOAD, None),
            (KIRO_V2_PAYLOAD, Some("konductor")),
        ];
        for (payload, agent_arg) in cases {
            let ours = resolve_session_agent(&parse(payload), agent_arg, &v3_store);
            let env = HookEnv {
                kiro_session_id: parse(payload).session_id,
                claude_agent: None,
            };
            let theirs: Vec<String> =
                resolve_invocations(AGENT_INVOCATION, parse(payload), agent_arg, &env, &v3_store)
                    .into_iter()
                    .map(|invocation| invocation.agent)
                    .collect();
            assert_eq!(ours.as_deref(), Some("konductor"), "{payload}");
            assert_eq!(theirs, vec!["konductor".to_string()], "{payload}");
        }
    }

    // ── decide ───────────────────────────────────────────────────────

    fn must_not_load() -> Result<String, PersonaError> {
        panic!("only a coordinator session may load the persona")
    }

    #[test]
    fn non_coordinator_sessions_never_load_the_persona() {
        assert_eq!(
            decide(&ModeResolution::Default, must_not_load),
            HookOutput::Nothing
        );
        assert_eq!(
            decide(&ModeResolution::Explicit(Mode::Auto), must_not_load),
            HookOutput::Nothing
        );
        let fallback = ModeResolution::Fallback(FallbackReason::UnknownValue {
            value: "strict".to_string(),
        });
        assert!(matches!(
            decide(&fallback, must_not_load),
            HookOutput::Line(_)
        ));
    }

    #[test]
    fn coordinator_session_gets_the_persona_or_a_fallback_line() {
        let coordinator = ModeResolution::Explicit(Mode::Coordinator);
        assert_eq!(
            decide(&coordinator, || Ok("body\n".to_string())),
            HookOutput::Persona("body\n".to_string())
        );
        let missing = decide(&coordinator, || {
            Err(PersonaError::NotInstalled {
                install_root: PathBuf::from("/srv/project"),
            })
        });
        assert_eq!(
            missing,
            HookOutput::Line(
                "Orchestration: auto (fallback: the coordinator rules file is not installed \
                 under /srv/project; run konductor update)"
                    .to_string()
            )
        );
        for error in [
            PersonaError::Unreadable {
                path: PathBuf::from("/srv/p/rules.md"),
            },
            PersonaError::TooLarge {
                path: PathBuf::from("/srv/p/rules.md"),
            },
        ] {
            assert_eq!(
                decide(&coordinator, || Err(error.clone())),
                HookOutput::Line(
                    "Orchestration: auto (fallback: the coordinator rules file at \
                     /srv/p/rules.md could not be read; run konductor update)"
                        .to_string()
                )
            );
        }
    }

    #[test]
    fn config_fallback_lines_match_the_design_text() {
        let home = Path::new("/home/u");
        let path = home.join(".konductor/config.yml");
        assert_eq!(
            display_path(&path, Some(home)),
            "~/.konductor/config.yml".to_string()
        );
        assert_eq!(
            fallback_line(&config_reason(&FallbackReason::HomeUnresolved)),
            "Orchestration: auto (fallback: HOME is not set, so ~/.konductor/config.yml could not \
             be located)"
        );
        assert_eq!(
            fallback_line(&config_reason(&FallbackReason::Unreadable {
                path: PathBuf::from("/etc/c.yml"),
                kind: std::io::ErrorKind::PermissionDenied,
            })),
            "Orchestration: auto (fallback: /etc/c.yml could not be read: permission denied)"
        );
        assert_eq!(
            fallback_line(&config_reason(&FallbackReason::Malformed {
                path: PathBuf::from("/etc/c.yml"),
                message: "invalid type:\tmap".to_string(),
            })),
            "Orchestration: auto (fallback: /etc/c.yml could not be parsed: invalid type: map)"
        );
        assert_eq!(
            fallback_line(&config_reason(&FallbackReason::UnknownValue {
                value: "strict".to_string(),
            })),
            "Orchestration: auto (fallback: orchestration.mode is \"strict\"; expected auto or \
             coordinator)"
        );
    }

    #[test]
    fn echoed_values_stay_on_one_short_line() {
        let newline = fallback_line(&config_reason(&FallbackReason::UnknownValue {
            value: "coord\n\ninator".to_string(),
        }));
        assert!(newline.contains("\"coord inator\""), "{newline}");
        let long = fallback_line(&config_reason(&FallbackReason::UnknownValue {
            value: "x".repeat(2048),
        }));
        assert!(long.contains(&format!("\"{}\"", "x".repeat(40))), "{long}");
        let huge = fallback_line(&"é".repeat(2048));
        assert!(huge.len() <= MAX_FALLBACK_LINE_BYTES);
        assert!(huge.ends_with(')'));
        for line in [newline, long, huge] {
            assert!(!line.chars().any(char::is_control), "{line:?}");
        }
    }

    #[test]
    fn render_writes_each_output_shape() {
        assert!(render(&HookOutput::Nothing).is_empty());
        assert_eq!(render(&HookOutput::Line("a".to_string())), b"a\n");
        let persona =
            String::from_utf8(render(&HookOutput::Persona("Step 1\n".to_string()))).unwrap();
        assert_eq!(persona, format!("{HEADER}Step 1\n"));
        assert!(persona.starts_with("Orchestration: coordinator\nFor this session"));
    }

    // ── load_persona ─────────────────────────────────────────────────

    fn seed(root: &Path, files: &[(&str, &str)]) {
        let manifest_files = files
            .iter()
            .map(|(path, contents)| {
                let full = root.join(path);
                std::fs::create_dir_all(full.parent().unwrap()).unwrap();
                std::fs::write(&full, contents).unwrap();
                ManifestFile {
                    path: path.to_string(),
                    sha256: None,
                    provenance: Provenance::Created,
                }
            })
            .collect();
        upsert_strategy(
            root,
            StrategyManifest::new(
                "kiro-v3",
                "2026-01-01T00:00:00Z",
                ".",
                None,
                Status::Complete,
                manifest_files,
            ),
        )
        .unwrap();
    }

    #[test]
    fn persona_names_the_installed_rules_file_and_carries_the_digest() {
        let root = scratch_dir("persona");
        seed(
            &root,
            &[
                (".kiro/agents/konductor.json", "{}"),
                (".kiro/context/k-orchestrator-routing-rules.md", "# Rules\n"),
                (
                    ".kiro/context/k-coordinator-digest.md",
                    "## Digest\n- delegate",
                ),
            ],
        );
        let body = load_persona(&root).unwrap();
        let rules =
            std::fs::canonicalize(root.join(".kiro/context/k-orchestrator-routing-rules.md"))
                .unwrap();
        assert!(body.starts_with(&format!(
            "Step 1, before any other action: read {} in full.",
            rules.display()
        )));
        assert!(body.ends_with("\n\n## Digest\n- delegate\n"), "{body}");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn persona_errors_name_what_is_missing() {
        let root = scratch_dir("persona-missing");
        assert_eq!(
            load_persona(&root),
            Err(PersonaError::NotInstalled {
                install_root: root.clone()
            })
        );
        seed(
            &root,
            &[(".kiro/context/k-orchestrator-routing-rules.md", "# Rules\n")],
        );
        assert!(matches!(
            load_persona(&root),
            Err(PersonaError::NotInstalled { .. })
        ));
        seed(
            &root,
            &[
                (".kiro/context/k-orchestrator-routing-rules.md", "# Rules\n"),
                (
                    ".kiro/context/k-coordinator-digest.md",
                    &"x".repeat(MAX_PERSONA_BYTES),
                ),
            ],
        );
        assert!(matches!(
            load_persona(&root),
            Err(PersonaError::TooLarge { .. })
        ));
        std::fs::remove_file(root.join(".kiro/context/k-orchestrator-routing-rules.md")).unwrap();
        assert!(matches!(
            load_persona(&root),
            Err(PersonaError::Unreadable { .. })
        ));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn manifest_paths_outside_the_install_are_ignored() {
        let root = scratch_dir("persona-escape");
        seed(&root, &[(".kiro/context/k-coordinator-digest.md", "d")]);
        let mut manifest = read_manifest(&root).unwrap().unwrap();
        manifest.strategies[0].files.push(ManifestFile {
            path: "../k-orchestrator-routing-rules.md".to_string(),
            sha256: None,
            provenance: Provenance::Created,
        });
        assert_eq!(
            installed_file(&manifest, &root, ROUTING_RULES_FILE_NAME),
            None
        );
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn the_pointer_path_stays_on_one_line() {
        let line = pointer_line(Path::new("/p/a\u{2028}b\nc\u{202E}d/rules.md"));
        assert!(line.contains("read /p/a b c d/rules.md in full."), "{line}");
        assert_eq!(line.matches('\n').count(), 2, "{line:?}");
    }

    #[test]
    fn the_shipped_digest_fits_the_persona_budget() {
        let digest = include_str!("../../../../context/k-coordinator-digest.md");
        let long_path = format!(
            "/{}/.kiro/context/{ROUTING_RULES_FILE_NAME}",
            "p".repeat(200)
        );
        let pointer = pointer_line(Path::new(&long_path));
        assert!(HEADER.len() + pointer.len() + digest.len() <= MAX_PERSONA_BYTES);
    }
}
