// SPDX-License-Identifier: Apache-2.0
//
// index.rs — the in-memory skill index and its query/reload surface.
//
// Wraps the scanner's `HashMap<String, SkillRecord>` in an
// `Arc<RwLock<...>>` and exposes what a future MCP tool layer needs:
// lookup by name, search by keyword/tag, and a re-scan entry point. No
// MCP protocol types live here, so a follow-up can add the MCP-facing
// tool handlers on top of this type without reshaping it.

use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};

use crate::model::{ResolvedDir, ScanDiagnostic, SkillRecord};
use crate::scanner::{apply_name_filter, build_index};

/// Recovers a poisoned `RwLock` read guard, logging the poisoning once
/// and clearing the poison flag so later callers don't re-log it.
///
/// A poisoned lock means some other thread panicked while holding it;
/// `into_inner()` recovers the data anyway instead of propagating the
/// panic to every future caller. `into_inner()` alone does not clear
/// the poison flag — it's sticky by design (`std::sync::Mutex`/`RwLock`
/// docs), so every subsequent lock acquisition would keep re-entering
/// this same `Err` arm and re-emitting the WARN for the rest of the
/// process's life, even long after a `reload()` has replaced the map
/// with fully consistent data. `clear_poison()` (stable since Rust
/// 1.77) resolves that: called on `lock` itself once recovery has the
/// data in hand, it un-poisons the lock so the next acquisition takes
/// the `Ok` path and logs nothing. Chosen over a log-once flag because
/// it fixes the actual condition being logged, not just the symptom —
/// once a human has been told about the panic and the data has been
/// recovered, there is nothing further a poisoned flag is protecting.
fn recover_read_lock<'a, T>(
    lock: &'a RwLock<T>,
    result: Result<RwLockReadGuard<'a, T>, std::sync::PoisonError<RwLockReadGuard<'a, T>>>,
) -> RwLockReadGuard<'a, T> {
    result.unwrap_or_else(|e| {
        let message =
            "skill index lock was poisoned by a panic in another thread; recovering anyway";
        eprintln!("skill-lookup-mcp: WARN {message}");
        crate::logging::log_file_only(crate::logging::Level::Warn, message);
        lock.clear_poison();
        e.into_inner()
    })
}

/// Write-lock counterpart of `recover_read_lock`; see its doc comment.
fn recover_write_lock<'a, T>(
    lock: &'a RwLock<T>,
    result: Result<RwLockWriteGuard<'a, T>, std::sync::PoisonError<RwLockWriteGuard<'a, T>>>,
) -> RwLockWriteGuard<'a, T> {
    result.unwrap_or_else(|e| {
        let message =
            "skill index lock was poisoned by a panic in another thread; recovering anyway";
        eprintln!("skill-lookup-mcp: WARN {message}");
        crate::logging::log_file_only(crate::logging::Level::Warn, message);
        lock.clear_poison();
        e.into_inner()
    })
}

/// The live, queryable skill index.
///
/// `skills_dirs` and `skill_name_filter` never change after construction
/// — `reload` needs them to re-run the same scan configuration the
/// index was originally built with. `find_skills`, `get_skill`, and
/// `reload_skills` (in the consuming server) call `search`, `get`, and
/// `reload` respectively.
#[derive(Clone, Debug)]
pub struct SkillIndex {
    inner: Arc<RwLock<std::collections::HashMap<String, SkillRecord>>>,
    skills_dirs: Vec<ResolvedDir>,
    skill_name_filter: Option<String>,
}

impl SkillIndex {
    /// Builds a new index by scanning `skills_dirs` in order and
    /// applying `skill_name_filter`, if any. Returns the index, the
    /// `ScanDiagnostic` from the scan (before filtering), how many
    /// entries the filter removed, and the names of those entries —
    /// filtering is a separate concept from a skip, so it isn't folded
    /// into `ScanDiagnostic`. The caller needs both the count (for the
    /// aggregate `info` line) and the names (for the per-skill `debug`
    /// line §4.9 requires); see `apply_name_filter`.
    pub fn build(
        skills_dirs: Vec<ResolvedDir>,
        skill_name_filter: Option<String>,
    ) -> (Self, ScanDiagnostic, usize, Vec<String>) {
        let (raw_index, diagnostic) = build_index(&skills_dirs);
        let (filtered_index, excluded_names) = apply_name_filter(raw_index, &skill_name_filter);
        let filtered_out = excluded_names.len();
        let index = Self {
            inner: Arc::new(RwLock::new(filtered_index)),
            skills_dirs,
            skill_name_filter,
        };
        (index, diagnostic, filtered_out, excluded_names)
    }

