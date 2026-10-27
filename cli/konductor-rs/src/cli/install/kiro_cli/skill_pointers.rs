// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli/skill_pointers.rs — one small `ks-<name>/SKILL.md`
// pointer per synthed skill under `.kiro/skills/`, so Kiro lists every
// skill's name and description natively while the body is still loaded
// through the `konductor-skills` MCP server.

use std::path::Path;

use super::super::artifact::sha256_hex;
use super::super::claude::yaml_double_quote;
use super::super::index::env_home_dir;
use super::super::manifest::{classify_provenance, ManifestFile, Provenance, StrategyManifest};
use super::plan::{content_manifest_path, PlannedFile};
use super::{list_skill_dirs, KIRO_DESTINATION_ROOT, KONDUCTOR_DESTINATION_ROOT};
use crate::cli::atomic_write::write_atomic;
use crate::cli::synth::kiro_cli_v2::SKILLS_CONTENT_TYPE_DIR;
use crate::cli::synth::parse_canonical::split_frontmatter;
use crate::cli::synth::path_safety::reject_unsafe_skill_name;

/// Directory-name prefix of every pointer. Keeps pointers apart from
/// same-named skills other tools put in `.kiro/skills/`.
const SKILL_POINTER_PREFIX: &str = "ks-";

const SKILL_FILE_NAME: &str = "SKILL.md";

/// One synthed skill, reduced to what its pointer needs.
struct SkillPointer {
    skill_name: String,
    description: String,
}

impl SkillPointer {
    fn dir_name(&self) -> String {
        format!("{SKILL_POINTER_PREFIX}{}", self.skill_name)
    }

    fn manifest_path(&self) -> String {
        content_manifest_path(
            KIRO_DESTINATION_ROOT,
            SKILLS_CONTENT_TYPE_DIR,
            &format!("{}/{SKILL_FILE_NAME}", self.dir_name()),
        )
    }
}

/// Writes one pointer `SKILL.md` per skill staged under
/// `<harness_dir>/skills/` into `<target_dir>/.kiro/skills/ks-<name>/`.
/// Returns an empty `Vec` when no skills are staged.
pub(in crate::cli::install) fn install_kiro_skill_pointers(
    harness_dir: &Path,
    target_dir: &Path,
) -> Result<Vec<ManifestFile>, String> {
    let fallback_dir = fallback_skills_dir(target_dir);
    let mut files = Vec::new();
    for pointer in list_skill_pointers(harness_dir)? {
        let rendered = render_pointer_md(&pointer, &fallback_dir);
        let dst = target_dir.join(pointer.manifest_path());
        write_pointer(&dst, &rendered)?;
        files.push(ManifestFile {
            path: pointer.manifest_path(),
            sha256: Some(sha256_hex(rendered.as_bytes())),
            // Overwritten by `attach_provenance`.
            provenance: Provenance::Created,
        });
    }
    Ok(files)
}

/// Plans every file `install_kiro_skill_pointers` will write, without
/// writing anything.
pub(in crate::cli::install) fn plan_kiro_skill_pointer_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<PlannedFile>, String> {
    Ok(list_skill_pointers(harness_dir)?
        .iter()
        .map(|pointer| {
            let manifest_path = pointer.manifest_path();
            let provenance = classify_provenance(
                &target_dir.join(&manifest_path),
                &manifest_path,
                prior_manifest,
            );
            PlannedFile {
                manifest_path,
                provenance,
            }
        })
        .collect())
}

fn write_pointer(dst: &Path, rendered: &str) -> Result<(), String> {
    if let Some(dir) = dst.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    }
    write_atomic(dst, rendered.as_bytes())
        .map_err(|e| format!("failed to write {}: {e}", dst.display()))
}

/// Skills whose `SKILL.md` has no readable `description` get no
/// pointer: synth rejects them, so only a hand-staged tree can hit this.
fn list_skill_pointers(harness_dir: &Path) -> Result<Vec<SkillPointer>, String> {
    let source_root = harness_dir.join(SKILLS_CONTENT_TYPE_DIR);
    let mut pointers = Vec::new();
    for skill_name in list_skill_dirs(&source_root)? {
        reject_unsafe_skill_name(&format!("{SKILL_POINTER_PREFIX}{skill_name}"))?;
        let skill_md = source_root.join(&skill_name).join(SKILL_FILE_NAME);
        let description = std::fs::read_to_string(skill_md)
            .ok()
            .and_then(|raw| read_description(&raw));
        pointers.extend(description.map(|description| SkillPointer {
            skill_name,
            description,
        }));
    }
    Ok(pointers)
}

