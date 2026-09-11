// SPDX-License-Identifier: Apache-2.0
//
// synth/content_writers.rs — shared per-item content writers used by
// every `HarnessTransformer`: writing a skill's `SKILL.md` + auxiliary
// files, a SOP's markdown body, and a context file's body.
//
// None of these functions (`write_skill`, `write_auxiliary_file`, both
// `set_executable` cfg variants, `write_sop`, `write_context`) have any
// per-harness variation, so `kiro_cli_v2.rs` and `claude.rs` both call
// into this shared module instead of each carrying their own copy --
// the same "fix-in-one, forget-the-other" maintenance hazard that
// motivates keeping `staging.rs` and `path_safety.rs` shared too.

use std::fs;
use std::path::Path;

use super::frontmatter::render_skill_md;
use super::model::{AuxiliaryFile, ContextDef, SkillDef, SopDef};
use super::path_safety::{
    reject_unsafe_auxiliary_relative_path, reject_unsafe_context_name, reject_unsafe_skill_name,
    reject_unsafe_sop_name,
};

/// Writes one skill's `SKILL.md` (frontmatter + body, rendered by
/// `render_skill_md`) and all of its auxiliary files under
/// `<output_dir>/<skill.name>/`, preserving each auxiliary file's
/// `executable` bit.
pub(crate) fn write_skill(output_dir: &Path, skill: &SkillDef) -> Result<(), String> {
    reject_unsafe_skill_name(&skill.name)?;
    let skill_dir = output_dir.join(&skill.name);
    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("failed to create directory {}: {e}", skill_dir.display()))?;

    let rendered = render_skill_md(skill)?;
    let skill_md_path = skill_dir.join("SKILL.md");
    fs::write(&skill_md_path, rendered)
        .map_err(|e| format!("failed to write {}: {e}", skill_md_path.display()))?;

    for aux in &skill.auxiliary_files {
        write_auxiliary_file(&skill_dir, aux)?;
    }
    Ok(())
}

/// Writes every entry in `skills` under `output_dir`, one call to
/// `write_skill` per entry. Shrinks each `HarnessTransformer::transform`
/// implementation's `stage_content_type` closure to a single call
/// instead of an inline loop.
pub(crate) fn write_all_skills(output_dir: &Path, skills: &[SkillDef]) -> Result<(), String> {
    for skill in skills {
        write_skill(output_dir, skill)?;
    }
    Ok(())
}

/// Writes one auxiliary file at `<skill_dir>/<aux.relative_path>`,
/// creating any intermediate directories, and chmods it `0o755` when
/// `aux.executable` (matching the source's execute bit) or `0o644`
/// otherwise. The chmod is a no-op on non-Unix targets, which have no
/// equivalent permission bit.
pub(crate) fn write_auxiliary_file(skill_dir: &Path, aux: &AuxiliaryFile) -> Result<(), String> {
    reject_unsafe_auxiliary_relative_path(&aux.relative_path)?;
    let path = skill_dir.join(&aux.relative_path);
    let parent = path.parent().ok_or_else(|| {
        format!(
            "auxiliary file path has no parent directory: {}",
            path.display()
        )
    })?;
    fs::create_dir_all(parent)
        .map_err(|e| format!("failed to create directory {}: {e}", parent.display()))?;
    fs::write(&path, &aux.content)
        .map_err(|e| format!("failed to write {}: {e}", path.display()))?;
    set_executable(&path, aux.executable)
        .map_err(|e| format!("failed to set permissions on {}: {e}", path.display()))?;
    Ok(())
}

