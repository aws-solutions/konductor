// SPDX-License-Identifier: Apache-2.0
//! The trust record, the repo tool configuration scan and the agent catalog, through the real file system.

#![cfg(unix)]

mod common;

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::thread;

use common::TempDir;
use workflow_adapters::repo_config::MAX_FILES;
use workflow_adapters::{scan_repo_config, FileAgentCatalog, FileTrustStore, InstalledFiles};
use workflow_core::ports::{AgentCatalog, AgentTools, Placement, Runner, TrustStore};
use workflow_core::trust::{sha256_hex, ConfigContent};

fn hash(c: char) -> String {
    c.to_string().repeat(64)
}

#[test]
fn a_recorded_hash_is_read_back_and_the_file_has_mode_0600() {
    let home = TempDir::new("trust-mode");
    let mut store = FileTrustStore::new(Some(home.path()));
    assert_eq!(store.recorded("/repo", "plan"), None);
    store.record("/repo", "plan", &hash('a')).unwrap();
    assert_eq!(store.recorded("/repo", "plan"), Some(hash('a')));
    assert_eq!(store.recorded("/repo", "other"), None);
    assert_eq!(store.recorded("/elsewhere", "plan"), None);
    let mode = fs::metadata(store.path().unwrap())
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    // The same holds after a change replaces the file, and no temporary file is left behind.
    store.record("/repo", "plan", &hash('b')).unwrap();
    let mode = fs::metadata(store.path().unwrap())
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600);
    let names: Vec<String> = fs::read_dir(home.path().join(".konductor"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(
        names
            .iter()
            .all(|n| n == "trust.json" || n == ".trust.lock"),
        "{names:?}"
    );
}

#[test]
fn two_writers_do_not_lose_an_update() {
    let home = TempDir::new("trust-race");
    let root = home.path().to_path_buf();
    let writers: Vec<_> = (0..8)
        .map(|n| {
            let root = root.clone();
            thread::spawn(move || {
                let mut store = FileTrustStore::new(Some(&root));
                for m in 0..5 {
                    store
                        .record("/repo", &format!("w{n}-{m}"), &"c".repeat(64))
                        .unwrap();
                }
            })
        })
        .collect();
    for writer in writers {
        writer.join().unwrap();
    }
    let store = FileTrustStore::new(Some(&root));
    for n in 0..8 {
        for m in 0..5 {
            assert!(
                store.recorded("/repo", &format!("w{n}-{m}")).is_some(),
                "w{n}-{m}"
            );
        }
    }
}

#[test]
fn a_record_that_cannot_be_parsed_trusts_nothing_and_the_next_record_replaces_it() {
    let home = TempDir::new("trust-bad");
    let path = home.write(".konductor/trust.json", b"{ not json");
    let mut store = FileTrustStore::new(Some(home.path()));
    assert_eq!(store.recorded("/repo", "plan"), None);
    store.record("/repo", "plan", &hash('a')).unwrap();
    assert_eq!(store.recorded("/repo", "plan"), Some(hash('a')));
    assert!(fs::read_to_string(path).unwrap().contains("schema_version"));
}

#[test]
fn a_record_with_the_wrong_shape_or_unreadable_trusts_nothing() {
    let home = TempDir::new("trust-shape");
    let store = FileTrustStore::new(Some(home.path()));
    for text in [
        r#"{"schema_version":1,"trusted":{"/repo":{"plan":5}}}"#,
        r#"{"schema_version":1,"trusted":[]}"#,
        r#"{"trusted":{"/repo":{"plan":"x"}}}"#,
        r#"{"schema_version":2,"trusted":{"/repo":{"plan":"x"}}}"#,
        "",
    ] {
        home.write(".konductor/trust.json", text.as_bytes());
        assert_eq!(store.recorded("/repo", "plan"), None, "{text}");
    }
    // A directory where the file should be.
    fs::remove_file(home.path().join(".konductor/trust.json")).unwrap();
    home.mkdir(".konductor/trust.json");
    assert_eq!(store.recorded("/repo", "plan"), None);
}

#[test]
fn a_record_from_a_newer_konductor_is_not_replaced() {
    let home = TempDir::new("trust-newer");
    let path = home.write(
        ".konductor/trust.json",
        br#"{"schema_version":2,"trusted":{}}"#,
    );
    let mut store = FileTrustStore::new(Some(home.path()));
    assert!(store.record("/repo", "plan", &hash('a')).is_err());
    assert!(fs::read_to_string(path)
        .unwrap()
        .contains(r#""schema_version":2"#));
}

#[test]
fn revoke_removes_one_entry_and_reports_whether_there_was_one() {
    let home = TempDir::new("trust-revoke");
    let mut store = FileTrustStore::new(Some(home.path()));
    assert!(!store.revoke("/repo", "plan").unwrap());
    assert!(!home.path().join(".konductor/trust.json").exists());
    store.record("/repo", "plan", &hash('a')).unwrap();
    store.record("/repo", "keep", &hash('b')).unwrap();
    assert!(store.revoke("/repo", "plan").unwrap());
    assert_eq!(store.recorded("/repo", "plan"), None);
    assert_eq!(store.recorded("/repo", "keep"), Some(hash('b')));
    assert!(!store.revoke("/repo", "plan").unwrap());
}

#[test]
fn with_no_home_nothing_is_trusted_and_a_record_is_refused() {
    let mut store = FileTrustStore::new(None);
    assert_eq!(store.recorded("/repo", "plan"), None);
    assert!(store.record("/repo", "plan", &hash('a')).is_err());
    assert!(!store.revoke("/repo", "plan").unwrap());
}

fn names(files: &[workflow_core::trust::ConfigFile]) -> Vec<&str> {
    files.iter().map(|f| f.path.as_str()).collect()
}

#[test]
fn the_scan_finds_the_four_kinds_of_file_sorted() {
    let repo = TempDir::new("scan");
    repo.write(".claude/settings.json", b"{}");
    repo.write(".mcp.json", b"{}");
    repo.write(".kiro/agents/a.json", b"{}");
    repo.write(".claude/agents/sub/b.md", b"x");
    repo.write(".claude/settings.local.json", b"{}");
    repo.write("README.md", b"x");
    let files = scan_repo_config(repo.path(), None, &InstalledFiles::new());
    assert_eq!(
        names(&files),
        [
            ".claude/agents/sub/b.md",
            ".claude/settings.json",
            ".kiro/agents/a.json",
            ".mcp.json"
        ]
    );
    assert!(scan_repo_config(
        TempDir::new("scan-empty").path(),
        None,
        &InstalledFiles::new()
    )
    .is_empty());
}

#[test]
fn an_installed_file_is_left_out_until_it_changes() {
    let repo = TempDir::new("scan-installed");
    repo.write(".claude/agents/k-a.md", b"installed");
    repo.write(".mcp.json", b"{}");
    let installed: InstalledFiles = BTreeSet::from([(
        ".claude/agents/k-a.md".to_string(),
        sha256_hex(b"installed"),
    )]);
    assert_eq!(
        names(&scan_repo_config(repo.path(), None, &installed)),
        [".mcp.json"]
    );
    repo.write(".claude/agents/k-a.md", b"changed");
    assert_eq!(
        names(&scan_repo_config(repo.path(), None, &installed)),
        [".claude/agents/k-a.md", ".mcp.json"]
    );
}

#[test]
fn a_link_to_a_file_is_followed() {
    let repo = TempDir::new("scan-links");
    repo.write("real/settings.json", b"{}");
    repo.mkdir(".claude");
    std::os::unix::fs::symlink(
        repo.path().join("real/settings.json"),
        repo.path().join(".claude/settings.json"),
    )
    .unwrap();
    let files = scan_repo_config(repo.path(), None, &InstalledFiles::new());
    let settings = files
        .iter()
        .find(|f| f.path == ".claude/settings.json")
        .unwrap();
    assert_eq!(settings.content, ConfigContent::Bytes(b"{}".to_vec()));
}

fn unreadable_paths(files: &[workflow_core::trust::ConfigFile]) -> Vec<&str> {
    files
        .iter()
        .filter(|f| matches!(f.content, ConfigContent::Unreadable(_)))
        .map(|f| f.path.as_str())
        .collect()
}

fn scan_of(repo: &TempDir) -> Vec<workflow_core::trust::ConfigFile> {
    scan_repo_config(repo.path(), None, &InstalledFiles::new())
}

#[test]
fn a_file_that_is_too_big_or_a_linked_agent_folder_is_marked_unreadable() {
    let repo = TempDir::new("scan-odd");
    repo.write(".mcp.json", &vec![b'x'; 1024 * 1024 + 1]);
    repo.mkdir("elsewhere");
    repo.write("elsewhere/evil.md", b"one");
    repo.mkdir(".kiro");
    std::os::unix::fs::symlink(
        repo.path().join("elsewhere"),
        repo.path().join(".kiro/agents"),
    )
    .unwrap();
    let files = scan_of(&repo);
    assert_eq!(names(&files), [".kiro/agents", ".mcp.json"]);
    assert_eq!(unreadable_paths(&files), [".kiro/agents", ".mcp.json"]);
}

#[test]
fn a_folder_with_more_files_than_the_scan_reads_is_marked_and_the_other_folder_is_still_read() {
    let repo = TempDir::new("scan-cap-shared");
    for n in 0..MAX_FILES + 88 {
        repo.write(&format!(".kiro/agents/a{n:04}.json"), b"{}");
    }
    repo.write(".claude/agents/evil.md", b"one");
    let files = scan_of(&repo);
    assert_eq!(unreadable_paths(&files), [".kiro/agents"]);
    // The cap is per folder, so the file in the other folder is hashed and not hidden behind the marker.
    let evil = files
        .iter()
        .find(|f| f.path == ".claude/agents/evil.md")
        .unwrap();
    assert_eq!(evil.content, ConfigContent::Bytes(b"one".to_vec()));
    let read = files
        .iter()
        .filter(|f| f.path.starts_with(".kiro/agents/"))
        .count();
    assert_eq!(read, MAX_FILES);
}

#[test]
fn a_folder_at_the_cap_is_read_whole_and_one_over_is_marked() {
    let repo = TempDir::new("scan-cap-edge");
    for n in 0..MAX_FILES {
        repo.write(&format!(".claude/agents/a{n:04}.md"), b"x");
    }
    assert!(unreadable_paths(&scan_of(&repo)).is_empty());
    repo.write(".claude/agents/zzz.md", b"x");
    assert_eq!(unreadable_paths(&scan_of(&repo)), [".claude/agents"]);
}

#[test]
fn a_nested_folder_deeper_than_the_limit_is_marked_and_the_limit_itself_is_read() {
    let repo = TempDir::new("scan-depth");
    repo.write(".claude/agents/a/b/c/d/ok.md", b"x");
    let files = scan_of(&repo);
    assert_eq!(names(&files), [".claude/agents/a/b/c/d/ok.md"]);
    assert!(unreadable_paths(&files).is_empty());
    repo.write(".claude/agents/a/b/c/d/e/evil.md", b"x");
    let files = scan_of(&repo);
    assert_eq!(unreadable_paths(&files), [".claude/agents/a/b/c/d/e"]);
}

#[test]
fn a_linked_folder_below_an_agent_folder_is_marked() {
    let repo = TempDir::new("scan-inner-link");
    repo.mkdir("elsewhere");
    repo.write("elsewhere/evil.md", b"x");
    repo.mkdir(".claude/agents");
    std::os::unix::fs::symlink(
        repo.path().join("elsewhere"),
        repo.path().join(".claude/agents/team"),
    )
    .unwrap();
    assert_eq!(unreadable_paths(&scan_of(&repo)), [".claude/agents/team"]);
}

#[test]
fn a_name_that_is_not_utf8_is_marked_and_not_skipped() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let repo = TempDir::new("scan-non-utf8");
    repo.mkdir(".claude/agents");
    let bad = repo
        .path()
        .join(".claude/agents")
        .join(OsStr::from_bytes(b"\xff.md"));
    fs::write(bad, b"x").unwrap();
    let files = scan_of(&repo);
    assert_eq!(files.len(), 1, "{files:?}");
    assert!(matches!(&files[0].content, ConfigContent::Unreadable(why) if why.contains("UTF-8")));
}

#[test]
fn a_file_that_cannot_be_read_is_marked_not_skipped() {
    let repo = TempDir::new("scan-denied");
    let file = repo.write(".claude/agents/locked.md", b"x");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
    let files = scan_of(&repo);
    // A process that ignores file modes (root) can read it, and then it is read.
    let readable = fs::read(&file).is_ok();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    if readable {
        assert!(unreadable_paths(&files).is_empty());
    } else {
        assert_eq!(unreadable_paths(&files), [".claude/agents/locked.md"]);
    }
}

#[test]
fn a_folder_that_cannot_be_listed_is_marked_not_skipped() {
    let repo = TempDir::new("scan-nolist");
    repo.write(".kiro/agents/sub/a.json", b"{}");
    let dir = repo.path().join(".kiro/agents/sub");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
    let files = scan_of(&repo);
    let listable = fs::read_dir(&dir).is_ok();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    if !listable {
        assert_eq!(unreadable_paths(&files), [".kiro/agents/sub"]);
    }
}

#[test]
fn editing_a_file_behind_a_marker_cannot_go_unseen_because_the_marker_stays() {
    // The marker has constant text, so the scan alone does not see an edit behind it. This is why a caller must
    // refuse while any marker exists. The test pins both halves: the marker is there before and after the edit.
    let repo = TempDir::new("scan-behind");
    repo.mkdir("elsewhere");
    repo.write("elsewhere/evil.md", b"one");
    repo.mkdir(".claude");
    std::os::unix::fs::symlink(
        repo.path().join("elsewhere"),
        repo.path().join(".claude/agents"),
    )
    .unwrap();
    let before = scan_of(&repo);
    repo.write("elsewhere/evil.md", b"two");
    let after = scan_of(&repo);
    assert_eq!(before, after);
    assert_eq!(unreadable_paths(&after), [".claude/agents"]);
}

#[test]
fn folders_above_the_project_up_to_the_git_root_count() {
    let repo = TempDir::new("scan-ancestors");
    repo.mkdir(".git");
    repo.write(".mcp.json", b"{}");
    repo.write(".claude/agents/root.md", b"x");
    repo.write("pkg/app/.kiro/agents/near.json", b"{}");
    let project = repo.path().join("pkg/app");
    let files = scan_repo_config(&project, None, &InstalledFiles::new());
    let shown = names(&files);
    // Paths are relative to the git root.
    assert_eq!(
        shown,
        [
            ".claude/agents/root.md",
            ".mcp.json",
            "pkg/app/.kiro/agents/near.json"
        ]
    );
    // Above the git root nothing counts.
    let outer = TempDir::new("scan-above-root");
    outer.write(".mcp.json", b"{}");
    outer.write("repo/.git/HEAD", b"x");
    outer.write("repo/src/.keep", b"");
    assert!(
        scan_repo_config(&outer.path().join("repo/src"), None, &InstalledFiles::new()).is_empty()
    );
}

#[test]
fn with_no_git_root_only_the_project_folder_counts() {
    let outer = TempDir::new("scan-no-git");
    outer.write(".mcp.json", b"{}");
    outer.write("project/.claude/settings.json", b"{}");
    let files = scan_repo_config(&outer.path().join("project"), None, &InstalledFiles::new());
    assert_eq!(names(&files), [".claude/settings.json"]);
}

#[test]
fn a_git_root_that_is_the_home_folder_does_not_widen_the_scan() {
    let home = TempDir::new("scan-home-git");
    home.mkdir(".git");
    home.write(".claude/settings.json", b"{}");
    home.write("project/.mcp.json", b"{}");
    let files = scan_repo_config(
        &home.path().join("project"),
        Some(home.path()),
        &InstalledFiles::new(),
    );
    assert_eq!(names(&files), [".mcp.json"]);
}

#[test]
fn an_install_in_a_subfolder_is_matched_by_its_own_relative_paths() {
    let repo = TempDir::new("scan-sub-install");
    repo.mkdir(".git");
    repo.write("pkg/.claude/agents/k-a.md", b"installed");
    let installed: InstalledFiles = BTreeSet::from([(
        ".claude/agents/k-a.md".to_string(),
        sha256_hex(b"installed"),
    )]);
    let files = scan_repo_config(&repo.path().join("pkg"), None, &installed);
    assert!(files.is_empty(), "{files:?}");
}

fn catalog(project: &TempDir, home: &TempDir) -> FileAgentCatalog {
    FileAgentCatalog::new(project.path(), Some(home.path()))
}

#[test]
fn a_kiro_agent_gives_its_allow_list_and_the_project_wins_over_home() {
    let (project, home) = (TempDir::new("cat-p"), TempDir::new("cat-h"));
    home.write(
        ".kiro/agents/k-a.json",
        br#"{"name":"k-a","allowedTools":["fs_read"],"temperature":0.5}"#,
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found.len(), 1);
    assert_eq!(
        (found[0].runner, found[0].placement),
        (Runner::KiroCli, Placement::Home)
    );
    assert_eq!(found[0].tools, AgentTools::Listed(vec!["fs_read".into()]));
    project.write(
        ".kiro/agents/k-a.json",
        br#"{"allowedTools":["fs_read","shell"]}"#,
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found[0].placement, Placement::Project);
    assert_eq!(
        found[0].tools,
        AgentTools::Listed(vec!["fs_read".into(), "shell".into()])
    );
}

#[test]
fn a_kiro_file_without_an_allow_list_or_with_bad_json_is_unknown() {
    let (project, home) = (TempDir::new("cat-k1"), TempDir::new("cat-k2"));
    project.write(".kiro/agents/k-a.json", br#"{"tools":["read"]}"#);
    project.write(".kiro/agents/k-b.json", b"{");
    let c = catalog(&project, &home);
    for id in ["k-a", "k-b"] {
        assert!(
            matches!(c.definitions(id)[0].tools, AgentTools::Unknown(_)),
            "{id}"
        );
    }
}

fn claude(text: &str) -> AgentTools {
    let (project, home) = (TempDir::new("cat-c1"), TempDir::new("cat-c2"));
    project.write(".claude/agents/k-a.md", text.as_bytes());
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].runner, Runner::Claude);
    found[0].tools.clone()
}

fn listed(items: &[&str]) -> AgentTools {
    AgentTools::Listed(items.iter().map(|s| s.to_string()).collect())
}

#[test]
fn claude_tools_are_read_as_written_in_every_form() {
    assert_eq!(
        claude("---\nname: k-a\ntools: Read, Write\n---\nbody"),
        listed(&["Read", "Write"])
    );
    assert_eq!(
        claude("---\ntools: [Read, \"mcp__aws-mcp__x\"]\n---\n"),
        listed(&["Read", "mcp__aws-mcp__x"])
    );
    assert_eq!(
        claude("---\ntools:\n  - Read\n  - Bash # shell\nmodel: x\n---\n"),
        listed(&["Read", "Bash"])
    );
    assert_eq!(
        claude("---\ntools: \"Read, Grep\"\n---\n"),
        listed(&["Read", "Grep"])
    );
    assert_eq!(claude("---\ntools: []\n---\n"), listed(&[]));
}

#[test]
fn a_claude_agent_with_no_tools_key_has_every_tool_and_none_pre_approved() {
    assert_eq!(
        claude("---\nname: k-a\ndescription: tools: are nice\n---\nUse tools: Read\n"),
        AgentTools::EveryToolNonePreApproved
    );
}

#[test]
fn odd_claude_files_are_unknown_not_guessed() {
    for text in [
        "no front matter",
        "---\ntools: >\n  Read\n---\n",
        "---\ntools:\n---\n",
        "---\ntools: Read\ntools: Write\n---\n",
    ] {
        assert!(matches!(claude(text), AgentTools::Unknown(_)), "{text:?}");
    }
}

#[test]
fn both_harnesses_are_listed_and_a_missing_or_bad_id_gives_nothing() {
    let (project, home) = (TempDir::new("cat-b1"), TempDir::new("cat-b2"));
    project.write(".kiro/agents/k-a.json", br#"{"allowedTools":[]}"#);
    project.write(".claude/agents/k-a.md", b"---\nname: k-a\n---\n");
    let c = catalog(&project, &home);
    let found = c.definitions("k-a");
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].tools, AgentTools::Listed(vec![]));
    assert_eq!(found[1].tools, AgentTools::EveryToolNonePreApproved);
    assert!(c.definitions("k-missing").is_empty());
    assert!(c.definitions("../k-a").is_empty());
}