fn read_description(skill_md: &str) -> Option<String> {
    let (frontmatter, _) = split_frontmatter(skill_md, SKILL_FILE_NAME).ok()?;
    let value: serde_yaml::Value = serde_yaml::from_str(frontmatter).ok()?;
    let description = value.get("description")?.as_str()?;
    Some(description.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// `~/.konductor/skills` when `target_dir` is the home directory,
/// otherwise the target's absolute skills directory, so the fallback
/// path always points at the install that wrote the pointer.
fn fallback_skills_dir(target_dir: &Path) -> String {
    if is_home_dir(target_dir) {
        return format!("~/{KONDUCTOR_DESTINATION_ROOT}/{SKILLS_CONTENT_TYPE_DIR}");
    }
    target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR)
        .display()
        .to_string()
}

fn is_home_dir(target_dir: &Path) -> bool {
    env_home_dir()
        .and_then(|home| Some(home.canonicalize().ok()? == target_dir.canonicalize().ok()?))
        .unwrap_or(false)
}

fn render_pointer_md(pointer: &SkillPointer, fallback_dir: &str) -> String {
    let name = &pointer.skill_name;
    format!(
        "---\nname: {}\ndescription: {}\n---\n\n\
         This is a pointer. Load the full `{name}` skill before following it:\n\n\
         1. Call `get_skill` with `name: \"{name}\"` on the `konductor-skills` MCP server \
         (load the tool first if it is deferred).\n\
         2. If that tool is unavailable, read `{fallback_dir}/{name}/{SKILL_FILE_NAME}`.\n",
        yaml_double_quote(&pointer.dir_name()),
        yaml_double_quote(&pointer.description),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        super::super::test_support::scratch_dir(&format!("skill-pointers-{name}"))
    }

    fn stage_skill(harness_dir: &Path, name: &str, skill_md: &str) {
        let dir = harness_dir.join(SKILLS_CONTENT_TYPE_DIR).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(SKILL_FILE_NAME), skill_md).unwrap();
    }

    #[test]
    fn description_is_flattened_to_one_line() {
        let md = "---\nname: a\ndescription: >-\n  one\n  two\n---\n\nBody\n";
        assert_eq!(read_description(md).as_deref(), Some("one two"));
    }

    #[test]
    fn description_is_absent_without_frontmatter_or_key() {
        assert_eq!(read_description("# just a body\n"), None);
        assert_eq!(read_description("---\nname: a\n---\n\nBody\n"), None);
    }

    #[test]
    fn rendered_pointer_is_valid_frontmatter_with_prefixed_name() {
        let pointer = SkillPointer {
            skill_name: "alpha".to_string(),
            description: "Say \"hi\": now".to_string(),
        };
        let rendered = render_pointer_md(&pointer, "~/.konductor/skills");
        let (frontmatter, body) = split_frontmatter(&rendered, "pointer").unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(frontmatter).unwrap();
        assert_eq!(value["name"].as_str(), Some("ks-alpha"));
        assert_eq!(value["description"].as_str(), Some("Say \"hi\": now"));
        assert!(body.contains("~/.konductor/skills/alpha/SKILL.md"));
    }

    #[test]
    fn install_writes_one_pointer_per_described_skill_and_plan_agrees() {
        let harness_dir = scratch_dir("install-harness");
        let target_dir = scratch_dir("install-target");
        stage_skill(
            &harness_dir,
            "alpha",
            "---\nname: alpha\ndescription: A.\n---\n\nBody\n",
        );
        stage_skill(&harness_dir, "bare", "no frontmatter\n");

        let files = install_kiro_skill_pointers(&harness_dir, &target_dir).unwrap();
        let planned = plan_kiro_skill_pointer_files(&harness_dir, &target_dir, None).unwrap();

        let paths: Vec<_> = files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, [".kiro/skills/ks-alpha/SKILL.md"]);
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].manifest_path, files[0].path);
        assert!(target_dir.join(&files[0].path).is_file());
        assert!(!target_dir.join(".kiro/skills/ks-bare").exists());
    }

    #[test]
    fn install_returns_nothing_when_no_skills_are_staged() {
        let harness_dir = scratch_dir("empty-harness");
        let target_dir = scratch_dir("empty-target");
        assert!(install_kiro_skill_pointers(&harness_dir, &target_dir)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn unsafe_skill_directory_name_is_rejected() {
        let harness_dir = scratch_dir("unsafe-harness");
        stage_skill(&harness_dir, "bad name", "---\ndescription: x\n---\n");
        assert!(list_skill_pointers(&harness_dir).is_err());
    }
}
