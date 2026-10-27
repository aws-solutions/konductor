// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli/skill_pointers.rs — one small `ks-<name>/SKILL.md`
// pointer per synthed skill under `.kiro/skills/`, so Kiro lists every
// skill's name and description natively while the body is still loaded
// through the `konductor-skills` MCP server.
//
// Each Kiro agent also gets a `skill://.kiro/skills/ks-*/SKILL.md`
// resource (`resource_rewrite::SkillPointerResourcePass`) so the pointers
// are listed for that agent explicitly rather than by relying on Kiro's
// directory scan.
//
// `install --no-skill-pointers` records a marker file under `.konductor/`;
// install and update read it, so an opt-out survives `update`.

use std::path::{Path, PathBuf};

use super::super::artifact::sha256_hex;
use super::super::claude::yaml_double_quote;
use super::super::manifest::{classify_provenance, ManifestFile, Provenance, StrategyManifest};
use super::plan::{content_manifest_path, PlannedFile};
use super::{list_skill_dirs, KIRO_DESTINATION_ROOT, KONDUCTOR_DESTINATION_ROOT};
use crate::cli::atomic_write::write_atomic;
use crate::cli::synth::kiro_cli_v2::SKILLS_CONTENT_TYPE_DIR;
use crate::cli::synth::parse_canonical::split_frontmatter;
use crate::cli::synth::path_safety::reject_unsafe_skill_name;

/// Directory-name prefix of every pointer. Keeps pointers apart from
/// same-named skills other tools put in `.kiro/skills/`. The prefix is
/// not the bare skill name, so a pointer is listed as `ks-<name>`.
pub(in crate::cli::install) const SKILL_POINTER_PREFIX: &str = "ks-";

/// The `resources` entry that lists every pointer for an agent. Must
/// match `SKILL_POINTER_PREFIX`.
pub(in crate::cli::install) const SKILL_POINTER_RESOURCE: &str =
    "skill://.kiro/skills/ks-*/SKILL.md";

/// Longest pointer description, in characters, ellipsis included. Every
/// pointer is listed in each agent's prompt, so this bounds their
/// combined size.
const POINTER_DESCRIPTION_MAX_CHARS: usize = 200;

const ELLIPSIS: &str = "...";

const SKILL_FILE_NAME: &str = "SKILL.md";

/// Marker file under `.konductor/` that records `install
/// --no-skill-pointers`.
const OPT_OUT_MARKER_NAME: &str = "no-skill-pointers";

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

/// The pointers a harness dir yields, plus the skills that get none.
struct PointerSet {
    pointers: Vec<SkillPointer>,
    /// `(skill name, reason)` for each skill without a usable description.
    skipped: Vec<(String, String)>,
}

fn opt_out_marker_path(target_dir: &Path) -> PathBuf {
    target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(OPT_OUT_MARKER_NAME)
}

/// Whether pointers are written for `target_dir`: true unless an
/// `install --no-skill-pointers` left its marker there.
pub(crate) fn skill_pointers_enabled(target_dir: &Path) -> bool {
    !opt_out_marker_path(target_dir).exists()
}

/// Records (`opt_out`) or clears the `--no-skill-pointers` choice for
/// `target_dir`. Returns whether the recorded choice changed.
pub(crate) fn set_skill_pointers_opt_out(target_dir: &Path, opt_out: bool) -> Result<bool, String> {
    let marker = opt_out_marker_path(target_dir);
    if opt_out == marker.exists() {
        return Ok(false);
    }
    if opt_out {
        std::fs::create_dir_all(target_dir.join(KONDUCTOR_DESTINATION_ROOT))
            .map_err(|e| format!("failed to create {}: {e}", marker.display()))?;
        write_atomic(
            &marker,
            b"install --no-skill-pointers was used here; install and update skip the ks-* pointers.\n",
        )
        .map_err(|e| format!("failed to write {}: {e}", marker.display()))?;
    } else {
        std::fs::remove_file(&marker)
            .map_err(|e| format!("failed to remove {}: {e}", marker.display()))?;
    }
    Ok(true)
}

