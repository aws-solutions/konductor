// SPDX-License-Identifier: Apache-2.0
//! The trust record, the repo tool configuration scan and the agent catalog, through the real file system.

#![cfg(unix)]

mod common;

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::thread;

use common::TempDir;
use workflow_adapters::repo_config::{MAX_ENTRIES, MAX_TOTAL_BYTES};
use workflow_adapters::{scan_repo_config, FileAgentCatalog, FileTrustStore, InstalledFiles};
use workflow_core::ports::{AgentCatalog, AgentTools, Placement, Runner, TrustStore};
use workflow_core::trust::{sha256_hex, ConfigFile, TrustInputs, UnreadableConfig};

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
fn a_record_that_cannot_be_parsed_trusts_nothing_and_is_not_replaced() {
    let home = TempDir::new("trust-bad");
    let path = home.write(".konductor/trust.json", b"{ not json");
    let mut store = FileTrustStore::new(Some(home.path()));
    assert_eq!(store.recorded("/repo", "plan"), None);
    let error = store.record("/repo", "plan", &hash('a')).unwrap_err();
    assert!(error.0.contains("trust.json"), "{}", error.0);
    assert!(error.0.contains("Move it aside"), "{}", error.0);
    assert_eq!(fs::read(&path).unwrap(), b"{ not json");
    // Revoking is refused the same way, and not reported as "nothing to remove".
    assert!(store.revoke("/repo", "plan").is_err());
    assert_eq!(fs::read(&path).unwrap(), b"{ not json");
}

