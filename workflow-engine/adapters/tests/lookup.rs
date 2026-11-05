// SPDX-License-Identifier: Apache-2.0
//! A bare name resolves to the project file, then the user file.

mod common;

use common::{TempDir, WORKFLOWS};
use workflow_adapters::{Lookup, Scope, Skip, Skipped};
use workflow_core::WorkflowSource;

#[test]
fn the_project_file_wins_over_the_user_file() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    project.write(&format!("{WORKFLOWS}/plan.yml"), b"project");
    home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
    let found = Lookup::new(project.path(), Some(home.path()))
        .find("plan")
        .found
        .expect("found");
    assert_eq!(found.scope, Scope::Project);
    assert_eq!(found.text, "project");
}

#[test]
fn the_user_file_is_used_when_the_project_has_none() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
    home.write(&format!("{WORKFLOWS}/plan.md"), b"user prompt");
    let found = Lookup::new(project.path(), Some(home.path()))
        .find("plan")
        .found
        .expect("found");
    assert_eq!(found.scope, Scope::User);
    assert_eq!(found.text, "user");
    // Its prompt files come from its own folder.
    assert_eq!(
        found.source.prompt_file_bytes("plan.md").as_deref(),
        Some(&b"user prompt"[..])
    );
}

#[test]
fn a_project_prompt_file_is_read_from_the_project_folder_only() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    project.write(&format!("{WORKFLOWS}/plan.yml"), b"project");
    home.write(&format!("{WORKFLOWS}/plan.md"), b"user prompt");
    let found = Lookup::new(project.path(), Some(home.path()))
        .find("plan")
        .found
        .expect("found");
    assert_eq!(found.source.prompt_file_bytes("plan.md"), None);
}

#[test]
fn nothing_is_found_when_neither_folder_has_the_name() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    assert!(Lookup::new(project.path(), Some(home.path()))
        .find("plan")
        .found
        .is_none());
    assert!(Lookup::new(project.path(), None)
        .find("plan")
        .found
        .is_none());
}

#[test]
fn a_project_file_that_is_treated_as_not_there_does_not_hide_the_user_file() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    project.write(&format!("{WORKFLOWS}/plan.yml"), &vec![b'a'; 262_145]);
    home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
    let found = Lookup::new(project.path(), Some(home.path()))
        .find("plan")
        .found
        .expect("found");
    assert_eq!(found.scope, Scope::User);
}

#[test]
fn lookup_writes_nothing() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    let lookup = Lookup::new(project.path(), Some(home.path()));
    let _ = lookup.find("plan");
    assert!(!project.path().join(".konductor").exists());
    assert!(!home.path().join(".konductor").exists());
}

#[test]
fn nothing_is_found_and_nothing_is_skipped_when_the_home_folder_is_unknown() {
    // HOME unset: there is no user folder to look in, and a missing project file is just a miss.
    let project = TempDir::new("project");
    let located = Lookup::new(project.path(), None).find("plan");
    assert!(located.found.is_none());
    assert!(located.skipped.is_empty());
}

