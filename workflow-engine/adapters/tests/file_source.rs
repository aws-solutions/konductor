// SPDX-License-Identifier: Apache-2.0
//! The file rules of the spec: a regular UTF-8 file with the expected name, within the size limit, reached without
//! following a link.

mod common;

use common::{TempDir, WORKFLOWS};
use workflow_adapters::FileSource;
use workflow_core::{read_workflow_text, WorkflowSource};

fn source_in(dir: &TempDir) -> FileSource {
    FileSource::under(dir.path())
}

#[test]
fn reads_a_workflow_and_a_prompt_file_from_the_folder() {
    let dir = TempDir::new("reads");
    dir.write(&format!("{WORKFLOWS}/plan.yml"), b"format: konductor/1\n");
    dir.write(
        &format!("{WORKFLOWS}/prompts/plan.md"),
        "Plan it. é\n".as_bytes(),
    );
    let source = source_in(&dir);
    assert_eq!(
        source.workflow_bytes("plan").as_deref(),
        Some(&b"format: konductor/1\n"[..])
    );
    assert_eq!(
        source.prompt_file_bytes("prompts/plan.md").as_deref(),
        Some("Plan it. é\n".as_bytes())
    );
}

#[test]
fn a_missing_file_or_folder_is_not_there() {
    let dir = TempDir::new("missing");
    let source = source_in(&dir);
    assert_eq!(source.workflow_bytes("plan"), None);
    dir.mkdir(WORKFLOWS);
    assert_eq!(source.workflow_bytes("plan"), None);
    assert_eq!(source.prompt_file_bytes("plan.md"), None);
}

#[test]
fn only_the_exact_name_matches() {
    let dir = TempDir::new("exact");
    dir.write(&format!("{WORKFLOWS}/plan.yml"), b"x");
    dir.write(&format!("{WORKFLOWS}/Notes.md"), b"x");
    let source = source_in(&dir);
    assert!(source.workflow_bytes("plan").is_some());
    assert_eq!(source.workflow_bytes("pla"), None);
    assert_eq!(source.workflow_bytes("plan.yml"), None);
    assert_eq!(source.workflow_bytes("PLAN"), None);
    assert_eq!(source.prompt_file_bytes("notes.md"), None);
    assert!(source.prompt_file_bytes("Notes.md").is_some());
}

#[test]
fn a_name_that_is_not_a_name_reads_nothing() {
    let dir = TempDir::new("badname");
    dir.write(&format!("{WORKFLOWS}/plan.yml"), b"x");
    dir.write("secret.yml", b"x");
    let source = source_in(&dir);
    for name in [
        "../../secret",
        "../secret",
        "/secret",
        "plan/../plan",
        "a/b",
        "",
    ] {
        assert_eq!(source.workflow_bytes(name), None, "{name:?}");
    }
}

#[test]
fn a_prompt_file_path_that_breaks_the_path_rules_reads_nothing() {
    let dir = TempDir::new("paths");
    dir.write(&format!("{WORKFLOWS}/ok.md"), b"x");
    dir.write("outside.md", b"x");
    let outside = dir.path().join("outside.md");
    let source = source_in(&dir);
    let absolute = outside.to_string_lossy().to_string();
    for path in [
        "../../outside.md",
        "../outside.md",
        "a/../ok.md",
        absolute.as_str(),
        "",
        "a//ok.md",
        "./ok.md",
    ] {
        assert_eq!(source.prompt_file_bytes(path), None, "{path:?}");
    }
}

#[test]
fn a_directory_with_the_expected_name_is_not_a_file() {
    let dir = TempDir::new("dir");
    dir.mkdir(&format!("{WORKFLOWS}/plan.yml"));
    dir.mkdir(&format!("{WORKFLOWS}/prompts"));
    let source = source_in(&dir);
    assert_eq!(source.workflow_bytes("plan"), None);
    assert_eq!(source.prompt_file_bytes("prompts"), None);
}

#[test]
fn the_size_limit_is_262144_bytes() {
    let dir = TempDir::new("size");
    dir.write(&format!("{WORKFLOWS}/edge.yml"), &vec![b'a'; 262_144]);
    dir.write(&format!("{WORKFLOWS}/big.yml"), &vec![b'a'; 262_145]);
    dir.write(&format!("{WORKFLOWS}/big.md"), &vec![b'a'; 262_145]);
    let source = source_in(&dir);
    assert_eq!(
        source.workflow_bytes("edge").map(|b| b.len()),
        Some(262_144)
    );
    assert_eq!(source.workflow_bytes("big"), None);
    assert_eq!(source.prompt_file_bytes("big.md"), None);
}