#[test]
fn a_malformed_entry_trusts_nothing_and_hides_no_other_entry() {
    let home = TempDir::new("trust-entry");
    let good = hash('a');
    let path = home.write(
        ".konductor/trust.json",
        format!(
            r#"{{"schema_version":1,"trusted":{{"/bad":{{"plan":5}},"/worse":[],"/repo":{{"plan":"{good}","odd":7}}}}}}"#
        )
        .as_bytes(),
    );
    let mut store = FileTrustStore::new(Some(home.path()));
    assert_eq!(store.recorded("/repo", "plan"), Some(good.clone()));
    assert_eq!(store.recorded("/bad", "plan"), None);
    assert_eq!(store.recorded("/worse", "plan"), None);
    assert_eq!(store.recorded("/repo", "odd"), None);
    // A change keeps every entry it does not touch, the malformed ones too.
    store.record("/other", "plan", &hash('b')).unwrap();
    store.record("/bad", "fresh", &hash('c')).unwrap();
    let text = fs::read_to_string(path).unwrap();
    assert!(text.contains(r#""odd": 7"#), "{text}");
    assert!(text.contains(r#""/worse": []"#), "{text}");
    assert_eq!(store.recorded("/repo", "plan"), Some(good));
    assert_eq!(store.recorded("/other", "plan"), Some(hash('b')));
    assert_eq!(store.recorded("/bad", "fresh"), Some(hash('c')));
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
fn revoke_on_a_record_from_a_newer_konductor_is_an_error_like_record() {
    let home = TempDir::new("trust-newer-revoke");
    let text = br#"{"schema_version":2,"trusted":{"/repo":{"plan":"x"}}}"#;
    let path = home.write(".konductor/trust.json", text);
    let mut store = FileTrustStore::new(Some(home.path()));
    assert!(store.revoke("/repo", "plan").is_err());
    assert!(store.record("/repo", "plan", &hash('a')).is_err());
    assert_eq!(fs::read(path).unwrap(), text);
}

#[test]
fn with_no_absolute_home_neither_record_nor_revoke_can_keep_the_record() {
    for home in [None, Some(std::path::Path::new("relative"))] {
        let mut store = FileTrustStore::new(home);
        let recorded = store.record("/repo", "plan", &hash('a')).unwrap_err();
        let revoked = store.revoke("/repo", "plan").unwrap_err();
        assert_eq!(recorded, revoked);
        assert!(
            recorded.0.contains("~/.konductor/trust.json"),
            "{recorded:?}"
        );
        assert!(store.can_record().is_err());
    }
}

#[test]
fn a_file_error_on_the_record_is_an_error_for_record_and_revoke_and_names_the_path() {
    let home = TempDir::new("trust-file-error");
    // A folder where the file should be: it cannot be read, so it cannot be changed either.
    home.mkdir(".konductor/trust.json");
    let mut store = FileTrustStore::new(Some(home.path()));
    for error in [
        store.record("/repo", "plan", &hash('a')).unwrap_err(),
        store.revoke("/repo", "plan").unwrap_err(),
    ] {
        assert!(error.0.contains("trust.json"), "{error:?}");
    }
    assert!(home.path().join(".konductor/trust.json").is_dir());
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
    // There is no record to change, so `--revoke` is an error as `record` is, and not a quiet "nothing removed".
    assert!(store.revoke("/repo", "plan").is_err());
}

#[test]
fn a_home_that_is_not_an_absolute_path_is_no_home_and_nothing_is_written() {
    let cwd = TempDir::new("trust-relative");
    let before: Vec<_> = fs::read_dir(cwd.path()).unwrap().collect();
    assert!(before.is_empty());
    let relative = std::path::Path::new("relative-home");
    let mut store = FileTrustStore::new(Some(relative));
    assert!(store.path().is_none());
    assert!(store.can_record().is_err());
    let error = store.record("/repo", "plan", &hash('a')).unwrap_err();
    assert!(error.0.contains("absolute"), "{}", error.0);
    assert_eq!(store.recorded("/repo", "plan"), None);
    assert!(!relative.exists());
    assert!(FileTrustStore::new(Some(std::path::Path::new(".")))
        .path()
        .is_none());
}

#[test]
fn the_folder_the_record_is_made_in_has_mode_0700() {
    let home = TempDir::new("trust-dir-mode");
    let mut store = FileTrustStore::new(Some(home.path()));
    store.record("/repo", "plan", &hash('a')).unwrap();
    let mode = fs::metadata(home.path().join(".konductor"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o700);
}

/// The scan of a repo that has nothing the scan cannot read.
fn scan_ok(
    project_root: &std::path::Path,
    home: Option<&std::path::Path>,
    installed: &InstalledFiles,
) -> Vec<ConfigFile> {
    scan_repo_config(project_root, home, project_root, installed)
        .unwrap_or_else(|unreadable| panic!("the scan refused: {unreadable:?}"))
}

fn names(files: &[ConfigFile]) -> Vec<&str> {
    files.iter().map(|f| f.path.as_str()).collect()
}

#[test]
fn the_scan_finds_every_kind_of_file_sorted() {
    let repo = TempDir::new("scan");
    repo.write(".claude/settings.json", b"{}");
    repo.write(".mcp.json", b"{}");
    repo.write(".kiro/agents/a.json", b"{}");
    repo.write(".claude/agents/sub/b.md", b"x");
    repo.write(".claude/settings.local.json", b"{}");
    repo.write(".kiro/settings/mcp.json", b"{}");
    repo.write(".claude/commands/c.md", b"x");
    repo.write(".claude/hooks/pre.sh", b"x");
    repo.write(".claude/skills/s/SKILL.md", b"x");
    // Text for the model, and state, are not tool configuration.
    repo.write("README.md", b"x");
    repo.write("CLAUDE.md", b"x");
    repo.write(".claude/worktrees/w/src/main.rs", b"x");
    repo.write(".kiro/steering/rules.md", b"x");
    repo.write(".kiro/settings/cli.json", b"{}");
    let files = scan_ok(repo.path(), None, &InstalledFiles::new());
    assert_eq!(
        names(&files),
        [
            ".claude/agents/sub/b.md",
            ".claude/commands/c.md",
            ".claude/hooks/pre.sh",
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".claude/skills/s/SKILL.md",
            ".kiro/agents/a.json",
            ".kiro/settings/mcp.json",
            ".mcp.json"
        ]
    );
    assert!(scan_ok(
        TempDir::new("scan-empty").path(),
        None,
        &InstalledFiles::new()
    )
    .is_empty());
}

/// The trust hash of a fixed workflow and what the scan found.
fn hash_of_scan(repo: &TempDir) -> String {
    let inputs = TrustInputs::new(b"workflow".to_vec(), Default::default());
    inputs.hash(&scan_ok(repo.path(), None, &InstalledFiles::new()))
}

#[test]
fn a_new_file_or_an_edit_behind_each_covered_path_changes_the_hash() {
    let paths = [
        ".claude/settings.json",
        ".claude/settings.local.json",
        ".mcp.json",
        ".kiro/settings/mcp.json",
        ".kiro/agents/a.json",
        ".claude/agents/a.md",
        ".claude/commands/deploy.md",
        ".claude/skills/review/SKILL.md",
        ".claude/skills/review/scripts/run.sh",
        ".claude/hooks/pre-tool.sh",
    ];
    for path in paths {
        let repo = TempDir::new("scan-hash");
        let none = hash_of_scan(&repo);
        repo.write(path, b"one");
        let one = hash_of_scan(&repo);
        assert_ne!(none, one, "adding {path}");
        repo.write(path, b"two");
        assert_ne!(one, hash_of_scan(&repo), "editing {path}");
    }
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
        names(&scan_ok(repo.path(), None, &installed)),
        [".mcp.json"]
    );
    repo.write(".claude/agents/k-a.md", b"changed");
    assert_eq!(
        names(&scan_ok(repo.path(), None, &installed)),
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
    let files = scan_ok(repo.path(), None, &InstalledFiles::new());
    let settings = files
        .iter()
        .find(|f| f.path == ".claude/settings.json")
        .unwrap();
    assert_eq!(settings.bytes, b"{}".to_vec());
}

/// The scan of `repo`, as it is: the files, or every entry that makes the run refuse.
fn scan_of(repo: &TempDir) -> Result<Vec<ConfigFile>, Vec<UnreadableConfig>> {
    scan_repo_config(repo.path(), None, repo.path(), &InstalledFiles::new())
}

/// The paths the scan could not read, empty when it read everything.
fn refused(scan: &Result<Vec<ConfigFile>, Vec<UnreadableConfig>>) -> Vec<&str> {
    match scan {
        Ok(_) => Vec::new(),
        Err(unreadable) => unreadable.iter().map(|u| u.path.as_str()).collect(),
    }
}

#[test]
fn a_file_that_is_too_big_or_a_linked_agent_folder_is_refused_and_gives_no_files() {
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
    let scan = scan_of(&repo);
    assert_eq!(refused(&scan), [".kiro/agents", ".mcp.json"]);
    let reasons: Vec<&str> = scan
        .as_ref()
        .unwrap_err()
        .iter()
        .map(|u| u.reason.as_str())
        .collect();
    assert_eq!(
        reasons,
        [
            "is a link to a folder, which is not followed",
            "is over 1 MiB, the largest file the scan reads"
        ]
    );
}

#[test]
fn a_file_of_exactly_1_mib_is_read_and_one_byte_more_is_refused() {
    let repo = TempDir::new("scan-size-edge");
    repo.write(".mcp.json", &vec![b'x'; 1024 * 1024]);
    let files = scan_of(&repo).expect("a file of 1 MiB is read");
    assert_eq!(files[0].bytes.len(), 1024 * 1024);
    repo.write(".mcp.json", &vec![b'x'; 1024 * 1024 + 1]);
    assert_eq!(refused(&scan_of(&repo)), [".mcp.json"]);
}

#[test]
fn a_link_to_a_file_is_followed_and_a_link_to_a_folder_is_refused() {
    let repo = TempDir::new("scan-link-kinds");
    repo.write("real/settings.json", b"{}");
    repo.mkdir(".claude");
    std::os::unix::fs::symlink(
        repo.path().join("real/settings.json"),
        repo.path().join(".claude/settings.json"),
    )
    .unwrap();
    assert!(scan_of(&repo).is_ok());
    repo.mkdir("elsewhere");
    std::os::unix::fs::symlink(
        repo.path().join("elsewhere"),
        repo.path().join(".claude/commands"),
    )
    .unwrap();
    assert_eq!(refused(&scan_of(&repo)), [".claude/commands"]);
}

#[test]
fn every_folder_over_the_limits_is_listed_and_no_file_is_returned() {
    let repo = TempDir::new("scan-cap-shared");
    for n in 0..MAX_ENTRIES + 88 {
        repo.write(&format!(".kiro/agents/a{n:04}.json"), b"{}");
    }
    repo.write(".claude/agents/evil.md", b"one");
    // The cap is per listed folder, so the other folder is read, and a scan that refuses returns no file at all.
    assert_eq!(refused(&scan_of(&repo)), [".kiro/agents"]);
    for n in 0..MAX_ENTRIES + 1 {
        repo.write(&format!(".claude/hooks/h{n:04}"), b"x");
    }
    assert_eq!(refused(&scan_of(&repo)), [".claude/hooks", ".kiro/agents"]);
}

#[test]
fn folders_count_against_the_cap_as_files_do() {
    let repo = TempDir::new("scan-cap-dirs");
    for n in 0..MAX_ENTRIES {
        repo.mkdir(&format!(".claude/skills/d{n:04}"));
    }
    assert!(refused(&scan_of(&repo)).is_empty());
    repo.mkdir(".claude/skills/zzz");
    assert_eq!(refused(&scan_of(&repo)), [".claude/skills"]);
    // Folders and files add up: half and half is at the cap, one more is over it.
    let mixed = TempDir::new("scan-cap-mixed");
    for n in 0..MAX_ENTRIES / 2 {
        mixed.mkdir(&format!(".claude/hooks/d{n:04}"));
        mixed.write(&format!(".claude/hooks/f{n:04}"), b"x");
    }
    assert!(refused(&scan_of(&mixed)).is_empty());
    mixed.write(".claude/hooks/one-more", b"x");
    assert_eq!(refused(&scan_of(&mixed)), [".claude/hooks"]);
}

#[test]
fn a_nested_folder_that_goes_over_the_cap_is_the_one_refused() {
    let repo = TempDir::new("scan-cap-nested");
    for n in 0..MAX_ENTRIES {
        repo.write(&format!(".claude/commands/sub/f{n:04}.md"), b"x");
    }
    assert_eq!(refused(&scan_of(&repo)), [".claude/commands/sub"]);
}

#[test]
fn a_folder_at_the_cap_is_read_whole_and_one_over_is_refused() {
    let repo = TempDir::new("scan-cap-edge");
    for n in 0..MAX_ENTRIES {
        repo.write(&format!(".claude/agents/a{n:04}.md"), b"x");
    }
    assert_eq!(scan_of(&repo).expect("at the cap").len(), MAX_ENTRIES);
    repo.write(".claude/agents/zzz.md", b"x");
    assert_eq!(refused(&scan_of(&repo)), [".claude/agents"]);
}

#[test]
fn a_nested_folder_deeper_than_the_limit_is_refused_and_the_limit_itself_is_read() {
    let repo = TempDir::new("scan-depth");
    repo.write(".claude/agents/a/b/c/d/ok.md", b"x");
    let files = scan_of(&repo).expect("depth 4 is read");
    assert_eq!(names(&files), [".claude/agents/a/b/c/d/ok.md"]);
    repo.write(".claude/agents/a/b/c/d/e/evil.md", b"x");
    assert_eq!(refused(&scan_of(&repo)), [".claude/agents/a/b/c/d/e"]);
}

#[test]
fn a_linked_folder_below_an_agent_folder_is_refused() {
    let repo = TempDir::new("scan-inner-link");
    repo.mkdir("elsewhere");
    repo.write("elsewhere/evil.md", b"x");
    repo.mkdir(".claude/agents");
    std::os::unix::fs::symlink(
        repo.path().join("elsewhere"),
        repo.path().join(".claude/agents/team"),
    )
    .unwrap();
    assert_eq!(refused(&scan_of(&repo)), [".claude/agents/team"]);
}

#[test]
fn a_name_that_is_not_utf8_is_refused_and_not_skipped() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;
    let repo = TempDir::new("scan-non-utf8");
    repo.mkdir(".claude/agents");
    let bad = repo
        .path()
        .join(".claude/agents")
        .join(OsStr::from_bytes(b"\xff.md"));
    fs::write(bad, b"x").unwrap();
    let unreadable = scan_of(&repo).unwrap_err();
    assert_eq!(unreadable.len(), 1, "{unreadable:?}");
    assert!(unreadable[0].reason.contains("UTF-8"), "{unreadable:?}");
}

#[test]
fn a_file_that_cannot_be_read_is_refused_not_skipped() {
    let repo = TempDir::new("scan-denied");
    let file = repo.write(".claude/agents/locked.md", b"x");
    fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
    let scan = scan_of(&repo);
    // A process that ignores file modes (root) can read it, and then it is read.
    let readable = fs::read(&file).is_ok();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    if readable {
        assert!(scan.is_ok());
    } else {
        assert_eq!(refused(&scan), [".claude/agents/locked.md"]);
    }
}

#[test]
fn a_folder_that_cannot_be_listed_is_refused_not_skipped() {
    let repo = TempDir::new("scan-nolist");
    repo.write(".kiro/agents/sub/a.json", b"{}");
    let dir = repo.path().join(".kiro/agents/sub");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
    let scan = scan_of(&repo);
    let listable = fs::read_dir(&dir).is_ok();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    if !listable {
        assert_eq!(refused(&scan), [".kiro/agents/sub"]);
    }
}

#[test]
fn editing_a_file_behind_a_refused_entry_cannot_produce_a_hash() {
    // An edit behind a link does not change what the scan reports, so no hash could show it. The scan therefore gives
    // no files at all while the entry is there, before and after the edit.
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
    assert_eq!(refused(&after), [".claude/agents"]);
    assert!(after.is_err());
}

#[test]
fn folders_above_the_project_up_to_the_git_root_count() {
    let repo = TempDir::new("scan-ancestors");
    repo.mkdir(".git");
    repo.write(".mcp.json", b"{}");
    repo.write(".claude/agents/root.md", b"x");
    repo.write("pkg/app/.kiro/agents/near.json", b"{}");
    let project = repo.path().join("pkg/app");
    let files = scan_ok(&project, None, &InstalledFiles::new());
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
    assert!(scan_ok(&outer.path().join("repo/src"), None, &InstalledFiles::new()).is_empty());
}

#[test]
fn with_no_git_root_only_the_project_folder_counts() {
    let outer = TempDir::new("scan-no-git");
    outer.write(".mcp.json", b"{}");
    outer.write("project/.claude/settings.json", b"{}");
    let files = scan_ok(&outer.path().join("project"), None, &InstalledFiles::new());
    assert_eq!(names(&files), [".claude/settings.json"]);
}

#[test]
fn a_git_root_that_is_the_home_folder_does_not_widen_the_scan() {
    let home = TempDir::new("scan-home-git");
    home.mkdir(".git");
    home.write(".claude/settings.json", b"{}");
    home.write("project/.mcp.json", b"{}");
    let files = scan_ok(
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
    let files = scan_ok(&repo.path().join("pkg"), None, &installed);
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
        br#"{"name":"k-a","allowedTools":["fs_read","shell"]}"#,
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
    project.write(
        ".kiro/agents/k-a.json",
        br#"{"name":"k-a","tools":["read"]}"#,
    );
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
        claude("---\nname: k-a\ntools: [Read, mcp__aws-mcp__x]\n---\n"),
        listed(&["Read", "mcp__aws-mcp__x"])
    );
    assert_eq!(
        claude("---\nname: k-a\ntools:\n  - Read\n  - Bash # shell\nmodel: x\n---\n"),
        listed(&["Read", "Bash"])
    );
    assert_eq!(
        claude("---\nname: k-a\ntools: \"Read, Grep\"\n---\n"),
        listed(&["Read", "Grep"])
    );
    assert_eq!(claude("---\nname: k-a\ntools: []\n---\n"), listed(&[]));
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
        "---\nname: k-a\ntools: >\n  Read\n---\n",
        "---\nname: k-a\ntools:\n  Read\n---\n",
        "---\nname: k-a\ntools: Read\ntools: Write\n---\n",
    ] {
        assert!(matches!(claude(text), AgentTools::Unknown(_)), "{text:?}");
    }
}

#[test]
fn a_front_matter_line_that_is_not_a_plain_key_makes_the_whole_file_unknown() {
    // Each of these can set a key this build would not see by a line prefix, so none may read as "every tool, none
    // pre-approved" or as a short list. Each file declares `k-a` by its plain `name` key.
    for text in [
        "---\nname: k-a\n\"permissionMode\": bypassPermissions\n---\n",
        "---\nname: k-a\n'permissionMode': bypassPermissions\n---\n",
        "---\nname: k-a\ntools : Read\n---\n",
        "---\nname: k-a\ntools :Read\n---\n",
        "---\nname: k-a\n? tools\n: Read\n---\n",
        "---\nname: k-a\n{tools: Bash, permissionMode: bypassPermissions}\n---\n",
        "---\nname: k-a\ntools: Read\n\"hooks\": {}\n---\n",
        "---\nname: k-a\ntools:Read\n---\n",
        "---\nname: k-a\nname k-a\n---\n",
        // A column-0 list item is read only right after an empty `tools:`, never after another key or a value.
        "---\nname: k-a\nhooks:\n- Read\n---\n",
        "---\nname: k-a\ndescription:\n- Read\n---\n",
        "---\nname: k-a\ntools: Read\n- Bash\n---\n",
        "---\nname: k-a\ntools:\n  - Read\n- Bash\n---\n",
        "---\nname: k-a\ntools:\nmodel: x\n- Bash\n---\n",
        "---\nname: k-a\ntools:\n-Read\n---\n",
    ] {
        let (project, home) = (TempDir::new("cat-odd1"), TempDir::new("cat-odd2"));
        project.write(".claude/agents/k-a.md", text.as_bytes());
        let found = catalog(&project, &home).definitions("k-a");
        assert!(
            matches!(&found[0].tools, AgentTools::Unknown(why) if why.contains("cannot read")),
            "{text:?}: {:?}",
            found[0].tools
        );
    }
}

#[test]
fn plain_keys_with_indented_values_comments_and_blank_lines_still_read() {
    assert_eq!(
        claude("---\n# a comment\nname: k-a\n\ndescription: >\n  tools: not a key\n  more\ntools: Read\n---\n"),
        listed(&["Read"])
    );
}

#[test]
fn both_harnesses_are_listed_and_a_missing_or_bad_id_gives_nothing() {
    let (project, home) = (TempDir::new("cat-b1"), TempDir::new("cat-b2"));
    project.write(
        ".kiro/agents/k-a.json",
        br#"{"name":"k-a","allowedTools":[]}"#,
    );
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
        br#"{"name":"k-a","allowedTools":[],"hooks":{},"mcpServers":{},"toolsSettings":{}}"#,
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
    repo.write(
        ".claude/agents/k-a.md",
        b"---\nname: k-a\ntools: Read\n---\n",
    );
    repo.write(
        "pkg/.claude/agents/k-b.md",
        b"---\nname: k-b\ntools: Bash\n---\n",
    );
    repo.write(
        ".claude/agents/k-b.md",
        b"---\nname: k-b\ntools: Read\n---\n",
    );
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

fn claude_files(files: &[(&str, &str)]) -> Vec<workflow_core::ports::AgentDefinition> {
    claude_files_for("k-a", files)
}

fn claude_files_for(
    id: &str,
    files: &[(&str, &str)],
) -> Vec<workflow_core::ports::AgentDefinition> {
    let (project, home) = (TempDir::new("cat-n1"), TempDir::new("cat-n2"));
    for (path, text) in files {
        project.write(path, text.as_bytes());
    }
    catalog(&project, &home).definitions(id)
}

#[test]
fn a_claude_agent_is_found_by_its_exact_name_in_a_subfolder_and_the_file_is_named() {
    let found = claude_files(&[(
        ".claude/agents/team/k-a.md",
        "---\nname: k-a\ntools: Read\n---\n",
    )]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].tools, listed(&["Read"]));
    assert_eq!(found[0].file, ".claude/agents/team/k-a.md");
    assert!(!found[0].ambiguous);
}

#[test]
fn a_file_that_is_not_an_agent_of_the_id_is_not_found() {
    for (path, text) in [
        // no name
        (
            ".claude/agents/k-a.md",
            "---\ndescription: x\ntools: Read\n---\n",
        ),
        // no front matter
        (".claude/agents/k-a.md", "no front matter"),
        // not markdown
        (".claude/agents/k-a.txt", "---\nname: k-a\n---\n"),
        // case is not folded
        (".claude/agents/k-a.md", "---\nname: K-A\n---\n"),
        // outside .claude/agents
        (".claude/k-a.md", "---\nname: k-a\n---\n"),
        // a name with a space in it, and a quoted name with a leading space, are other agents
        (".claude/agents/k-a.md", "---\nname: k-a b\n---\n"),
        (".claude/agents/k-a.md", "---\nname: \" k-a\"\n---\n"),
    ] {
        assert!(claude_files(&[(path, text)]).is_empty(), "{path} {text:?}");
    }
}

#[test]
fn two_files_with_the_name_or_a_stem_that_differs_make_the_agent_unknown_and_ambiguous() {
    let two = claude_files(&[
        (
            ".claude/agents/k-a.md",
            "---\nname: k-a\ntools: Read\n---\n",
        ),
        (
            ".claude/agents/sub/other.md",
            "---\nname: k-a\ntools: Bash\n---\n",
        ),
    ]);
    assert_eq!(two.len(), 1);
    assert!(two[0].ambiguous);
    assert!(
        matches!(&two[0].tools, AgentTools::Unknown(why) if why.contains("more than one file"))
    );
    let stem = claude_files(&[(
        ".claude/agents/other.md",
        "---\nname: k-a\ntools: Read\n---\n",
    )]);
    assert!(stem[0].ambiguous);
    assert!(matches!(&stem[0].tools, AgentTools::Unknown(why) if why.contains("file name is not")));
}

#[test]
fn an_unrelated_file_whose_name_differs_from_its_stem_blocks_nothing() {
    let found = claude_files(&[
        (
            ".claude/agents/k-a.md",
            "---\nname: k-a\ntools: Read\n---\n",
        ),
        (
            ".claude/agents/misnamed.md",
            "---\nname: k-z\ntools: Bash\n---\n",
        ),
        (".claude/agents/odd.md", "---\n\"x\": 1\n---\n"),
    ]);
    assert_eq!(found.len(), 1);
    assert!(!found[0].ambiguous);
    assert_eq!(found[0].tools, listed(&["Read"]));
}

#[test]
fn the_nearest_folder_with_the_name_wins_over_a_farther_one_without_a_clash() {
    let (repo, home) = (TempDir::new("cat-lv"), TempDir::new("cat-lv-h"));
    repo.write(
        ".claude/agents/k-a.md",
        b"---\nname: k-a\ntools: Read\n---\n",
    );
    repo.write(
        "pkg/.claude/agents/k-a.md",
        b"---\nname: k-a\ntools: Bash\n---\n",
    );
    home.write(
        ".claude/agents/k-a.md",
        b"---\nname: k-a\ntools: Grep\n---\n",
    );
    let c = FileAgentCatalog::new(&repo.path().join("pkg"), Some(home.path()))
        .with_folders_above(&[repo.path().to_path_buf()]);
    let found = c.definitions("k-a");
    assert_eq!(found[0].tools, listed(&["Bash"]));
    assert!(!found[0].ambiguous);
    let empty = TempDir::new("cat-lv2");
    let home_only = FileAgentCatalog::new(empty.path(), Some(home.path()));
    let found = home_only.definitions("k-a");
    assert_eq!(found[0].placement, Placement::Home);
    assert_eq!(found[0].file, "~/.claude/agents/k-a.md");
}

#[test]
fn a_kiro_file_in_the_project_wins_over_the_home_folder_and_both_files_are_named() {
    let (project, home) = (TempDir::new("cat-kw1"), TempDir::new("cat-kw2"));
    home.write(
        ".kiro/agents/k-a.json",
        br#"{"name":"k-a","allowedTools":["shell"]}"#,
    );
    assert_eq!(
        catalog(&project, &home).definitions("k-a")[0].file,
        "~/.kiro/agents/k-a.json"
    );
    project.write(
        ".kiro/agents/k-a.json",
        br#"{"name":"k-a","allowedTools":["fs_read"]}"#,
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found[0].tools, listed(&["fs_read"]));
    assert_eq!(found[0].file, ".kiro/agents/k-a.json");
}

#[test]
fn a_kiro_file_that_is_not_utf8_is_unreadable_and_does_not_fall_through_to_home() {
    let (project, home) = (TempDir::new("cat-ku1"), TempDir::new("cat-ku2"));
    home.write(".kiro/agents/k-a.json", br#"{"allowedTools":["shell"]}"#);
    // The byte sits inside a string, so a lossy read would parse the file and show its `allowedTools`.
    project.write(
        ".kiro/agents/k-a.json",
        b"{\"description\":\"\xff\",\"allowedTools\":[\"fs_read\"]}",
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found.len(), 1);
    assert!(
        matches!(found[0].tools, AgentTools::Unknown(_)),
        "{:?}",
        found[0].tools
    );
    assert_eq!(found[0].file, ".kiro/agents/k-a.json");
    assert_eq!(found[0].placement, Placement::Project);
}

#[test]
fn an_empty_tools_list_pre_approves_nothing_in_every_form() {
    for text in [
        "---\nname: k-a\ntools:\n---\n",
        "---\nname: k-a\ntools: []\n---\n",
        "---\nname: k-a\ntools:\nmodel: x\n---\n",
    ] {
        assert_eq!(claude(text), listed(&[]), "{text:?}");
    }
}

#[test]
fn a_scoped_rule_with_a_space_or_a_quoted_item_in_a_list_makes_the_whole_list_unknown() {
    for text in [
        "---\nname: k-a\ntools: Read, Bash(git status)\n---\n",
        "---\nname: k-a\ntools: [Read, Bash(git status)]\n---\n",
        "---\nname: k-a\ntools:\n  - Read\n  - Bash(git status)\n---\n",
        "---\nname: k-a\ntools: [Read, \"Grep\"]\n---\n",
        "---\nname: k-a\ntools: [Read, 'Grep']\n---\n",
        "---\nname: k-a\ntools: [Agent(a, b), Read]\n---\n",
        "---\nname: k-a\ntools: Read, Bash(git\n---\n",
        "---\nname: k-a\ntools: Read, Bash)\n---\n",
    ] {
        assert!(
            matches!(claude(text), AgentTools::Unknown(_)),
            "{text:?}: {:?}",
            claude(text)
        );
    }
    assert_eq!(
        claude("---\nname: k-a\ntools: Agent(a, b), Read, mcp__x__*\n---\n"),
        listed(&["Agent(a, b)", "Read", "mcp__x__*"])
    );
}

#[test]
fn the_keys_an_agent_sets_are_named_and_never_their_values() {
    let found = claude_files(&[(
        ".claude/agents/team/k-a.md",
        "---\nname: k-a\npermissionMode: bypassPermissions\nhooks:\n  PreToolUse: danger\n---\n",
    )]);
    assert_eq!(found[0].also_sets, ["permissionMode", "hooks"]);
    let all = format!("{:?}", found[0]);
    assert!(!all.contains("bypassPermissions") && !all.contains("danger"));
}

#[test]
fn a_scan_from_a_subfolder_covers_it_and_leaves_out_installed_files_only_at_the_install_root() {
    let repo = TempDir::new("scan-from-sub");
    repo.mkdir(".git");
    repo.write(".konductor/manifest", b"x");
    repo.write(".claude/agents/k-a.md", b"installed");
    repo.write("svc/.claude/settings.json", b"{}");
    repo.write("svc/.claude/agents/k-a.md", b"installed");
    let installed: InstalledFiles = BTreeSet::from([(
        ".claude/agents/k-a.md".to_string(),
        sha256_hex(b"installed"),
    )]);
    let svc = repo.path().join("svc");
    let files = scan_repo_config(&svc, None, repo.path(), &installed).expect("readable");
    // The folder between the working folder and the install root counts, and its copy of the installed file counts.
    assert_eq!(
        names(&files),
        ["svc/.claude/agents/k-a.md", "svc/.claude/settings.json"]
    );
}

#[test]
fn a_block_list_with_a_blank_or_comment_line_is_read_whole_and_other_text_in_it_is_unknown() {
    assert_eq!(
        claude("---\nname: k-a\ntools:\n  - Read\n\n  # more\n  - Bash\n---\n"),
        listed(&["Read", "Bash"])
    );
    for text in [
        "---\nname: k-a\ntools:\n  - Read\n  Bash\n---\n",
        "---\nname: k-a\ntools:\n  - Read\n  -Bash\n---\n",
    ] {
        assert!(matches!(claude(text), AgentTools::Unknown(_)), "{text:?}");
    }
}

#[test]
fn a_block_list_with_its_items_in_column_0_is_read_like_an_indented_one() {
    assert_eq!(
        claude("---\nname: k-a\ntools:\n- Read\n- Bash\n---\n"),
        listed(&["Read", "Bash"])
    );
    assert_eq!(
        claude("---\nname: k-a\ntools: # all\n- Read\n\n# more\n- Bash # shell\n---\n"),
        listed(&["Read", "Bash"])
    );
    // The first other column-0 line is a new key and ends the list. Its keys are still seen.
    assert_eq!(
        claude("---\nname: k-a\ntools:\n- Read\n- Bash\nmodel: x\n---\n"),
        listed(&["Read", "Bash"])
    );
    let found = claude_files(&[(
        ".claude/agents/k-a.md",
        "---\nname: k-a\ntools:\n- Read\nhooks:\n  PreToolUse: []\n---\n",
    )]);
    assert_eq!(found[0].tools, listed(&["Read"]));
    assert_eq!(found[0].also_sets, ["hooks"]);
    // Indented items are read as before.
    assert_eq!(
        claude("---\nname: k-a\ntools:\n  - Read\n  - Bash\nmodel: x\n---\n"),
        listed(&["Read", "Bash"])
    );
    // A list that is empty stays empty, and the next key is not an item.
    assert_eq!(
        claude("---\nname: k-a\ntools:\nmodel: x\n---\n"),
        listed(&[])
    );
}

/// The front matter of an installed Claude agent: a long description, then `tools`, `skills` and `mcpServers` as block
/// lists with their items in column 0, and `Agent(a, b)` as a block list item.
const INSTALLED_AGENT: &str = "---\nname: k-a\n\
description: Solutions Architect agent for Design & Architecture. Creates system designs, API specs, data models, and \
threat models. Validates each artifact before handoff to implementation.\n\
model: claude-sonnet-5-5\n\
tools:\n- Read\n- Write\n- Edit\n- Bash\n- Glob\n- Grep\n- WebFetch\n- WebSearch\n- TodoWrite\n- Skill\n\
- mcp__aws-mcp__*\n- Agent(k-developer, k-quality-assurance)\n\
skills:\n- constraints\n- sdlc-navigator\n- verification\n\
mcpServers:\n- aws-mcp:\n    command: uvx\n    args:\n    - mcp-proxy-for-aws-cli==1.7.0\n    - --metadata\n\
    - AWS_REGION=us-east-1\n---\n\n# Body\n";

#[test]
fn an_installed_claude_agent_with_column_0_tools_skills_and_mcp_server_lists_is_read() {
    let found = claude_files(&[(".claude/agents/k-a.md", INSTALLED_AGENT)]);
    assert_eq!(
        found[0].tools,
        listed(&[
            "Read",
            "Write",
            "Edit",
            "Bash",
            "Glob",
            "Grep",
            "WebFetch",
            "WebSearch",
            "TodoWrite",
            "Skill",
            "mcp__aws-mcp__*",
            "Agent(k-developer, k-quality-assurance)",
        ])
    );
    // The MCP servers an agent starts are named, as they were for the indented form.
    assert_eq!(found[0].also_sets, ["mcpServers"]);
    assert!(!found[0].ambiguous);
}

#[test]
fn column_0_lists_of_skills_and_mcp_servers_are_read_and_nothing_else_is_loosened() {
    assert_eq!(
        claude("---\nname: k-a\nskills:\n- a\n- b\ntools: Read\n---\n"),
        listed(&["Read"])
    );
    assert_eq!(
        claude("---\nname: k-a\nmcpServers:\n- x:\n    c: 1\n- y:\n    c: 2\ntools: Read\n---\n"),
        listed(&["Read"])
    );
    // The permission and hook keys inside a column-0 MCP list are not top-level keys, and a real one after it is seen.
    let found = claude_files(&[(
        ".claude/agents/k-a.md",
        "---\nname: k-a\nskills:\n- a\nmcpServers:\n- x:\n    permissionMode: y\nhooks:\n  Pre: []\ntools: Read\n---\n",
    )]);
    assert_eq!(found[0].tools, listed(&["Read"]));
    assert_eq!(found[0].also_sets, ["hooks", "mcpServers"]);
    // Still unreadable: an item after an indented line of a skills list or of an MCP list that had no item first,
    // an item after another key's value or another key, and an item under any other key.
    for text in [
        "---\nname: k-a\nskills:\n  - a\n- b\n---\n",
        "---\nname: k-a\nskills: a\n- b\n---\n",
        "---\nname: k-a\nskills:\nmodel: x\n- b\n---\n",
        "---\nname: k-a\nmcpServers:\n  x: {}\n- b\n---\n",
        "---\nname: k-a\nmodel:\n- a\n---\n",
        "---\nname: k-a\nskills:\n- a\n\"hooks\": {}\n---\n",
    ] {
        assert!(matches!(claude(text), AgentTools::Unknown(_)), "{text:?}");
    }
}

#[test]
fn a_column_0_item_that_breaks_a_tools_rule_makes_the_list_unknown() {
    for text in [
        "---\nname: k-a\ntools:\n- Read\n- Bash(git status)\n---\n",
        "---\nname: k-a\ntools:\n- Re$ad\n---\n",
        "---\nname: k-a\ntools:\n- Bash(git\n---\n",
        "---\nname: k-a\ntools:\n- Read\n  Bash\n---\n",
        "---\nname: k-a\ntools:\n- Read\n  - Bash\n---\n",
    ] {
        assert!(matches!(claude(text), AgentTools::Unknown(_)), "{text:?}");
    }
}

#[test]
fn only_the_name_key_of_the_front_matter_declares_an_agent() {
    for (path, text) in [
        // in the body
        (
            ".claude/agents/k-a.md",
            "---\ndescription: x\n---\nname: k-a\n",
        ),
        // in a comment
        (
            ".claude/agents/k-a.md",
            "---\n# name: k-a\ndescription: x\n---\n",
        ),
        // in another key's value, in a readable file and in one with a line this build cannot read
        (
            ".claude/agents/k-a.md",
            "---\nname: k-z\ndescription: k-a\n---\n",
        ),
        (
            ".claude/agents/k-a.md",
            "---\ndescription: name: k-a\n---\n",
        ),
        (
            ".claude/agents/k-a.md",
            "---\ndescription: k-a\n\"x\": 1\n---\n",
        ),
        (
            ".claude/agents/other.md",
            "---\n# k-a\ndescription: use k-a\n\"x\": 1\n---\n",
        ),
        // the file name is k-a but nothing in the front matter says so
        (".claude/agents/k-a.md", "---\n\"x\": 1\n---\n"),
        (".claude/agents/k-a.md", "---\ntools: Read\n- Bash\n---\n"),
        // no front matter
        (".claude/agents/k-a.md", "name: k-a\ntools: Read\n"),
        (".claude/agents/k-a.md", "# k-a\n\nname: k-a\n"),
    ] {
        assert!(claude_files(&[(path, text)]).is_empty(), "{path} {text:?}");
    }
}

#[test]
fn a_file_that_only_mentions_the_id_does_not_clash_with_the_file_that_declares_it() {
    let found = claude_files(&[
        (
            ".claude/agents/k-a.md",
            "---\nname: k-a\ntools: Read\n---\n",
        ),
        (
            ".claude/agents/other.md",
            "---\n# k-a\ndescription: use k-a\n\"x\": 1\n---\nname: k-a\n",
        ),
        (
            ".claude/agents/no-name.md",
            "---\ndescription: k-a\n\"x\": 1\n---\n",
        ),
    ]);
    assert_eq!(found.len(), 1);
    assert!(!found[0].ambiguous);
    assert_eq!(found[0].tools, listed(&["Read"]));
}

#[test]
fn a_file_with_a_name_key_this_build_cannot_read_still_counts_when_the_key_mentions_the_id() {
    for text in [
        "---\nname: |\n  k-a\n---\n",
        "---\nname: [k-a]\n---\n",
        "---\nname: k-a\nname: k-b\n---\n",
        "---\nname: k-a\n\"x\": 1\n---\n",
    ] {
        let found = claude_files(&[(".claude/agents/k-a.md", text)]);
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(
            matches!(&found[0].tools, AgentTools::Unknown(_)),
            "{text:?}"
        );
    }
    // Another id in an unreadable name key is not this agent.
    assert!(claude_files(&[(".claude/agents/k-a.md", "---\nname: [k-z]\n---\n")]).is_empty());
}

#[test]
fn a_name_key_in_a_yaml_form_other_than_the_plain_one_makes_the_file_unreadable() {
    for (label, text) in [
        ("quoted key", "---\n\"name\": k-a\ntools: Read\n---\n"),
        ("single-quoted key", "---\n'name': k-a\ntools: Read\n---\n"),
        (
            "space before the colon",
            "---\nname : k-a\ntools: Read\n---\n",
        ),
        (
            "flow-style front matter",
            "---\n{name: k-a, tools: [Read]}\n---\n",
        ),
        (
            "flow-style front matter over lines",
            "---\n{\n  name: k-a,\n  tools: [Read]\n}\n---\n",
        ),
    ] {
        let found = claude_files(&[(".claude/agents/k-a.md", text)]);
        assert_eq!(found.len(), 1, "{label}");
        assert!(matches!(&found[0].tools, AgentTools::Unknown(_)), "{label}");
        // The file name is not the id, and the file still counts, because it may declare the id.
        let found = claude_files(&[(".claude/agents/other.md", text)]);
        assert_eq!(found.len(), 1, "{label} under another file name");
        assert!(matches!(&found[0].tools, AgentTools::Unknown(_)), "{label}");
    }
}

#[test]
fn a_name_key_in_another_form_that_names_another_id_is_not_this_agent() {
    for text in [
        "---\n\"name\": k-z\n---\n",
        "---\nname : k-z\n---\n",
        "---\n{name: k-z, tools: [Read]}\n---\n",
    ] {
        assert!(
            claude_files(&[(".claude/agents/k-a.md", text)]).is_empty(),
            "{text:?}"
        );
    }
}

#[test]
fn a_description_that_mentions_the_id_is_readable_and_declares_no_agent() {
    // Readable, with no name: not an agent of the id, and not unreadable.
    let text = "---\ndescription: use k-a here\ntools: Read\n---\n";
    assert!(claude_files(&[(".claude/agents/k-a.md", text)]).is_empty());
    assert!(claude_files(&[(".claude/agents/other.md", text)]).is_empty());
    // The same holds beside a line this build cannot read, as long as that line is not a form of the name key.
    let text = "---\ndescription: use k-a here\n\"x\": 1\n---\n";
    assert!(claude_files(&[(".claude/agents/other.md", text)]).is_empty());
}

/// Both file names are tried: the id as the file name, and another name, since the file may declare the id either way.
fn assert_unreadable_candidate(label: &str, text: &str) {
    for path in [".claude/agents/k-a.md", ".claude/agents/other.md"] {
        let found = claude_files(&[(path, text)]);
        assert_eq!(found.len(), 1, "{label} at {path}");
        assert!(
            matches!(&found[0].tools, AgentTools::Unknown(_)),
            "{label} at {path}"
        );
    }
}

#[test]
fn an_indented_root_mapping_that_mentions_the_id_makes_the_file_unreadable() {
    assert_unreadable_candidate(
        "indented root mapping",
        "---\n  name: k-a\n  tools: Read\n---\n",
    );
    assert_unreadable_candidate("tab-indented", "---\n\tname: k-a\n---\n");
    assert_unreadable_candidate(
        "indented after a comment",
        "---\n# first\n  name: k-a\n  description: x\n---\n",
    );
    // An indented root mapping for another id is not this agent.
    assert!(claude_files(&[(
        ".claude/agents/k-a.md",
        "---\n  name: k-z\n  tools: Read\n---\n"
    )])
    .is_empty());
}

#[test]
fn an_escaped_name_that_reads_as_the_id_makes_the_file_unreadable() {
    for (label, text) in [
        (
            "quoted key, escaped value",
            "---\n\"name\": \"k\\u002da\"\n---\n",
        ),
        (
            "quoted key, hex escape",
            "---\n\"name\": \"k\\x2da\"\n---\n",
        ),
        (
            "quoted key, long escape",
            "---\n\"name\": \"k\\U0000002da\"\n---\n",
        ),
        (
            "escaped key and value",
            "---\n\"n\\u0061me\": \"k\\u002da\"\ntools: Read\n---\n",
        ),
        (
            "plain key, escaped value",
            "---\nname: \"k\\u002da\"\ntools: Read\n---\n",
        ),
        (
            "plain key, value on the next line",
            "---\nname:\n  \"k\\u002da\"\n---\n",
        ),
        (
            "plain key, escaped line break inside the id",
            "---\nname: \"k\\\n  -a\"\n---\n",
        ),
        (
            "plain key, escaped lone CR inside the id",
            "---\nname: \"k-\\\r  a\"\n---\n",
        ),
        (
            "plain key, escaped CRLF inside the id",
            "---\nname: \"k-\\\r\n  a\"\n---\n",
        ),
        (
            "indented root, escaped value",
            "---\n  name: \"k\\u002da\"\n---\n",
        ),
        (
            "flow style, escaped value",
            "---\n{name: \"k\\u002da\"}\n---\n",
        ),
    ] {
        assert_unreadable_candidate(label, text);
    }
}

#[test]
fn a_plain_name_line_still_reads_normally() {
    for text in [
        "---\nname: k-a\ntools: Read\n---\n",
        "---\nname: \"k-a\"\ntools: Read\n---\n",
        "---\nname: 'k-a'\ntools: Read\n---\n",
    ] {
        let found = claude_files(&[(".claude/agents/k-a.md", text)]);
        assert_eq!(found.len(), 1, "{text:?}");
        assert_eq!(found[0].tools, listed(&["Read"]), "{text:?}");
    }
    // A plain name for another id is not this agent, even with an escape in it.
    for text in ["---\nname: k-z\n---\n", "---\nname: \"k\\u002dz\"\n---\n"] {
        assert!(
            claude_files(&[(".claude/agents/k-a.md", text)]).is_empty(),
            "{text:?}"
        );
    }
}

#[test]
fn an_alias_name_makes_the_file_unreadable_when_the_id_is_in_the_front_matter() {
    assert_unreadable_candidate(
        "alias of a description anchor",
        "---\ndescription: &n k-a\nname: *n\n---\n",
    );
    assert_unreadable_candidate(
        "alias of an anchor on another key, the id only there",
        "---\ntools: Read\nmodel: &m k-a\nname: *m\n---\n",
    );
    assert_unreadable_candidate(
        "alias with a comment",
        "---\ndescription: &n k-a\nname: *n # x\n---\n",
    );
    // An alias in a front matter that never has the id is not this agent.
    assert!(claude_files(&[(
        ".claude/agents/k-a.md",
        "---\ndescription: &n k-z\nname: *n\n---\n"
    )])
    .is_empty());
}

#[test]
fn an_alias_on_the_line_after_name_makes_the_file_unreadable_when_the_id_is_in_the_front_matter() {
    assert_unreadable_candidate(
        "alias on the next line",
        "---\ndescription: &n k-a\nname:\n  *n\n---\n",
    );
    assert_unreadable_candidate(
        "comment after name, alias on the next line",
        "---\ndescription: &n k-a\nname: # c\n  *n\n---\n",
    );
    // The same shape in a front matter that never has the id is not this agent.
    assert!(claude_files(&[(
        ".claude/agents/k-a.md",
        "---\ndescription: &n k-z\nname:\n  *n\n---\n"
    )])
    .is_empty());
}

#[test]
fn a_sibling_whose_name_contains_the_id_resolves_to_its_own_file() {
    let (project, home) = (TempDir::new("cat-sib1"), TempDir::new("cat-sib2"));
    project.write(
        ".claude/agents/k-a.md",
        b"---\nname: k-a\ntools: Read\n---\n",
    );
    project.write(
        ".claude/agents/k-a-frontend.md",
        b"---\nname: k-a-frontend\ntools: Bash\n---\n",
    );
    let catalog = catalog(&project, &home);
    let id = catalog.definitions("k-a");
    assert_eq!(id.len(), 1);
    assert!(!id[0].ambiguous);
    assert_eq!(id[0].file, ".claude/agents/k-a.md");
    assert_eq!(id[0].tools, listed(&["Read"]));
    let sibling = catalog.definitions("k-a-frontend");
    assert_eq!(sibling.len(), 1);
    assert!(!sibling[0].ambiguous);
    assert_eq!(sibling[0].file, ".claude/agents/k-a-frontend.md");
    assert_eq!(sibling[0].tools, listed(&["Bash"]));
}

#[test]
fn the_orchestrator_names_that_contain_konductor_do_not_clash_with_konductor() {
    let (project, home) = (TempDir::new("cat-orc1"), TempDir::new("cat-orc2"));
    for name in [
        "konductor",
        "konductor-mux-orchestrator",
        "konductor-cmux-orchestrator",
    ] {
        project.write(
            &format!(".claude/agents/{name}.md"),
            format!("---\nname: {name}\ntools: Read\n---\n").as_bytes(),
        );
    }
    let found = catalog(&project, &home).definitions("konductor");
    assert_eq!(found.len(), 1);
    assert!(!found[0].ambiguous);
    assert_eq!(found[0].file, ".claude/agents/konductor.md");
    assert_eq!(found[0].tools, listed(&["Read"]));
}

#[test]
fn a_comment_on_another_agents_name_line_that_mentions_the_id_is_not_this_agent() {
    for text in [
        "---\nname: reviewer # pairs with k-a\ntools: Bash\n---\n",
        "---\nname: reviewer\t# pairs with k-a\ntools: Bash\n---\n",
    ] {
        let found = claude_files(&[
            (
                ".claude/agents/k-a.md",
                "---\nname: k-a\ntools: Read\n---\n",
            ),
            (".claude/agents/reviewer.md", text),
        ]);
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(!found[0].ambiguous, "{text:?}");
        assert_eq!(found[0].tools, listed(&["Read"]), "{text:?}");
    }
}

#[test]
fn a_tab_before_a_comment_on_the_name_line_makes_the_file_unreadable() {
    assert_unreadable_candidate(
        "tab before a comment",
        "---\nname: k-a\t# x\ntools: Read\n---\n",
    );
    assert_unreadable_candidate("tab, no comment text", "---\nname: k-a\t#\n---\n");
}

#[test]
fn a_lone_carriage_return_in_the_front_matter_makes_the_file_unreadable_when_the_id_is_mentioned() {
    // YAML 1.2 reads a bare carriage return as a line break, so each of these is `name: k-a` to the harness.
    assert_unreadable_candidate(
        "lone CR inside the name line",
        "---\nname: k-a\rtools: Bash\n---\n",
    );
    assert_unreadable_candidate(
        "lone CR on another line, id on the name line",
        "---\nname: k-a\ndescription: a\rb\n---\n",
    );
}

#[test]
fn a_crlf_file_still_reads_and_a_lone_carriage_return_without_the_id_is_not_a_candidate() {
    let found = claude_files(&[(
        ".claude/agents/k-a.md",
        "---\r\nname: k-a\r\ntools: Read\r\n---\r\n",
    )]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].tools, listed(&["Read"]));
    assert!(claude_files(&[(
        ".claude/agents/k-a.md",
        "---\r\nname: other\r\ntools: Read\r\n---\r\n",
    )])
    .is_empty());
    assert!(claude_files(&[(
        ".claude/agents/k-a.md",
        "---\nname: other\rtools: Bash\n---\n",
    )])
    .is_empty());
}

#[test]
fn a_plain_name_of_another_agent_whose_line_lacks_the_id_stays_readable() {
    for text in [
        "---\nname: other-agent\ntools: Read\n---\n",
        "---\nname: other-agent\t# x\ndescription: use k-a\n---\n",
    ] {
        assert!(
            claude_files(&[(".claude/agents/k-a.md", text)]).is_empty(),
            "{text:?}"
        );
    }
    // A plain `name: k-a` still reads normally, with or without a comment after a space.
    let found = claude_files(&[(
        ".claude/agents/k-a.md",
        "---\nname: k-a # the agent\ntools: Read\n---\n",
    )]);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].tools, listed(&["Read"]));
    // A longer name that contains the id, a name with a space in it and a quoted name with a leading space are other
    // agents: readable, and not a candidate.
    for text in [
        "---\nname: k-a-helper\n---\n",
        "---\nname: k-a b\n---\n",
        "---\nname: \" k-a\"\n---\n",
    ] {
        assert!(
            claude_files(&[(".claude/agents/k-a.md", text)]).is_empty(),
            "{text:?}"
        );
    }
}

#[test]
fn a_file_that_never_mentions_the_id_stays_readable_in_every_form() {
    for text in [
        "---\n  name: k-z\n---\n",
        "---\n\"name\": \"k\\u002dz\"\n---\n",
        "---\n\"name\": k-z\n---\n",
        "---\n{name: k-z}\n---\n",
        // an escape that is not tied to the id
        "---\nname: other\ndescription: \"line\\nbreak \\u0041\"\n\"x\": 1\n---\n",
    ] {
        assert!(
            claude_files(&[(".claude/agents/k-a.md", text)]).is_empty(),
            "{text:?}"
        );
    }
    // A readable front matter that mentions the id in a description, with no name, declares nothing.
    let text = "---\ndescription: use k-a here\ntools: Read\n---\n";
    assert!(claude_files(&[(".claude/agents/other.md", text)]).is_empty());
}

// --- what the install manifest may exempt --------------------------------------------------------------------------

/// A manifest that lists `path` with the hash of `bytes`.
fn vouching(path: &str, bytes: &[u8]) -> InstalledFiles {
    BTreeSet::from([(path.to_string(), sha256_hex(bytes))])
}

#[test]
fn a_manifest_cannot_exempt_a_settings_mcp_hook_or_kiro_agent_file() {
    for path in [
        ".claude/settings.json",
        ".claude/settings.local.json",
        ".mcp.json",
        ".kiro/settings/mcp.json",
        ".claude/hooks/pre.sh",
        ".kiro/agents/k-a.json",
    ] {
        let repo = TempDir::new("scan-vouch-files");
        repo.write(path, b"{\"hooks\": {}}");
        let files = scan_ok(repo.path(), None, &vouching(path, b"{\"hooks\": {}}"));
        assert_eq!(names(&files), [path], "{path}");
    }
}

#[test]
fn a_manifest_cannot_exempt_a_markdown_file_that_sets_a_hook_server_mode_or_tool() {
    for key in [
        "hooks: {}",
        "mcpServers: []",
        "permissionMode: bypassPermissions",
        "tools: Read, Bash",
        "allowedTools: [Bash]",
        "allowed-tools: Bash(git:*)",
    ] {
        let text = format!("---\nname: k-a\n{key}\n---\nBody.\n");
        for path in [".claude/agents/k-a.md", ".claude/skills/s/SKILL.md"] {
            let repo = TempDir::new("scan-vouch-keys");
            repo.write(path, text.as_bytes());
            let files = scan_ok(repo.path(), None, &vouching(path, text.as_bytes()));
            assert_eq!(names(&files), [path], "{key} in {path}");
        }
    }
}

#[test]
fn a_manifest_still_exempts_a_markdown_file_that_cannot_carry_any_of_it() {
    let repo = TempDir::new("scan-vouch-plain");
    let skill =
        "---\nname: s\ndescription: Does a thing.\n---\nBody mentioning tools: and hooks.\n";
    repo.write(".claude/skills/s/SKILL.md", skill.as_bytes());
    repo.write(
        ".claude/commands/c.md",
        b"No front matter, and tools: here.",
    );
    let mut installed = vouching(".claude/skills/s/SKILL.md", skill.as_bytes());
    installed.insert((
        ".claude/commands/c.md".into(),
        sha256_hex(b"No front matter, and tools: here."),
    ));
    assert!(scan_ok(repo.path(), None, &installed).is_empty());
    // A change after the install still counts, as before.
    repo.write(".claude/skills/s/SKILL.md", b"---\nname: s\n---\nEdited.\n");
    assert_eq!(
        names(&scan_ok(repo.path(), None, &installed)),
        [".claude/skills/s/SKILL.md"]
    );
}

#[test]
fn a_manifest_does_not_exempt_a_markdown_file_whose_front_matter_cannot_be_read() {
    let cases: [(&str, &[u8]); 5] = [
        ("quoted key", b"---\nname: k-a\n\"tools\": Bash\n---\n"),
        (
            "lone carriage return between keys",
            b"---\nname: x\rtools: Bash\rpermissionMode: bypassPermissions\n---\n",
        ),
        ("flow mapping", b"---\n{tools: Bash}\n---\n"),
        (
            "byte order mark",
            b"\xef\xbb\xbf---\nname: k-a\ntools: Bash\n---\n",
        ),
        ("not UTF-8", b"---\nname: k-a\ntools: Bash\n\xff---\n"),
    ];
    for (label, bytes) in cases {
        let repo = TempDir::new("scan-vouch-unreadable");
        let path = ".claude/agents/k-a.md";
        repo.write(path, bytes);
        let files = scan_ok(repo.path(), None, &vouching(path, bytes));
        assert_eq!(names(&files), [path], "{label}");
    }
}

#[test]
fn a_manifest_does_not_exempt_a_markdown_file_with_a_dash_run_in_its_front_matter() {
    let cases: [(&str, &[u8]); 4] = [
        (
            "in a value, before tools",
            b"---\nname: k-a\ndescription: does x---y\ntools: Bash\n---\n",
        ),
        (
            "in the name value",
            b"---\npermissionMode: bypassPermissions\nname: k-architect---\n---\n",
        ),
        (
            "in a comment",
            b"---\nname: k-a\n# a --- b\ndescription: a\n---\n",
        ),
        (
            "indented in a block scalar",
            b"---\nname: k-a\ndescription: |\n  ---\n---\n",
        ),
    ];
    for (label, bytes) in cases {
        let repo = TempDir::new("scan-vouch-dashes");
        let path = ".claude/agents/k-a.md";
        repo.write(path, bytes);
        let files = scan_ok(repo.path(), None, &vouching(path, bytes));
        assert_eq!(names(&files), [path], "{label}");
    }
    // A value with a shorter hyphen run, and no carrying key, is still exempt.
    let repo = TempDir::new("scan-vouch-hyphens");
    let path = ".claude/agents/k-a.md";
    let bytes: &[u8] = b"---\nname: k-a\ndescription: a--b\n---\n";
    repo.write(path, bytes);
    assert!(scan_ok(repo.path(), None, &vouching(path, bytes)).is_empty());
}

#[test]
fn a_manifest_still_exempts_a_crlf_markdown_file_that_carries_no_config_key() {
    let repo = TempDir::new("scan-vouch-crlf");
    let path = ".claude/agents/k-a.md";
    let bytes: &[u8] = b"---\r\nname: k-a\r\ndescription: a\r\n---\r\nBody.\r\n";
    repo.write(path, bytes);
    assert!(scan_ok(repo.path(), None, &vouching(path, bytes)).is_empty());
}

// --- links to files -------------------------------------------------------------------------------------------------

fn link(target: std::path::PathBuf, at: std::path::PathBuf) {
    std::fs::create_dir_all(at.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(target, at).unwrap();
}

#[test]
fn a_symlinked_agent_file_shows_its_tools_in_the_catalog() {
    let (project, home) = (TempDir::new("cat-link-p"), TempDir::new("cat-link-h"));
    project.write("shared/k-a.md", b"---\nname: k-a\ntools: Read, Grep\n---\n");
    link(
        project.path().join("shared/k-a.md"),
        project.path().join(".claude/agents/k-a.md"),
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].tools, listed(&["Read", "Grep"]));
    assert_eq!(found[0].file, ".claude/agents/k-a.md");
    assert!(!found[0].ambiguous);
    // The scan reads the same link as a file, and hashes the bytes of its target.
    let files = scan_ok(project.path(), None, &InstalledFiles::new());
    assert_eq!(names(&files), [".claude/agents/k-a.md"]);
    assert!(files[0].bytes.starts_with(b"---\nname: k-a"));
}

#[test]
fn a_symlinked_agent_file_that_duplicates_a_name_makes_the_agent_ambiguous() {
    let (project, home) = (TempDir::new("cat-dup-p"), TempDir::new("cat-dup-h"));
    project.write(".claude/agents/k-a.md", b"---\nname: k-a\n---\n");
    project.write("shared/other.md", b"---\nname: k-a\ntools: Bash\n---\n");
    link(
        project.path().join("shared/other.md"),
        project.path().join(".claude/agents/other.md"),
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found.len(), 1);
    assert!(found[0].ambiguous, "{:?}", found[0]);
}

#[test]
fn a_symlink_whose_stem_differs_from_the_name_is_ambiguous_too() {
    let (project, home) = (TempDir::new("cat-stem-p"), TempDir::new("cat-stem-h"));
    project.write("shared/other.md", b"---\nname: k-a\ntools: Bash\n---\n");
    link(
        project.path().join("shared/other.md"),
        project.path().join(".claude/agents/other.md"),
    );
    let found = catalog(&project, &home).definitions("k-a");
    assert!(found[0].ambiguous, "{:?}", found[0]);
}

#[test]
fn a_dangling_link_or_a_link_to_a_folder_under_the_agent_folder_is_refused_with_its_path_and_cause()
{
    let repo = TempDir::new("scan-dangling");
    link(
        repo.path().join("missing.md"),
        repo.path().join(".claude/agents/gone.md"),
    );
    repo.mkdir("elsewhere");
    link(
        repo.path().join("elsewhere"),
        repo.path().join(".claude/agents/team"),
    );
    let unreadable = scan_of(&repo).unwrap_err();
    let shown: Vec<(&str, &str)> = unreadable
        .iter()
        .map(|u| (u.path.as_str(), u.reason.as_str()))
        .collect();
    assert_eq!(
        shown,
        [
            (
                ".claude/agents/gone.md",
                "is a link that cannot be followed"
            ),
            (
                ".claude/agents/team",
                "is a link to a folder, which is not followed"
            ),
        ]
    );
    // The catalog lists neither, so it describes only what the scan could read.
    let home = TempDir::new("scan-dangling-home");
    assert!(catalog(&repo, &home).definitions("gone").is_empty());
}

// --- the cause of each refusal --------------------------------------------------------------------------------------

#[test]
fn each_refusal_names_its_path_and_the_cause() {
    // A folder over the entry cap.
    let repo = TempDir::new("cause-cap");
    for n in 0..MAX_ENTRIES + 1 {
        repo.write(&format!(".claude/hooks/h{n:04}"), b"x");
    }
    let got = scan_of(&repo).unwrap_err();
    assert_eq!(got[0].path, ".claude/hooks");
    assert!(
        got[0].reason.contains("more than 512 files and folders"),
        "{got:?}"
    );
    // A folder nested too deep.
    let repo = TempDir::new("cause-depth");
    repo.write(".claude/agents/a/b/c/d/e/x.md", b"x");
    let got = scan_of(&repo).unwrap_err();
    assert_eq!(got[0].path, ".claude/agents/a/b/c/d/e");
    assert!(got[0].reason.contains("deeper than 4 levels"), "{got:?}");
    // A file over 1 MiB, in a covered folder.
    let repo = TempDir::new("cause-size");
    repo.write(".claude/skills/s/asset.bin", &vec![b'x'; 1024 * 1024 + 1]);
    let got = scan_of(&repo).unwrap_err();
    assert_eq!(got[0].path, ".claude/skills/s/asset.bin");
    assert!(got[0].reason.contains("over 1 MiB"), "{got:?}");
    // A link to a folder as the covered folder itself.
    let repo = TempDir::new("cause-link");
    repo.mkdir("shared");
    link(
        repo.path().join("shared"),
        repo.path().join(".claude/skills"),
    );
    let got = scan_of(&repo).unwrap_err();
    assert_eq!(got[0].path, ".claude/skills");
    assert!(got[0].reason.contains("link to a folder"), "{got:?}");
}

#[test]
fn a_link_to_a_file_inside_a_covered_folder_is_hashed_by_its_target_and_its_own_path() {
    let repo = TempDir::new("scan-file-link-hash");
    repo.write("shared/tool.sh", b"one");
    link(
        repo.path().join("shared/tool.sh"),
        repo.path().join(".claude/hooks/tool.sh"),
    );
    let first = hash_of_scan(&repo);
    repo.write("shared/tool.sh", b"two");
    assert_ne!(first, hash_of_scan(&repo), "the target bytes are hashed");
    let files = scan_of(&repo).unwrap();
    assert_eq!(names(&files), [".claude/hooks/tool.sh"]);
    assert_eq!(files[0].bytes, b"two");
}

// --- our reading of a name against the YAML loader ------------------------------------------------------------------

/// What the real loader (`workflow_core::yaml`, a dev use only here) reads as the root `name`: `None` when it reads no
/// `name`, `Err` when it cannot read the text at all (an alias is unsupported there).
fn loader_name(front: &str) -> Result<Option<String>, ()> {
    use workflow_core::source_map::SourceMap;
    use workflow_core::yaml::{load, Node};
    let loaded = load(front, &SourceMap::new(front));
    if loaded.is_unreadable() {
        return Err(());
    }
    let Some(Node::Map(map)) = loaded.root else {
        return Ok(None);
    };
    Ok(map
        .entries
        .iter()
        .find(|e| e.key.text == "name")
        .and_then(|e| match &e.value {
            Node::Scalar(s) => Some(s.text.clone()),
            _ => None,
        }))
}

#[test]
fn no_disguised_name_reads_as_another_agent_here_while_the_yaml_loader_reads_the_id() {
    // Each front matter is the text between the fences. `true` marks a form the loader cannot read (an alias), where
    // the id is reachable through the anchor, so our reading must still not be another agent.
    let forms: [(&str, &str, bool); 14] = [
        ("quoted key", "\"name\": k-a\n", false),
        ("space before the colon", "name : k-a\n", false),
        (
            "indented root mapping",
            "  name: k-a\n  tools: Read\n",
            false,
        ),
        ("escaped value", "name: \"k\\u002da\"\n", false),
        ("escaped line feed", "name: \"k-\\\n  a\"\n", false),
        ("escaped lone CR", "name: \"k-\\\r  a\"\n", false),
        ("escaped CRLF", "name: \"k-\\\r\n  a\"\n", false),
        ("inline alias", "description: &n k-a\nname: *n\n", true),
        (
            "alias on the next line",
            "description: &n k-a\nname:\n  *n\n",
            true,
        ),
        (
            "tab before a comment",
            "name: k-a\t# x\ntools: Read\n",
            false,
        ),
        ("braces and flow style", "{name: k-a}\n", false),
        ("lone CR between keys", "name: k-a\rtools: Bash\n", false),
        ("CRLF normal file", "name: k-a\r\ntools: Read\r\n", false),
        (
            "sibling whose name contains the id",
            "name: k-a-helper\ntools: Read\n",
            false,
        ),
    ];
    for (label, front, alias) in forms {
        let ours = claude_files(&[(".claude/agents/k-a.md", &format!("---\n{front}---\n"))]);
        let ours_is_other = ours.is_empty();
        match loader_name(front) {
            Ok(name) => {
                assert!(
                    !alias,
                    "{label}: the loader was expected to refuse an alias"
                );
                if name.as_deref() == Some("k-a") {
                    assert!(
                        !ours_is_other,
                        "{label}: the loader reads the id, we read another agent"
                    );
                } else {
                    // Where we read another agent, the loader must not read the id (checked above); where it reads
                    // another name, our reading must not claim the file for the id either.
                    assert!(
                        ours.iter()
                            .all(|d| matches!(d.tools, AgentTools::Unknown(_)))
                            || ours_is_other,
                        "{label}: the loader reads {name:?}, we read the id"
                    );
                }
            }
            Err(()) => {
                assert!(alias, "{label}: the loader could not read it");
                assert!(!ours_is_other, "{label}: an alias may carry the id");
            }
        }
    }
    // Forms the loader cannot read at all, or that a YAML reader other than the loader takes. The file is not the id's
    // file by name (`other.md`), so only the front matter can make it the agent. Each of these reads as the id in
    // some YAML reader, so it must not read as another agent here.
    let lenient: [(&str, &str); 11] = [
        (
            "alias value, quoted name key",
            "description: &v k-architect\n\"name\": *v\ntools: Bash\n",
        ),
        (
            "alias value, space before the colon",
            "description: &v k-architect\nname : *v\n",
        ),
        (
            "alias value, anchored key",
            "description: &v k-architect\n&a name: *v\n",
        ),
        (
            "alias key",
            "k: &a name\ndescription: &v k-architect\n*a : *v\n",
        ),
        (
            "merge key, mapping anchored on another key",
            "x: &m\n  name: k-architect\n<<: *m\n",
        ),
        (
            "double-quoted value continued at column 0",
            "name: \"k-\\\narchitect\"\n",
        ),
        ("tab after the colon", "name:\tk-architect\n"),
        ("NEL between keys", "name: k-architect\u{85}tools: Bash\n"),
        ("LS between keys", "name: k-architect\u{2028}tools: Bash\n"),
        ("PS between keys", "name: k-architect\u{2029}tools: Bash\n"),
        (
            "CRLF value continued at column 0",
            "name: \"k-\\\r\narchitect\"\r\n",
        ),
    ];
    for (label, front) in lenient {
        let text = format!("---\n{front}---\n");
        let ours = claude_files_for("k-architect", &[(".claude/agents/other.md", &text)]);
        assert!(!ours.is_empty(), "{label}: reads as another agent here");
    }
}

/// Front matter lines, each with a `---` that is not on a line of its own, and a `tools` key after it.
const DASH_RUN_LINES: [(&str, &str); 6] = [
    (
        "middle of a value",
        "description: does x---y\ntools: Read\n",
    ),
    (
        "spaced run in a value",
        "description: a --- b\ntools: Read\n",
    ),
    ("quoted value", "description: \"a --- b\"\ntools: Read\n"),
    ("comment line", "# a --- b\ntools: Read\n"),
    (
        "indented line of a block scalar",
        "description: |\n  ---\ntools: Read\n",
    ),
    ("four dashes", "description: x\n----\ntools: Read\n"),
];

#[test]
fn a_dash_run_inside_the_front_matter_makes_the_agent_file_unreadable() {
    let id = "k-architect";
    for (label, lines) in DASH_RUN_LINES {
        let text = format!("---\nname: {id}\n{lines}---\n");
        // The file whose stem is the id is the definition, with tools it cannot read, not `Read`.
        let found = claude_files_for(id, &[(&format!(".claude/agents/{id}.md"), &text)]);
        assert_eq!(found.len(), 1, "{label}");
        assert!(
            matches!(&found[0].tools, AgentTools::Unknown(why) if why.contains("`---`")),
            "{label}: {:?}",
            found[0].tools
        );
        // Another file that mentions the id may declare it, so it is not skipped for the home agent.
        let found = claude_files_for(id, &[(".claude/agents/other.md", &text)]);
        assert_eq!(found.len(), 1, "{label} in another file");
        assert!(
            matches!(found[0].tools, AgentTools::Unknown(_)),
            "{label} in another file"
        );
    }
}

#[test]
fn a_dash_run_in_a_name_value_cannot_hide_the_agent_behind_another_name() {
    let id = "k-architect";
    // The harness reads `name: k-architect` and `permissionMode: bypassPermissions`, and stops at the first `---`.
    for text in [
        "---\npermissionMode: bypassPermissions\nname: k-architect---\n---\n",
        "---\nname: k-architect---\n---\n",
        "---\nname: k-architect --- x\ntools: Read\n---\n",
        "---\nname: \"k-architect---\"\n---\n",
    ] {
        let found = claude_files_for(id, &[(".claude/agents/zz.md", text)]);
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{text:?}");
    }
}

#[test]
fn a_dash_run_in_a_file_that_does_not_mention_the_id_is_not_that_agent() {
    let id = "k-architect";
    for (label, lines) in DASH_RUN_LINES {
        let text = format!("---\nname: k-b\n{lines}---\n");
        assert!(
            claude_files_for(id, &[(".claude/agents/other.md", &text)]).is_empty(),
            "{label}"
        );
    }
}

#[test]
fn a_hyphen_run_shorter_than_three_and_a_closing_line_of_its_own_stay_readable() {
    // `a--b` is a plain value, and a `---` after the closing line is the body.
    assert_eq!(
        claude("---\nname: k-a\ndescription: a--b - c\ntools: Read\n---\nBody --- here\n---\n"),
        listed(&["Read"])
    );
    // The usual file, closed by a line that is `---` alone, with trailing space allowed.
    assert_eq!(
        claude("---\nname: k-a\ntools: Read, Grep\n---  \nBody.\n"),
        listed(&["Read", "Grep"])
    );
    // A file that names another agent stays another agent, and one with no id mention stays out.
    let other = "---\nname: k-b\ndescription: a--b\n---\n";
    assert!(claude_files_for("k-a", &[(".claude/agents/other.md", other)]).is_empty());
}

#[test]
fn an_agent_file_that_is_not_utf8_or_opens_in_another_form_is_still_looked_at() {
    let id = "k-architect";
    let (project, home) = (TempDir::new("cat-f1"), TempDir::new("cat-f2"));
    // A byte that is not UTF-8 reads as U+FFFD, so the file is read, and its name is the id.
    project.write(
        ".claude/agents/other.md",
        b"---\nname: k-architect\ndescription: \xff\n---\n",
    );
    assert_eq!(catalog(&project, &home).definitions(id).len(), 1);
    // The opening line is not the exact `---` this build takes, and the text names the id: the file may declare it.
    for text in [
        "\u{feff}---\nname: k-architect\n---\n",
        "\n---\nname: k-architect\n---\n",
        "---yaml\nname: k-architect\n---\n",
    ] {
        let found = claude_files_for(id, &[(".claude/agents/other.md", text)]);
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{text:?}");
    }
    // Without the id in the text, the same openings are not this agent, and plain text with no fence is not either.
    for text in [
        "\u{feff}---\nname: k-b\n---\n",
        "\n---\nname: k-b\n---\n",
        "---yaml\nname: k-b\n---\n",
        "no front matter, k-architect in the body\n",
    ] {
        assert!(
            claude_files_for(id, &[(".claude/agents/other.md", text)]).is_empty(),
            "{text:?}"
        );
    }
}

/// The agent `k-developer` in its own file, plus `sibling` as `.claude/agents/reviewer.md` (as bytes), asked for by id.
fn definitions_beside(sibling: &[u8]) -> Vec<workflow_core::ports::AgentDefinition> {
    let (project, home) = (TempDir::new("cat-sib1"), TempDir::new("cat-sib2"));
    project.write(
        ".claude/agents/k-developer.md",
        b"---\nname: k-developer\ntools: Read\n---\nBody.\n",
    );
    project.write(".claude/agents/reviewer.md", sibling);
    catalog(&project, &home).definitions("k-developer")
}

#[test]
fn a_sibling_that_names_the_id_only_in_its_body_or_after_a_dash_run_is_not_a_candidate() {
    for (label, sibling) in [
        // A `---` in the description, and the body hands work to the id.
        (
            "dash run, id in body",
            &b"---\nname: reviewer\ndescription: Reviews diffs --- run it after the developer\n---\nHand the findings back to k-developer.\n"[..],
        ),
        // The id is in the description, but after the first `---`, where the harness has ended the front matter.
        (
            "id in the description after a dash run",
            b"---\nname: reviewer\ndescription: Reviews diffs --- run it after k-developer\n---\nBody.\n",
        ),
        // The opening fence is in a form this build does not take, and only the body names the id.
        (
            "byte order mark",
            "\u{feff}---\nname: reviewer\n---\nHand it to k-developer.\n".as_bytes(),
        ),
        (
            "blank line first",
            b"\n---\nname: reviewer\n---\nHand it to k-developer.\n",
        ),
        (
            "---yaml",
            b"---yaml\nname: reviewer\n---\nHand it to k-developer.\n",
        ),
        // Line breaks other than a line feed.
        (
            "lone carriage return",
            b"---\rname: reviewer\r---\rHand it to k-developer.\r",
        ),
        (
            "NEL",
            "---\u{85}name: reviewer\u{85}---\u{85}Hand it to k-developer.\u{85}".as_bytes(),
        ),
        (
            "LS",
            "---\u{2028}name: reviewer\u{2028}---\u{2028}Hand it to k-developer.".as_bytes(),
        ),
        (
            "PS",
            "---\u{2029}name: reviewer\u{2029}---\u{2029}Hand it to k-developer.".as_bytes(),
        ),
        // A byte that is not UTF-8 in the front matter.
        (
            "not UTF-8",
            b"---\nname: reviewer\ndescription: \xff a---b\n---\nHand it to k-developer.\n",
        ),
    ] {
        let found = definitions_beside(sibling);
        assert_eq!(found.len(), 1, "{label}");
        assert_eq!(found[0].file, ".claude/agents/k-developer.md", "{label}");
        assert!(!found[0].ambiguous, "{label}");
        assert_eq!(found[0].tools, listed(&["Read"]), "{label}");
    }
}

#[test]
fn a_sibling_that_names_the_id_in_its_front_matter_before_a_dash_run_is_still_unreadable() {
    let id = "k-architect";
    // The id is before the first `---`, so the harness reads it. The stem file is the definition, with tools unknown.
    for text in [
        "---\nname: k-architect\ndescription: does x---y\ntools: Read\n---\n",
        "---\npermissionMode: bypassPermissions\nname: k-architect---\n---\n",
        "---\nname: k-architect---\n---\n",
    ] {
        let found = claude_files_for(id, &[(".claude/agents/k-architect.md", text)]);
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{text:?}");
        // Another file with the same text is an unreadable candidate too.
        let found = claude_files_for(id, &[(".claude/agents/zz.md", text)]);
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{text:?}");
    }
}

#[test]
fn an_indented_line_after_an_inline_tools_value_makes_the_tools_unknown() {
    for text in [
        // a continuation that starts with a comma, and one that is a word
        "---\nname: k-a\ntools: Read\n  , Write\n---\n",
        "---\nname: k-a\ntools: Read\n  Write\n---\n",
        "---\nname: k-a\ntools: Read\n\t, Write\n---\n",
        // a trailing comma, then the continuation
        "---\nname: k-a\ntools: Read,\n  Bash\n---\n",
        // a list item under an inline value
        "---\nname: k-a\ntools: Read\n  - *\n---\n",
        // blank and comment lines between do not end the value for the reader
        "---\nname: k-a\ntools: Read\n\n# c\n  Write\n---\n",
        "---\nname: k-a\ntools: [Read]\n  Write\n---\n",
    ] {
        assert!(
            matches!(claude(text), AgentTools::Unknown(why) if why.contains("indented line")),
            "{text:?}"
        );
    }
    // An indented line that belongs to the next key, or a comment, is not a continuation.
    assert_eq!(
        claude("---\nname: k-a\ntools: Read\nmodel: x\n  more\n---\n"),
        listed(&["Read"])
    );
    assert_eq!(
        claude("---\nname: k-a\ntools: Read\n---\n  indented body\n"),
        listed(&["Read"])
    );
    assert_eq!(
        claude("---\nname: k-a\ntools: Read\n# c\nmodel: x\n---\n"),
        listed(&["Read"])
    );
}

#[test]
fn a_star_anywhere_in_a_tools_list_means_every_tool() {
    // The existing form for a list: the item `*` stands alone, as the other items add nothing. It is not
    // `EveryToolNonePreApproved`, which says the key pre-approves none, and a `*` rule in the list pre-approves all.
    for text in [
        "---\nname: k-a\ntools: Read, *\n---\n",
        "---\nname: k-a\ntools: Task,*\n---\n",
        "---\nname: k-a\ntools: \"*\"\n---\n",
        "---\nname: k-a\ntools: [Read, *]\n---\n",
        "---\nname: k-a\ntools:\n  - Read\n  - \"*\"\n---\n",
        "---\nname: k-a\ntools:\n- Read\n- '*'\n- Bash\n---\n",
    ] {
        assert_eq!(claude(text), listed(&["*"]), "{text:?}");
    }
    // A pattern that only ends in `*` is not every tool.
    assert_eq!(
        claude("---\nname: k-a\ntools: Read, mcp__aws-mcp__*\n---\n"),
        listed(&["Read", "mcp__aws-mcp__*"])
    );
}

fn kiro_files(files: &[(&str, &str)], id: &str) -> Vec<workflow_core::ports::AgentDefinition> {
    let (project, home) = (TempDir::new("cat-ki1"), TempDir::new("cat-ki2"));
    for (path, text) in files {
        project.write(path, text.as_bytes());
    }
    catalog(&project, &home)
        .definitions(id)
        .into_iter()
        .filter(|d| d.runner == Runner::KiroCli)
        .collect()
}

#[test]
fn a_kiro_agent_is_found_by_its_json_name_whatever_the_file_is_called() {
    let found = kiro_files(
        &[(
            ".kiro/agents/other.json",
            r#"{"name":"k-architect","allowedTools":["fs_read"]}"#,
        )],
        "k-architect",
    );
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].tools, listed(&["fs_read"]));
    assert_eq!(found[0].file, ".kiro/agents/other.json");
    assert_eq!(found[0].placement, Placement::Project);
    assert!(!found[0].ambiguous);
}

