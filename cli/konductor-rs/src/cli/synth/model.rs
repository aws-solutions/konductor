// SPDX-License-Identifier: Apache-2.0
//
// synth/model.rs — data types that make up the in-memory model the synth
// pipeline builds from the source tree and hands to each harness transformer.

use std::path::PathBuf;

use crate::cli::synth::parser::ParsedAgentSpec;

/// A file that lives alongside a skill's SKILL.md — a script, template,
/// or other resource that needs to be copied into the harness output along
/// with the skill's instructions.
#[derive(Debug, Clone, PartialEq)]
pub struct AuxiliaryFile {
    pub relative_path: PathBuf, // skill-directory-scoped, never traverses outside
    pub content: Vec<u8>,       // raw bytes; inline for transformer filesystem-freedom
    pub executable: bool,       // source had execute bit (755); write with chmod +x
}

/// Everything about a skill that a transformer needs to write it to a
/// harness output directory: its name, source frontmatter, and markdown
/// body, plus any scripts or templates bundled with it.
///
/// Frontmatter is passed through VERBATIM (`raw_frontmatter`): synth
/// never parses it into typed fields for output. The `name` key must
/// be present and its source text (compared as text, not YAML-resolved)
/// must equal the skill's directory name; `name` itself is not used for
/// the output path — the directory is.
#[derive(Debug, Clone, PartialEq)]
pub struct SkillDef {
    pub name: String,
    // Verbatim source frontmatter text (the exact characters between the
    // leading `---` fences), unmodified. Not parsed into typed fields.
    //
    // Security contract: unvalidated, consumer-provided text -- a larger
    // unvalidated surface than any single typed field, since it is
    // written verbatim into a file an agent reads. Transformers MUST NOT
    // pass it to system calls or file operations without validation.
    pub raw_frontmatter: String,
    pub body: String,
    pub auxiliary_files: Vec<AuxiliaryFile>,
}

/// A standard operating procedure: its name (derived from the filename)
/// and the full markdown text of the file.
#[derive(Debug, Clone, PartialEq)]
pub struct SopDef {
    pub name: String,
    pub body: String,
}

/// A per-agent context file: its name (the source filename under
/// `context/`, matched against an agent spec's `contextNames`) and its
/// full text content, written through verbatim.
#[derive(Debug, Clone, PartialEq)]
pub struct ContextDef {
    pub name: String,
    pub body: String,
}

/// An agent from the source tree, represented as the parser's typed IR.
/// This is a type alias rather than a wrapper — the two types are
/// interchangeable at this milestone.
pub type AgentSpec = ParsedAgentSpec;

/// The full picture of the source tree, held in memory: all the agents,
/// skills, SOPs, and context files that `konductor synth` will
/// transform into harness-specific output. Built by `parse_canonical`,
/// consumed by each `HarnessTransformer`.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CanonicalModel {
    pub agents: Vec<AgentSpec>,
    pub skills: Vec<SkillDef>,
    pub sops: Vec<SopDef>,
    pub context: Vec<ContextDef>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_agent_spec(name: &str) -> AgentSpec {
        ParsedAgentSpec {
            name: name.to_string(),
            config: crate::cli::synth::parser::AgentConfig {
                description: String::new(),
                system_prompt: String::new(),
                model: String::new(),
            },
            dependencies: crate::cli::synth::parser::AgentDependencies::default(),
            client_config: crate::cli::synth::parser::ClientConfig::default(),
        }
    }

    fn full_skill_def(name: &str) -> SkillDef {
        SkillDef {
            name: name.to_string(),
            raw_frontmatter: format!(
                "name: {name}\ndescription: A test skill.\nallowed-tools: fs_read"
            ),
            body: "# Body\n\nContent.".to_string(),
            auxiliary_files: vec![AuxiliaryFile {
                relative_path: PathBuf::from("scripts/run.sh"),
                content: b"#!/bin/sh\necho hi\n".to_vec(),
                executable: true,
            }],
        }
    }

    #[test]
    fn skill_def_full_populated_equality() {
        let a = full_skill_def("skill-a");
        let b = full_skill_def("skill-a");
        assert_eq!(a, b);

        let mut c = b.clone();
        c.body.push_str(" extra");
        assert_ne!(a, c);
    }

    #[test]
    fn auxiliary_file_executable_flag_distinguishes_equality() {
        let base = AuxiliaryFile {
            relative_path: PathBuf::from("template.md"),
            content: b"content".to_vec(),
            executable: false,
        };
        let executable = AuxiliaryFile {
            executable: true,
            ..base.clone()
        };
        assert_ne!(base, executable);
        assert!(!base.executable);
        assert!(executable.executable);
    }

    #[test]
    fn canonical_model_default_is_empty() {
        let model = CanonicalModel::default();
        assert!(model.agents.is_empty());
        assert!(model.skills.is_empty());
        assert!(model.sops.is_empty());
        assert!(model.context.is_empty());
    }

    #[test]
    fn canonical_model_equality_on_populated_instances() {
        let a = CanonicalModel {
            agents: vec![minimal_agent_spec("agent-a")],
            skills: vec![full_skill_def("skill-a")],
            sops: vec![SopDef {
                name: "sop-a".to_string(),
                body: "SOP body.".to_string(),
            }],
            context: vec![ContextDef {
                name: "context-a.md".to_string(),
                body: "Context body.".to_string(),
            }],
        };
        let b = a.clone();
        assert_eq!(a, b);

        let mut c = b.clone();
        c.sops.push(SopDef {
            name: "sop-extra".to_string(),
            body: "extra".to_string(),
        });
        assert_ne!(a, c);
    }

    /// Smoke test only: checks `{:?}` doesn't panic on a fully-populated model.
    #[test]
    fn canonical_model_debug_format_does_not_panic() {
        let model = CanonicalModel {
            agents: vec![minimal_agent_spec("agent-1")],
            skills: vec![full_skill_def("skill-debug")],
            sops: vec![SopDef {
                name: "sop-debug".to_string(),
                body: "body".to_string(),
            }],
            context: vec![ContextDef {
                name: "context-debug.md".to_string(),
                body: "body".to_string(),
            }],
        };
        let rendered = format!("{:?}", model);
        assert!(rendered.contains("skill-debug"));
        assert!(rendered.contains("sop-debug"));
        assert!(rendered.contains("agent-1"));
        assert!(rendered.contains("context-debug.md"));
    }
}
