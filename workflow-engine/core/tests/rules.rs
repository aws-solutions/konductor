// SPDX-License-Identifier: Apache-2.0
//! Names, versions and paths.

use workflow_core::reference::{parse_reference, Reference, ReferenceError};
use workflow_core::rules::{
    code_points, is_name, is_reserved_stage_name, is_semver, path_problem, template_references,
    PathProblem,
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
        "é/ü.md",
        "C",
        "README.md",
        "docs/design.md",
        ".hidden/x",
        "...",
        "a b",
        "a/b/c.md",
        // Line and paragraph separators are not control characters.
        "a\u{2028}b",
        "a\u{2029}b",
        // A colon is fine unless a single letter and a colon start the path.
        "ab:c",
        "a/b:c",
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
        ("./a", PathProblem::UnnormalizedSegment),
        ("a/./b", PathProblem::UnnormalizedSegment),
        (".", PathProblem::UnnormalizedSegment),
        ("a//b", PathProblem::UnnormalizedSegment),
        ("dir/", PathProblem::UnnormalizedSegment),
        ("a/b/", PathProblem::UnnormalizedSegment),
        ("a\0b", PathProblem::ControlCharacter),
        ("a\nb", PathProblem::ControlCharacter),
        ("a\tb", PathProblem::ControlCharacter),
        ("/", PathProblem::Absolute),
        ("a:b.md", PathProblem::Absolute),
        ("./README.md", PathProblem::UnnormalizedSegment),
        ("a/.", PathProblem::UnnormalizedSegment),
        ("docs/", PathProblem::UnnormalizedSegment),
        ("a//b.md", PathProblem::UnnormalizedSegment),
        ("a\\b.md", PathProblem::Backslash),
        ("C:/x.md", PathProblem::Absolute),
        ("a\nb.md", PathProblem::ControlCharacter),
        ("a\u{7f}b", PathProblem::ControlCharacter),
        ("a\u{85}b", PathProblem::ControlCharacter),
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
        PathProblem::UnnormalizedSegment,
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

fn matches_in(text: &str) -> Vec<&str> {
    template_references(text)
        .into_iter()
        .map(|r| &text[r])
        .collect()
}

#[test]
fn template_references_follow_the_pattern_of_the_spec() {
    assert_eq!(matches_in("{run.goal}"), ["{run.goal}"]);
    assert_eq!(
        matches_in("Plan {plan.design} then {1.x} and {a-b.c_d-e}."),
        ["{plan.design}", "{1.x}", "{a-b.c_d-e}"]
    );
    // A name starts with a letter or digit, and an output with a letter or underscore.
    assert_eq!(
        matches_in("{0.x} {a.b0} {a._b}"),
        ["{0.x}", "{a.b0}", "{a._b}"]
    );
}

#[test]
fn other_braces_are_literal() {
    for text in [
        "{severity, file, line}",
        "{}",
        "{a}",
        "{a.}",
        "{.a}",
        "{A.b}",
        "{a.B}",
        "{a.1}",
        "{-a.b}",
        "{a b.c}",
        "{a.b",
        "a.b}",
        "{{a",
        "{a.b c}",
        "{1.5}",
        "{\"a\": {\"b\": 1}}",
        "",
    ] {
        assert_eq!(matches_in(text), Vec::<&str>::new(), "{text:?}");
    }
}

#[test]
fn a_reference_is_found_after_a_failed_attempt_and_inside_other_braces() {
    assert_eq!(matches_in("{{run.goal}}"), ["{run.goal}"]);
    assert_eq!(matches_in("{a{run.goal}"), ["{run.goal}"]);
    assert_eq!(matches_in("{severity, {plan.design}}"), ["{plan.design}"]);
    assert_eq!(matches_in("é{run.goal}😀{a.b}"), ["{run.goal}", "{a.b}"]);
}

#[test]
fn finding_references_in_a_large_prompt_is_linear() {
    let text = "{a".repeat(16_384);
    assert!(template_references(&text).is_empty());
    let text = "{a.b} ".repeat(5_000);
    assert_eq!(template_references(&text).len(), 5_000);
}
