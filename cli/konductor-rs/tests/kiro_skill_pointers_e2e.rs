// SPDX-License-Identifier: Apache-2.0
//
// kiro_skill_pointers_e2e.rs — drives the REAL compiled binary through
// synth, install, update and uninstall to prove the Kiro harnesses write
// a `ks-<name>/SKILL.md` pointer per skill under `.kiro/skills/`, track
// it in the install manifest, and remove it on uninstall.
//
// Isolation: every invocation runs with `HOME` set to a scratch dir, and
// every test holds a `RealInstallsGuard` that fails the test if the
// runner's real `~/.konductor/installs` changes while it runs. The guard
// watches only that index, so it is a tripwire: it also fails if someone
// runs a real install on the same machine while the tests run.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const POINTER_PREFIX: &str = "ks-";
const KIRO_HARNESSES: [&str; 2] = ["kiro-cli-v2", "kiro-v3"];

const POINTER_GLOB: &str = "skill://.kiro/skills/ks-*/SKILL.md";

const PLAIN_DESCRIPTION: &str = "Use when: a \"quoted\" thing, with a colon.";
const FOLDED_DESCRIPTION: &str = "First line second line";

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_konductor")
}

fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "konductor-kiro-skill-pointers-e2e-{name}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Fails its test when the file it watches changes while it lives.
struct RealInstallsGuard {
    path: PathBuf,
    before: Option<Vec<u8>>,
}

impl RealInstallsGuard {
    fn watch(path: PathBuf) -> Self {
        let before = std::fs::read(&path).ok();
        Self { path, before }
    }

    /// Watches the install index under the test runner's real `HOME`.
    fn real() -> Self {
        let home = std::env::var_os("HOME").expect("HOME must be set for the runner");
        Self::watch(PathBuf::from(home).join(".konductor/installs"))
    }

    fn check(&self) -> Result<(), String> {
        let now = std::fs::read(&self.path).ok();
        if now == self.before {
            return Ok(());
        }
        Err(format!("{} was modified by a test", self.path.display()))
    }
}

impl Drop for RealInstallsGuard {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            self.check().unwrap();
        }
    }
}

fn run_konductor(home: &Path, sink: &telemetry_test_sink::TelemetrySink, args: &[&str]) -> Output {
    let mut command = Command::new(bin());
    command.args(args).current_dir(home).env("HOME", home);
    for var in sink.env_vars() {
        command.env(var.name, &var.value);
    }
    let output = command.output().expect("failed to spawn konductor binary");
    assert!(
        output.status.success(),
        "`konductor {}` failed: {}",
        args.join(" "),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn seed_repo(repo_root: &Path, agent_client_config: &str) {
    let agents_dir = repo_root.join("agents");
    std::fs::create_dir_all(&agents_dir).unwrap();
    std::fs::write(
        agents_dir.join("k-example.agent-spec.json"),
        format!(
            r#"{{"schemaVersion":"1","name":"k-example",
"config":{{"description":"An example agent.","model":"claude-sonnet-5","systemPrompt":"Hi."}},
"clientConfig":{{"{agent_client_config}":{{}}}}}}"#
        ),
    )
    .unwrap();
    seed_skill(
        repo_root,
        "alpha",
        &format!("'{}'", PLAIN_DESCRIPTION.replace('\'', "''")),
    );
    seed_skill(repo_root, "beta", ">-\n  First line\n  second line");
}

fn seed_skill(repo_root: &Path, name: &str, description_yaml: &str) {
    let dir = repo_root.join("skills").join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {description_yaml}\n---\n\n# {name}\n\nBody.\n"),
    )
    .unwrap();
}

fn synthed_repo(home: &Path, sink: &telemetry_test_sink::TelemetrySink, client: &str) -> PathBuf {
    let repo_root = scratch_dir("repo");
    seed_repo(&repo_root, client);
    run_konductor(
        home,
        sink,
        &["synth", "--from", &repo_root.display().to_string()],
    );
    repo_root
}