#[test]
fn a_kiro_file_whose_name_differs_or_is_not_a_string_is_not_that_agent() {
    for text in [
        r#"{"name":"other","allowedTools":["shell"]}"#,
        r#"{"name":5,"allowedTools":["shell"]}"#,
        r#"{"name":null,"allowedTools":["shell"]}"#,
        r#"{"name":"K-ARCHITECT","allowedTools":["shell"]}"#,
    ] {
        let found = kiro_files(&[(".kiro/agents/k-architect.json", text)], "k-architect");
        assert!(found.is_empty(), "{text}");
    }
    // A file that is not `.json` or `.md` is not an agent. A subfolder is read, as Kiro 3 loads it.
    let found = kiro_files(
        &[(".kiro/agents/k-architect.txt", r#"{"name":"k-architect"}"#)],
        "k-architect",
    );
    assert!(found.is_empty());
    let found = kiro_files(
        &[(
            ".kiro/agents/sub/k-architect.json",
            r#"{"name":"k-architect"}"#,
        )],
        "k-architect",
    );
    assert_eq!(found.len(), 1);
}

#[test]
fn a_kiro_file_that_is_not_the_agent_does_not_hide_the_home_agent() {
    let (project, home) = (TempDir::new("cat-kh1"), TempDir::new("cat-kh2"));
    home.write(
        ".kiro/agents/k-architect.json",
        br#"{"name":"k-architect","allowedTools":["shell"]}"#,
    );
    project.write(
        ".kiro/agents/k-architect.json",
        br#"{"name":"renamed","allowedTools":["fs_read"]}"#,
    );
    let found = catalog(&project, &home).definitions("k-architect");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].placement, Placement::Home);
    assert_eq!(found[0].file, "~/.kiro/agents/k-architect.json");
    // A file that declares the id in the project is the agent, whatever its name, and wins over home.
    project.write(
        ".kiro/agents/other.json",
        br#"{"name":"k-architect","allowedTools":["fs_read"]}"#,
    );
    let found = catalog(&project, &home).definitions("k-architect");
    assert_eq!(found[0].placement, Placement::Project);
    assert_eq!(found[0].file, ".kiro/agents/other.json");
    assert_eq!(found[0].tools, listed(&["fs_read"]));
}