#[test]
fn keys_that_can_change_what_runs_are_named_for_both_harnesses() {
    let (project, home) = (TempDir::new("cat-x1"), TempDir::new("cat-x2"));
    project.write(
        ".kiro/agents/k-a.json",
        br#"{"allowedTools":[],"hooks":{},"mcpServers":{},"toolsSettings":{}}"#,
    );
    project.write(
        ".claude/agents/k-a.md",
        b"---\nname: k-a\npermissionMode: acceptEdits\nhooks:\n  PreToolUse: []\nmcpServers:\n  x: {}\n---\nbody\n",
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found[0].also_sets, ["hooks", "mcpServers", "toolsSettings"]);
    assert_eq!(
        found[1].also_sets,
        ["permissionMode", "hooks", "mcpServers"]
    );
    project.write(
        ".claude/agents/k-b.md",
        b"---\nname: k-b\ntools: Read\n---\nhooks: not a key\n",
    );
    let found = catalog(&project, &home).definitions("k-b");
    assert!(found[0].also_sets.is_empty());
}

#[test]
fn an_agent_in_a_folder_above_the_project_is_found_nearest_first() {
    let (repo, home) = (TempDir::new("cat-up"), TempDir::new("cat-up-h"));
    repo.write(".claude/agents/k-a.md", b"---\ntools: Read\n---\n");
    repo.write("pkg/.claude/agents/k-b.md", b"---\ntools: Bash\n---\n");
    repo.write(".claude/agents/k-b.md", b"---\ntools: Read\n---\n");
    let project = repo.path().join("pkg");
    let above = vec![repo.path().to_path_buf()];
    let c = FileAgentCatalog::new(&project, Some(home.path())).with_folders_above(&above);
    assert_eq!(c.definitions("k-a")[0].tools, listed(&["Read"]));
    assert_eq!(c.definitions("k-b")[0].tools, listed(&["Bash"]));
}

#[test]
fn a_store_with_no_home_says_so_before_anything_is_asked() {
    assert!(FileTrustStore::new(None).can_record().is_err());
    assert!(FileTrustStore::new(Some(TempDir::new("can").path()))
        .can_record()
        .is_ok());
}