fn install(
    home: &Path,
    sink: &telemetry_test_sink::TelemetrySink,
    repo: &Path,
    target: &Path,
    harness: &str,
) -> Output {
    install_with(home, sink, repo, target, harness, &[])
}

fn install_with(
    home: &Path,
    sink: &telemetry_test_sink::TelemetrySink,
    repo: &Path,
    target: &Path,
    harness: &str,
    extra: &[&str],
) -> Output {
    let repo = repo.display().to_string();
    let target = target.display().to_string();
    let mut args = vec![
        "install",
        "--from",
        &repo,
        "--target",
        &target,
        "--harness",
        harness,
    ];
    args.extend_from_slice(extra);
    run_konductor(home, sink, &args)
}

fn update(home: &Path, sink: &telemetry_test_sink::TelemetrySink, repo: &Path, target: &Path) {
    run_konductor(
        home,
        sink,
        &[
            "update",
            "--from",
            &repo.display().to_string(),
            "--target",
            &target.display().to_string(),
            "--force",
        ],
    );
}

fn uninstall(home: &Path, sink: &telemetry_test_sink::TelemetrySink, target: &Path, harness: &str) {
    run_konductor(
        home,
        sink,
        &[
            "uninstall",
            "--target",
            &target.display().to_string(),
            "--harness",
            harness,
        ],
    );
}