/// Sets the file mode to `0o755` when `executable`, `0o644` otherwise.
#[cfg(unix)]
pub(crate) fn set_executable(path: &Path, executable: bool) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if executable { 0o755 } else { 0o644 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

/// Non-Unix targets have no execute-permission bit to set.
#[cfg(not(unix))]
pub(crate) fn set_executable(_path: &Path, _executable: bool) -> std::io::Result<()> {
    Ok(())
}

/// Writes one SOP's markdown body to `<output_dir>/<sop.name>.sop.md`,
/// preserving the source `.sop.md` naming convention. The body is
/// written verbatim (no frontmatter reconstruction -- `SopDef` has no
/// frontmatter fields, per `parse_canonical.rs`'s `_parse_sops`).
pub(crate) fn write_sop(output_dir: &Path, sop: &SopDef) -> Result<(), String> {
    reject_unsafe_sop_name(&sop.name)?;
    fs::create_dir_all(output_dir)
        .map_err(|e| format!("failed to create directory {}: {e}", output_dir.display()))?;
    let path = output_dir.join(format!("{}.sop.md", sop.name));
    fs::write(&path, &sop.body).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Writes every entry in `sops` under `output_dir`, one call to
/// `write_sop` per entry.
pub(crate) fn write_all_sops(output_dir: &Path, sops: &[SopDef]) -> Result<(), String> {
    for sop in sops {
        write_sop(output_dir, sop)?;
    }
    Ok(())
}

/// Writes one context file's body to `<output_dir>/<context.name>`,
/// preserving the source filename verbatim. Written through as-is (no
/// frontmatter reconstruction -- `ContextDef` has no frontmatter
/// fields, per `parse_canonical.rs`'s `parse_context`).
pub(crate) fn write_context(output_dir: &Path, context: &ContextDef) -> Result<(), String> {
    reject_unsafe_context_name(&context.name)?;
    fs::create_dir_all(output_dir)
        .map_err(|e| format!("failed to create directory {}: {e}", output_dir.display()))?;
    let path = output_dir.join(&context.name);
    fs::write(&path, &context.body).map_err(|e| format!("failed to write {}: {e}", path.display()))
}

/// Writes every entry in `context` under `output_dir`, one call to
/// `write_context` per entry.
pub(crate) fn write_all_context(output_dir: &Path, context: &[ContextDef]) -> Result<(), String> {
    for entry in context {
        write_context(output_dir, entry)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-content-writers-test-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn minimal_skill(name: &str) -> SkillDef {
        SkillDef {
            name: name.to_string(),
            raw_frontmatter: format!("name: {name}\ndescription: A test skill."),
            body: "# Body\n\nContent.\n".to_string(),
            auxiliary_files: Vec::new(),
        }
    }

    #[test]
    fn write_skill_rejects_path_traversal_skill_name() {
        let output_root = temp_dir("skill-traversal-bypass-direct");
        let escape_target = output_root.parent().unwrap().join("evil").join("SKILL.md");
        let _ = fs::remove_dir_all(escape_target.parent().unwrap());

        let result = write_skill(&output_root, &minimal_skill("../evil"));
        assert!(result.is_err());
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
        let _ = fs::remove_dir_all(escape_target.parent().unwrap());
    }

    #[test]
    fn write_skill_rejects_embedded_nul_skill_name() {
        let output_root = temp_dir("skill-nul-bypass");
        let result = write_skill(&output_root, &minimal_skill("evil\0name"));
        assert!(result.is_err());
        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_auxiliary_file_rejects_path_traversal_relative_path() {
        let output_root = temp_dir("aux-traversal-bypass-direct");
        let escape_target = output_root.parent().unwrap().join("evil.sh");
        let _ = fs::remove_file(&escape_target);

        let aux = AuxiliaryFile {
            relative_path: std::path::PathBuf::from("../evil.sh"),
            content: b"#!/bin/sh\n".to_vec(),
            executable: true,
        };
        let result = write_auxiliary_file(&output_root, &aux);
        assert!(result.is_err());
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_auxiliary_file_preserves_executable_bit() {
        let output_root = temp_dir("aux-executable-bit");
        let aux = AuxiliaryFile {
            relative_path: std::path::PathBuf::from("scripts/run.sh"),
            content: b"#!/bin/sh\necho hi\n".to_vec(),
            executable: true,
        };
        write_auxiliary_file(&output_root, &aux).unwrap();

        let script = output_root.join("scripts/run.sh");
        assert!(script.exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&script).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o755);
        }

        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_sop_rejects_path_traversal_sop_name() {
        let output_root = temp_dir("sop-traversal-bypass-direct");
        let escape_target = output_root.parent().unwrap().join("evil.sop.md");
        let _ = fs::remove_file(&escape_target);

        let result = write_sop(
            &output_root,
            &SopDef {
                name: "../evil".to_string(),
                body: "body".to_string(),
            },
        );
        assert!(result.is_err());
        assert!(!escape_target.exists());

        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_all_skills_writes_every_entry() {
        let output_root = temp_dir("write-all-skills");
        let skills = vec![minimal_skill("skill-a"), minimal_skill("skill-b")];
        write_all_skills(&output_root, &skills).unwrap();
        assert!(output_root.join("skill-a/SKILL.md").exists());
        assert!(output_root.join("skill-b/SKILL.md").exists());
        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_all_sops_writes_every_entry() {
        let output_root = temp_dir("write-all-sops");
        let sops = vec![
            SopDef {
                name: "sop-a".to_string(),
                body: "Body A".to_string(),
            },
            SopDef {
                name: "sop-b".to_string(),
                body: "Body B".to_string(),
            },
        ];
        write_all_sops(&output_root, &sops).unwrap();
        assert!(output_root.join("sop-a.sop.md").exists());
        assert!(output_root.join("sop-b.sop.md").exists());
        let _ = fs::remove_dir_all(&output_root);
    }

    #[test]
    fn write_all_context_writes_every_entry() {
        let output_root = temp_dir("write-all-context");
        let context = vec![
            ContextDef {
                name: "a.md".to_string(),
                body: "A".to_string(),
            },
            ContextDef {
                name: "b.md".to_string(),
                body: "B".to_string(),
            },
        ];
        write_all_context(&output_root, &context).unwrap();
        assert!(output_root.join("a.md").exists());
        assert!(output_root.join("b.md").exists());
        let _ = fs::remove_dir_all(&output_root);
    }
}
