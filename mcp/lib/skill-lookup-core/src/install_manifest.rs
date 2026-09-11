// SPDX-License-Identifier: Apache-2.0
//
// install_manifest.rs — minimal, dependency-free reader for the install
// manifest `cli/konductor-rs` writes at `<target_dir>/.konductor/manifest`
// (see that crate's own `cli/install/manifest.rs`, which is this module's
// source of truth for the manifest's wire shape).
//
// `skill-lookup-core` (this crate, under `mcp/`) and `cli/konductor-rs`
// are separate Cargo workspaces (`mcp/Cargo.toml` declares its own
// `[workspace]` with members `servers/*`/`lib/*`; `cli/konductor-rs` is a
// standalone package with no workspace relationship to it). Adding a
// cross-workspace dependency just to reuse `cli/konductor-rs`'s
// `Manifest`/`ManifestFile` types would couple two otherwise-independent
// binaries. Instead, this module parses only the minimal subset of the
// manifest's documented JSON shape this crate actually needs --
// `files[].path` -- treating every other field (`schema_version`,
// `sha256`, `provenance`, `status`, `source`, `strategy`,
// `installed_at`, `destination`) as opaque and never modeling it here.
// Treat the shape parsed below as a stable, documented wire contract
// (per `cli/install/manifest.rs`'s own module docstring), not as this
// crate's to evolve independently.
//
// ── Why this exists ─────────────────────────────────────────────────────
// `scanner::apply_name_filter` narrows `--skill-name-filter` to only ever
// remove a skill konductor itself installed -- a hand-authored or
// third-party skill living in the same `--skills-dir` root must always
// pass through untouched, regardless of the filter (see reviewer
// feedback on CR-302539291's r4p2). The install manifest is the only
// reliable signal for that distinction: konductor's own installer MERGES
// into `.konductor/skills/` rather than replacing it wholesale --
// `cli/install/kiro_cli.rs`'s own module doc comment says so explicitly
// ("a skill directory this install did not emit ... is left untouched")
// -- so a hand-authored skill can sit in the exact same root, even the
// exact same parent directory, as a konductor-installed one.
// `model::Provenance` (which `--skills-dir` a skill was found under) is
// the wrong axis for this: both kinds of skill share one root.
//
// ── Fail-open, by design ────────────────────────────────────────────────
// Every failure this module can hit -- the manifest file doesn't exist,
// can't be read, isn't valid JSON, or doesn't have the expected `files`
// array shape -- collapses to an empty result (`HashSet::new()`), never
// an error propagated to the caller. A scan must never treat "I couldn't
// read the manifest" as "therefore nothing here is konductor-installed,
// so the filter should scope everything" (failing CLOSED) -- that would
// silently hide every skill under a root whose manifest happens to be
// temporarily unreadable, exactly the false-positive scoping this module
// exists to prevent. Failing open here means: on any read/parse problem,
// treat every skill under that root as NOT konductor-installed, so
// `--skill-name-filter` leaves all of them untouched -- the safer of the
// two possible wrong answers.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

/// The install manifest's file name, relative to its parent `.konductor`
/// directory. Duplicated from `cli/konductor-rs/src/cli/install/manifest.rs`'s
/// own `MANIFEST_FILE_NAME` constant (no `.json` suffix, by that crate's
/// own design) -- see this module's doc comment for why a cross-workspace
/// dependency is not used to share it directly instead.
const MANIFEST_FILE_NAME: &str = "manifest";

/// Given a `--skills-dir` root (e.g. `<target_dir>/.konductor/skills`),
/// returns its sibling install manifest's path: one directory up from
/// `root`, then `MANIFEST_FILE_NAME` -- i.e. `<target_dir>/.konductor/manifest`,
/// since `root`'s own parent IS the `.konductor` directory the manifest
/// lives in. Confirmed against `cli/install/manifest.rs::manifest_path`
/// (`target_dir.join(KONDUCTOR_DIR_NAME).join(MANIFEST_FILE_NAME)`) and
/// `cli/install/kiro_cli.rs`'s `KONDUCTOR_DESTINATION_ROOT` (`.konductor`)
/// and `SKILLS_CONTENT_TYPE_DIR` (`skills`) constants, which is exactly
/// how a real `--skills-dir` root is constructed
/// (`<target_dir>/.konductor/skills`, per this server's own `cli.rs`).
///
/// `None` if `root` has no parent at all (e.g. `/`, or a bare
/// single-component relative path) -- there is nothing to look up in
/// that case, and the caller treats this the same as "no manifest".
fn manifest_path_for_skills_root(root: &Path) -> Option<PathBuf> {
    Some(root.parent()?.join(MANIFEST_FILE_NAME))
}

/// Reads `manifest_path` and returns the set of every `files[].path`
/// string it names, or `None` on any failure: absent, unreadable, not
/// valid JSON, missing the expected `files` array, or an entry missing
/// its `path` string. See this module's doc comment for why every
/// failure collapses to a single `None` rather than a distinguishable
/// error -- the caller's fail-open default is the same either way. Only
/// `files[].path` is parsed; every other field in the real manifest is
/// ignored, deliberately -- see the module doc comment.
fn read_installed_paths(manifest_path: &Path) -> Option<HashSet<String>> {
    let contents = std::fs::read_to_string(manifest_path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&contents).ok()?;
    let files = value.get("files")?.as_array()?;
    let mut paths = HashSet::with_capacity(files.len());
    for file in files {
        let path = file.get("path")?.as_str()?;
        paths.insert(path.to_string());
    }
    Some(paths)
}