#[test]
fn a_file_that_is_not_utf8_is_not_text_for_the_engine() {
    let dir = TempDir::new("utf8");
    dir.write(&format!("{WORKFLOWS}/bad.yml"), &[0xff, 0xfe, b'a']);
    dir.write(&format!("{WORKFLOWS}/good.yml"), "é".as_bytes());
    let source = source_in(&dir);
    assert_eq!(read_workflow_text(&source, "bad"), None);
    assert_eq!(read_workflow_text(&source, "good").as_deref(), Some("é"));
}

#[cfg(unix)]
mod links {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn a_link_to_a_file_is_not_followed() {
        let dir = TempDir::new("link-file");
        dir.write("outside.yml", b"format: konductor/1\n");
        dir.write("outside.md", b"secret");
        dir.mkdir(WORKFLOWS);
        symlink(
            dir.path().join("outside.yml"),
            dir.path().join(WORKFLOWS).join("plan.yml"),
        )
        .expect("link");
        symlink(
            dir.path().join("outside.md"),
            dir.path().join(WORKFLOWS).join("plan.md"),
        )
        .expect("link");
        symlink("outside.md", dir.path().join(WORKFLOWS).join("relative.md")).expect("link");
        let source = source_in(&dir);
        assert_eq!(source.workflow_bytes("plan"), None);
        assert_eq!(source.prompt_file_bytes("plan.md"), None);
        assert_eq!(source.prompt_file_bytes("relative.md"), None);
    }

    #[test]
    fn a_link_to_a_file_inside_the_folder_is_not_followed_either() {
        let dir = TempDir::new("link-inside");
        dir.write(&format!("{WORKFLOWS}/real.yml"), b"x");
        symlink("real.yml", dir.path().join(WORKFLOWS).join("alias.yml")).expect("link");
        let source = source_in(&dir);
        assert!(source.workflow_bytes("real").is_some());
        assert_eq!(source.workflow_bytes("alias"), None);
    }

    #[test]
    fn a_link_to_a_directory_below_the_folder_is_not_followed() {
        let dir = TempDir::new("link-dir");
        dir.write("elsewhere/plan.md", b"secret");
        dir.mkdir(WORKFLOWS);
        symlink(
            dir.path().join("elsewhere"),
            dir.path().join(WORKFLOWS).join("prompts"),
        )
        .expect("link");
        let source = source_in(&dir);
        assert_eq!(source.prompt_file_bytes("prompts/plan.md"), None);
    }

    #[test]
    fn a_link_in_place_of_the_folder_or_its_parent_is_not_followed() {
        let dir = TempDir::new("link-folder");
        dir.write("elsewhere/plan.yml", b"x");
        dir.mkdir(".konductor");
        symlink(
            dir.path().join("elsewhere"),
            dir.path().join(".konductor/workflows"),
        )
        .expect("link");
        assert_eq!(source_in(&dir).workflow_bytes("plan"), None);

        let other = TempDir::new("link-parent");
        other.write("elsewhere/workflows/plan.yml", b"x");
        symlink(
            other.path().join("elsewhere"),
            other.path().join(".konductor"),
        )
        .expect("link");
        assert_eq!(source_in(&other).workflow_bytes("plan"), None);
    }

    #[test]
    fn a_link_that_dangles_or_loops_is_not_there() {
        let dir = TempDir::new("link-loop");
        dir.mkdir(WORKFLOWS);
        symlink(
            "missing.yml",
            dir.path().join(WORKFLOWS).join("dangling.yml"),
        )
        .expect("link");
        symlink("loop.yml", dir.path().join(WORKFLOWS).join("loop.yml")).expect("link");
        let source = source_in(&dir);
        assert_eq!(source.workflow_bytes("dangling"), None);
        assert_eq!(source.workflow_bytes("loop"), None);
    }

    #[test]
    fn a_pipe_with_the_expected_name_is_not_read() {
        let dir = TempDir::new("pipe");
        dir.mkdir(WORKFLOWS);
        let made = std::process::Command::new("mkfifo")
            .arg(dir.path().join(WORKFLOWS).join("pipe.yml"))
            .status();
        if made.map(|s| s.success()).unwrap_or(false) {
            // Reading a pipe with no writer would block, so a pass here also shows that it was never opened.
            assert_eq!(source_in(&dir).workflow_bytes("pipe"), None);
        }
    }

    #[test]
    fn the_base_itself_may_be_reached_through_a_link() {
        // The project root and the home folder are chosen by the user. Only what is below them is checked.
        let real = TempDir::new("base-real");
        real.write(&format!("{WORKFLOWS}/plan.yml"), b"x");
        let holder = TempDir::new("base-link");
        symlink(real.path(), holder.path().join("home")).expect("link");
        let source = FileSource::under(&holder.path().join("home"));
        assert!(source.workflow_bytes("plan").is_some());
    }
}
