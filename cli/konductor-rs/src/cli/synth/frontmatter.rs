// SPDX-License-Identifier: Apache-2.0
//
// synth/frontmatter.rs — reassembles a SKILL.md file from `SkillDef`'s
// verbatim source frontmatter and body. Not a YAML serializer: the
// frontmatter text is copied through as-is. A trailing CR on the
// closing delimiter line is normalized away during parsing, so output
// is idempotent under repeated synth rather than always byte-identical
// to a CRLF source.

use super::model::SkillDef;

/// Renders `skill`'s frontmatter + body as a complete SKILL.md file:
/// the delimiting `---` lines wrap `skill.raw_frontmatter` verbatim,
/// followed by a blank line and `skill.body`.
///
/// Returns `Err` if `raw_frontmatter` contains a line equal to `---`:
/// `split_frontmatter` never produces one (such a line is consumed as
/// the closing fence instead), but `SkillDef` is freely constructible,
/// and emitting one here would corrupt the delimiter structure of the
/// output file. Returning `Result` here (rather than `assert!`/`panic!`,
/// which is not compiled out in `--release`) makes this failure
/// catchable by callers instead of aborting the process.
pub(crate) fn render_skill_md(skill: &SkillDef) -> Result<String, String> {
    if skill.raw_frontmatter.lines().any(|line| line == "---") {
        return Err(
            "raw_frontmatter must not contain a bare '---' line (would corrupt the output's frontmatter delimiters)"
                .to_string(),
        );
    }
    Ok(format!(
        "---\n{}\n---\n\n{}",
        skill.raw_frontmatter, skill.body
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::synth::model::AuxiliaryFile;

    fn skill(name: &str, raw_frontmatter: &str, body: &str) -> SkillDef {
        SkillDef {
            name: name.to_string(),
            raw_frontmatter: raw_frontmatter.to_string(),
            body: body.to_string(),
            auxiliary_files: Vec::new(),
        }
    }

    #[test]
    fn renders_frontmatter_and_body_verbatim() {
        let s = skill(
            "minimal-skill",
            "name: minimal-skill\ndescription: A test skill.",
            "# Body\n\nContent.\n",
        );
        let rendered = render_skill_md(&s).expect("frontmatter has no bare '---' line");
        assert_eq!(
            rendered,
            "---\nname: minimal-skill\ndescription: A test skill.\n---\n\n# Body\n\nContent.\n"
        );
    }

    #[test]
    fn preserves_arbitrary_source_frontmatter_shapes_unchanged() {
        // Passthrough means synth never re-normalizes key order, list
        // style, or quoting -- whatever shape the source frontmatter
        // had is exactly what's emitted.
        let raw = "name: full-skill\ntags: [alpha, beta]\nallowed-tools: \"Read Write\"";
        let s = skill("full-skill", raw, "Body.\n");
        let rendered = render_skill_md(&s).expect("frontmatter has no bare '---' line");
        assert_eq!(rendered, format!("---\n{raw}\n---\n\nBody.\n"));
    }

    #[test]
    fn skill_def_auxiliary_files_field_unused_by_render() {
        let mut s = skill("aux-skill", "name: aux-skill", "Body.\n");
        s.auxiliary_files.push(AuxiliaryFile {
            relative_path: std::path::PathBuf::from("scripts/run.sh"),
            content: b"#!/bin/sh\n".to_vec(),
            executable: true,
        });
        let rendered = render_skill_md(&s).expect("frontmatter has no bare '---' line");
        assert!(!rendered.contains("scripts/run.sh"));
    }

    #[test]
    fn errs_on_raw_frontmatter_containing_bare_dash_line() {
        let s = skill(
            "bad-skill",
            "name: bad-skill\n---\ndescription: injected",
            "Body.\n",
        );
        let err = render_skill_md(&s).expect_err("bare '---' line must be rejected");
        assert!(err.contains("bare '---' line"));
    }

    #[test]
    fn errs_on_raw_frontmatter_containing_crlf_bare_dash_line() {
        let s = skill(
            "bad-skill",
            "name: bad-skill\r\n---\r\ndescription: injected",
            "Body.\n",
        );
        let err = render_skill_md(&s).expect_err("bare '---' line must be rejected");
        assert!(err.contains("bare '---' line"));
    }
}