/// Convenience wrapper combining `manifest_path_for_skills_root` and
/// `read_installed_paths`, collapsing every failure mode (no sibling
/// manifest, unreadable, malformed) to an empty set -- the fail-open
/// default this module's doc comment describes. Called once per
/// `--skills-dir` root, by `scanner::mark_konductor_installed`, after
/// that root has already been scanned.
pub(crate) fn installed_paths_for_root(root: &Path) -> HashSet<String> {
    manifest_path_for_skills_root(root)
        .and_then(|path| read_installed_paths(&path))
        .unwrap_or_default()
}

/// Renders `skill_md`'s path relative to `target_dir_anchor` (the
/// install root two directory levels above a `--skills-dir` root -- see
/// `manifest.rs`'s own module doc comment: "destination is always `.`",
/// meaning every `files[].path` entry is relative to `target_dir`
/// itself, not to the `--skills-dir` root), joined with `/` regardless
/// of platform. The real writer (`cli/install/kiro_cli.rs`'s
/// `content_manifest_path`) builds every manifest path with
/// `format!("{a}/{b}")`, never `Path::join`, so a path rendered with the
/// platform separator (e.g. `\` on Windows) would never match a real
/// manifest entry; this always emits `/`.
///
/// Returns `None` if `target_dir_anchor` is `None`, if `skill_md` is not
/// actually under it, or if any path component in between is anything
/// other than a plain name (`..`, a root, a prefix) -- all of these fail
/// open at the caller (see `installed_paths_for_root`'s doc comment),
/// since `None` here just means "can't compute this skill's
/// manifest-relative path," not "the manifest lookup itself failed."
pub(crate) fn manifest_relative_path(
    skill_md: &Path,
    target_dir_anchor: Option<&Path>,
) -> Option<String> {
    let anchor = target_dir_anchor?;
    let relative = skill_md.strip_prefix(anchor).ok()?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-install-manifest-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn manifest_path_for_skills_root_is_one_level_up() {
        let root = PathBuf::from("/home/user/.konductor/skills");
        let manifest = manifest_path_for_skills_root(&root).unwrap();
        assert_eq!(manifest, PathBuf::from("/home/user/.konductor/manifest"));
    }

    #[test]
    fn manifest_path_for_skills_root_none_when_root_has_no_parent() {
        assert_eq!(manifest_path_for_skills_root(Path::new("/")), None);
    }

    #[test]
    fn read_installed_paths_none_when_file_absent() {
        let dir = temp_dir("absent");
        assert_eq!(read_installed_paths(&dir.join("manifest")), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_none_when_malformed_json() {
        let dir = temp_dir("malformed");
        let path = dir.join("manifest");
        fs::write(&path, b"not json").unwrap();
        assert_eq!(read_installed_paths(&path), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_none_when_files_field_missing() {
        let dir = temp_dir("no-files-field");
        let path = dir.join("manifest");
        fs::write(&path, br#"{"schema_version":1}"#).unwrap();
        assert_eq!(read_installed_paths(&path), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_extracts_every_file_path() {
        let dir = temp_dir("valid");
        let path = dir.join("manifest");
        fs::write(
            &path,
            br#"{"schema_version":1,"files":[
                {"path":".konductor/skills/code-review/SKILL.md","sha256":null,"provenance":"created"},
                {"path":".konductor/skills/code-review/references/foo.md","sha256":null,"provenance":"created"}
            ]}"#,
        )
        .unwrap();
        let paths = read_installed_paths(&path).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(".konductor/skills/code-review/SKILL.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn installed_paths_for_root_empty_when_no_sibling_manifest() {
        let base = temp_dir("no-sibling-manifest");
        let root = base.join(".konductor").join("skills");
        fs::create_dir_all(&root).unwrap();
        assert!(installed_paths_for_root(&root).is_empty());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn installed_paths_for_root_reads_sibling_manifest() {
        let base = temp_dir("sibling-manifest");
        let konductor_dir = base.join(".konductor");
        let root = konductor_dir.join("skills");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            konductor_dir.join("manifest"),
            br#"{"schema_version":1,"files":[{"path":".konductor/skills/code-review/SKILL.md","sha256":null,"provenance":"created"}]}"#,
        )
        .unwrap();
        let paths = installed_paths_for_root(&root);
        assert!(paths.contains(".konductor/skills/code-review/SKILL.md"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn manifest_relative_path_joins_with_forward_slash_regardless_of_platform() {
        let anchor = PathBuf::from("/home/user");
        let skill_md = anchor
            .join(".konductor")
            .join("skills")
            .join("code-review")
            .join("SKILL.md");
        let relative = manifest_relative_path(&skill_md, Some(&anchor)).unwrap();
        assert_eq!(relative, ".konductor/skills/code-review/SKILL.md");
    }

    #[test]
    fn manifest_relative_path_none_when_anchor_absent() {
        let skill_md = PathBuf::from("/home/user/.konductor/skills/code-review/SKILL.md");
        assert_eq!(manifest_relative_path(&skill_md, None), None);
    }

    #[test]
    fn manifest_relative_path_none_when_skill_md_not_under_anchor() {
        let anchor = PathBuf::from("/home/user");
        let skill_md = PathBuf::from("/other/place/SKILL.md");
        assert_eq!(manifest_relative_path(&skill_md, Some(&anchor)), None);
    }
}