/// Removes the opt-out marker, if any, on a full uninstall.
pub(crate) fn remove_skill_pointers_opt_out(target_dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_file(opt_out_marker_path(target_dir)) {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
}

/// Writes one pointer `SKILL.md` per skill staged under
/// `<harness_dir>/skills/` into `<target_dir>/.kiro/skills/ks-<name>/`,
/// and removes the pointers `prior_manifest` tracked that this run no
/// longer writes (a dropped skill, or `--no-skill-pointers`). Returns an
/// empty `Vec` when pointers are off or no skills are staged.
pub(in crate::cli::install) fn install_kiro_skill_pointers(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<ManifestFile>, String> {
    let mut files = Vec::new();
    if skill_pointers_enabled(target_dir) {
        let set = list_skill_pointers(harness_dir)?;
        for (skill, reason) in &set.skipped {
            eprintln!(
                "konductor install: warning: no skill pointer for '{skill}': {reason}; \
                 the skill itself is still installed"
            );
        }
        let fallback_dir = fallback_skills_dir(target_dir);
        for pointer in &set.pointers {
            let rendered = render_pointer_md(pointer, &fallback_dir);
            let dst = target_dir.join(pointer.manifest_path());
            write_pointer(&dst, &rendered)?;
            files.push(ManifestFile {
                path: pointer.manifest_path(),
                sha256: Some(sha256_hex(rendered.as_bytes())),
                // Overwritten by `attach_provenance`.
                provenance: Provenance::Created,
            });
        }
    }
    prune_stale_pointers(target_dir, prior_manifest, &files);
    Ok(files)
}

/// Plans every file `install_kiro_skill_pointers` will write, without
/// writing anything.
pub(in crate::cli::install) fn plan_kiro_skill_pointer_files(
    harness_dir: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<PlannedFile>, String> {
    if !skill_pointers_enabled(target_dir) {
        return Ok(Vec::new());
    }
    Ok(list_skill_pointers(harness_dir)?
        .pointers
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

/// Deletes the pointer files `prior_manifest` tracked that `written` no
/// longer contains. Only manifest-tracked paths are touched, and a pointer
/// directory is removed only once empty. Best-effort: a file the user
/// already removed is fine.
fn prune_stale_pointers(
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
    written: &[ManifestFile],
) {
    let Some(prior) = prior_manifest else {
        return;
    };
    let pointer_root = content_manifest_path(
        KIRO_DESTINATION_ROOT,
        SKILLS_CONTENT_TYPE_DIR,
        SKILL_POINTER_PREFIX,
    );
    for prior_file in &prior.files {
        if !prior_file.path.starts_with(&pointer_root)
            || written.iter().any(|f| f.path == prior_file.path)
        {
            continue;
        }
        let stale = target_dir.join(&prior_file.path);
        let _ = std::fs::remove_file(&stale);
        if let Some(dir) = stale.parent() {
            let _ = std::fs::remove_dir(dir);
        }
    }
}

fn write_pointer(dst: &Path, rendered: &str) -> Result<(), String> {
    if let Some(dir) = dst.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("failed to create {}: {e}", dir.display()))?;
    }
    write_atomic(dst, rendered.as_bytes())
        .map_err(|e| format!("failed to write {}: {e}", dst.display()))
}

/// A skill whose `SKILL.md` cannot be read fails the install. A skill
/// whose `description` is missing or unusable gets no pointer and is
/// reported in `skipped`: synth rejects such skills, so only a hand-staged
/// tree can hit this.
fn list_skill_pointers(harness_dir: &Path) -> Result<PointerSet, String> {
    let source_root = harness_dir.join(SKILLS_CONTENT_TYPE_DIR);
    let mut set = PointerSet {
        pointers: Vec::new(),
        skipped: Vec::new(),
    };
    for skill_name in list_skill_dirs(&source_root)? {
        reject_unsafe_skill_name(&format!("{SKILL_POINTER_PREFIX}{skill_name}"))?;
        let skill_md = source_root.join(&skill_name).join(SKILL_FILE_NAME);
        let raw = std::fs::read_to_string(&skill_md)
            .map_err(|e| format!("failed to read {}: {e}", skill_md.display()))?;
        match read_description(&raw) {
            Ok(description) => set.pointers.push(SkillPointer {
                skill_name,
                description,
            }),
            Err(reason) => set.skipped.push((skill_name, reason)),
        }
    }
    Ok(set)
}

/// The skill's `description`, flattened to one line of printable
/// characters and cut to `POINTER_DESCRIPTION_MAX_CHARS`.
fn read_description(skill_md: &str) -> Result<String, String> {
    let (frontmatter, _) = split_frontmatter(skill_md, SKILL_FILE_NAME)
        .map_err(|_| "SKILL.md has no frontmatter".to_string())?;
    let value: serde_yaml::Value = serde_yaml::from_str(frontmatter)
        .map_err(|e| format!("SKILL.md frontmatter is not valid YAML ({e})"))?;
    let description = value
        .get("description")
        .ok_or_else(|| "SKILL.md has no `description`".to_string())?
        .as_str()
        .ok_or_else(|| "`description` is not a string".to_string())?;
    let one_line = description.split_whitespace().collect::<Vec<_>>().join(" ");
    // `yaml_double_quote` assumes no control characters.
    let printable: String = one_line.chars().filter(|c| !c.is_control()).collect();
    if printable.is_empty() {
        return Err("`description` is empty".to_string());
    }
    Ok(truncate_description(&printable))
}

/// Cuts `text` to `POINTER_DESCRIPTION_MAX_CHARS` characters, at a word
/// boundary when one falls in the back half, and ends it with an ellipsis.
fn truncate_description(text: &str) -> String {
    if text.chars().count() <= POINTER_DESCRIPTION_MAX_CHARS {
        return text.to_string();
    }
    let keep: String = text
        .chars()
        .take(POINTER_DESCRIPTION_MAX_CHARS - ELLIPSIS.len())
        .collect();
    let cut = match keep.rfind(' ') {
        Some(i) if i >= keep.len() / 2 => &keep[..i],
        _ => keep.as_str(),
    };
    format!("{}{ELLIPSIS}", cut.trim_end())
}

/// The absolute path of the installed skill bodies, so the fallback read
/// works from any working directory without relying on `~` expansion.
fn fallback_skills_dir(target_dir: &Path) -> String {
    std::path::absolute(target_dir)
        .unwrap_or_else(|_| target_dir.to_path_buf())
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(SKILLS_CONTENT_TYPE_DIR)
        .display()
        .to_string()
}

fn render_pointer_md(pointer: &SkillPointer, fallback_dir: &str) -> String {
    let name = &pointer.skill_name;
    format!(
        "---\nname: {}\ndescription: {}\n---\n\n\
         This file points to the `{name}` skill. The skill's instructions are not in this file.\n\n\
         1. Call `get_skill` with `name: \"{name}\"` on the `konductor-skills` MCP server. \
         Do this first. If the tool is not loaded yet, load it, then call it.\n\
         2. Only if the `konductor-skills` server is not connected, or it has no `get_skill` tool, \
         read `{fallback_dir}/{name}/{SKILL_FILE_NAME}`.\n\
         3. If `get_skill` says the skill is not found, stop. The skill is outside your scope. \
         Do not read the file.\n",
        yaml_double_quote(&pointer.dir_name()),
        yaml_double_quote(&pointer.description),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::install::manifest::Status;

    fn scratch_dir(name: &str) -> std::path::PathBuf {
        super::super::test_support::scratch_dir(&format!("skill-pointers-{name}"))
    }

    fn stage_skill(harness_dir: &Path, name: &str, skill_md: &str) {
        let dir = harness_dir.join(SKILLS_CONTENT_TYPE_DIR).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(SKILL_FILE_NAME), skill_md).unwrap();
    }

    fn skill_md(name: &str, description: &str) -> String {
        format!("---\nname: {name}\ndescription: {description}\n---\n\nBody\n")
    }

    fn manifest_of(files: &[ManifestFile]) -> StrategyManifest {
        StrategyManifest::new(
            "kiro-cli-v2",
            "2026-01-01T00:00:00Z",
            ".",
            None,
            Status::Complete,
            files.to_vec(),
        )
    }

    fn paths(files: &[ManifestFile]) -> Vec<&str> {
        files.iter().map(|f| f.path.as_str()).collect()
    }

    #[test]
    fn description_is_flattened_to_one_line() {
        let md = "---\nname: a\ndescription: >-\n  one\n  two\n---\n\nBody\n";
        assert_eq!(read_description(md).as_deref(), Ok("one two"));
    }

    #[test]
    fn description_errors_without_frontmatter_or_key() {
        assert!(read_description("# just a body\n").is_err());
        assert!(read_description("---\nname: a\n---\n\nBody\n").is_err());
    }

    #[test]
    fn list_valued_description_is_reported_not_flattened() {
        let md = "---\nname: a\ndescription:\n  - one\n  - two\n---\n\nBody\n";
        let err = read_description(md).unwrap_err();
        assert!(err.contains("not a string"), "{err}");
    }

    #[test]
    fn control_characters_are_stripped_from_the_description() {
        let md = "---\nname: a\ndescription: \"red \\u001b[31mtext\\u0007\"\n---\n\nBody\n";
        assert_eq!(read_description(md).as_deref(), Ok("red [31mtext"));
    }

    #[test]
    fn description_of_only_control_characters_is_an_error() {
        let md = "---\nname: a\ndescription: \"\\u001b\"\n---\n\nBody\n";
        assert!(read_description(md).unwrap_err().contains("empty"));
    }

    #[test]
    fn long_description_is_cut_to_the_cap_at_a_word_boundary() {
        let long = "word ".repeat(100);
        let cut = truncate_description(long.trim());
        assert!(
            cut.chars().count() <= POINTER_DESCRIPTION_MAX_CHARS,
            "{cut}"
        );
        assert!(cut.ends_with(ELLIPSIS), "{cut}");
        assert!(cut.trim_end_matches(ELLIPSIS).ends_with("word"), "{cut}");
    }

    #[test]
    fn description_at_the_cap_is_unchanged() {
        let exact = "a".repeat(POINTER_DESCRIPTION_MAX_CHARS);
        assert_eq!(truncate_description(&exact), exact);
        let over = "a".repeat(POINTER_DESCRIPTION_MAX_CHARS + 1);
        let cut = truncate_description(&over);
        assert_eq!(cut.chars().count(), POINTER_DESCRIPTION_MAX_CHARS);
    }

    #[test]
    fn truncation_never_splits_a_multibyte_character() {
        let wide = "é".repeat(POINTER_DESCRIPTION_MAX_CHARS + 50);
        let cut = truncate_description(&wide);
        assert_eq!(cut.chars().count(), POINTER_DESCRIPTION_MAX_CHARS);
    }

    #[test]
    fn resource_glob_matches_the_pointer_prefix() {
        assert_eq!(
            SKILL_POINTER_RESOURCE,
            format!("skill://.kiro/skills/{SKILL_POINTER_PREFIX}*/SKILL.md")
        );
    }

    #[test]
    fn rendered_pointer_is_valid_frontmatter_with_prefixed_name() {
        let pointer = SkillPointer {
            skill_name: "alpha".to_string(),
            description: "Say \"hi\": now".to_string(),
        };
        let rendered = render_pointer_md(&pointer, "/abs/.konductor/skills");
        let (frontmatter, body) = split_frontmatter(&rendered, "pointer").unwrap();
        let value: serde_yaml::Value = serde_yaml::from_str(frontmatter).unwrap();
        assert_eq!(value["name"].as_str(), Some("ks-alpha"));
        assert_eq!(value["description"].as_str(), Some("Say \"hi\": now"));
        assert!(body.contains("/abs/.konductor/skills/alpha/SKILL.md"));
    }

    /// The scope check lives in the server's `get_skill`, so the body must
    /// send the agent there first, allow the file only when the server is
    /// absent, and forbid it after a not-found answer.
    #[test]
    fn pointer_body_orders_get_skill_before_the_file_and_stops_on_not_found() {
        let pointer = SkillPointer {
            skill_name: "alpha".to_string(),
            description: "d".to_string(),
        };
        let rendered = render_pointer_md(&pointer, "/abs/.konductor/skills");
        let (_, body) = split_frontmatter(&rendered, "pointer").unwrap();
        let get_skill = body.find("Call `get_skill`").expect("step 1");
        let file = body
            .find("read `/abs/.konductor/skills/alpha/SKILL.md`")
            .expect("step 2");
        assert!(get_skill < file, "get_skill comes first: {body}");
        assert!(
            body.contains("Only if the `konductor-skills` server is not connected"),
            "{body}"
        );
        assert!(body.contains("says the skill is not found, stop"), "{body}");
        assert!(body.contains("Do not read the file"), "{body}");
        assert!(
            body.contains("If the tool is not loaded yet, load it"),
            "{body}"
        );
        assert!(!body.contains("deferred"), "{body}");
        assert!(!body.contains('~'), "fallback path is absolute: {body}");
    }

    #[test]
    fn install_writes_one_pointer_per_described_skill_and_plan_agrees() {
        let harness_dir = scratch_dir("install-harness");
        let target_dir = scratch_dir("install-target");
        stage_skill(&harness_dir, "alpha", &skill_md("alpha", "A."));
        stage_skill(&harness_dir, "bare", "no frontmatter\n");

        let files = install_kiro_skill_pointers(&harness_dir, &target_dir, None).unwrap();
        let planned = plan_kiro_skill_pointer_files(&harness_dir, &target_dir, None).unwrap();

        assert_eq!(paths(&files), [".kiro/skills/ks-alpha/SKILL.md"]);
        assert_eq!(planned.len(), 1);
        assert_eq!(planned[0].manifest_path, files[0].path);
        assert!(target_dir.join(&files[0].path).is_file());
        assert!(!target_dir.join(".kiro/skills/ks-bare").exists());
    }

    #[test]
    fn unreadable_skill_md_fails_the_install() {
        let harness_dir = scratch_dir("unreadable-harness");
        let target_dir = scratch_dir("unreadable-target");
        // A directory named SKILL.md cannot be read as a file.
        let dir = harness_dir.join(SKILLS_CONTENT_TYPE_DIR).join("alpha");
        std::fs::create_dir_all(dir.join(SKILL_FILE_NAME)).unwrap();

        let err = install_kiro_skill_pointers(&harness_dir, &target_dir, None).unwrap_err();
        assert!(err.contains("failed to read"), "{err}");
    }

    #[test]
    fn install_returns_nothing_when_no_skills_are_staged() {
        let harness_dir = scratch_dir("empty-harness");
        let target_dir = scratch_dir("empty-target");
        assert!(install_kiro_skill_pointers(&harness_dir, &target_dir, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn unsafe_skill_directory_name_is_rejected() {
        let harness_dir = scratch_dir("unsafe-harness");
        stage_skill(&harness_dir, "bad name", "---\ndescription: x\n---\n");
        assert!(list_skill_pointers(&harness_dir).is_err());
    }

    #[test]
    fn dropped_skill_pointer_is_pruned_on_the_next_install() {
        let harness_dir = scratch_dir("prune-harness");
        let target_dir = scratch_dir("prune-target");
        stage_skill(&harness_dir, "alpha", &skill_md("alpha", "A."));
        stage_skill(&harness_dir, "beta", &skill_md("beta", "B."));
        let first = install_kiro_skill_pointers(&harness_dir, &target_dir, None).unwrap();
        assert_eq!(first.len(), 2);

        std::fs::remove_dir_all(harness_dir.join(SKILLS_CONTENT_TYPE_DIR).join("beta")).unwrap();
        let second =
            install_kiro_skill_pointers(&harness_dir, &target_dir, Some(&manifest_of(&first)))
                .unwrap();

        assert_eq!(paths(&second), [".kiro/skills/ks-alpha/SKILL.md"]);
        assert!(target_dir.join(".kiro/skills/ks-alpha/SKILL.md").is_file());
        assert!(!target_dir.join(".kiro/skills/ks-beta").exists());
    }

    #[test]
    fn prune_leaves_untracked_files_and_directories_alone() {
        let harness_dir = scratch_dir("prune-foreign-harness");
        let target_dir = scratch_dir("prune-foreign-target");
        stage_skill(&harness_dir, "alpha", &skill_md("alpha", "A."));
        let first = install_kiro_skill_pointers(&harness_dir, &target_dir, None).unwrap();
        let foreign = target_dir.join(".kiro/skills/ks-alpha/notes.txt");
        std::fs::write(&foreign, "mine").unwrap();
        let other = target_dir.join(".kiro/skills/ks-other/SKILL.md");
        std::fs::create_dir_all(other.parent().unwrap()).unwrap();
        std::fs::write(&other, "not ours").unwrap();

        std::fs::remove_dir_all(harness_dir.join(SKILLS_CONTENT_TYPE_DIR).join("alpha")).unwrap();
        install_kiro_skill_pointers(&harness_dir, &target_dir, Some(&manifest_of(&first))).unwrap();

        assert!(!target_dir.join(".kiro/skills/ks-alpha/SKILL.md").exists());
        assert!(
            foreign.is_file(),
            "an untracked file in a pointer dir stays"
        );
        assert!(other.is_file(), "an untracked pointer-like dir stays");
    }

    #[test]
    fn opt_out_is_recorded_skips_pointers_and_prunes_the_old_ones() {
        let harness_dir = scratch_dir("optout-harness");
        let target_dir = scratch_dir("optout-target");
        stage_skill(&harness_dir, "alpha", &skill_md("alpha", "A."));
        assert!(skill_pointers_enabled(&target_dir));
        let first = install_kiro_skill_pointers(&harness_dir, &target_dir, None).unwrap();
        assert_eq!(first.len(), 1);

        assert!(set_skill_pointers_opt_out(&target_dir, true).unwrap());
        assert!(
            !set_skill_pointers_opt_out(&target_dir, true).unwrap(),
            "no change"
        );
        assert!(!skill_pointers_enabled(&target_dir));
        let second =
            install_kiro_skill_pointers(&harness_dir, &target_dir, Some(&manifest_of(&first)))
                .unwrap();
        assert!(second.is_empty());
        assert!(!target_dir.join(".kiro/skills/ks-alpha").exists());
        assert!(
            plan_kiro_skill_pointer_files(&harness_dir, &target_dir, None)
                .unwrap()
                .is_empty()
        );

        assert!(set_skill_pointers_opt_out(&target_dir, false).unwrap());
        assert!(skill_pointers_enabled(&target_dir));
        assert_eq!(
            install_kiro_skill_pointers(&harness_dir, &target_dir, None)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn removing_the_marker_twice_is_fine() {
        let target_dir = scratch_dir("marker-remove");
        set_skill_pointers_opt_out(&target_dir, true).unwrap();
        remove_skill_pointers_opt_out(&target_dir).unwrap();
        remove_skill_pointers_opt_out(&target_dir).unwrap();
        assert!(skill_pointers_enabled(&target_dir));
    }
}