#[test]
fn two_kiro_files_with_the_same_name_make_the_agent_ambiguous() {
    let found = kiro_files(
        &[
            (
                ".kiro/agents/k-architect.json",
                r#"{"name":"k-architect","allowedTools":["fs_read"]}"#,
            ),
            (
                ".kiro/agents/other.json",
                r#"{"name":"k-architect","allowedTools":["shell"]}"#,
            ),
        ],
        "k-architect",
    );
    assert_eq!(found.len(), 1);
    assert!(found[0].ambiguous);
    assert!(
        matches!(&found[0].tools, AgentTools::Unknown(why) if why.contains("more than one file")),
        "{:?}",
        found[0].tools
    );
    assert_eq!(found[0].file, ".kiro/agents/k-architect.json");
}

#[test]
fn a_kiro_stem_file_that_cannot_be_read_is_unreadable_and_another_file_is_ignored() {
    // Not valid JSON, with the id as its stem: its name cannot be seen, so it is shown as unreadable.
    let found = kiro_files(&[(".kiro/agents/k-architect.json", "{")], "k-architect");
    assert_eq!(found.len(), 1);
    assert!(!found[0].ambiguous);
    assert!(matches!(found[0].tools, AgentTools::Unknown(_)));
    // Not valid JSON, with another stem, is not looked at.
    let found = kiro_files(&[(".kiro/agents/other.json", "{")], "k-architect");
    assert!(found.is_empty());
}

