// SPDX-License-Identifier: Apache-2.0
//! The trust record, the repo tool configuration scan and the agent catalog, through the real file system.

#![cfg(unix)]

mod common;

use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::thread;

use common::TempDir;
use workflow_adapters::repo_config::MAX_ENTRIES;
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
    scan_repo_config(project_root, home, installed)
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
    scan_repo_config(repo.path(), None, &InstalledFiles::new())
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
        ["is a link, which is not followed", "is over 1 MiB"]
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
fn commas_inside_parentheses_do_not_split_a_bare_or_whole_quoted_tools_value() {
    assert_eq!(
        claude("---\ntools: Agent(a, b), Read\n---\n"),
        listed(&["Agent(a, b)", "Read"])
    );
    assert_eq!(
        claude("---\ntools: \"Agent(a, b), Read\"\n---\n"),
        listed(&["Agent(a, b)", "Read"])
    );
    assert_eq!(
        claude("---\ntools:\n  - Agent(a, b)\n  - Read\n---\n"),
        listed(&["Agent(a, b)", "Read"])
    );
    assert_eq!(
        claude("---\ntools: [Agent(a), Read]\n---\n"),
        listed(&["Agent(a)", "Read"])
    );
}

#[test]
fn a_comma_inside_parentheses_in_the_list_form_and_a_stray_parenthesis_are_unknown() {
    for text in [
        "---\ntools: [Agent(a, b)]\n---\n",
        "---\ntools: Agent(a, b\n---\n",
        "---\ntools: Read)\n---\n",
        "---\ntools: [Read)]\n---\n",
        "---\ntools: \"Agent(a, b, Read\"\n---\n",
        "---\ntools:\n  - Agent(a\n  - Read\n---\n",
    ] {
        assert!(
            matches!(claude(text), AgentTools::Unknown(why) if why.contains("cannot read")),
            "{text:?}"
        );
    }
}

#[test]
fn a_claude_agent_in_the_project_wins_over_the_same_id_in_the_home_folder() {
    let (project, home) = (TempDir::new("cat-cp"), TempDir::new("cat-ch"));
    home.write(".claude/agents/k-a.md", b"---\ntools: Read\n---\n");
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(
        (found[0].runner, found[0].placement),
        (Runner::Claude, Placement::Home)
    );
    project.write(".claude/agents/k-a.md", b"---\ntools: Bash\n---\n");
    let found = catalog(&project, &home).definitions("k-a");
    assert_eq!(found[0].placement, Placement::Project);
    assert_eq!(found[0].tools, listed(&["Bash"]));
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
fn a_front_matter_line_that_is_not_a_plain_key_makes_the_whole_file_unknown() {
    // Each of these can set a key this build would not see by a line prefix, so none may read as "every tool, none
    // pre-approved" or as a short list.
    for text in [
        "---\n\"permissionMode\": bypassPermissions\n---\n",
        "---\n'permissionMode': bypassPermissions\n---\n",
        "---\ntools : Read\n---\n",
        "---\ntools :Read\n---\n",
        "---\n? tools\n: Read\n---\n",
        "---\n{tools: Bash, permissionMode: bypassPermissions}\n---\n",
        "---\ntools: Read\n\"hooks\": {}\n---\n",
        "---\ntools:Read\n---\n",
        "---\ntools: Read\n- Write\n---\n",
        "---\n- Read\ntools: Write\n---\n",
        "---\nname: k-a\n- tools: Bash\n---\n",
        "---\nname k-a\n---\n",
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
fn a_list_in_column_0_under_a_key_with_no_value_is_that_keys_list() {
    // The agent files that Konductor installs for Claude Code are written this way.
    assert_eq!(
        claude("---\nname: k-a\ntools:\n- Read\n- Write # edits\n- Agent(a, b)\nskills:\n- x\nmodel: m\n---\n"),
        listed(&["Read", "Write", "Agent(a, b)"])
    );
    assert_eq!(
        claude("---\nskills:\n- x\n# note\n\n- y\ntools: Bash\n---\n"),
        listed(&["Bash"])
    );
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
