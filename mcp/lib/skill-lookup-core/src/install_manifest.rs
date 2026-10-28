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
// manifest's documented JSON shape this crate actually needs: every
// file path, read from `strategies[].files[].path` (schema v2, what the
// installer writes today) or from a top-level `files[].path` (schema
// v1, which can linger on disk until the next install migrates it).
// Every other field (`schema_version`, `sha256`, `provenance`,
// `status`, `source`, `strategy`, `installed_at`, `destination`) is
// treated as opaque and never modeled here.
// Treat the shape parsed below as a stable, documented wire contract
// (per `cli/install/manifest.rs`'s own module docstring), not as this
// crate's to evolve independently. `testdata/install-manifest.v2.json`
// pins it from both sides: the installer's tests assert they serialize
// exactly that file, and this module's tests assert they parse it.
//
// ── Why this exists ─────────────────────────────────────────────────────
// `scanner::apply_name_filter` narrows `--skill-name-filter` to only ever
// remove a skill konductor itself installed -- a hand-authored or
// third-party skill living in the same `--skills-dir` root must always
// pass through untouched, regardless of the filter. The install manifest is the only
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
// can't be read, isn't valid JSON, or matches neither the v2
// `strategies[].files` shape nor the v1 `files` shape -- collapses to an
// empty result (`HashSet::new()`), never an error propagated to the
// caller. A missing manifest is the normal hand-authored case and stays
// silent. Every other case logs one WARN naming the manifest, since a
// manifest that is present but broken turns the name filter off for that
// root. A scan must never treat "I couldn't read the manifest" as
// "therefore nothing here is konductor-installed, so the filter should
// scope everything" (failing CLOSED) -- that would silently hide every
// skill under a root whose manifest happens to be temporarily unreadable,
// exactly the false-positive scoping this module exists to prevent.
// Failing open here means: on any read/parse problem, treat every skill
// under that root as NOT konductor-installed, so `--skill-name-filter`
// leaves all of them untouched -- the safer of the two possible wrong
// answers.

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

/// Why `read_installed_paths` found no installed paths. The caller fails
/// open on every variant and logs all but a `NotFound` read (see
/// `installed_paths_for_root`).
#[derive(Debug, PartialEq, Eq)]
enum ManifestReadError {
    Unreadable(std::io::ErrorKind),
    InvalidJson,
    /// Valid JSON matching neither shape: no `strategies` or `files`, a
    /// strategy without a `files` array, or an entry missing its `path`.
    UnrecognizedShape,
}

/// Reads `manifest_path` and returns every installed file path it names:
/// the union of `strategies[].files[].path` for a v2 manifest, or
/// `files[].path` for a v1 manifest.
fn read_installed_paths(manifest_path: &Path) -> Result<HashSet<String>, ManifestReadError> {
    let contents = std::fs::read_to_string(manifest_path)
        .map_err(|e| ManifestReadError::Unreadable(e.kind()))?;
    let value: serde_json::Value =
        serde_json::from_str(&contents).map_err(|_| ManifestReadError::InvalidJson)?;
    installed_paths_from_manifest(&value).ok_or(ManifestReadError::UnrecognizedShape)
}

/// Dispatches on the manifest's shape: `strategies` (v2) wins when
/// present, otherwise a top-level `files` (v1).
fn installed_paths_from_manifest(manifest: &serde_json::Value) -> Option<HashSet<String>> {
    match manifest.get("strategies") {
        Some(strategies) => {
            let mut paths = HashSet::new();
            for strategy in strategies.as_array()? {
                paths.extend(paths_from_files(strategy)?);
            }
            Some(paths)
        }
        None => paths_from_files(manifest),
    }
}