fn agent_resources(target: &Path) -> Vec<String> {
    let raw = std::fs::read_to_string(target.join(".kiro/agents/k-example.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&raw).unwrap();
    value["resources"]
        .as_array()
        .map(|r| {
            r.iter()
                .filter_map(|e| e.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn has_pointer_dirs(target: &Path) -> bool {
    std::fs::read_dir(target.join(".kiro/skills"))
        .map(|entries| {
            entries
                .flatten()
                .any(|e| e.file_name().to_string_lossy().starts_with(POINTER_PREFIX))
        })
        .unwrap_or(false)
}

fn pointer_path(target: &Path, skill: &str) -> PathBuf {
    target
        .join(".kiro/skills")
        .join(format!("{POINTER_PREFIX}{skill}"))
        .join("SKILL.md")
}

/// Splits a pointer into its parsed frontmatter and its body.
fn read_pointer(path: &Path) -> (serde_yaml::Value, String) {
    let raw = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("missing pointer {}: {e}", path.display()));
    let rest = raw
        .strip_prefix("---\n")
        .expect("pointer starts with frontmatter");
    let (frontmatter, body) = rest.split_once("\n---\n").expect("frontmatter is closed");
    (serde_yaml::from_str(frontmatter).unwrap(), body.to_string())
}

fn assert_pointer(target: &Path, skill: &str, description: &str, fallback_dir: &str) {
    let (frontmatter, body) = read_pointer(&pointer_path(target, skill));
    assert_eq!(
        frontmatter["name"].as_str(),
        Some(format!("{POINTER_PREFIX}{skill}").as_str())
    );
    assert_eq!(frontmatter["description"].as_str(), Some(description));
    assert!(
        body.contains("get_skill"),
        "body names the MCP tool: {body}"
    );
    assert!(
        body.contains("konductor-skills"),
        "body names the MCP server: {body}"
    );
    assert!(
        body.contains(&format!("name: \"{skill}\"")),
        "body names the real skill: {body}"
    );
    let fallback = format!("{fallback_dir}/{skill}/SKILL.md");
    assert!(
        body.contains(&fallback),
        "body carries the fallback path {fallback}: {body}"
    );
}

fn manifest_text(target: &Path) -> String {
    std::fs::read_to_string(target.join(".konductor/manifest")).unwrap()
}

#[test]
fn kiro_install_writes_tracked_pointers_and_uninstall_removes_them() {
    let _real = RealInstallsGuard::real();
    let sink = telemetry_test_sink::TelemetrySink::start();
    for harness in KIRO_HARNESSES {
        let home = scratch_dir(&format!("home-{harness}"));
        let repo = synthed_repo(&home, &sink, "kiroCli");

        install(&home, &sink, &repo, &home, harness);

        assert!(
            home.join(".konductor/installs").is_file(),
            "{harness}: index went to the scratch HOME"
        );
        let fallback_dir = home.join(".konductor/skills").display().to_string();
        assert_pointer(&home, "alpha", PLAIN_DESCRIPTION, &fallback_dir);
        assert_pointer(&home, "beta", FOLDED_DESCRIPTION, &fallback_dir);
        assert!(
            home.join(".konductor/skills/alpha/SKILL.md").is_file(),
            "{harness}: the fallback file the pointer names exists"
        );
        let manifest = manifest_text(&home);
        assert!(
            manifest.contains(".kiro/skills/ks-alpha/SKILL.md"),
            "{harness}: tracked: {manifest}"
        );
        assert!(
            manifest.contains(".kiro/skills/ks-beta/SKILL.md"),
            "{harness}: tracked: {manifest}"
        );

        std::fs::remove_file(pointer_path(&home, "alpha")).unwrap();
        update(&home, &sink, &repo, &home);
        assert_pointer(&home, "alpha", PLAIN_DESCRIPTION, &fallback_dir);

        uninstall(&home, &sink, &home, harness);
        assert!(
            !pointer_path(&home, "alpha").exists(),
            "{harness}: pointer removed"
        );
        assert!(
            !pointer_path(&home, "beta").exists(),
            "{harness}: pointer removed"
        );
        assert!(
            !home.join(".kiro/skills/ks-alpha").exists(),
            "{harness}: pointer dir removed"
        );

        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&repo).ok();
    }
}

#[test]
fn pointer_fallback_path_follows_a_target_that_is_not_home() {
    let _real = RealInstallsGuard::real();
    let sink = telemetry_test_sink::TelemetrySink::start();
    let home = scratch_dir("home-other-target");
    let target = scratch_dir("other-target");
    let repo = synthed_repo(&home, &sink, "kiroCli");

    install(&home, &sink, &repo, &target, "kiro-v3");

    let fallback_dir = target.join(".konductor/skills").display().to_string();
    assert_pointer(&target, "alpha", PLAIN_DESCRIPTION, &fallback_dir);
    assert!(Path::new(&fallback_dir).join("alpha/SKILL.md").is_file());

    std::fs::remove_dir_all(&home).ok();
    std::fs::remove_dir_all(&target).ok();
    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn every_kiro_agent_lists_the_pointer_glob_and_the_install_count_excludes_pointers() {
    let _real = RealInstallsGuard::real();
    let sink = telemetry_test_sink::TelemetrySink::start();
    for harness in KIRO_HARNESSES {
        let home = scratch_dir(&format!("home-glob-{harness}"));
        let repo = synthed_repo(&home, &sink, "kiroCli");

        let output = install(&home, &sink, &repo, &home, harness);

        assert!(
            agent_resources(&home).contains(&POINTER_GLOB.to_string()),
            "{harness}: agent lists the glob: {:?}",
            agent_resources(&home)
        );
        let summary = String::from_utf8_lossy(&output.stdout).to_string()
            + &String::from_utf8_lossy(&output.stderr);
        assert!(
            summary.contains("2 skill(s)"),
            "{harness}: two skills, pointers not counted: {summary}"
        );

        // `update` keeps the glob.
        update(&home, &sink, &repo, &home);
        assert!(agent_resources(&home).contains(&POINTER_GLOB.to_string()));

        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&repo).ok();
    }
}

#[test]
fn no_skill_pointers_is_recorded_survives_update_and_a_plain_install_turns_it_back_on() {
    let _real = RealInstallsGuard::real();
    let sink = telemetry_test_sink::TelemetrySink::start();
    for harness in KIRO_HARNESSES {
        let home = scratch_dir(&format!("home-optout-{harness}"));
        let repo = synthed_repo(&home, &sink, "kiroCli");

        install(&home, &sink, &repo, &home, harness);
        assert!(has_pointer_dirs(&home), "{harness}: pointers by default");

        // Opting out removes the pointers and the glob.
        install_with(
            &home,
            &sink,
            &repo,
            &home,
            harness,
            &["--no-skill-pointers"],
        );
        assert!(!has_pointer_dirs(&home), "{harness}: pointers removed");
        assert!(!agent_resources(&home).contains(&POINTER_GLOB.to_string()));
        assert!(
            !manifest_text(&home).contains("ks-"),
            "{harness}: untracked"
        );
        assert!(
            home.join(".konductor/skills/alpha/SKILL.md").is_file(),
            "{harness}: skill bodies are untouched"
        );

        // `update` respects the recorded choice.
        update(&home, &sink, &repo, &home);
        assert!(
            !has_pointer_dirs(&home),
            "{harness}: update kept the opt-out"
        );
        assert!(!agent_resources(&home).contains(&POINTER_GLOB.to_string()));

        // A plain install turns pointers back on.
        install(&home, &sink, &repo, &home, harness);
        assert!(has_pointer_dirs(&home), "{harness}: pointers back");
        assert!(agent_resources(&home).contains(&POINTER_GLOB.to_string()));

        // Opt out again, then uninstall clears the marker.
        install_with(
            &home,
            &sink,
            &repo,
            &home,
            harness,
            &["--no-skill-pointers"],
        );
        assert!(home.join(".konductor/no-skill-pointers").is_file());
        uninstall(&home, &sink, &home, harness);
        assert!(
            !home.join(".konductor/no-skill-pointers").exists(),
            "{harness}: uninstall removes the marker"
        );

        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&repo).ok();
    }
}

#[test]
fn update_prunes_the_pointer_of_a_skill_the_source_dropped() {
    let _real = RealInstallsGuard::real();
    let sink = telemetry_test_sink::TelemetrySink::start();
    for harness in KIRO_HARNESSES {
        let home = scratch_dir(&format!("home-prune-{harness}"));
        let repo = synthed_repo(&home, &sink, "kiroCli");
        install(&home, &sink, &repo, &home, harness);
        assert!(pointer_path(&home, "beta").is_file());

        std::fs::remove_dir_all(repo.join("skills/beta")).unwrap();
        run_konductor(
            &home,
            &sink,
            &["synth", "--from", &repo.display().to_string()],
        );
        update(&home, &sink, &repo, &home);

        assert!(pointer_path(&home, "alpha").is_file(), "{harness}: kept");
        assert!(
            !home.join(".kiro/skills/ks-beta").exists(),
            "{harness}: dropped skill's pointer pruned"
        );
        assert!(!manifest_text(&home).contains("ks-beta"));

        std::fs::remove_dir_all(&home).ok();
        std::fs::remove_dir_all(&repo).ok();
    }
}

#[test]
fn claude_install_writes_no_pointers() {
    let _real = RealInstallsGuard::real();
    let sink = telemetry_test_sink::TelemetrySink::start();
    let home = scratch_dir("home-claude");
    let repo = synthed_repo(&home, &sink, "claudeCli");

    install_with(
        &home,
        &sink,
        &repo,
        &home,
        "claude",
        &["--no-skill-pointers"],
    );

    assert!(
        home.join(".claude/skills/alpha/SKILL.md").is_file(),
        "claude keeps its own skills"
    );
    assert!(
        !home.join(".konductor/no-skill-pointers").exists(),
        "the flag records nothing for a Claude install"
    );
    assert!(
        !home.join(".kiro/skills").exists(),
        "no Kiro pointers on a Claude install"
    );

    std::fs::remove_dir_all(&home).ok();
    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn installs_guard_fails_when_the_watched_file_changes() {
    let dir = scratch_dir("guard");
    let watched = dir.join("installs");
    std::fs::write(&watched, b"original").unwrap();
    let guard = RealInstallsGuard::watch(watched.clone());
    assert!(guard.check().is_ok());

    std::fs::write(&watched, b"touched").unwrap();
    assert!(guard.check().is_err());

    std::fs::write(&watched, b"original").unwrap();
    drop(guard);
    std::fs::remove_dir_all(&dir).ok();
}