#[test]
fn a_project_file_that_is_passed_over_is_listed_with_its_reason() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    project.write(&format!("{WORKFLOWS}/big.yml"), &vec![b'a'; 262_145]);
    project.write(&format!("{WORKFLOWS}/bad.yml"), &[0xff, 0xfe]);
    project.mkdir(&format!("{WORKFLOWS}/dir.yml"));
    for name in ["big", "bad", "dir"] {
        home.write(&format!("{WORKFLOWS}/{name}.yml"), b"user");
    }
    let lookup = Lookup::new(project.path(), Some(home.path()));
    let reasons: Vec<_> = ["big", "bad", "dir"]
        .iter()
        .map(|name| {
            let located = lookup.find(name);
            assert_eq!(
                located.found.expect("falls through to the user file").scope,
                Scope::User
            );
            located.skipped
        })
        .collect();
    assert_eq!(
        reasons[0],
        [Skipped {
            scope: Scope::Project,
            reason: Skip::TooLarge
        }]
    );
    assert_eq!(
        reasons[1],
        [Skipped {
            scope: Scope::Project,
            reason: Skip::NotUtf8
        }]
    );
    assert_eq!(
        reasons[2],
        [Skipped {
            scope: Scope::Project,
            reason: Skip::NotRegular
        }]
    );
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn a_project_link_is_listed_as_a_link_and_the_user_file_is_used() {
        let project = TempDir::new("project");
        let home = TempDir::new("home");
        project.write("outside.yml", b"x");
        project.mkdir(WORKFLOWS);
        symlink(
            project.path().join("outside.yml"),
            project.path().join(WORKFLOWS).join("plan.yml"),
        )
        .expect("link");
        home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
        let located = Lookup::new(project.path(), Some(home.path())).find("plan");
        assert_eq!(located.found.expect("found").scope, Scope::User);
        assert_eq!(
            located.skipped,
            [Skipped {
                scope: Scope::Project,
                reason: Skip::Link
            }]
        );
    }

    /// Says so out loud when a permission test cannot run, so a pass is never mistaken for a check.
    fn skip_notice() {
        eprintln!("SKIPPED: mode 000 is still readable here (running as root), so this test checked nothing.");
    }

    /// Whether a mode 000 file is really unreadable here. It is not for root.
    fn unreadable(path: &std::path::Path) -> bool {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o000)).expect("chmod");
        std::fs::File::open(path).is_err()
    }

    #[test]
    fn an_unreadable_project_file_falls_through_to_the_user_file_and_is_listed() {
        // The chosen behavior: a file the rules cannot read is treated as not there, so the user file is used. The
        // caller shows the skipped file, so the choice is visible.
        let project = TempDir::new("project");
        let home = TempDir::new("home");
        let file = project.write(&format!("{WORKFLOWS}/plan.yml"), b"project");
        home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
        if !unreadable(&file) {
            skip_notice();
            return;
        }
        let located = Lookup::new(project.path(), Some(home.path())).find("plan");
        assert_eq!(located.found.expect("found").text, "user");
        assert_eq!(
            located.skipped,
            [Skipped {
                scope: Scope::Project,
                reason: Skip::Unreadable
            }]
        );
    }

    #[test]
    fn an_unreadable_project_file_with_no_user_file_finds_nothing_and_is_listed() {
        let project = TempDir::new("project");
        let file = project.write(&format!("{WORKFLOWS}/plan.yml"), b"project");
        if !unreadable(&file) {
            skip_notice();
            return;
        }
        let located = Lookup::new(project.path(), None).find("plan");
        assert!(located.found.is_none());
        assert_eq!(
            located.skipped,
            [Skipped {
                scope: Scope::Project,
                reason: Skip::Unreadable
            }]
        );
    }

    fn unreadable_dir(path: &std::path::Path) -> bool {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o000)).expect("chmod");
        std::fs::read_dir(path).is_err()
    }

    /// Gives the folder back its mode so that the temporary directory can be removed.
    fn restore(path: &std::path::Path) {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    }

    #[test]
    fn an_unreadable_project_folder_falls_through_to_the_user_file_and_is_listed() {
        let project = TempDir::new("project");
        let home = TempDir::new("home");
        project.write(&format!("{WORKFLOWS}/plan.yml"), b"project");
        home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
        let folder = project.path().join(WORKFLOWS);
        if !unreadable_dir(&folder) {
            skip_notice();
            return;
        }
        let located = Lookup::new(project.path(), Some(home.path())).find("plan");
        restore(&folder);
        assert_eq!(located.found.expect("found").text, "user");
        assert_eq!(
            located.skipped,
            [Skipped {
                scope: Scope::Project,
                reason: Skip::Unreadable
            }]
        );
    }

    #[test]
    fn an_unreadable_project_folder_with_no_user_file_finds_nothing_and_is_listed() {
        let project = TempDir::new("project");
        project.write(&format!("{WORKFLOWS}/plan.yml"), b"project");
        let folder = project.path().join(WORKFLOWS);
        if !unreadable_dir(&folder) {
            skip_notice();
            return;
        }
        let located = Lookup::new(project.path(), None).find("plan");
        restore(&folder);
        assert!(located.found.is_none());
        assert_eq!(
            located.skipped,
            [Skipped {
                scope: Scope::Project,
                reason: Skip::Unreadable
            }]
        );
    }
}