    /// Re-scans every configured `--skills-dir` from scratch and
    /// atomically swaps this index's contents with the result,
    /// re-applying the same immutable `skill_name_filter` the index was
    /// built with. Returns the new scan's diagnostic, filtered-out
    /// count, and excluded names, matching `build`'s return shape (minus
    /// the rebuilt `Self`, which `reload` mutates in place instead of
    /// returning).
    ///
    /// No `Result`: the scan this calls (`scanner::build_index` ->
    /// `scan_directory`) is infallible by construction. Every failure
    /// mode it can hit — an unreadable root, a `read_dir` iteration
    /// error, a per-skill I/O error — is caught at the point it occurs
    /// and turned into a `SkipEntry` on `ScanDiagnostic`, never
    /// propagated as an `Err`. So a genuine scan failure is still
    /// distinguishable from a successful empty index: it shows up as a
    /// non-empty `diagnostic.skipped`, not as a silently-empty result.
    /// See `reload_scan_failure_is_a_visible_skip_not_a_silent_empty_index`
    /// below for the case of a totally unreadable root.
    ///
    /// The swap is atomic to any concurrent reader: a reader holding a
    /// read lock sees either the entirely-old map or the entirely-new
    /// one, never a mix — the write lock is held only for the instant
    /// of replacement, after the new map is fully built outside it.
    ///
    /// Called by the `reload_skills` tool handler in the consuming server.
    pub fn reload(&self) -> (ScanDiagnostic, usize, Vec<String>) {
        let (raw_index, diagnostic) = build_index(&self.skills_dirs);
        let (filtered_index, excluded_names) =
            apply_name_filter(raw_index, &self.skill_name_filter);
        let filtered_out = excluded_names.len();
        let mut guard = recover_write_lock(&self.inner, self.inner.write());
        *guard = filtered_index;
        drop(guard);
        (diagnostic, filtered_out, excluded_names)
    }

    /// Exact-name, case-insensitive lookup. Returns a clone of the
    /// matching record, or `None` if no skill matches after lowercasing.
    ///
    /// Returns an owned clone, not a reference, so the caller never
    /// holds this index's internal read lock past the call — deliberate,
    /// since a future MCP handler built on this (e.g. re-reading a
    /// skill's body from `record.path`) shouldn't need to reason about
    /// lock scope here.
    ///
    /// Called by the `get_skill` tool handler in the consuming server.
    pub fn get(&self, name: &str) -> Option<SkillRecord> {
        let guard = recover_read_lock(&self.inner, self.inner.read());
        guard.get(&name.to_lowercase()).cloned()
    }

    /// Searches with AND semantics across whichever filters are given:
    /// `name` matches as a case-insensitive substring of
    /// `SkillRecord.name`; `keyword` matches as a case-insensitive
    /// substring of `name` OR `description`, checked per-field rather
    /// than on a concatenated string — so a keyword can't match by
    /// straddling the boundary between the two (name "foo" +
    /// description "bar" must not match keyword "oob"); `tag` matches
    /// exactly (case-insensitive) against any element of
    /// `SkillRecord.tags`.
    ///
    /// A filter left as `None` matches everything for that dimension;
    /// all three `None` returns every indexed skill. Returns an empty
    /// vec, not an error, when filters are given but nothing matches.
    ///
    /// Results are sorted by `name`, case-insensitively, ascending —
    /// deterministically, independent of the underlying `HashMap`'s
    /// iteration order (which varies per process; see the historical
    /// finding this fixed). A caller may rely on this ordering. Name
    /// alone is sufficient as the sort key: two records can't share a
    /// case-insensitive name within one index (the same lowercased
    /// string is this index's collision key, enforced during scanning —
    /// see `scanner::merge_scan_result` and
    /// `scanner::scan_directory`'s intra-directory collision handling),
    /// so no secondary key (e.g. provenance) is needed to break ties.
    ///
    /// Called by the `find_skills` tool handler in the consuming server.
    pub fn search(
        &self,
        name: Option<&str>,
        keyword: Option<&str>,
        tag: Option<&str>,
    ) -> Vec<SkillRecord> {
        let name_needle = name.map(str::to_lowercase);
        let keyword_needle = keyword.map(str::to_lowercase);
        let tag_needle = tag.map(str::to_lowercase);

        let guard = recover_read_lock(&self.inner, self.inner.read());
        let mut results: Vec<SkillRecord> = guard
            .values()
            .filter(|record| {
                let name_ok = name_needle
                    .as_deref()
                    .is_none_or(|needle| record.name.to_lowercase().contains(needle));
                let keyword_ok = keyword_needle.as_deref().is_none_or(|needle| {
                    record.name.to_lowercase().contains(needle)
                        || record.description.to_lowercase().contains(needle)
                });
                let tag_ok = tag_needle
                    .as_deref()
                    .is_none_or(|needle| record.tags.iter().any(|t| t.to_lowercase() == needle));
                name_ok && keyword_ok && tag_ok
            })
            .cloned()
            .collect();
        results.sort_by_key(|record| record.name.to_lowercase());
        results
    }