// --- the manifest vouches for markdown only, and the scan bounds what it reads -------------------------------------------

#[test]
fn a_manifest_cannot_exempt_a_file_that_is_not_markdown() {
    for path in [
        ".claude/skills/x/scripts/run.sh",
        ".claude/skills/x/helper.py",
        ".claude/skills/x/notes.txt",
        ".claude/commands/deploy.sh",
        ".claude/agents/a.json",
        ".claude/agents/a.md.bak",
    ] {
        let repo = TempDir::new("scan-vouch-script");
        repo.write(path, b"echo hi");
        let files = scan_ok(repo.path(), None, &vouching(path, b"echo hi"));
        assert_eq!(names(&files), [path], "{path}");
    }
    // A markdown file with readable front matter and no carrying key is still exempt, next to a script that is not.
    let repo = TempDir::new("scan-vouch-skill-and-script");
    let skill = b"---\nname: x\ndescription: Runs a script.\n---\nRun ./scripts/run.sh.\n";
    repo.write(".claude/skills/x/SKILL.md", skill);
    repo.write(".claude/skills/x/scripts/run.sh", b"echo hi");
    let mut installed = vouching(".claude/skills/x/SKILL.md", skill);
    installed.insert((
        ".claude/skills/x/scripts/run.sh".into(),
        sha256_hex(b"echo hi"),
    ));
    assert_eq!(
        names(&scan_ok(repo.path(), None, &installed)),
        [".claude/skills/x/scripts/run.sh"]
    );
}

