// SPDX-License-Identifier: Apache-2.0
//! Names, versions and paths.

use workflow_core::reference::{parse_reference, Reference, ReferenceError};
use workflow_core::rules::{
    code_points, is_name, is_reserved_stage_name, is_semver, path_problem, PathProblem,
};

#[test]
fn a_name_follows_the_pattern_of_the_spec() {
    let long_ok = "a".repeat(64);
    let long_bad = "a".repeat(65);
    for good in [
        "a",
        "0",
        "a-b",
        "9-lives",
        "k-adversarial-pull-request-review",
        "a--b",
        "a-",
        long_ok.as_str(),
    ] {
        assert!(is_name(good), "{good}");
    }
    for bad in [
        "",
        "-a",
        "A",
        "aB",
        "a_b",
        "a b",
        "a.b",
        "a/b",
        "é",
        "a\n",
        " a",
        "a ",
        "..",
        long_bad.as_str(),
    ] {
        assert!(!is_name(bad), "{bad:?}");
    }
}

#[test]
fn the_reserved_stage_names_are_the_four_canvas_markers() {
    for name in ["start", "end", "run", "halt"] {
        assert!(is_reserved_stage_name(name));
    }
    for name in ["starts", "Start", "plan", ""] {
        assert!(!is_reserved_stage_name(name));
    }
}

#[test]
fn a_version_is_three_numbers_with_no_leading_zero() {
    for good in ["0.0.0", "0.1.0", "1.2.3", "10.20.30", "100.0.1"] {
        assert!(is_semver(good), "{good}");
    }
    for bad in [
        "",
        "1",
        "1.1",
        "1.2.3.4",
        "01.2.3",
        "1.02.3",
        "1.2.03",
        "1.2.",
        ".1.2",
        "1.2.x",
        "v1.2.3",
        "1.2.3-rc.1",
        "1.2.3+b",
        " 1.2.3",
        "-1.2.3",
    ] {
        assert!(!is_semver(bad), "{bad:?}");
    }
}

#[test]
fn a_path_is_relative_uses_slashes_has_no_parent_segment_and_is_not_absolute() {
    for good in [
        "PLAN.md",
        "docs/PLAN.md",
        "a/b/c.txt",
        "a..b",
        "..a",
        "a/..b/c",
        ".hidden",
        "a/./b",
        "dir/",
        "é/ü.md",
        "C",
    ] {
        assert_eq!(path_problem(good), None, "{good}");
    }
    let cases = [
        ("", PathProblem::Empty),
        ("/etc/passwd", PathProblem::Absolute),
        ("//server/share", PathProblem::Absolute),
        ("C:/x", PathProblem::Absolute),
        ("c:x", PathProblem::Absolute),
        ("a\\b", PathProblem::Backslash),
        ("\\\\server\\share", PathProblem::Backslash),
        ("..", PathProblem::ParentSegment),
        ("../x", PathProblem::ParentSegment),
        ("a/../x", PathProblem::ParentSegment),
        ("a/..", PathProblem::ParentSegment),
        ("a\0b", PathProblem::ControlCharacter),
        ("a\nb", PathProblem::ControlCharacter),
        ("a\tb", PathProblem::ControlCharacter),
    ];
    for (path, problem) in cases {
        assert_eq!(path_problem(path), Some(problem), "{path:?}");
    }
}

#[test]
fn every_path_problem_has_a_reason_for_a_message() {
    for problem in [
        PathProblem::Empty,
        PathProblem::Absolute,
        PathProblem::Backslash,
        PathProblem::ParentSegment,
        PathProblem::ControlCharacter,
    ] {
        assert!(!problem.reason().is_empty());
    }
}

#[test]
fn lengths_count_code_points() {
    assert_eq!(code_points(""), 0);
    assert_eq!(code_points("abc"), 3);
    assert_eq!(code_points("é"), 1);
    assert_eq!(code_points("😀"), 1);
    assert_eq!(code_points("e\u{301}"), 2);
}

#[test]
fn a_bare_name_is_local_and_library_names_are_shipped() {
    assert_eq!(
        parse_reference("hello-plan"),
        Ok(Reference::Local("hello-plan".into()))
    );
    assert_eq!(
        parse_reference("library/k-adversarial-pull-request-review"),
        Ok(Reference::Shipped(
            "k-adversarial-pull-request-review".into()
        ))
    );
}

#[test]
fn anything_else_names_no_workflow() {
    for arg in [
        "",
        "Hello",
        "hello.yml",
        "./hello",
        "../hello",
        "a/b",
        "/abs/hello",
        "library/",
        "library/Bad",
        "library/a/b",
        "library//a",
        "LIBRARY/a",
        "hello plan",
        "hello\n",
    ] {
        assert_eq!(
            parse_reference(arg),
            Err(ReferenceError::InvalidName),
            "{arg:?}"
        );
    }
}