/// Collects `files[].path` from one JSON object: a v2 strategy slot or
/// a whole v1 manifest.
fn paths_from_files(owner: &serde_json::Value) -> Option<HashSet<String>> {
    let files = owner.get("files")?.as_array()?;
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
///
/// A missing manifest is the normal hand-authored case and stays silent.
/// A manifest that exists but can't be read, isn't valid JSON, or matches
/// no known shape gets one WARN, since the name filter is then off for
/// this root.
pub(crate) fn installed_paths_for_root(root: &Path) -> HashSet<String> {
    let Some(manifest_path) = manifest_path_for_skills_root(root) else {
        return HashSet::new();
    };
    match read_installed_paths(&manifest_path) {
        Ok(paths) => paths,
        Err(ManifestReadError::Unreadable(std::io::ErrorKind::NotFound)) => HashSet::new(),
        Err(err) => {
            crate::logging::log(
                crate::logging::Level::Warn,
                &manifest_warning(&manifest_path, root, &err),
            );
            HashSet::new()
        }
    }
}

fn manifest_warning(manifest_path: &Path, root: &Path, err: &ManifestReadError) -> String {
    let problem = match err {
        ManifestReadError::Unreadable(kind) => format!("could not be read ({kind})"),
        ManifestReadError::InvalidJson => "is not valid JSON".to_string(),
        ManifestReadError::UnrecognizedShape => "has no recognized shape".to_string(),
    };
    format!(
        "install manifest at {} {problem}; --skill-name-filter will not apply to skills under {}",
        manifest_path.display(),
        root.display()
    )
}

/// Renders `skill_md`'s path relative to `target_dir_anchor` (the
/// install root two directory levels above a `--skills-dir` root -- see
/// `manifest.rs`'s own module doc comment: "destination is always `.`",
/// meaning every manifest file path is relative to `target_dir`
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

    /// A v2 manifest whose only strategy has no `files` array.
    const STRATEGY_WITHOUT_FILES: &[u8] =
        br#"{"schema_version":2,"strategies":[{"strategy":"kiro-cli-v2","status":"complete"}]}"#;

    /// Runs `f` with `HOME` pointed at a scratch dir and returns everything
    /// logged there. Other tests in the crate log through the real `HOME`
    /// without taking the HOME lock, so assert on manifest messages only,
    /// never on the log as a whole.
    fn logged_while(label: &str, f: impl FnOnce()) -> String {
        let home = crate::test_home_lock::HomeGuard::new(label);
        f();
        let mut logged = String::new();
        if let Ok(entries) = fs::read_dir(home.scratch.join(".konductor/mcp/logs")) {
            for entry in entries.flatten() {
                logged.push_str(&fs::read_to_string(entry.path()).unwrap_or_default());
            }
        }
        logged
    }

    /// Prefix every manifest WARN shares.
    const MANIFEST_WARNING_PREFIX: &str = "install manifest at";

    /// Builds a `<base>/.konductor/skills` root, lets `make_manifest` put
    /// something at `<base>/.konductor/manifest`, and returns what
    /// `installed_paths_for_root` returned plus everything it logged.
    fn warned_for_manifest(
        label: &str,
        make_manifest: impl FnOnce(&Path),
    ) -> (HashSet<String>, PathBuf, String) {
        let base = temp_dir(label);
        let konductor_dir = base.join(".konductor");
        let root = konductor_dir.join("skills");
        fs::create_dir_all(&root).unwrap();
        let manifest_path = konductor_dir.join("manifest");
        make_manifest(&manifest_path);

        let mut paths = None;
        let logged = logged_while(&format!("{label}-home"), || {
            paths = Some(installed_paths_for_root(&root));
        });
        let _ = fs::remove_dir_all(&base);
        (paths.unwrap(), manifest_path, logged)
    }

    fn assert_one_manifest_warning(logged: &str, manifest_path: &Path, problem: &str) {
        let expected = format!(
            "{MANIFEST_WARNING_PREFIX} {} {problem}",
            manifest_path.display()
        );
        assert_eq!(
            logged.matches(&expected).count(),
            1,
            "expected exactly one {expected:?}, got: {logged}"
        );
        assert_eq!(
            logged.matches(MANIFEST_WARNING_PREFIX).count(),
            1,
            "expected no other manifest warning, got: {logged}"
        );
        assert!(
            logged.contains("--skill-name-filter will not apply"),
            "got: {logged}"
        );
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
    fn read_installed_paths_not_found_when_file_absent() {
        let dir = temp_dir("absent");
        assert_eq!(
            read_installed_paths(&dir.join("manifest")),
            Err(ManifestReadError::Unreadable(std::io::ErrorKind::NotFound))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_invalid_json_when_malformed_json() {
        let dir = temp_dir("malformed");
        let path = dir.join("manifest");
        fs::write(&path, b"not json").unwrap();
        assert_eq!(
            read_installed_paths(&path),
            Err(ManifestReadError::InvalidJson)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_unrecognized_when_files_field_missing() {
        let dir = temp_dir("no-files-field");
        let path = dir.join("manifest");
        fs::write(&path, br#"{"schema_version":1}"#).unwrap();
        assert_eq!(
            read_installed_paths(&path),
            Err(ManifestReadError::UnrecognizedShape)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_extracts_paths_from_v2_strategies_manifest() {
        let dir = temp_dir("v2");
        let path = dir.join("manifest");
        fs::write(
            &path,
            br#"{
  "schema_version": 2,
  "strategies": [
    {
      "strategy": "kiro-cli-v2",
      "installed_at": "2026-01-15T09:30:00Z",
      "destination": ".",
      "source": null,
      "status": "complete",
      "files": [
        {"path": ".kiro/agents/k-example.json", "sha256": null, "provenance": "created"},
        {"path": ".konductor/skills/code-review/SKILL.md", "sha256": null, "provenance": "created"}
      ]
    }
  ]
}"#,
        )
        .unwrap();
        let paths = read_installed_paths(&path).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(".konductor/skills/code-review/SKILL.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_unions_paths_across_two_strategies() {
        let dir = temp_dir("v2-two-strategies");
        let path = dir.join("manifest");
        fs::write(
            &path,
            br#"{"schema_version":2,"strategies":[
                {"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","source":null,"status":"complete",
                 "files":[{"path":".konductor/skills/code-review/SKILL.md","sha256":null,"provenance":"created"}]},
                {"strategy":"claude","installed_at":"2026-01-15T09:30:00Z","destination":".","source":null,"status":"complete",
                 "files":[{"path":".claude/skills/code-review/SKILL.md","sha256":null,"provenance":"created"}]}
            ]}"#,
        )
        .unwrap();
        let paths = read_installed_paths(&path).unwrap();
        assert_eq!(paths.len(), 2);
        assert!(paths.contains(".konductor/skills/code-review/SKILL.md"));
        assert!(paths.contains(".claude/skills/code-review/SKILL.md"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_unrecognized_when_strategies_entry_lacks_files() {
        let dir = temp_dir("v2-no-files");
        let path = dir.join("manifest");
        fs::write(&path, STRATEGY_WITHOUT_FILES).unwrap();
        assert_eq!(
            read_installed_paths(&path),
            Err(ManifestReadError::UnrecognizedShape)
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_installed_paths_extracts_paths_from_v1_flat_manifest() {
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
            br#"{"schema_version":2,"strategies":[{"strategy":"kiro-cli-v2","installed_at":"2026-01-15T09:30:00Z","destination":".","source":null,"status":"complete","files":[{"path":".konductor/skills/code-review/SKILL.md","sha256":null,"provenance":"created"}]}]}"#,
        )
        .unwrap();
        let paths = installed_paths_for_root(&root);
        assert!(paths.contains(".konductor/skills/code-review/SKILL.md"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn installed_paths_for_root_warns_when_manifest_shape_is_unrecognized() {
        let (paths, manifest_path, logged) =
            warned_for_manifest("unrecognized-shape-warns", |path| {
                fs::write(path, STRATEGY_WITHOUT_FILES).unwrap();
            });
        assert!(paths.is_empty(), "must still fail open");
        assert_one_manifest_warning(&logged, &manifest_path, "has no recognized shape");
    }

    #[test]
    fn installed_paths_for_root_warns_when_manifest_is_invalid_json() {
        let (paths, manifest_path, logged) = warned_for_manifest("invalid-json-warns", |path| {
            fs::write(path, b"not json").unwrap();
        });
        assert!(paths.is_empty(), "must still fail open");
        assert_one_manifest_warning(&logged, &manifest_path, "is not valid JSON");
    }

    #[test]
    fn installed_paths_for_root_warns_when_manifest_is_unreadable() {
        let (paths, manifest_path, logged) = warned_for_manifest("unreadable-warns", |path| {
            fs::create_dir(path).unwrap();
        });
        assert!(paths.is_empty(), "must still fail open");
        assert_one_manifest_warning(&logged, &manifest_path, "could not be read");
    }

    #[test]
    fn installed_paths_for_root_is_silent_when_no_sibling_manifest() {
        let base = temp_dir("no-manifest-silent");
        let root = base.join(".konductor").join("skills");
        fs::create_dir_all(&root).unwrap();

        let mut paths = None;
        let logged = logged_while("no-manifest-silent-home", || {
            paths = Some(installed_paths_for_root(&root));
        });

        assert_eq!(paths, Some(HashSet::new()));
        assert!(
            !logged.contains(MANIFEST_WARNING_PREFIX),
            "a missing manifest must not log, got: {logged}"
        );
        let _ = fs::remove_dir_all(&base);
    }

    /// Consumer side of the contract fixture that `cli/konductor-rs`'s
    /// manifest writer test asserts its serialized output equals.
    #[test]
    fn read_installed_paths_parses_installer_contract_fixture() {
        let fixture =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/install-manifest.v2.json");
        let paths = read_installed_paths(&fixture).unwrap();
        let expected: HashSet<String> = [
            ".claude/skills/code-review/SKILL.md",
            ".kiro/agents/k-example.json",
            ".konductor/skills/code-review/SKILL.md",
            ".konductor/skills/code-review/references/checklist.md",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        assert_eq!(paths, expected);
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