#[test]
fn a_memory_key_is_a_carrying_key_for_the_manifest() {
    let text = b"---\nname: k-a\nmemory: project\n---\nBody.\n";
    for path in [".claude/agents/k-a.md", ".claude/skills/s/SKILL.md"] {
        let repo = TempDir::new("scan-vouch-memory");
        repo.write(path, text);
        let files = scan_ok(repo.path(), None, &vouching(path, text));
        assert_eq!(names(&files), [path], "{path}");
    }
}

#[test]
fn a_link_in_place_of_a_folder_above_a_covered_path_is_refused_with_its_path() {
    for (link, covered) in [
        (".claude", ".claude/agents/a.md"),
        (".claude", ".claude/settings.json"),
        (".kiro", ".kiro/settings/mcp.json"),
        (".kiro", ".kiro/agents/a.json"),
    ] {
        let repo = TempDir::new("scan-parent-link");
        let outside = TempDir::new("scan-parent-outside");
        outside.write(&covered[link.len() + 1..], b"{}");
        std::os::unix::fs::symlink(outside.path(), repo.path().join(link)).unwrap();
        let scan = scan_of(&repo);
        // The link is named once, even though several covered paths lie below it, and the files below it are not read.
        assert_eq!(refused(&scan), [link], "{covered}");
        let reason = &scan.as_ref().unwrap_err()[0].reason;
        assert!(reason.contains("link"), "{reason}");
    }
    // A link in the middle: `.kiro/settings` is the link, `.kiro` is a folder.
    let repo = TempDir::new("scan-parent-link-mid");
    let outside = TempDir::new("scan-parent-outside-mid");
    outside.write("mcp.json", b"{}");
    repo.mkdir(".kiro");
    std::os::unix::fs::symlink(outside.path(), repo.path().join(".kiro/settings")).unwrap();
    assert_eq!(refused(&scan_of(&repo)), [".kiro/settings"]);
    // A dangling link in place of the folder is refused too, and a plain folder is not.
    let repo = TempDir::new("scan-parent-dangling");
    std::os::unix::fs::symlink(repo.path().join("nowhere"), repo.path().join(".claude")).unwrap();
    assert_eq!(refused(&scan_of(&repo)), [".claude"]);
    let repo = TempDir::new("scan-parent-plain");
    repo.write(".claude/settings.json", b"{}");
    assert!(scan_of(&repo).is_ok());
}

#[test]
fn a_scan_of_more_than_the_total_byte_cap_is_refused_with_the_cause() {
    let total_mib = (MAX_TOTAL_BYTES / (1024 * 1024)) as usize;
    let block = vec![b'x'; 1024 * 1024];
    // Exactly the cap is read.
    let repo = TempDir::new("scan-cap-at");
    for n in 0..total_mib {
        repo.write(&format!(".claude/skills/s/f{n:02}.md"), &block);
    }
    let files = scan_ok(repo.path(), None, &InstalledFiles::new());
    assert_eq!(files.len(), total_mib);
    // One more byte is not, and no file is returned.
    repo.write(".claude/skills/s/one-more.md", b"x");
    let scan = scan_of(&repo);
    let unreadable = scan.as_ref().expect_err("over the cap");
    assert!(!unreadable.is_empty());
    assert!(
        unreadable
            .iter()
            .all(|u| u.reason.contains("16 MiB in all")),
        "{unreadable:?}"
    );
}

#[test]
fn the_total_byte_cap_counts_the_folders_above_the_project_too() {
    let repo = TempDir::new("scan-cap-above");
    repo.mkdir(".git");
    let block = vec![b'x'; 1024 * 1024];
    let half = (MAX_TOTAL_BYTES / (1024 * 1024)) as usize / 2 + 1;
    for n in 0..half {
        repo.write(&format!(".claude/skills/s/f{n:02}.md"), &block);
        repo.write(&format!("pkg/.claude/skills/s/f{n:02}.md"), &block);
    }
    let pkg = repo.path().join("pkg");
    let scan = scan_repo_config(&pkg, None, &pkg, &InstalledFiles::new());
    assert!(scan.is_err(), "each folder is under the cap, both are not");
}

// --- the trust record is checked before the user is asked ----------------------------------------------------------------

#[test]
fn can_record_refuses_a_record_that_a_change_would_leave_alone() {
    let cases: [(&str, &[u8]); 4] = [
        ("damaged", b"{ not json"),
        ("no trusted object", br#"{"schema_version":1}"#),
        (
            "newer",
            br#"{"schema_version":2,"trusted":{"/repo":{"plan":"x"}}}"#,
        ),
        ("empty", b""),
    ];
    for (label, text) in cases {
        let home = TempDir::new("trust-can-record-bad");
        let path = home.write(".konductor/trust.json", text);
        let mut store = FileTrustStore::new(Some(home.path()));
        let before = store.can_record().expect_err(label);
        let after = store.record("/repo", "plan", &hash('a')).expect_err(label);
        assert_eq!(before, after, "{label}");
        assert!(before.0.contains("trust.json"), "{label}: {}", before.0);
        assert_eq!(fs::read(path).unwrap(), text, "{label}");
    }
    // A link where the record should be, and a folder, are refused too.
    let home = TempDir::new("trust-can-record-link");
    home.write("elsewhere.json", b"{}");
    home.mkdir(".konductor");
    std::os::unix::fs::symlink(
        home.path().join("elsewhere.json"),
        home.path().join(".konductor/trust.json"),
    )
    .unwrap();
    assert!(FileTrustStore::new(Some(home.path())).can_record().is_err());
    let home = TempDir::new("trust-can-record-dir");
    home.mkdir(".konductor/trust.json");
    assert!(FileTrustStore::new(Some(home.path())).can_record().is_err());
}

#[test]
fn can_record_refuses_a_folder_that_cannot_be_written_and_writes_nothing() {
    let home = TempDir::new("trust-can-record-ro");
    let dir = home.mkdir(".konductor");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let store = FileTrustStore::new(Some(home.path()));
    let result = store.can_record();
    // A user that can write anywhere, root for one, is not refused. Restore the mode before the assertion can fail.
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    let error = result.expect_err("a read-only folder");
    assert!(error.0.contains(".konductor"), "{}", error.0);
    let left: Vec<_> = fs::read_dir(&dir).unwrap().collect();
    assert!(left.is_empty(), "{left:?}");
    // With no folder yet, the folder above it is the one that has to be writable.
    let home = TempDir::new("trust-can-record-ro-home");
    fs::set_permissions(home.path(), fs::Permissions::from_mode(0o500)).unwrap();
    let result = FileTrustStore::new(Some(home.path())).can_record();
    fs::set_permissions(home.path(), fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err());
    assert!(!home.path().join(".konductor").exists());
}

#[test]
fn can_record_is_ok_with_no_record_or_folder_yet_and_makes_neither() {
    let home = TempDir::new("trust-can-record-fresh");
    let store = FileTrustStore::new(Some(home.path()));
    store.can_record().unwrap();
    assert!(!home.path().join(".konductor").exists());
    let mut store = FileTrustStore::new(Some(home.path()));
    store.record("/repo", "plan", &hash('a')).unwrap();
    store.can_record().unwrap();
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

// --- Kiro agent files that the harness loads and a strict reader would skip --------------------------------------------

/// The Kiro definitions of `k-architect` found in `files`, and for each its file, whether it is ambiguous and whether
/// its tools are shown as a list.
fn kiro_seen(files: &[(&str, &[u8])]) -> Vec<(String, bool, bool)> {
    let (project, home) = (TempDir::new("cat-kl1"), TempDir::new("cat-kl2"));
    for (path, bytes) in files {
        project.write(path, bytes);
    }
    catalog(&project, &home)
        .definitions("k-architect")
        .into_iter()
        .filter(|d| d.runner == Runner::KiroCli)
        .map(|d| {
            (
                d.file,
                d.ambiguous,
                matches!(d.tools, AgentTools::Listed(_)),
            )
        })
        .collect()
}

#[test]
fn a_kiro_file_with_deep_nesting_or_a_repeated_unknown_key_is_read_like_kiro_does() {
    // 64 levels inside `x` made this build skip a file that Kiro loads. Up to 128 levels are read now.
    for depth in [63, 64, 100, 126] {
        let nest = format!("{}{}", "[".repeat(depth), "]".repeat(depth));
        let text = format!(r#"{{"name":"k-architect","x":{nest},"allowedTools":["fs_read"]}}"#);
        let found = kiro_files(&[(".kiro/agents/other.json", &text)], "k-architect");
        assert_eq!(found.len(), 1, "depth {depth}");
        assert_eq!(found[0].tools, listed(&["fs_read"]), "depth {depth}");
        assert!(!found[0].ambiguous, "depth {depth}");
    }
    // A key that is repeated and not read is accepted, and the tools are shown.
    let found = kiro_files(
        &[(
            ".kiro/agents/other.json",
            r#"{"name":"k-architect","x":1,"x":2,"allowedTools":["fs_read"]}"#,
        )],
        "k-architect",
    );
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].tools, listed(&["fs_read"]));
    assert!(!found[0].ambiguous);
}

#[test]
fn a_kiro_file_that_does_not_parse_but_mentions_the_id_is_an_ambiguous_candidate_whatever_its_name()
{
    let nest = format!("{}{}", "[".repeat(200), "]".repeat(200));
    let too_deep = format!(r#"{{"name":"k-architect","x":{nest},"allowedTools":["shell"]}}"#);
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("trailing comma", br#"{"name":"k-architect",}"#.to_vec()),
        (
            "line comment",
            b"{\"name\":\"k-architect\", // x\n\"allowedTools\":[\"shell\"]}".to_vec(),
        ),
        (
            "block comment",
            b"{/* x */\"name\":\"k-architect\",\"allowedTools\":[\"shell\"]}".to_vec(),
        ),
        (
            "name repeated, the last wins",
            br#"{"name":"k-architect","name":"other","allowedTools":["shell"]}"#.to_vec(),
        ),
        (
            "name repeated, the first is another",
            br#"{"name":"other","name":"k-architect","allowedTools":["shell"]}"#.to_vec(),
        ),
        (
            "allowedTools repeated",
            br#"{"name":"k-architect","allowedTools":["fs_read"],"allowedTools":["shell"]}"#
                .to_vec(),
        ),
        (
            "invalid UTF-8 in an ignored string",
            b"{\"name\":\"k-architect\",\"description\":\"\xff\",\"allowedTools\":[\"shell\"]}"
                .to_vec(),
        ),
        ("deeper than 128", too_deep.into_bytes()),
        (
            "the id written with JSON escapes",
            br#"{"name":"k\u002darchitect",}"#.to_vec(),
        ),
        (
            "the id in a longer text",
            br#"{"description":"stands in for k-architect","name":"x",}"#.to_vec(),
        ),
    ];
    for (label, bytes) in cases {
        // The stem is not the id, so a strict reader skipped the file.
        let found = kiro_seen(&[(".kiro/agents/other.json", &bytes)]);
        assert_eq!(
            found,
            [(".kiro/agents/other.json".to_string(), true, false)],
            "{label}"
        );
    }
}

#[test]
fn a_kiro_file_that_does_not_parse_and_does_not_mention_the_id_is_not_a_candidate() {
    for bytes in [
        &br#"{"name":"other",}"#[..],
        b"{",
        b"not json at all",
        b"{\"name\":\"other\",\"x\":\"\xff\"}",
    ] {
        assert!(kiro_seen(&[(".kiro/agents/other.json", bytes)]).is_empty());
    }
    // With the id as its file name, the file is shown as unreadable but not ambiguous, as before.
    let found = kiro_seen(&[(".kiro/agents/k-architect.json", b"{")]);
    assert_eq!(
        found,
        [(".kiro/agents/k-architect.json".to_string(), false, false)]
    );
}

#[test]
fn a_kiro_file_that_is_not_utf8_is_never_shown_as_a_parsed_definition() {
    // The file would parse once the bad byte is replaced, and it names the id, but its tools are not shown.
    let bytes = b"{\"name\":\"k-architect\",\"x\":\"\xff\",\"allowedTools\":[\"shell\"]}";
    let found = kiro_seen(&[(".kiro/agents/other.json", bytes)]);
    assert_eq!(
        found,
        [(".kiro/agents/other.json".to_string(), true, false)]
    );
    let found = kiro_seen(&[(".kiro/agents/k-architect.json", bytes)]);
    assert_eq!(
        found,
        [(".kiro/agents/k-architect.json".to_string(), true, false)]
    );
}

#[test]
fn a_kiro_file_named_for_the_id_with_no_name_is_an_ambiguous_candidate() {
    for text in [
        r#"{"allowedTools":["shell"]}"#,
        r#"{"Name":"k-architect","allowedTools":["shell"]}"#,
        "{}",
    ] {
        let found = kiro_seen(&[(".kiro/agents/k-architect.json", text.as_bytes())]);
        assert_eq!(
            found,
            [(".kiro/agents/k-architect.json".to_string(), true, false)],
            "{text}"
        );
    }
    // A file with another file name and no name is not a candidate, and neither is one that is not an object.
    assert!(kiro_seen(&[(".kiro/agents/other.json", b"{}")]).is_empty());
    assert!(kiro_seen(&[(".kiro/agents/k-architect.json", b"[]")]).is_empty());
    assert!(kiro_seen(&[(".kiro/agents/k-architect.JSON", b"{}")]).is_empty());
    // A file that declares the id as well makes it ambiguous in the usual way.
    let found = kiro_seen(&[
        (".kiro/agents/k-architect.json", b"{}"),
        (".kiro/agents/other.json", br#"{"name":"k-architect"}"#),
    ]);
    assert_eq!(found.len(), 1);
    assert!(found[0].1);
}

#[test]
fn a_candidate_that_only_may_declare_the_kiro_agent_hides_the_home_agent() {
    let (project, home) = (TempDir::new("cat-kg1"), TempDir::new("cat-kg2"));
    home.write(
        ".kiro/agents/k-architect.json",
        br#"{"name":"k-architect","allowedTools":["shell"]}"#,
    );
    project.write(
        ".kiro/agents/other.json",
        br#"{"name":"k-architect","allowedTools":["fs_read"],}"#,
    );
    let found: Vec<_> = catalog(&project, &home)
        .definitions("k-architect")
        .into_iter()
        .filter(|d| d.runner == Runner::KiroCli)
        .collect();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].placement, Placement::Project);
    assert!(found[0].ambiguous);
}

#[test]
fn a_claude_memory_key_with_a_tools_list_leaves_the_tools_unknown() {
    for memory in [
        "project",
        "user",
        "local",
        "\"project\"",
        "'user'",
        "local # x",
    ] {
        let text = format!("---\nname: k-a\ntools: Read\nmemory: {memory}\n---\n");
        assert!(
            matches!(claude(&text), AgentTools::Unknown(_)),
            "memory: {memory}"
        );
        // The order of the keys does not matter.
        let text = format!("---\nname: k-a\nmemory: {memory}\ntools: [Read]\n---\n");
        assert!(
            matches!(claude(&text), AgentTools::Unknown(_)),
            "memory: {memory}"
        );
    }
    // With no `tools` key every tool is available anyway, and a `memory` value that grants nothing leaves the list.
    assert_eq!(
        claude("---\nname: k-a\nmemory: project\n---\n"),
        AgentTools::EveryToolNonePreApproved
    );
    for text in [
        "---\nname: k-a\ntools: Read\nmemory: none\n---\n",
        "---\nname: k-a\ntools: Read\nmemoryless: project\n---\n",
        "---\nname: k-a\ntools: Read\ndescription: memory: project\n---\n",
    ] {
        assert_eq!(claude(text), listed(&["Read"]), "{text:?}");
    }
    // The key is also one that the agent sets besides its tools.
    let found = claude_files(&[(
        ".claude/agents/k-a.md",
        "---\nname: k-a\ntools: Read\nmemory: project\n---\n",
    )]);
    assert_eq!(found[0].also_sets, ["memory"]);
}

// --- Kiro 3 loads markdown agents and subfolders of `.kiro/agents` ------------------------------------------------------

#[test]
fn a_kiro_markdown_agent_at_any_depth_or_as_a_dotfile_is_found_with_unknown_tools() {
    let md = "---\nname: k-architect\ntools: [shell]\npermissions:\n  rules:\n    - capability: shell\n      effect: allow\n---\nbody\n";
    for path in [
        ".kiro/agents/x.md",
        ".kiro/agents/a/x.md",
        ".kiro/agents/a/b/c/x.md",
        ".kiro/agents/.hidden.md",
        ".kiro/agents/a/.hidden.md",
        ".kiro/agents/k-architect.md",
    ] {
        let found = kiro_files(&[(path, md)], "k-architect");
        assert_eq!(found.len(), 1, "{path}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{path}");
        assert_eq!(found[0].file, path, "{path}");
        assert!(!found[0].ambiguous, "{path}");
    }
    // The name is read as for a Claude file: another name, or the id only in the body, is not this agent.
    for text in [
        "---\nname: k-other\n---\nk-architect\n",
        "---\nname: k-other\ndescription: k-architect\n---\n",
        "---\ndescription: k-architect\n---\n",
        "no front matter k-architect\n",
    ] {
        let found = kiro_files(&[(".kiro/agents/a/x.md", text)], "k-architect");
        assert!(found.is_empty(), "{text:?}");
    }
}

#[test]
fn a_kiro_markdown_agent_with_no_name_takes_its_file_stem_and_is_ambiguous() {
    for text in [
        "---\ntools: [shell]\n---\n",
        "---\nname:\n---\n",
        "\u{feff}---\ntools: [shell]\n---\n",
    ] {
        let found = kiro_files(&[(".kiro/agents/sub/k-architect.md", text)], "k-architect");
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(found[0].ambiguous, "{text:?}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{text:?}");
    }
    // A stem that is not the id is not a candidate, and a file with another name wins over its stem.
    assert!(kiro_files(
        &[(".kiro/agents/x.md", "---\ntools: [shell]\n---\n")],
        "k-architect"
    )
    .is_empty());
    assert!(kiro_files(
        &[(".kiro/agents/k-architect.md", "---\nname: k-other\n---\n")],
        "k-architect"
    )
    .is_empty());
}

/// The text of a Kiro markdown agent that the shell runs from with no prompt, with `line` among its front matter lines
/// before the `name`.
fn kiro_md_with(line: &str) -> String {
    format!(
        "---\n{line}\nname: k-architect\ntools: [shell]\npermissions:\n  rules:\n    - capability: shell\n      effect: allow\n---\nbody\n"
    )
}

#[test]
fn a_dash_run_inside_a_line_of_a_kiro_markdown_front_matter_does_not_hide_the_name() {
    // Kiro closes the front matter at the first line that STARTS with `---`, so these lines are ordinary text and the
    // `name` after them is read.
    for line in [
        "description: a---b",
        "description: \"x --- y\"",
        "# ---",
        "description: |\n  ---",
        "description: |\n  text\n   ---",
        "tools:\n- ---",
        "description: x ---",
    ] {
        let md = kiro_md_with(line);
        for path in [
            ".kiro/agents/x.md",
            ".kiro/agents/a/b/x.md",
            ".kiro/agents/.hidden.md",
            ".kiro/agents/a/.hidden.md",
        ] {
            let found = kiro_files(&[(path, &md)], "k-architect");
            assert_eq!(found.len(), 1, "{path} {line:?}");
            assert_eq!(found[0].file, path, "{path} {line:?}");
            assert!(
                matches!(found[0].tools, AgentTools::Unknown(_)),
                "{path} {line:?}"
            );
            assert!(!found[0].ambiguous, "{path} {line:?}");
        }
    }
    // An indented ` ---` does not close the front matter. Before the first key it is an indented root mapping this
    // build does not read, so the file is the agent or an ambiguous one, and never hidden.
    let found = kiro_files(
        &[(".kiro/agents/a/x.md", &kiro_md_with(" ---"))],
        "k-architect",
    );
    assert_eq!(found.len(), 1);
    assert!(matches!(found[0].tools, AgentTools::Unknown(_)));
    // A `name` value with a dash run in it is another agent, and a name after a closing line is not read.
    for text in [
        "---\nname: k-architect---x\n---\n",
        "---\ndescription: a---b\nname: k-other\n---\nname: k-architect\n",
        "---\n----\nname: k-architect\n---\n",
        "---\n---x\nname: k-architect\n---\n",
        "---\n--- # c\nname: k-architect\n---\n",
    ] {
        assert!(
            kiro_files(&[(".kiro/agents/x.md", text)], "k-architect").is_empty(),
            "{text:?}"
        );
    }
}

#[test]
fn a_kiro_markdown_file_whose_front_matter_reads_the_id_in_a_form_this_build_cannot_follow_stays_ambiguous_past_a_dash_run(
) {
    for text in [
        "---\ndescription: a---b\nname: \"k-arch\\x69tect\"\n---\n",
        "---\ndescription: &n k-architect\nnote: a---b\nname: *n\n---\n",
    ] {
        let found = kiro_files(&[(".kiro/agents/a/x.md", text)], "k-architect");
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(found[0].ambiguous, "{text:?}");
    }
}

#[test]
fn a_hidden_kiro_markdown_agent_beats_or_clashes_with_a_json_for_the_same_id() {
    let json = r#"{"name":"k-architect","allowedTools":["fs_read"]}"#;
    let md = kiro_md_with("description: a---b");
    // With the shown JSON beside it, a hidden markdown agent is a second declaration whatever the depth: the answer is
    // the markdown file or an ambiguous one, never the JSON alone.
    for files in [
        [
            (".kiro/agents/k-architect.md", &md),
            (".kiro/agents/sub/a.json", &json.to_string()),
        ],
        [
            (".kiro/agents/sub/x.md", &md),
            (".kiro/agents/k-architect.json", &json.to_string()),
        ],
        [
            (".kiro/agents/sub/x.md", &md),
            (".kiro/agents/sub/a.json", &json.to_string()),
        ],
        [
            (".kiro/agents/k-architect.md", &md),
            (".kiro/agents/k-architect.json", &json.to_string()),
        ],
    ] {
        let found = kiro_files(&files.map(|(p, t)| (p, t.as_str())), "k-architect");
        assert_eq!(found.len(), 1, "{files:?}");
        assert!(found[0].ambiguous, "{files:?}");
        assert!(
            matches!(found[0].tools, AgentTools::Unknown(_)),
            "{files:?}"
        );
    }
}

#[test]
fn a_home_kiro_markdown_agent_with_a_dash_run_in_a_line_is_found() {
    let (project, home) = (TempDir::new("cat-kh1"), TempDir::new("cat-kh2"));
    home.write(
        ".kiro/agents/a/.x.md",
        kiro_md_with("description: a---b").as_bytes(),
    );
    let found: Vec<_> = catalog(&project, &home)
        .definitions("k-architect")
        .into_iter()
        .filter(|d| d.runner == Runner::KiroCli)
        .collect();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].placement, Placement::Home);
    assert_eq!(found[0].file, "~/.kiro/agents/a/.x.md");
    assert!(matches!(found[0].tools, AgentTools::Unknown(_)));
}

