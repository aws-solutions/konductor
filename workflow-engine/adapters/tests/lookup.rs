// SPDX-License-Identifier: Apache-2.0
//! A bare name resolves to the project file, then the user file.

mod common;

use common::{TempDir, WORKFLOWS};
use workflow_adapters::{Lookup, Scope};
use workflow_core::WorkflowSource;

#[test]
fn the_project_file_wins_over_the_user_file() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    project.write(&format!("{WORKFLOWS}/plan.yml"), b"project");
    home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
    let found = Lookup::new(project.path(), Some(home.path()))
        .find("plan")
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
        .expect("found");
    assert_eq!(found.source.prompt_file_bytes("plan.md"), None);
}

#[test]
fn nothing_is_found_when_neither_folder_has_the_name() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    assert!(Lookup::new(project.path(), Some(home.path()))
        .find("plan")
        .is_none());
    assert!(Lookup::new(project.path(), None).find("plan").is_none());
}

#[test]
fn a_project_file_that_is_treated_as_not_there_does_not_hide_the_user_file() {
    let project = TempDir::new("project");
    let home = TempDir::new("home");
    project.write(&format!("{WORKFLOWS}/plan.yml"), &vec![b'a'; 262_145]);
    home.write(&format!("{WORKFLOWS}/plan.yml"), b"user");
    let found = Lookup::new(project.path(), Some(home.path()))
        .find("plan")
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