    /// Number of skills currently indexed.
    ///
    /// Called by `find_skills`/`reload_skills` test helpers in this
    /// crate and by consumers of this crate; also exists so
    /// `is_empty()` satisfies `clippy::len_without_is_empty` now that
    /// both are `pub` on a published library crate rather than
    /// (formerly) private items of a binary.
    pub fn len(&self) -> usize {
        let guard = recover_read_lock(&self.inner, self.inner.read());
        guard.len()
    }

    /// Whether the index currently holds no skills.
    ///
    /// `len()`'s companion, required by `clippy::len_without_is_empty`
    /// now that both are `pub` on a published library crate.
    pub fn is_empty(&self) -> bool {
        let guard = recover_read_lock(&self.inner, self.inner.read());
        guard.is_empty()
    }

    /// The `--skills-dir` roots this index was built from, in argument
    /// order. Used by the `reload_skills` tool handler in the consuming
    /// server to echo back which directories were scanned.
    pub fn skills_dirs(&self) -> &[ResolvedDir] {
        &self.skills_dirs
    }

    /// The `--skill-name-filter` this index was (and, per `reload`'s own
    /// doc comment, always will be) built with. Used by the
    /// `reload_skills` tool handler to log each name `reload` excludes
    /// against the filter that excluded it — see
    /// `logging::log_filter_exclusions`.
    pub fn skill_name_filter(&self) -> &Option<String> {
        &self.skill_name_filter
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// A one-root `skills_dirs` argument. Which provenance the root
    /// carries is irrelevant to every test here — they exercise
    /// query/reload behavior, not trust labelling.
    fn one_root(dir: &Path) -> Vec<ResolvedDir> {
        vec![ResolvedDir::managed(dir)]
    }

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-index-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_skill(dir: &Path, name: &str, description: &str, tags: &[&str]) {
        let skill_dir = dir.join(name);
        fs::create_dir_all(&skill_dir).unwrap();
        let tags_yaml = if tags.is_empty() {
            String::new()
        } else {
            format!(
                "\ntags:\n{}",
                tags.iter()
                    .map(|t| format!("  - {t}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        };
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {description}{tags_yaml}\n---\n\nBody.\n"),
        )
        .unwrap();
    }

    /// Writes a sibling install manifest at `<base>/.konductor/manifest`
    /// marking every one of `skill_names` (each written under
    /// `<base>/.konductor/skills/<name>/SKILL.md` by `write_skill`) as
    /// konductor-installed. None of the tests in this module exercise
    /// manifest-based `--skill-name-filter` scoping directly (that
    /// coverage lives in `scanner.rs`) -- this exists only so the
    /// pre-existing filter/reload tests below, which predate that
    /// feature, keep exercising real filter removal rather than
    /// silently no-op'ing once every record defaults to
    /// `installed_by_konductor == false`.
    fn write_manifest_marking_installed(base: &Path, skill_names: &[&str]) {
        let files_json: Vec<String> = skill_names
            .iter()
            .map(|name| {
                format!(
                    r#"{{"path":".konductor/skills/{name}/SKILL.md","sha256":null,"provenance":"created"}}"#
                )
            })
            .collect();
        let manifest = format!(
            r#"{{"schema_version":1,"strategy":"kiro-cli","installed_at":"2026-01-01T00:00:00Z","destination":".","status":"complete","files":[{}]}}"#,
            files_json.join(",")
        );
        fs::write(base.join(".konductor").join("manifest"), manifest).unwrap();
    }

    use std::path::Path;

    #[test]
    fn get_is_case_insensitive() {
        let dir = temp_dir("get-case-insensitive");
        write_skill(&dir, "MyThing", "A thing.", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert!(index.get("mything").is_some());
        assert!(index.get("MYTHING").is_some());
        assert!(index.get("nope").is_none());
        assert_eq!(index.get("mything").unwrap().name, "MyThing");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_empty_reflects_index_contents() {
        let dir = temp_dir("is-empty");
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert!(index.is_empty());

        write_skill(&dir, "a", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert!(!index.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_results_are_returned_in_deterministic_name_order() {
        // `search` collects from `guard.values()` (a HashMap, whose
        // iteration order is a function of Rust's per-process random hash
        // seed, not insertion order) and then sorts by name. This test
        // pins the sort. Enough distinctly-named entries are inserted
        // that the sorted order this assertion expects is very unlikely
        // to coincide with HashMap iteration order by chance — so if the
        // sort were ever dropped, the test would fail rather than pass on
        // a lucky seed.
        let dir = temp_dir("search-deterministic-order");
        let names = [
            "zeta", "alpha", "mu", "beta", "gamma", "delta", "epsilon", "theta",
        ];
        for name in names {
            write_skill(&dir, name, "d", &[]);
        }
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);

        let results = index.search(None, None, None);
        let returned_names: Vec<&str> = results.iter().map(|r| r.name.as_str()).collect();

        let mut expected_sorted = names.to_vec();
        expected_sorted.sort();

        assert_eq!(
            returned_names, expected_sorted,
            "search results must be returned in deterministic (name-sorted) order"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_with_no_filters_returns_everything() {
        let dir = temp_dir("search-no-filters");
        write_skill(&dir, "a", "d", &[]);
        write_skill(&dir, "b", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert_eq!(index.search(None, None, None).len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_by_name_substring_case_insensitive() {
        let dir = temp_dir("search-name");
        write_skill(&dir, "frontend-dev", "d", &[]);
        write_skill(&dir, "backend-dev", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        let results = index.search(Some("FRONT"), None, None);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "frontend-dev");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_by_keyword_matches_name_or_description_not_across_boundary() {
        let dir = temp_dir("search-keyword-boundary");
        write_skill(&dir, "foo", "bar", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        // "oob" would only match if name+description were concatenated
        // as "foobar" — per-field OR must not match this.
        assert!(index.search(None, Some("oob"), None).is_empty());
        assert_eq!(index.search(None, Some("foo"), None).len(), 1);
        assert_eq!(index.search(None, Some("bar"), None).len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_by_tag_exact_match_case_insensitive() {
        let dir = temp_dir("search-tag");
        write_skill(&dir, "a", "d", &["Rust", "backend"]);
        write_skill(&dir, "b", "d", &["frontend"]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        let results = index.search(None, None, Some("rust"));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "a");
        // Not a substring match — "back" alone must not match "backend".
        assert!(index.search(None, None, Some("back")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_and_semantics_across_filters() {
        let dir = temp_dir("search-and-semantics");
        write_skill(&dir, "alpha", "first skill", &["rust"]);
        write_skill(&dir, "alpha-two", "second skill", &["python"]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        let results = index.search(Some("alpha"), None, Some("rust"));
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "alpha");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_no_match_returns_empty_not_error() {
        let dir = temp_dir("search-no-match");
        write_skill(&dir, "a", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert!(index.search(Some("does-not-exist"), None, None).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reload_picks_up_newly_added_skill() {
        let dir = temp_dir("reload-picks-up-new");
        write_skill(&dir, "existing", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert_eq!(index.len(), 1);

        write_skill(&dir, "new-arrival", "d", &[]);
        let (diagnostic, _filtered_out, _excluded_names) = index.reload();
        assert_eq!(diagnostic.indexed_count, 2);
        assert_eq!(index.len(), 2);
        assert!(index.get("new-arrival").is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn reload_scan_failure_is_a_visible_skip_not_a_silent_empty_index() {
        // Proves the claim in `SkillIndex::reload`'s doc comment: the
        // scan underneath it is infallible by construction, so a
        // genuine failure (root becomes unreadable) still shows up as a
        // non-empty `diagnostic.root_errors`, distinguishable from a
        // successful scan of a directory that's merely empty. A
        // root-level failure lands in `root_errors`, not `skipped`
        // (which covers failures for individual files within a root
        // that opened successfully) — see `ScanDiagnostic::root_errors`.
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("reload-scan-failure-visible");
        write_skill(&dir, "existing", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert_eq!(index.len(), 1);

        // Revoke read+execute permission on the root itself so a
        // rescan's `read_dir` fails outright, mirroring a root that had
        // its permissions changed since the last scan.
        let mut perms = fs::metadata(&dir).unwrap().permissions();
        perms.set_mode(0o000);
        fs::set_permissions(&dir, perms.clone()).unwrap();

        // Root (and some sandboxes) ignore directory permission bits, so
        // `read_dir` would still succeed and this test would prove
        // nothing. Skip rather than false-fail in that environment.
        if std::fs::read_dir(&dir).is_ok() {
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&dir, perms);
            let _ = fs::remove_dir_all(&dir);
            return;
        }

        let (diagnostic, _filtered_out, _excluded_names) = index.reload();

        // Restore permissions before any assertion can panic and leave
        // the temp dir unremovable, then clean up.
        perms.set_mode(0o755);
        let _ = fs::set_permissions(&dir, perms);

        assert_eq!(
            diagnostic.indexed_count, 0,
            "an unreadable root can't index anything"
        );
        assert!(
            diagnostic.skipped.is_empty(),
            "a whole-root failure is not a per-file skip: {:?}",
            diagnostic.skipped
        );
        assert_eq!(
            diagnostic.root_errors.len(),
            1,
            "the failure must be reported, not silently swallowed"
        );
        assert_eq!(diagnostic.root_errors[0].0, dir);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reload_reapplies_the_same_immutable_filter() {
        // Nested under `<base>/.konductor/skills` (rather than passing
        // `dir` straight to `SkillIndex::build`, as most tests in this
        // module do) so a sibling manifest at `<base>/.konductor/manifest`
        // can mark these skills konductor-installed -- otherwise
        // `--skill-name-filter` never removes anything here (see
        // `SkillRecord::installed_by_konductor`'s fail-open default),
        // and this test would stop exercising the filter/reload
        // interaction it actually targets. Manifest-based scoping
        // itself is covered in `scanner.rs`, not here.
        let base = temp_dir("reload-reapplies-filter");
        let skills_root = base.join(".konductor").join("skills");
        fs::create_dir_all(&skills_root).unwrap();
        write_skill(&skills_root, "keep-me", "d", &[]);
        write_skill(&skills_root, "drop-me", "d", &[]);
        write_manifest_marking_installed(&base, &["keep-me", "drop-me"]);
        let (index, _diag, filtered_out, excluded_names) =
            SkillIndex::build(one_root(&skills_root), Some("keep-*".to_string()));
        assert_eq!(filtered_out, 1);
        assert_eq!(excluded_names, vec!["drop-me".to_string()]);
        assert_eq!(index.len(), 1);

        write_skill(&skills_root, "keep-also", "d", &[]);
        write_manifest_marking_installed(&base, &["keep-me", "drop-me", "keep-also"]);
        let (_diag2, filtered_out2, excluded_names2) = index.reload();
        // "drop-me" is filtered again; "keep-also" newly matches.
        assert_eq!(filtered_out2, 1);
        assert_eq!(excluded_names2, vec!["drop-me".to_string()]);
        assert_eq!(index.len(), 2);
        assert!(index.get("keep-me").is_some());
        assert!(index.get("keep-also").is_some());
        assert!(index.get("drop-me").is_none());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn skills_dirs_echoes_configured_roots_in_order_with_provenance() {
        let dir_a = temp_dir("skills-dirs-a");
        let dir_b = temp_dir("skills-dirs-b");
        let roots = vec![ResolvedDir::managed(&dir_a), ResolvedDir::workspace(&dir_b)];
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(roots.clone(), None);
        // Echoed back verbatim, provenance included — a future
        // reload-diagnostic response reports which root a skill came from,
        // so the label has to survive the round-trip, not just the path.
        assert_eq!(index.skills_dirs(), roots.as_slice());
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn poisoned_lock_is_recovered_not_propagated() {
        // Regression for the untested `recover_read_lock`/
        // `recover_write_lock` path: panic a thread while it holds the
        // write guard (poisoning the RwLock), then confirm get/search/len
        // still return without panicking, using whatever (possibly
        // stale) data survived the panic.
        let dir = temp_dir("poison-recovery");
        write_skill(&dir, "existing", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);
        assert_eq!(index.len(), 1);

        let poison_index = index.clone();
        let result = std::thread::spawn(move || {
            let _guard = poison_index.inner.write().unwrap();
            panic!("simulated panic while holding the write guard");
        })
        .join();
        assert!(result.is_err(), "the spawned thread must have panicked");
        assert!(
            index.inner.is_poisoned(),
            "the lock must be poisoned after the panic"
        );

        // None of these may panic, even though the lock is poisoned.
        assert_eq!(index.len(), 1);
        assert!(index.get("existing").is_some());
        assert_eq!(index.search(None, None, None).len(), 1);

        // The first recovery (len(), above) must have cleared the
        // poison flag — otherwise it stays poisoned forever (Rust's
        // poison flag is sticky by design; `into_inner()` alone doesn't
        // clear it) and every future call keeps re-entering the
        // recovery path, which is exactly the permanent-log-spam bug
        // this fix addresses. Asserting `!is_poisoned()` here is what
        // would fail if `clear_poison()` were ever dropped from
        // `recover_read_lock`/`recover_write_lock`.
        assert!(
            !index.inner.is_poisoned(),
            "poison must be cleared by the first recovery, not left sticky"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn poison_warning_is_emitted_at_most_once_not_on_every_call() {
        // Regression for the permanent-log-spam bug: before the fix,
        // `into_inner()` recovered the data but never cleared the
        // poison flag, so every `get`/`search`/`len`/`is_empty` call
        // after a single panic kept re-entering the `Err` arm and
        // re-emitting the WARN for the rest of the process's life —
        // even after a `reload()` had replaced the map with fully
        // consistent data. This drives several post-panic calls
        // (including a `reload()`) and confirms the lock is un-poisoned
        // after the first one, which is what makes every later call
        // take the cheap, silent `Ok` path instead of logging again.
        let dir = temp_dir("poison-warn-once");
        write_skill(&dir, "existing", "d", &[]);
        let (index, _diag, _filtered, _excluded_names) = SkillIndex::build(one_root(&dir), None);

        let poison_index = index.clone();
        let result = std::thread::spawn(move || {
            let _guard = poison_index.inner.write().unwrap();
            panic!("simulated panic while holding the write guard");
        })
        .join();
        assert!(result.is_err());
        assert!(
            index.inner.is_poisoned(),
            "must be poisoned right after the panic"
        );

        // First post-panic call: this is the one call allowed to hit
        // the recovery path (and therefore the one call allowed to log
        // the WARN).
        let _ = index.len();
        assert!(
            !index.inner.is_poisoned(),
            "poison must already be cleared after the very first recovery"
        );

        // Every subsequent call — including a reload, which replaces
        // the map contents entirely — must see an un-poisoned lock and
        // take the normal `Ok` path, never re-triggering recovery (and
        // therefore never re-logging the WARN).
        assert!(index.get("existing").is_some());
        assert!(!index.inner.is_poisoned());
        assert_eq!(index.search(None, None, None).len(), 1);
        assert!(!index.inner.is_poisoned());
        assert!(!index.is_empty());
        assert!(!index.inner.is_poisoned());

        let (_diag2, _filtered2, _excluded_names) = index.reload();
        assert!(
            !index.inner.is_poisoned(),
            "reload's write-lock acquisition must also see the lock already clean"
        );
        assert_eq!(index.len(), 1);
        assert!(!index.inner.is_poisoned());

        let _ = fs::remove_dir_all(&dir);
    }
}