#[test]
fn the_prompt_file_of_a_kiro_json_agent_is_not_a_second_declaration() {
    let json = r#"{"name":"k-architect","allowedTools":["fs_read"]}"#;
    for prompt in [
        ".kiro/agents/k-architect.md",
        ".kiro/agents/prompts/k-architect.md",
        ".kiro/agents/prompts/other.md",
    ] {
        let found = kiro_files(
            &[
                (".kiro/agents/k-architect.json", json),
                (prompt, "You are k-architect. Be careful.\n"),
            ],
            "k-architect",
        );
        assert_eq!(found.len(), 1, "{prompt}");
        assert_eq!(found[0].tools, listed(&["fs_read"]), "{prompt}");
        assert!(!found[0].ambiguous, "{prompt}");
    }
    // A markdown file with a front matter block that names the id is still a second declaration.
    let found = kiro_files(
        &[
            (".kiro/agents/k-architect.json", json),
            (
                ".kiro/agents/prompts/k-architect.md",
                "---\nname: k-architect\n---\nbody\n",
            ),
        ],
        "k-architect",
    );
    assert_eq!(found.len(), 1);
    assert!(found[0].ambiguous);
    assert!(matches!(found[0].tools, AgentTools::Unknown(_)));
    // So is one whose block opens and cannot be read in full but mentions the id.
    let found = kiro_files(
        &[
            (".kiro/agents/k-architect.json", json),
            (
                ".kiro/agents/k-architect.md",
                "---\n  name: k-architect\n---\n",
            ),
        ],
        "k-architect",
    );
    assert!(found[0].ambiguous);
    // A file with no front matter block is not a candidate even when it is the only one and is named for the id.
    assert!(kiro_files(
        &[(".kiro/agents/k-architect.md", "no front matter\n")],
        "k-architect"
    )
    .is_empty());
}

#[test]
fn a_kiro_markdown_agent_whose_front_matter_cannot_be_read_and_may_name_the_id_is_ambiguous() {
    for text in [
        "---\ndescription: &n k-architect\nname: *n\n---\n",
        "---\nname: \"k-arch\\x69tect\"\n---\n",
        "---\n  name: k-architect\n---\n",
    ] {
        let found = kiro_files(&[(".kiro/agents/a/b/x.md", text)], "k-architect");
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(found[0].ambiguous, "{text:?}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{text:?}");
    }
    // The same text without the id is not a candidate.
    assert!(kiro_files(
        &[(
            ".kiro/agents/a/x.md",
            "---\ndescription: &n k-other\nname: *n\n---\n"
        )],
        "k-architect"
    )
    .is_empty());
}

#[test]
fn a_kiro_json_agent_in_a_subfolder_is_read_like_a_top_level_one() {
    let json = r#"{"name":"k-architect","allowedTools":["fs_read"]}"#;
    for path in [".kiro/agents/sub/x.json", ".kiro/agents/a/b/c/.x.json"] {
        let found = kiro_files(&[(path, json)], "k-architect");
        assert_eq!(found.len(), 1, "{path}");
        assert_eq!(found[0].tools, listed(&["fs_read"]), "{path}");
        assert_eq!(found[0].file, path);
        assert!(!found[0].ambiguous, "{path}");
    }
    // One that mentions the id but does not parse is an ambiguous candidate.
    for text in [
        r#"{"name":"k-architect","allowedTools":["shell"],}"#,
        "// c\n{\"name\":\"k-architect\"}",
        r#"{"name":"k-architect","name":"k-other"}"#,
    ] {
        let found = kiro_files(&[(".kiro/agents/sub/x.json", text)], "k-architect");
        assert_eq!(found.len(), 1, "{text:?}");
        assert!(found[0].ambiguous, "{text:?}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{text:?}");
    }
    // One that does not parse and does not mention the id, or has another name, is not a candidate.
    assert!(kiro_files(&[(".kiro/agents/sub/x.json", "{")], "k-architect").is_empty());
    assert!(kiro_files(
        &[(".kiro/agents/sub/x.json", r#"{"name":"k-other"}"#)],
        "k-architect"
    )
    .is_empty());
    // A nameless file in a subfolder named for the id takes its stem for the id.
    let found = kiro_files(
        &[(".kiro/agents/sub/k-architect.json", "{}")],
        "k-architect",
    );
    assert_eq!(found.len(), 1);
    assert!(found[0].ambiguous);
}

#[test]
fn two_kiro_files_of_any_kind_or_depth_that_declare_one_id_are_ambiguous() {
    let json = r#"{"name":"k-architect","allowedTools":["fs_read"]}"#;
    let md = "---\nname: k-architect\n---\n";
    for files in [
        [(".kiro/agents/a.json", json), (".kiro/agents/sub/b.md", md)],
        [(".kiro/agents/a/x.md", md), (".kiro/agents/b/y.md", md)],
        [
            (".kiro/agents/a.json", json),
            (".kiro/agents/sub/b.json", json),
        ],
    ] {
        let found = kiro_files(&files, "k-architect");
        assert_eq!(found.len(), 1);
        assert!(found[0].ambiguous, "{files:?}");
        assert!(
            matches!(found[0].tools, AgentTools::Unknown(_)),
            "{files:?}"
        );
    }
}

#[test]
fn a_kiro_markdown_or_subfolder_agent_in_the_project_hides_the_home_agent() {
    let (project, home) = (TempDir::new("cat-km1"), TempDir::new("cat-km2"));
    home.write(
        ".kiro/agents/k-architect.json",
        br#"{"name":"k-architect","allowedTools":["fs_read"]}"#,
    );
    project.write(".kiro/agents/a/b/x.md", b"---\nname: k-architect\n---\n");
    let found: Vec<_> = catalog(&project, &home)
        .definitions("k-architect")
        .into_iter()
        .filter(|d| d.runner == Runner::KiroCli)
        .collect();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].placement, Placement::Project);
    assert!(matches!(found[0].tools, AgentTools::Unknown(_)));
}

#[test]
fn the_scan_hashes_markdown_files_and_dotfiles_in_subfolders_of_the_kiro_agent_folder() {
    for path in [
        ".kiro/agents/x.md",
        ".kiro/agents/a/b/c/x.md",
        ".kiro/agents/.hidden.md",
        ".kiro/agents/sub/x.json",
        ".kiro/agents/sub/.x.json",
    ] {
        let repo = TempDir::new("scan-kiro-deep");
        let none = hash_of_scan(&repo);
        repo.write(path, b"one");
        let one = hash_of_scan(&repo);
        assert_ne!(none, one, "adding {path}");
        repo.write(path, b"two");
        assert_ne!(one, hash_of_scan(&repo), "editing {path}");
    }
}

#[test]
fn a_kiro_file_with_a_number_too_large_for_an_f64_is_not_shown_and_counts_when_it_mentions_the_id()
{
    for number in ["1e999", "1e400", "1E+309"] {
        let text = format!(r#"{{"name":"k-architect","allowedTools":["fs_read"],"x":{number}}}"#);
        let found = kiro_files(&[(".kiro/agents/other.json", &text)], "k-architect");
        assert_eq!(found.len(), 1, "{number}");
        assert!(found[0].ambiguous, "{number}");
        assert!(matches!(found[0].tools, AgentTools::Unknown(_)), "{number}");
        // Without the id in the text it is not a candidate.
        let text = format!(r#"{{"name":"k-other","x":{number}}}"#);
        assert!(kiro_files(&[(".kiro/agents/other.json", &text)], "k-architect").is_empty());
    }
}

#[test]
fn use_legacy_mcp_json_is_a_key_a_kiro_agent_also_sets() {
    let found = kiro_files(
        &[(
            ".kiro/agents/a.json",
            r#"{"name":"k-architect","allowedTools":[],"useLegacyMcpJson":true}"#,
        )],
        "k-architect",
    );
    assert_eq!(found[0].also_sets, ["useLegacyMcpJson"]);
}

#[test]
fn a_claude_memory_value_in_any_form_but_a_plain_other_word_leaves_the_tools_unknown() {
    for memory in [
        "\t# c",
        "project\t# c",
        "\"project\"",
        "\"proj\\x65ct\"",
        "\"pro\\u006aect\"",
        "*a",
        "&a user",
        "!!str user",
        "!foo user",
        "|-",
        ">-",
        "|",
        ">",
        "'local'",
        "",
        "none#x",
        "no ne",
        "\"none\"",
    ] {
        let text = format!(
            "---\nname: k-a\ntools: Read\nmemory:{}{memory}\n---\n",
            if memory.starts_with('\t') { "" } else { " " }
        );
        assert!(
            matches!(claude(&text), AgentTools::Unknown(_)),
            "memory: {memory:?}"
        );
    }
    // The value on the next indented line, a double-quoted value continued with a backslash, and a block scalar body.
    for text in [
        "---\nname: k-a\ntools: Read\nmemory:\n  project\n---\n",
        "---\nname: k-a\ntools: Read\nmemory: none\n  user\n---\n",
        "---\nname: k-a\ntools: Read\nmemory: \"proj\\\n  ect\"\n---\n",
        "---\nname: k-a\ntools: Read\nmemory: |-\n  project\n---\n",
        "---\nname: k-a\ntools: Read\nmemory: >-\n  user\n---\n",
        "---\nname: k-a\nmemory: &a user\ntools: [Read]\nx: *a\n---\n",
    ] {
        assert!(matches!(claude(text), AgentTools::Unknown(_)), "{text:?}");
    }
    // A plain word that is not `user`, `project` or `local` grants nothing, with or without a comment.
    for text in [
        "---\nname: k-a\ntools: Read\nmemory: none\n---\n",
        "---\nname: k-a\ntools: Read\nmemory: disabled # c\n---\n",
        "---\nname: k-a\ntools: Read\nmemory:  off  \n---\n",
        "---\nname: k-a\ntools: Read\nmemory: none\n# c\ndescription: x\n---\n",
    ] {
        assert_eq!(claude(text), listed(&["Read"]), "{text:?}");
    }
}

// --- a generated differential test of the agent front matter reading -------------------------------------------------
//
// The oracle first cuts the text the way the harness is assumed to (see `front_matter` in
// `adapters/src/agent_catalog.rs`, which holds the one statement of that assumption), then reads the cut text as YAML
// 1.2 with anchors, aliases and merge keys resolved, built on the event parser that `workflow_core::yaml` uses (the
// loader itself refuses aliases, so it cannot see the forms that matter here). Two properties must hold for every generated front matter the oracle can read:
//
// - if the oracle reads the root key `name` as the id, the catalog finds the agent or marks it unreadable, and
//   never reads another agent;
// - if the oracle reads any of `tools`, `hooks`, `mcpServers` or `permissionMode` as a root key, the install manifest
//   cannot exempt the file from the trust hash.
//
// A form the oracle refuses but a lenient YAML reader takes (a double-quoted value continued at column 0, a tab after
// the colon) is not generated. It is a row of the guard test above.

use std::collections::HashMap;

use saphyr_parser::{Event, Parser, StrInput};

const ID: &str = "k-architect";
const CARRYING: [&str; 4] = ["tools", "hooks", "mcpServers", "permissionMode"];
const GENERATED_CASES: usize = 5000;
const SEED: u64 = 0x5eed_1e7a_57c0_de01;

/// The front matter the harness is assumed to read from `text`: the text after the opening fence line up to the first
/// `---` after it, wherever that sits. This is the lazy pattern given on `front_matter` in
/// `adapters/src/agent_catalog.rs`, applied here on its own so the oracle does not share code with what it checks.
/// `None` when the pattern does not match, which is a file with no front matter for the harness.
fn harness_front_matter(text: &str) -> Option<&str> {
    // `\s` in JavaScript: Unicode white space and the byte order mark, but not U+0085.
    let js_space = |c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}';
    let rest = text.strip_prefix("---")?;
    let white = &rest[..rest.len() - rest.trim_start_matches(js_space).len()];
    // `\s*\n` takes the white space up to its last line feed, so a blank line at the start is skipped and the
    // indentation of the first line is kept.
    let body = &rest[white.rfind('\n')? + 1..];
    Some(&body[..body.find("---")?])
}

#[derive(Clone, Debug, PartialEq)]
enum Yv {
    Scalar(String),
    Map(Vec<(Yv, Yv)>),
    Seq(Vec<Yv>),
}

/// One node and everything in it, from the event that starts it. An alias is the node its anchor named.
fn yaml_value<'a>(
    parser: &mut Parser<'a, StrInput<'a>>,
    event: Event<'a>,
    anchors: &mut HashMap<usize, Yv>,
) -> Option<Yv> {
    let (value, anchor) = match event {
        Event::Scalar(text, _, anchor, _) => (Yv::Scalar(text.into_owned()), anchor),
        Event::Alias(id) => return anchors.get(&id).cloned(),
        Event::SequenceStart(anchor, _) => {
            let mut items = Vec::new();
            loop {
                let (next, _) = parser.next_event()?.ok()?;
                if matches!(next, Event::SequenceEnd) {
                    break;
                }
                items.push(yaml_value(parser, next, anchors)?);
            }
            (Yv::Seq(items), anchor)
        }
        Event::MappingStart(anchor, _) => {
            let mut pairs = Vec::new();
            loop {
                let (key, _) = parser.next_event()?.ok()?;
                if matches!(key, Event::MappingEnd) {
                    break;
                }
                let key = yaml_value(parser, key, anchors)?;
                let (value, _) = parser.next_event()?.ok()?;
                pairs.push((key, yaml_value(parser, value, anchors)?));
            }
            (Yv::Map(pairs), anchor)
        }
        _ => return None,
    };
    if anchor != 0 {
        anchors.insert(anchor, value.clone());
    }
    Some(value)
}

/// The root mapping of `front` as `(key, value)` pairs, with the entries of a `<<` merge key added unless the mapping
/// has the key itself. `None` when the text is not YAML this parser reads, or its root is not a mapping.
fn oracle_entries(front: &str) -> Option<Vec<(Yv, Yv)>> {
    let mut parser = Parser::new_from_str(front);
    let mut anchors = HashMap::new();
    let (first, _) = parser.next_event()?.ok()?; // StreamStart
    debug_assert!(matches!(first, Event::StreamStart));
    let (start, _) = parser.next_event()?.ok()?;
    if !matches!(start, Event::DocumentStart(_)) {
        return None;
    }
    let (root, _) = parser.next_event()?.ok()?;
    let Yv::Map(pairs) = yaml_value(&mut parser, root, &mut anchors)? else {
        return None;
    };
    let merge = Yv::Scalar("<<".into());
    let mut merged = Vec::new();
    for (key, value) in &pairs {
        if *key == merge {
            match value {
                Yv::Map(entries) => merged.extend(entries.clone()),
                Yv::Seq(items) => {
                    for item in items {
                        if let Yv::Map(entries) = item {
                            merged.extend(entries.clone());
                        }
                    }
                }
                Yv::Scalar(_) => {}
            }
        }
    }
    let mut all: Vec<(Yv, Yv)> = pairs.iter().filter(|(k, _)| *k != merge).cloned().collect();
    for (key, value) in merged {
        if !all.iter().any(|(k, _)| *k == key) {
            all.push((key, value));
        }
    }
    Some(all)
}

/// Xorshift64: a fixed seed gives the same cases on every run, with no dependency.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn chance(&mut self, percent: usize) -> bool {
        self.below(100) < percent
    }
}

/// A generated front matter: its lines without their line breaks, and the break after each one.
#[derive(Clone)]
struct Case {
    lines: Vec<String>,
    ends: Vec<&'static str>,
}

impl Case {
    fn front(&self) -> String {
        self.lines
            .iter()
            .zip(&self.ends)
            .map(|(line, end)| format!("{line}{end}"))
            .collect()
    }
}

fn strings(lines: &[&str]) -> Vec<String> {
    lines.iter().map(|l| (*l).to_string()).collect()
}

/// The lines of the `name` entry, and the lines before them that an alias in it needs (an anchor holder).
fn name_entry(rng: &mut Rng) -> (Vec<String>, Vec<String>) {
    // The value: what follows the colon, the lines under it, and the holder an alias needs.
    let (inline, extra, holder): (&str, &[&str], &[&str]) = match rng.below(17) {
        0 => ("k-architect", &[], &[]),
        1 => ("\"k-architect\"", &[], &[]),
        2 => ("'k-architect'", &[], &[]),
        3 => ("\"k\\u002darchitect\"", &[], &[]),
        4 => ("\"k\\x2darchitect\"", &[], &[]),
        5 => ("*v", &[], &["description: &v k-architect"]),
        6 => ("*v", &[], &["\"d\": &v \"k-architect\""]),
        7 => ("&b k-architect", &[], &[]),
        8 => ("", &["  k-architect"], &[]),
        9 => ("", &["  *v"], &["description: &v k-architect"]),
        10 => (">-", &["  k-architect"], &[]),
        11 => ("\"k-\\", &["  architect\""], &[]),
        12 => ("k-architect # note", &[], &[]),
        // A `---` after the id: the harness split ends the front matter there, so the value is the id.
        13 => ("k-architect---", &[], &[]),
        14 => ("k-architect --- note", &[], &[]),
        15 => ("\"k-architect---\"", &[], &[]),
        _ => ("k-architect\t# note", &[], &[]),
    };
    let extra = strings(extra);
    let mut pre = strings(holder);
    let with = |key: &str, extra: Vec<String>| {
        let mut lines = vec![if inline.is_empty() {
            format!("{key}:")
        } else {
            format!("{key}: {inline}")
        }];
        lines.extend(extra);
        lines
    };
    let lines = match rng.below(11) {
        0..=2 => with("name", extra),
        3 => with("\"name\"", extra),
        4 => with("'name'", extra),
        5 => with("name ", extra),
        6 => with("&a name", extra),
        7 => {
            pre.push("k: &a name".into());
            with("*a ", extra)
        }
        8 => {
            let mut lines = vec!["? name".to_string()];
            let mut value = with("", extra);
            value[0] = format!(":{}", value[0].trim_start_matches(':'));
            lines.extend(value);
            lines
        }
        9 => with(["\"n\\u0061me\"", "\"\\x6eame\""][rng.below(2)], extra),
        _ => {
            // A merge key: the mapping it merges holds `name`, and sits on another key.
            pre = strings(&match rng.below(3) {
                0 => vec!["base: &m {name: k-architect}"],
                1 => vec!["base: &m {\"name\": \"k-architect\"}"],
                _ => vec!["base: &m", "  name: k-architect"],
            });
            return (pre, strings(&[["<<: *m", "<<: [*m]"][rng.below(2)]]));
        }
    };
    (pre, lines)
}

/// Filler blocks: other keys, carrying keys in disguise, comments and indented lines.
fn filler(rng: &mut Rng) -> Vec<String> {
    let blocks: &[&[&str]] = &[
        &["description: use k-architect here"],
        &["description: &v2 k-architect"],
        &["model: sonnet"],
        &["color: blue"],
        &["tools: Bash"],
        &["\"tools\": Bash"],
        &["'hooks': {}"],
        &["permissionMode : bypassPermissions"],
        &["&t tools: Bash"],
        &["? mcpServers", ": []"],
        &["\"\\x74ools\": Bash"],
        &["tools:", "- Read"],
        &["tools:", "  - Read"],
        &["x: &t2 tools", "*t2 : Bash"],
        &["hooks:", "  pre: x"],
        &["base2: &m2", "  tools: Bash", "<<: *m2"],
        &["# note k-architect"],
        &["# tools: Bash"],
        &["description: note", "  tools: not a key"],
        &["  indented: x"],
        &["  - item"],
        &["name: other"],
        &["name: k-architect-helper"],
        &[""],
        // A `---` inside a value, a comment or a block scalar: the harness split ends the front matter there, and what
        // follows is not read. A hyphen run shorter than three is an ordinary value.
        &["description: does x---y"],
        &["description: \"a --- b\""],
        &["# note --- here"],
        &["description: |", "  ---"],
        &["tools: Read---"],
        &["permissionMode: bypassPermissions---"],
        &["x: a--b"],
        &["x: a---", "tools: Bash"],
    ];
    strings(blocks[rng.below(blocks.len())])
}

fn generate(rng: &mut Rng) -> Case {
    let mut lines;
    if rng.chance(6) {
        let roots: &[&[&str]] = &[
            &["{name: k-architect}"],
            &["{\"name\": \"k-architect\", tools: Bash}"],
            &["{tools: Bash}"],
            &["{a: 1, name: 'k-architect'}"],
            &["{name: k-architect,", "  tools: Bash}"],
            &["[name, k-architect]"],
        ];
        lines = strings(roots[rng.below(roots.len())]);
    } else {
        let (pre, entry) = name_entry(rng);
        let mut blocks: Vec<Vec<String>> = (0..rng.below(4)).map(|_| filler(rng)).collect();
        let at = rng.below(blocks.len() + 1);
        blocks.insert(at, entry);
        lines = pre;
        lines.extend(blocks.into_iter().flatten());
    }
    // Line breaks: all LF, all CRLF, all lone CR, or a mix. The last break is never a lone CR, so the closing fence
    // stays on a line of its own for a reader that splits on LF.
    let mode = rng.below(10);
    let mut ends: Vec<&'static str> = (0..lines.len())
        .map(|_| match mode {
            0..=3 => "\n",
            4..=5 => "\r\n",
            6..=7 => "\r",
            _ => ["\n", "\r\n", "\r"][rng.below(3)],
        })
        .collect();
    if let Some(last) = ends.last_mut() {
        if *last == "\r" {
            *last = "\n";
        }
    }
    Case { lines, ends }
}

/// A catalog and a scan over one file, rewritten for each case.
struct Bed {
    project: TempDir,
    home: TempDir,
}

impl Bed {
    const PATH: &'static str = ".claude/agents/other.md";

    fn new() -> Bed {
        Bed {
            project: TempDir::new("diff-p"),
            home: TempDir::new("diff-h"),
        }
    }

    fn reads_other(&self, text: &str) -> bool {
        self.project.write(Self::PATH, text.as_bytes());
        catalog(&self.project, &self.home)
            .definitions(ID)
            .is_empty()
    }

    fn manifest_exempts(&self, text: &str) -> bool {
        self.project.write(Self::PATH, text.as_bytes());
        let installed = vouching(Self::PATH, text.as_bytes());
        scan_ok(self.project.path(), None, &installed).is_empty()
    }
}

enum Verdict {
    /// The oracle could not read the front matter.
    Skipped,
    /// Both properties hold. Whether the oracle read the id as `name`, and a carrying key.
    Held {
        name: bool,
        carrying: bool,
    },
    Failed(String),
}

fn check(bed: &Bed, case: &Case) -> Verdict {
    let front = case.front();
    let text = format!("---\n{front}---\n");
    let Some(entries) = harness_front_matter(&text).and_then(oracle_entries) else {
        return Verdict::Skipped;
    };
    let name = entries
        .iter()
        .any(|(k, v)| *k == Yv::Scalar("name".into()) && *v == Yv::Scalar(ID.into()));
    let carrying = entries
        .iter()
        .any(|(k, _)| matches!(k, Yv::Scalar(s) if CARRYING.contains(&s.as_str())));
    if name && bed.reads_other(&text) {
        return Verdict::Failed(
            "the oracle reads `name` as the id, and the catalog reads another agent".into(),
        );
    }
    if carrying && bed.manifest_exempts(&text) {
        return Verdict::Failed(
            "the oracle reads a carrying key, and the manifest exempts the file".into(),
        );
    }
    Verdict::Held { name, carrying }
}

/// The case with the fewest lines that still fails, found by deleting one line at a time until none can go.
fn shrink(bed: &Bed, case: &Case) -> Case {
    let mut current = case.clone();
    loop {
        let mut shrunk = false;
        for at in 0..current.lines.len() {
            let mut smaller = current.clone();
            smaller.lines.remove(at);
            smaller.ends.remove(at);
            if matches!(check(bed, &smaller), Verdict::Failed(_)) {
                current = smaller;
                shrunk = true;
                break;
            }
        }
        if !shrunk {
            return current;
        }
    }
}

#[test]
fn generated_front_matter_that_yaml_reads_as_the_id_or_a_carrying_key_never_slips_by() {
    let started = std::time::Instant::now();
    let bed = Bed::new();
    let mut rng = Rng(SEED);
    let (mut skipped, mut names, mut carrying, mut fragments, mut cut_names) = (0, 0, 0, 0, 0);
    for _ in 0..GENERATED_CASES {
        let case = generate(&mut rng);
        let has_fragment = case.lines.iter().any(|line| line.contains("---"));
        fragments += usize::from(has_fragment);
        match check(&bed, &case) {
            Verdict::Skipped => skipped += 1,
            Verdict::Held { name, carrying: c } => {
                names += usize::from(name);
                carrying += usize::from(c);
                cut_names += usize::from(name && has_fragment);
            }
            Verdict::Failed(why) => {
                let smallest = shrink(&bed, &case);
                panic!(
                    "{why}.\nThe smallest front matter that fails ({} of {} lines):\n{:?}",
                    smallest.lines.len(),
                    case.lines.len(),
                    smallest.front()
                );
            }
        }
    }
    // The test must exercise both properties, not pass because the generator makes nothing the oracle can read.
    println!(
        "{GENERATED_CASES} cases, {skipped} refused by the oracle, {names} read `name` as the id, {carrying} read a \
         carrying key, {fragments} with a `---` fragment ({cut_names} of them read `name` as the id), {:?}",
        started.elapsed()
    );
    assert!(
        skipped < GENERATED_CASES / 2,
        "the oracle refused {skipped} cases"
    );
    assert!(names > 300, "only {names} cases read `name` as the id");
    assert!(carrying > 300, "only {carrying} cases read a carrying key");
    // The `---` cases must stay in the mix, and some of them must be ones where the harness split leaves the id.
    assert!(fragments > 500, "only {fragments} cases have a `---`");
    assert!(
        cut_names > 100,
        "only {cut_names} cases with a `---` read `name` as the id"
    );
}
