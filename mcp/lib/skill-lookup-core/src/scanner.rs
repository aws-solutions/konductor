// SPDX-License-Identifier: Apache-2.0
//
// scanner.rs — directory traversal, collision resolution, and in-memory
// index construction for skill-lookup-mcp.
//
// This module builds the skill index from a set of `--skills-dir`
// roots. It implements no MCP-facing tool — a planned follow-up adds
// the lookup tools that read from the index built here.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::frontmatter::parse_frontmatter;
use crate::model::{
    CollisionEntry, Provenance, ResolvedDir, ScanDiagnostic, SkillRecord, SkipEntry, SkipReason,
};

/// Cap on directory entries processed per `--skills-dir` root, enforced
/// during enumeration by `collect_dir_entries`'s bounded max-heap — not
/// after a full materialize-then-sort. Bounds both enumeration memory
/// (O(limit), never O(N)) and the per-entry `canonicalize()` syscall
/// cost that follows, against a hostile tree with attacker-controlled
/// fan-out. 10,000 is comfortably above any real skills directory
/// (which has one subdirectory per skill) while still bounding
/// worst-case cost.
///
/// What this does NOT bound: the kernel-side `readdir` walk itself.
/// `std::fs::read_dir` opens the whole directory stream, and every
/// entry is still visited once via `ReadDir::next()` to push it onto
/// the heap — this cap bounds how many of those entries are ever held
/// in memory or canonicalized afterward, not how many the OS enumerates
/// on the way in.
const MAX_ENTRIES_PER_DIR: usize = 10_000;

/// Canonical form of a skills-dir root, or `None` if it can't be
/// canonicalized (it doesn't exist, or a component isn't readable).
///
/// Shared with `main::resolve_skills_dirs`, which deduplicates roots on
/// this value: dedup and containment must agree on what "the same
/// directory" means, or a root can survive dedup under two spellings and
/// then be scanned twice.
pub fn canonical_root(dir: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(dir).ok()
}

/// Builds the full skill index across every configured skills-dir root,
/// in argument order.
///
/// Infallible by construction, not merely in practice: every failure
/// `scan_directory` can hit (an unreadable root, a `read_dir` iteration
/// error, a per-skill I/O error) is caught at its source and turned into
/// a `SkipEntry`, never an `Err` propagated up through this function.
/// `SkillIndex::reload` relies on this — see its doc comment — to keep a
/// genuine scan failure distinguishable from a successful empty scan
/// without needing a `Result` return here.
///
/// Each root carries its own `Provenance`, assigned by
/// `main::resolve_skills_dirs` from the position the operator requested
/// it in. This function does not derive provenance from `dirs` positions:
/// by the time it runs, `dirs` has already had unusable roots filtered
/// out, so position here no longer means what the operator asked for.
///
/// A name colliding across two roots keeps whichever root was scanned
/// first (see `merge_scan_result`).
///
/// `dirs` is assumed already deduplicated (on canonicalized paths — see
/// `canonical_root`) and validated (exists, is a directory) by the
/// caller — this function doesn't re-check either.
pub fn build_index(dirs: &[ResolvedDir]) -> (HashMap<String, SkillRecord>, ScanDiagnostic) {
    let mut index: HashMap<String, SkillRecord> = HashMap::new();
    let mut diagnostic = ScanDiagnostic {
        indexed_count: 0,
        dir_count: dirs.len(),
        skipped: Vec::new(),
        collisions: Vec::new(),
        root_errors: Vec::new(),
    };

    for dir in dirs {
        let (mut records, skips, root_error) = scan_directory(&dir.path, dir.provenance);
        mark_konductor_installed(&dir.path, &mut records);
        diagnostic.skipped.extend(skips);
        if let Some(root_error) = root_error {
            diagnostic.root_errors.push(root_error);
        }
        merge_scan_result(&mut index, records, &mut diagnostic);
    }

    diagnostic.indexed_count = index.len();
    (index, diagnostic)
}

/// Fills in `SkillRecord::installed_by_konductor` for every record
/// scanned under `root`, using `root`'s sibling install manifest (see
/// `crate::install_manifest`). Called once per `--skills-dir` root, from
/// `build_index`, after `scan_directory` has already returned that
/// root's records -- not threaded through `scan_directory` itself, so
/// that function's existing signature and its own unit tests (none of
/// which exercise manifest-based scoping) are untouched by this feature.
///
/// A no-op (every record keeps its provisional `false`) whenever `root`
/// has no sibling manifest, or the manifest is unreadable/malformed --
/// `install_manifest::installed_paths_for_root` already collapses all of
/// those cases to an empty set, so the early return below is purely a
/// cheap short-circuit (skip the canonicalize/strip_prefix work
/// entirely when there is nothing to look up), not a second fail-open
/// decision layered on top of that module's.
fn mark_konductor_installed(root: &Path, records: &mut [SkillRecord]) {
    let installed_paths = crate::install_manifest::installed_paths_for_root(root);
    if installed_paths.is_empty() {
        return;
    }

    // The manifest's `files[].path` entries are relative to `target_dir`
    // (the install root two directory levels above a `--skills-dir`
    // root -- see `install_manifest::manifest_relative_path`'s doc
    // comment), so the anchor to strip from each record's absolute path
    // is `root`'s own canonical grandparent, not `root` itself. Computed
    // from `canonical_root(root)` (the same canonicalization
    // `scan_directory` already uses for its own containment checks),
    // not from `root` directly, so a relative or symlinked-ancestor
    // `--skills-dir` argument (see `scan_directory`'s doc comment for
    // why that matters) doesn't wrongly fail every lookup under it.
    let canonical = canonical_root(root);
    let target_dir_anchor: Option<PathBuf> = canonical
        .as_deref()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf);

    for record in records.iter_mut() {
        record.installed_by_konductor = crate::install_manifest::manifest_relative_path(
            &record.path,
            target_dir_anchor.as_deref(),
        )
        .map(|relative| installed_paths.contains(&relative))
        .unwrap_or(false);
    }
}

/// Inserts each of `records` into `index`, applying the collision
/// policy: a `Provenance::Managed` record always wins over a
/// `Provenance::Workspace` one, regardless of which was scanned first.
/// Within the same provenance, whichever record already holds a given
/// lowercased key — from an earlier `--skills-dir` of that provenance,
/// or an earlier record in this same directory's iteration order — wins;
/// the later one becomes a `CollisionEntry` and is dropped.
///
/// This doesn't distinguish cross-directory from intra-directory
/// collisions in `diagnostic.collisions` — both get the same
/// deterministic treatment, so one list is enough. An intra-dir
/// collision is also reported per-file as
/// `SkipReason::IntraDirCaseCollision` (see `scan_directory`); a
/// cross-directory collision doesn't need that, since the losing record
/// there was never added to `records` in the first place.
fn merge_scan_result(
    index: &mut HashMap<String, SkillRecord>,
    records: Vec<SkillRecord>,
    diagnostic: &mut ScanDiagnostic,
) {
    for record in records {
        let key = record.name.to_lowercase();
        match index.get(&key) {
            Some(existing) if should_replace(existing, &record) => {
                let evicted = index
                    .insert(key, record.clone())
                    .expect("checked Some above");
                diagnostic.collisions.push(CollisionEntry {
                    name: record.name,
                    winning_path: record.path,
                    losing_path: evicted.path,
                });
            }
            Some(existing) => {
                diagnostic.collisions.push(CollisionEntry {
                    name: record.name.clone(),
                    winning_path: existing.path.clone(),
                    losing_path: record.path.clone(),
                });
            }
            None => {
                index.insert(key, record);
            }
        }
    }
}

/// Whether `candidate` should replace `existing` at the same key.
/// `Managed` always beats `Workspace`; within the same provenance the
/// incumbent keeps precedence (first-wins), so a later scan can never
/// dethrone an equally-trusted earlier one.
fn should_replace(existing: &SkillRecord, candidate: &SkillRecord) -> bool {
    matches!(
        (existing.provenance, candidate.provenance),
        (Provenance::Workspace, Provenance::Managed)
    )
}

/// Scans one `--skills-dir` root at depth 1: every immediate
/// subdirectory containing a `SKILL.md` file is a skill. A subdirectory
/// with no `SKILL.md` is silently ignored — not an error, since "not a
/// skill" is out of scope, distinct from "looks like a skill but can't
/// be indexed."
///
/// Returns the successfully-parsed records plus every skip encountered.
/// An intra-directory case-only collision (e.g. `Foo/` and `foo/` in the
/// same root) is resolved here, in directory-iteration order: the first
/// entry to claim a lowercased name wins, and later ones are skipped
/// with `SkipReason::IntraDirCaseCollision` rather than passed to
/// `merge_scan_result`, whose collision handling is for cross-directory
/// precedence specifically.
///
/// Symlink containment: every entry's canonicalized path (see
/// `resolve_symlink`, which canonicalizes plain entries too, not just
/// symlinks) must stay within `dir`'s own canonicalized form — a path
/// that resolves outside `dir` is skipped as
/// `SkipReason::SymlinkEscapesRoot` rather than indexed. Without this
/// check, a symlink could point a skill directory anywhere on the
/// filesystem the process can read. Canonicalizing plain entries too
/// (rather than only symlinks) matters because `dir` itself may not be
/// canonical — a relative `--skills-dir`, or an absolute one reached
/// through a symlinked ancestor — in which case comparing a raw,
/// non-canonical entry path against `dir`'s canonical form would almost
/// never match, wrongly rejecting ordinary skills. If `dir` itself can't
/// be canonicalized (e.g. removed between the caller's validation and
/// this scan), containment is skipped for this call rather than treated
/// as fatal — the same fail-open posture `read_dir`'s error handling
/// below already takes for a vanished root.
///
/// This entry-level check only covers the directory entry itself. Each
/// entry's `SKILL.md` is containment-checked again, independently,
/// right before it's read — an in-root directory can still have an
/// out-of-root `SKILL.md` symlink, which the entry-level check alone
/// would miss (see the second `canonicalize`/`starts_with` pair below).
/// Both checks share the same TOCTOU limitation: canonicalizing a path
/// and then reading it are separate syscalls, not one atomic operation,
/// so this is containment-at-read-time, not an airtight guarantee
/// against a target swapped in between the two calls.
///
/// A missing `SKILL.md` and a dangling `SKILL.md` symlink are handled
/// differently: no file at all means the directory just isn't a skill,
/// silently skipped like any other non-skill directory; a `SKILL.md`
/// that exists as a symlink but resolves to nothing is reported as
/// `SkipReason::BrokenSymlink`, the same variant a dangling
/// directory-level symlink already gets, so this case isn't dropped
/// with no diagnostic either; and a `SKILL.md` that exists but isn't a
/// regular file (a directory, fifo, socket, etc.) is reported as
/// `SkipReason::NotRegularFile`, whether it's that directly or through a
/// symlink — nothing is dangling in either form, so `BrokenSymlink`
/// would misdescribe both.
///
/// Private, not `pub`: called only from `build_index`, in this same
/// module. `skill-lookup-mcp` (the crate's only consumer) drives a scan
/// through `SkillIndex::build`/`reload`, never by calling this directly
/// — narrowed rather than disclosed as external API surface.
///
/// The third element of the returned tuple is `Some((dir, detail))` when
/// `dir`'s own `read_dir` fails (permission denied, vanished between
/// validation and scan, etc.) — kept separate from `skipped` because
/// it's a whole scan root that could not be read at all, not a single
/// file within an otherwise-readable root. Per §4.9's level table, this
/// is what logs at `error` ("I/O failures and permission errors on
/// individual scan roots that prevent reading"); every other failure in
/// `skipped` — one file within a root that DID open, a
/// `ReadDir::next()` iteration error, a per-skill read failure — stays
/// `warn`, unaffected by this distinction.
fn scan_directory(
    dir: &Path,
    provenance: Provenance,
) -> (Vec<SkillRecord>, Vec<SkipEntry>, Option<(PathBuf, String)>) {
    let mut records = Vec::new();
    let mut skipped = Vec::new();
    let mut seen_targets: HashMap<PathBuf, PathBuf> = HashMap::new();
    let mut claimed_keys: HashMap<String, PathBuf> = HashMap::new();
    let canonical_root: Option<PathBuf> = canonical_root(dir);

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            return (records, skipped, Some((dir.to_path_buf(), e.to_string())));
        }
    };

    // Each `ReadDir::next()` call can fail independently of the initial
    // `read_dir()` above succeeding; see `collect_dir_entries`'s doc
    // comment for why this can't be dropped via `.ok()`. Bounded to
    // MAX_ENTRIES_PER_DIR while collecting — see `collect_dir_entries`'s
    // doc comment for why this still yields the same entries sort+
    // truncate would.
    let entry_paths = collect_dir_entries(entries, dir, &mut skipped, MAX_ENTRIES_PER_DIR);

    for entry_path in entry_paths {
        let resolved = match resolve_symlink(&entry_path) {
            Ok(resolved) => resolved,
            Err(reason) => {
                skipped.push(SkipEntry {
                    path: entry_path,
                    reason,
                });
                continue;
            }
        };

        if let Some(ref root) = canonical_root {
            if !resolved.starts_with(root) {
                skipped.push(SkipEntry {
                    path: entry_path,
                    reason: SkipReason::SymlinkEscapesRoot(resolved),
                });
                continue;
            }
        }

        if !resolved.is_dir() {
            continue;
        }

        // Looked up here, but only inserted once this entry is confirmed
        // indexable (see the insert right before `records.push` below).
        // A directory with no SKILL.md is silently ignored per this
        // function's doc comment, so it must never claim a `seen_targets`
        // slot — otherwise a second entry resolving to that same
        // non-skill directory (e.g. a real dir plus a symlink to it)
        // would wrongly get `SkipReason::DuplicateTarget`, whose message
        // claims the target was "already indexed", even though it never
        // was.
        if let Some(original) = seen_targets.get(&resolved) {
            skipped.push(SkipEntry {
                path: entry_path,
                reason: SkipReason::DuplicateTarget(original.clone()),
            });
            continue;
        }

        let skill_md = resolved.join("SKILL.md");
        // `skill_md.is_file()` alone can't distinguish three cases that
        // all make it return `false`: (1) no SKILL.md exists at all —
        // genuinely not a skill, correctly unreported; (2) SKILL.md is a
        // symlink whose target doesn't exist — a dangling symlink, which
        // must be reported like the directory-level BrokenSymlink case
        // is; (3) SKILL.md is a symlink whose target DOES exist but
        // isn't a regular file (e.g. a directory) — not dangling, so
        // BrokenSymlink would misdescribe it. `is_file()` follows
        // symlinks and returns `false` for all three, so `symlink_metadata`
        // plus an explicit existence check on the resolved target is
        // needed to tell them apart.
        match skill_md.symlink_metadata() {
            Ok(meta) if meta.file_type().is_symlink() => {
                if skill_md.is_file() {
                    // A symlink resolving to a regular file; fall
                    // through to read it below.
                } else if skill_md.exists() {
                    // The symlink resolves to a target that exists but
                    // isn't a regular file (a directory, fifo, socket,
                    // etc.) — not dangling, so this isn't
                    // BrokenSymlink. No existing SkipReason variant
                    // describes "resolves to the wrong kind of entry";
                    // NotRegularFile is added for this case rather than
                    // overloading BrokenSymlink or MalformedYaml, which
                    // both describe unrelated failure shapes.
                    skipped.push(SkipEntry {
                        path: skill_md,
                        reason: SkipReason::NotRegularFile,
                    });
                    continue;
                } else {
                    // The symlink's target doesn't exist: genuinely
                    // dangling.
                    skipped.push(SkipEntry {
                        path: skill_md,
                        reason: SkipReason::BrokenSymlink,
                    });
                    continue;
                }
            }
            Ok(_) if !skill_md.is_file() => {
                // Exists but is neither a regular file nor a symlink: a
                // real directory, fifo, or socket named SKILL.md. Same
                // NotRegularFile diagnostic the symlinked form gets —
                // "no SKILL.md at all" is the only case that stays
                // silent, and something does exist at this path.
                skipped.push(SkipEntry {
                    path: skill_md,
                    reason: SkipReason::NotRegularFile,
                });
                continue;
            }
            Ok(_) => {} // A regular file; fall through.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                // Nothing exists at this path at all: genuinely no
                // SKILL.md, not a skill, not reported.
                continue;
            }
            Err(e) => {
                // Some other I/O error (e.g. EACCES from a directory
                // with no search permission) — not "nothing exists",
                // so it must be reported, not silently dropped. Mirrors
                // `resolve_symlink`'s NotFound-vs-other split below.
                skipped.push(SkipEntry {
                    path: skill_md,
                    reason: SkipReason::IoError(e.to_string()),
                });
                continue;
            }
        }

        // The entry-level check above containment-checks `resolved`
        // (the skill directory itself), but `SKILL.md` inside it can
        // independently be a symlink to a target outside the root —
        // `resolved` being in-root says nothing about where
        // `resolved.join("SKILL.md")` resolves to. Re-canonicalize and
        // re-check `skill_md` on its own before either read below
        // touches it: both `std::fs::metadata` and `parse_frontmatter`
        // follow symlinks, so without this a skill directory legitimately
        // inside the root could still exfiltrate arbitrary file content
        // by making its `SKILL.md` a symlink elsewhere, indexed with no
        // skip entry at all.
        //
        // This check, like the entry-level one, is TOCTOU-limited:
        // canonicalizing `skill_md` and then reading it are two separate
        // syscalls, not one atomic operation, so a target swapped in
        // between them could in principle slip past. That gap is
        // inherent to check-then-open on this filesystem API and isn't
        // closed by this fix.
        match std::fs::canonicalize(&skill_md) {
            Ok(canonical_skill_md) => {
                if let Some(ref root) = canonical_root {
                    if !canonical_skill_md.starts_with(root) {
                        skipped.push(SkipEntry {
                            path: skill_md,
                            reason: SkipReason::SymlinkEscapesRoot(canonical_skill_md),
                        });
                        continue;
                    }
                }
            }
            Err(e) => {
                skipped.push(SkipEntry {
                    path: skill_md,
                    reason: SkipReason::IoError(e.to_string()),
                });
                continue;
            }
        }

        let size_bytes = match std::fs::metadata(&skill_md) {
            Ok(meta) => meta.len(),
            Err(e) => {
                skipped.push(SkipEntry {
                    path: skill_md,
                    reason: SkipReason::IoError(e.to_string()),
                });
                continue;
            }
        };

        let frontmatter = match parse_frontmatter(&skill_md) {
            Ok(fm) => fm,
            Err(reason) => {
                skipped.push(SkipEntry {
                    path: skill_md,
                    reason,
                });
                continue;
            }
        };

        let key = frontmatter.name.to_lowercase();
        if let Some(winning_path) = claimed_keys.get(&key) {
            skipped.push(SkipEntry {
                path: skill_md,
                reason: SkipReason::IntraDirCaseCollision(winning_path.clone()),
            });
            continue;
        }
        claimed_keys.insert(key, skill_md.clone());

        // Only now is this entry confirmed indexable — claim the
        // `seen_targets` slot here, not at first sight of `resolved` (see
        // the lookup above), so a later entry resolving to the same
        // target is only ever reported as a duplicate of a target that
        // was genuinely indexed.
        seen_targets.insert(resolved.clone(), entry_path.clone());

        records.push(SkillRecord {
            name: frontmatter.name,
            description: frontmatter.description,
            tags: frontmatter.tags,
            version: frontmatter.version,
            size_bytes,
            path: skill_md,
            provenance,
            // Provisional -- `build_index` fills this in for real, once
            // per root, via `mark_konductor_installed`. Left `false`
            // here (rather than threading the manifest lookup through
            // this function) so `scan_directory`'s existing signature
            // and its own unit tests -- none of which exercise
            // manifest-based scoping -- are untouched by this field.
            installed_by_konductor: false,
        });
    }

    (records, skipped, None)
}

/// Collects `entries` into the `limit` lexicographically-smallest paths,
/// sorted ascending, using a bounded max-heap so at most `limit` paths
/// are ever held at once — memory is O(limit), not O(N), even when the
/// directory has far more than `limit` entries.
///
/// This yields the SAME surviving set sort-then-truncate would: the
/// `limit` smallest paths in sorted order. A `BinaryHeap<PathBuf>` is a
/// max-heap, so pushing every path and popping the largest whenever the
/// heap exceeds `limit` leaves exactly the `limit` smallest behind,
/// regardless of arrival order — the property proven by
/// `entry_cap_bounded_collection_matches_sort_then_truncate` below.
/// Draining the heap (which pops largest-first) and reversing recovers
/// ascending order, which is what deterministic same-directory
/// case-collision resolution and `merge_scan_result` both depend on.
///
/// Entries beyond `limit` are reported as a single `TooManyEntries`
/// skip naming the drop count, never silently ignored. Also pushes a
/// `SkipEntry { path: dir, reason: SkipReason::IoError(..) }` for every
/// iteration error instead of dropping it via `.ok()`. An iteration
/// error — e.g. an entry removed between `read_dir()` opening the
/// stream and this loop reading it — would otherwise vanish a skill
/// from the index with no diagnostic at all, since `std::io::Error`
/// from iteration carries no path of its own to report against.
///
/// Generic over the item type so a test can supply a synthetic sequence
/// of `io::Result`-like values without forcing a real `ReadDir::next()`
/// failure — a genuine race that's hard to reproduce deterministically
/// across platforms without OS-specific fault injection.
fn collect_dir_entries<I, E>(
    entries: I,
    dir: &Path,
    skipped: &mut Vec<SkipEntry>,
    limit: usize,
) -> Vec<PathBuf>
where
    I: IntoIterator<Item = std::io::Result<E>>,
    E: DirEntryPath,
{
    let mut heap: std::collections::BinaryHeap<PathBuf> = std::collections::BinaryHeap::new();
    let mut total = 0usize;

    for entry in entries {
        match entry {
            Ok(entry) => {
                total += 1;
                heap.push(entry.entry_path());
                if heap.len() > limit {
                    // Evict the current largest — the heap never holds
                    // more than `limit` + 1 paths at any instant, so
                    // memory stays O(limit).
                    heap.pop();
                }
            }
            Err(e) => skipped.push(SkipEntry {
                path: dir.to_path_buf(),
                reason: SkipReason::IoError(e.to_string()),
            }),
        }
    }

    if total > limit {
        skipped.push(SkipEntry {
            path: dir.to_path_buf(),
            reason: SkipReason::TooManyEntries {
                dropped_count: total - limit,
                limit,
            },
        });
    }

    // `into_sorted_vec()` drains in ascending order directly — no
    // separate pop-and-reverse pass needed.
    heap.into_sorted_vec()
}

/// Narrow trait so `collect_dir_entries` can be generic over both the
/// real `std::fs::DirEntry` and a test-only stand-in, without pulling in
/// any mocking dependency.
trait DirEntryPath {
    fn entry_path(&self) -> PathBuf;
}

impl DirEntryPath for std::fs::DirEntry {
    fn entry_path(&self) -> PathBuf {
        self.path()
    }
}

/// Canonicalizes `path` unconditionally, whether or not it's a symlink.
///
/// A plain (non-symlink) directory entry still needs canonicalizing here
/// because `path` is built as `dir.join(name)` (see `scan_directory`),
/// so it inherits whatever form `dir` was passed in — relative, or
/// absolute with a symlinked ancestor. The containment check right
/// after this call compares this return value against `dir`'s own
/// canonical form, so both sides must be canonical or the comparison is
/// meaningless: a non-canonical `resolved` almost never
/// `starts_with(canonical_root)`, even for an entry that is genuinely
/// inside `dir`, which would wrongly reject it as
/// `SkipReason::SymlinkEscapesRoot`.
///
/// A dangling target surfaces as `SkipReason::BrokenSymlink` only when
/// `path` actually is a symlink — a plain entry can't dangle in the same
/// sense (its non-existence would already have surfaced from
/// `symlink_metadata` above), so a canonicalize failure on a non-symlink
/// entry is reported as `SkipReason::IoError` instead, consistent with
/// every other I/O failure in this scan. Any other symlink resolution
/// failure (a loop, permission denied partway through) surfaces as
/// `SkipReason::SymlinkResolutionFailed`. `std::fs::canonicalize` already
/// detects symlink loops itself (`ELOOP`), so no separate visited-set is
/// needed for that — only for catching a symlink from *this* scan
/// resolving to a target an *earlier* entry in the same scan already
/// claimed, which `scan_directory`'s `seen_targets` map (keyed on this
/// function's return value) handles.
fn resolve_symlink(path: &Path) -> Result<PathBuf, SkipReason> {
    let symlink_meta = match path.symlink_metadata() {
        Ok(meta) => meta,
        Err(e) => return Err(SkipReason::IoError(e.to_string())),
    };
    if !symlink_meta.file_type().is_symlink() {
        return match std::fs::canonicalize(path) {
            Ok(resolved) => Ok(resolved),
            Err(e) => Err(SkipReason::IoError(e.to_string())),
        };
    }
    match std::fs::canonicalize(path) {
        Ok(resolved) => Ok(resolved),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(SkipReason::BrokenSymlink),
        Err(e) => Err(SkipReason::SymlinkResolutionFailed(e.to_string())),
    }
}

/// Applies a `--skill-name-filter` glob (comma-separated, each pattern
/// trimmed and matched case-insensitively against `SkillRecord.name` —
/// the canonical frontmatter casing, never the lowercased index key) to
/// `index`, removing entries that match none of the patterns.
///
/// Scoped to konductor-installed skills ONLY: a record is a candidate
/// for removal at all only when `SkillRecord::installed_by_konductor`
/// is `true`. A hand-authored or third-party skill
/// (`installed_by_konductor == false` — including the fail-open case of
/// a missing/unreadable manifest, see `install_manifest.rs`) always
/// passes through unfiltered, regardless of `filter`'s value, since
/// konductor's own installer merges into the same `--skills-dir` root
/// such content already lives in rather than replacing it wholesale.
/// Before this scoping existed, `--skill-name-filter` narrowed the
/// WHOLE merged scan of every configured root, so a non-empty filter
/// (which every agent spec with a non-empty `skillNames` produces — see
/// `resource_rewrite.rs`'s `McpServerPass`) would silently hide every
/// hand-authored/third-party skill in that root for every agent, not
/// just the konductor-installed ones it was meant to scope.
///
/// Case-insensitive to stay consistent with every other lookup path
/// this index exposes (`SkillIndex::get`/`search`, and the collision key
/// itself, all lowercase before comparing) — a skill reachable via
/// `index.get("MyThing")` or `index.get("mything")` shouldn't be
/// excludable by `--skill-name-filter` in only one casing.
///
/// Returns the filtered index and the names of every entry that was
/// removed. Filtered-out is a distinct concept from a `SkipReason`:
/// these entries parsed fine and were excluded by the operator's own
/// filter choice, not because they couldn't be indexed — the caller
/// logs each returned name separately, at `debug` level (per §4.9's
/// debug row: "Skills excluded by `--skill-name-filter` (name + filter
/// pattern)"), and none of them are counted as a skip. The count a
/// caller needs for the existing aggregate `info` line is just
/// `excluded_names.len()`.
///
/// `filter` of `None` (the flag wasn't passed) returns `index` unchanged
/// with no excluded names.
///
/// Glob matching supports only `*` as a wildcard, via a simple
/// segment-split — covering the universal (`*`), prefix (`foo*`), and
/// suffix (`*foo`) cases. A pattern with other regex metacharacters is
/// matched literally rather than as a full regex — a minimal
/// dependency-free matcher, not a full regex engine, since the broader
/// filter contract was never pinned down beyond these documented cases.
///
/// `pub(crate)`, not `pub`: called only from `SkillIndex::build`/
/// `reload` (in `index.rs`, a different module — hence `pub(crate)`
/// rather than fully private). `skill-lookup-mcp` configures filtering
/// via the `skill_name_filter` argument to `SkillIndex::build`, never by
/// calling this directly — narrowed rather than disclosed.
pub(crate) fn apply_name_filter(
    index: HashMap<String, SkillRecord>,
    filter: &Option<String>,
) -> (HashMap<String, SkillRecord>, Vec<String>) {
    let Some(filter) = filter else {
        return (index, Vec::new());
    };

    let patterns: Vec<String> = filter.split(',').map(|p| p.trim().to_lowercase()).collect();
    let mut excluded_names = Vec::new();
    let filtered: HashMap<String, SkillRecord> = index
        .into_iter()
        .filter(|(_, record)| {
            // Not konductor's to scope: always keep, regardless of
            // `patterns` — this is the fix for r4p2 on CR-302539291
            // (see this function's doc comment above).
            if !record.installed_by_konductor {
                return true;
            }
            let name_lower = record.name.to_lowercase();
            let keep = patterns
                .iter()
                .any(|pattern| glob_match(pattern, &name_lower));
            if !keep {
                excluded_names.push(record.name.clone());
            }
            keep
        })
        .collect();
    (filtered, excluded_names)
}

/// Minimal `*`-wildcard glob match: `*` matches any run of characters,
/// including none; every other character must match literally.
/// Case-sensitive at this level — callers pass both `pattern` and `text`
/// already lowercased (see `apply_name_filter`).
///
/// Linear two-pointer match (the standard `*`-only wildcard algorithm),
/// not recursive backtracking: on a literal mismatch after a `*`, it
/// rewinds to the most recent `*` and retries by advancing the text
/// pointer one character, using two saved indices (`star_pattern_idx`,
/// `star_text_idx`) instead of a stack frame per retry. A naive
/// recursive `inner()` that tries every split point per `*` is
/// exponential on multi-`*` patterns (each `*` re-explores the whole
/// remaining text independently); this is O(pattern.len() *
/// text.len()) worst case, since `star_text_idx` never moves backward
/// and `text_idx` strictly advances between rewinds to the same star.
fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.as_bytes();
    let text = text.as_bytes();

    let mut pattern_idx = 0;
    let mut text_idx = 0;
    // Most recent `*`'s position in `pattern`, and how much of `text` had
    // been consumed when that `*` was first reached. `usize::MAX` as a
    // sentinel for "no `*` seen yet", since there is nothing yet to
    // rewind to.
    let mut star_pattern_idx = usize::MAX;
    let mut star_text_idx = 0usize;

    while text_idx < text.len() {
        if pattern_idx < pattern.len() && pattern[pattern_idx] == b'*' {
            // Record this star, for now matching zero characters —
            // advance the pattern only.
            star_pattern_idx = pattern_idx;
            star_text_idx = text_idx;
            pattern_idx += 1;
        } else if pattern_idx < pattern.len() && pattern[pattern_idx] == text[text_idx] {
            // Literal match; advance both.
            pattern_idx += 1;
            text_idx += 1;
        } else if star_pattern_idx != usize::MAX {
            // Literal mismatch (or pattern exhausted) with a `*` to
            // rewind to: it now consumes one more character of `text`
            // than it did last time, and matching resumes right after it.
            star_text_idx += 1;
            pattern_idx = star_pattern_idx + 1;
            text_idx = star_text_idx;
        } else {
            // Mismatch with no `*` to rewind to.
            return false;
        }
    }

    // `text` is fully consumed. Any pattern left over must be all `*`s —
    // each matches zero characters — for this to still be a match.
    pattern[pattern_idx..].iter().all(|&b| b == b'*')
}

/// Test-only serialization point for the one test in this module
/// (`relative_skills_dir_does_not_falsely_reject_valid_skills`) that has
/// to change the process's current directory to exercise a cwd-relative
/// path. The cwd is per-process, not per-thread, so two such tests
/// running on Rust's parallel test threads would each scan the other's
/// directory.
///
/// A separate copy of this same small helper exists in the consuming
/// server's own test module for its own cwd-mutating tests.
/// The two are independent on purpose, not a missed dedup: `cargo test
/// --workspace` runs each crate's unit tests as its own test binary
/// process, so a mutex here can never actually serialize against one in
/// a different crate's process regardless of whether the two share code
/// — only tests within the *same* compiled test binary can race on the
/// real process-wide cwd. Sharing one copy across a crate boundary would
/// buy nothing beyond avoiding an 8-line duplicate.
#[cfg(test)]
pub(crate) mod cwd_lock {
    use std::sync::{Mutex, MutexGuard};

    static CWD_LOCK: Mutex<()> = Mutex::new(());

    /// Takes the lock, recovering rather than propagating if a previous
    /// holder panicked — poisoning here says nothing about the cwd.
    pub(crate) fn lock() -> MutexGuard<'static, ()> {
        CWD_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-scanner-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_skill(dir: &Path, name_on_disk: &str, frontmatter_name: &str, description: &str) {
        let skill_dir = dir.join(name_on_disk);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: {frontmatter_name}\ndescription: {description}\n---\n\nBody.\n"),
        )
        .unwrap();
    }

    #[test]
    fn scan_directory_indexes_valid_skills() {
        let dir = temp_dir("valid-skills");
        write_skill(&dir, "alpha", "alpha", "First skill.");
        write_skill(&dir, "beta", "beta", "Second skill.");

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert_eq!(records.len(), 2);
        assert!(skipped.is_empty());
        let names: Vec<&str> = records.iter().map(|r| r.name.as_str()).collect();
        assert!(names.contains(&"alpha"));
        assert!(names.contains(&"beta"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn directory_with_no_skill_md_is_ignored_not_reported() {
        let dir = temp_dir("no-skill-md");
        fs::create_dir_all(dir.join("not-a-skill")).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(records.is_empty());
        assert!(skipped.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn depth_1_only_nested_skill_dirs_are_not_recursed_into() {
        let dir = temp_dir("depth-limit");
        let nested_parent = dir.join("parent");
        fs::create_dir_all(&nested_parent).unwrap();
        write_skill(&nested_parent, "nested", "nested", "Too deep.");

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(records.is_empty(), "nested skill must not be indexed");
        assert!(skipped.is_empty(), "parent dir has no SKILL.md itself");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn unindexable_skill_directory_is_reported_not_dropped() {
        let dir = temp_dir("unindexable");
        let skill_dir = dir.join("broken");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "no frontmatter here\n").unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(records.is_empty());
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].reason, SkipReason::NoFrontmatterDelimiters);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn same_dir_case_only_collision_first_wins_second_skipped() {
        let dir = temp_dir("intra-dir-case-collision");
        // Two DISTINCT on-disk directory names (not "Foo"/"foo" — on a
        // case-insensitive filesystem like default APFS or NTFS those
        // are the same directory, and the second write would silently
        // overwrite the first). The collision instead comes from their
        // frontmatter `name:` values differing only in case, which is
        // what `claimed_keys` actually keys on. Sorted iteration order
        // ("skill-a" before "skill-b") is what makes "skill-a" claim
        // the lowercased key first.
        write_skill(&dir, "skill-a", "Same-Name", "First.");
        write_skill(&dir, "skill-b", "same-name", "Second.");

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].description, "First.");
        assert_eq!(skipped.len(), 1);
        match &skipped[0].reason {
            SkipReason::IntraDirCaseCollision(winning_path) => {
                assert!(winning_path.to_string_lossy().contains("skill-a"));
            }
            other => panic!("expected IntraDirCaseCollision, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn skill_md_permission_denied_is_reported_not_silently_dropped() {
        // Regression for the catch-all `Err(_) => continue` that used
        // to treat every symlink_metadata error as "nothing exists
        // here" — true only for NotFound. EACCES from a directory with
        // no search permission landed in that same arm and vanished
        // with no SkipEntry at all.
        //
        // Root and some sandboxes ignore permission bits, so verify the
        // denial actually takes effect before asserting on it — mirrors
        // the guard used elsewhere in this crate for permission-based
        // tests.
        let dir = temp_dir("skill-md-permission-denied");
        let skill_dir = dir.join("locked");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: locked\ndescription: d.\n---\n\nBody.\n",
        )
        .unwrap();

        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&skill_dir, fs::Permissions::from_mode(0o000)).unwrap();

        // Confirm the permission change actually blocks access before
        // relying on it — self-skip rather than false-fail under root
        // or a permission-ignoring sandbox.
        let denied = fs::read_dir(&skill_dir).is_err();
        if !denied {
            let _ = fs::set_permissions(&skill_dir, fs::Permissions::from_mode(0o755));
            let _ = fs::remove_dir_all(&dir);
            eprintln!(
                "skipping skill_md_permission_denied_is_reported_not_silently_dropped: \
                 permission bits are not enforced in this environment (root or a \
                 permission-ignoring sandbox)"
            );
            return;
        }

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);

        // Restore permissions before any assertion can early-return via
        // panic, so cleanup still runs.
        let _ = fs::set_permissions(&skill_dir, fs::Permissions::from_mode(0o755));

        assert!(
            records.is_empty(),
            "an unreadable skill directory must not produce a record, but got: {records:?}"
        );
        assert_eq!(
            skipped.len(),
            1,
            "the permission error must produce a diagnostic, not vanish silently; skipped: {skipped:?}"
        );
        match &skipped[0].reason {
            SkipReason::IoError(_) => {}
            other => panic!("expected IoError, got {other:?}"),
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn broken_symlink_is_skipped() {
        let dir = temp_dir("broken-symlink");
        let link = dir.join("dangling");
        std::os::unix::fs::symlink(dir.join("does-not-exist"), &link).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(records.is_empty());
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].reason, SkipReason::BrokenSymlink);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escaping_the_skills_dir_root_is_skipped_not_indexed() {
        // A symlink whose target resolves outside the configured
        // --skills-dir root must be rejected, not indexed — otherwise
        // a skill directory could point anywhere on the filesystem the
        // process has read access to.
        let dir = temp_dir("symlink-escape-root");
        let outside = temp_dir("symlink-escape-outside");
        write_skill(&outside, "escapee", "escapee", "Lives outside the root.");
        let link = dir.join("escape-link");
        std::os::unix::fs::symlink(outside.join("escapee"), &link).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(
            records.is_empty(),
            "a skill reached only via an out-of-root symlink must not be indexed"
        );
        assert_eq!(skipped.len(), 1);
        match &skipped[0].reason {
            SkipReason::SymlinkEscapesRoot(target) => {
                assert!(target.to_string_lossy().contains("escapee"));
            }
            other => panic!("expected SymlinkEscapesRoot, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_within_the_skills_dir_root_is_still_indexed() {
        // A symlink whose target stays inside the same --skills-dir
        // root (e.g. an internal alias) must not be penalized by the
        // containment check — only an out-of-root escape is rejected.
        let dir = temp_dir("symlink-within-root");
        write_skill(&dir, "aaa_real", "real-skill", "The real one.");
        let link = dir.join("zzz_aliased");
        std::os::unix::fs::symlink(dir.join("aaa_real"), &link).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert_eq!(records.len(), 1);
        // The alias is still reported, but as a DuplicateTarget (an
        // existing, unrelated skip reason), never SymlinkEscapesRoot.
        assert_eq!(skipped.len(), 1);
        assert!(matches!(skipped[0].reason, SkipReason::DuplicateTarget(_)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn skill_md_symlink_escaping_the_root_is_skipped_not_indexed() {
        // The directory entry itself (`escapee/`) is a real directory
        // inside the root — it passes the entry-level containment
        // check. But its `SKILL.md` is a symlink to a file OUTSIDE the
        // root. Before the fix, `skill_md` is handed straight to
        // `std::fs::metadata`/`parse_frontmatter` with no containment
        // check of its own, so the outside file's content gets indexed
        // with no skip entry at all — silent inclusion of out-of-root
        // content, the inverse of this module's no-silent-drop
        // guarantee.
        let dir = temp_dir("skill-md-symlink-escape-root");
        let outside = temp_dir("skill-md-symlink-escape-outside");
        fs::write(
            outside.join("secret.md"),
            "---\nname: exfiltrated\ndescription: leaked\n---\n\nBody.\n",
        )
        .unwrap();

        let skill_dir = dir.join("escapee");
        fs::create_dir_all(&skill_dir).unwrap();
        std::os::unix::fs::symlink(outside.join("secret.md"), skill_dir.join("SKILL.md")).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);

        assert!(
            records.is_empty(),
            "a SKILL.md symlink escaping the root must not be indexed, but got: {records:?}"
        );
        assert_eq!(
            skipped.len(),
            1,
            "the escape must produce a diagnostic, not vanish silently; skipped: {skipped:?}"
        );
        match &skipped[0].reason {
            SkipReason::SymlinkEscapesRoot(target) => {
                assert!(
                    target.to_string_lossy().contains("secret.md"),
                    "diagnostic should name the out-of-root target, got: {target:?}"
                );
            }
            other => panic!("expected SymlinkEscapesRoot, got {other:?}"),
        }

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn dangling_skill_md_symlink_is_reported_not_silently_dropped() {
        // The directory entry itself (`broken/`) is a real directory
        // inside the root. Its `SKILL.md` is a symlink whose target
        // does not exist at all — not an escape, just dangling. Before
        // the fix, `skill_md.is_file()` follows the symlink, gets
        // `false` for a dangling target, and the directory is silently
        // `continue`'d as "not a skill" with no SkipEntry — the same
        // no-silent-drop guarantee this module claims elsewhere is
        // violated for this one case (a dangling *directory-level*
        // symlink is correctly reported as BrokenSymlink; a dangling
        // SKILL.md-level symlink was not).
        let dir = temp_dir("skill-md-symlink-dangling");
        let skill_dir = dir.join("broken");
        fs::create_dir_all(&skill_dir).unwrap();
        std::os::unix::fs::symlink(dir.join("does-not-exist.md"), skill_dir.join("SKILL.md"))
            .unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);

        assert!(
            records.is_empty(),
            "a dangling SKILL.md symlink must not produce a record, but got: {records:?}"
        );
        assert_eq!(
            skipped.len(),
            1,
            "a dangling SKILL.md symlink must be reported, not vanish silently; skipped: {skipped:?}"
        );
        assert_eq!(skipped[0].reason, SkipReason::BrokenSymlink);

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn skill_md_symlink_to_existing_directory_is_not_reported_as_broken() {
        // The directory entry itself (`escapee/`) is a real directory
        // inside the root. Its `SKILL.md` is a symlink whose target
        // DOES exist, but is a directory rather than a regular file —
        // distinct from the dangling case in
        // `dangling_skill_md_symlink_is_reported_not_silently_dropped`.
        // `skill_md.is_file()` still returns `false` here (a directory
        // is not a regular file), but the target is not broken, so
        // labelling this `BrokenSymlink` would be inaccurate.
        let dir = temp_dir("skill-md-symlink-to-existing-dir");
        let skill_dir = dir.join("escapee");
        fs::create_dir_all(&skill_dir).unwrap();
        let target_dir = skill_dir.join("target-dir");
        fs::create_dir_all(&target_dir).unwrap();
        std::os::unix::fs::symlink(&target_dir, skill_dir.join("SKILL.md")).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);

        assert!(
            records.is_empty(),
            "a SKILL.md symlink to a directory must not be indexed as a skill, but got: {records:?}"
        );
        assert_eq!(
            skipped.len(),
            1,
            "the non-regular-file target must produce a diagnostic, not vanish silently; skipped: {skipped:?}"
        );
        assert_eq!(
            skipped[0].reason,
            SkipReason::NotRegularFile,
            "a symlink to an existing directory is not a broken/dangling symlink; got: {:?}",
            skipped[0].reason
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn directory_named_skill_md_is_reported_not_silently_dropped() {
        // A real directory (not a symlink) named SKILL.md. The symlinked
        // form of this already produced NotRegularFile; the direct form
        // was `continue`'d with no SkipEntry at all, so the same on-disk
        // mistake was diagnosed or silent depending only on whether a
        // symlink was involved.
        let dir = temp_dir("direct-dir-named-skill-md");
        fs::create_dir_all(dir.join("weird").join("SKILL.md")).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(records.is_empty(), "got: {records:?}");
        assert_eq!(
            skipped.len(),
            1,
            "a non-regular SKILL.md must be reported whether or not a symlink is involved; skipped: {skipped:?}"
        );
        assert_eq!(skipped[0].reason, SkipReason::NotRegularFile);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn relative_skills_dir_does_not_falsely_reject_valid_skills() {
        // A relative `dir` (e.g. `--skills-dir ./skills` or
        // `--skills-dir skills`) is not in canonical form. If the
        // containment check compares a non-canonicalized plain-directory
        // entry against a canonicalized root, every ordinary skill under
        // a relative root gets wrongly rejected as SymlinkEscapesRoot.
        let base = temp_dir("relative-dir-valid-skill");
        write_skill(
            &base,
            "real-skill",
            "real-skill",
            "A valid, non-symlink skill.",
        );

        let _cwd_guard = cwd_lock::lock();
        let original_cwd = std::env::current_dir().unwrap();
        // `base`'s parent is itself an absolute temp path, so cd there
        // and pass only the final path segment as a relative dir.
        std::env::set_current_dir(base.parent().unwrap()).unwrap();
        let relative_dir = PathBuf::from(base.file_name().unwrap());

        let (records, skipped, _root_error) = scan_directory(&relative_dir, Provenance::Managed);

        std::env::set_current_dir(&original_cwd).unwrap();

        assert_eq!(
            records.len(),
            1,
            "a valid non-symlink skill under a relative --skills-dir must be indexed, not skipped; skipped: {skipped:?}"
        );
        assert!(
            skipped.is_empty(),
            "expected no skips for a valid skill under a relative root, got: {skipped:?}"
        );
        let _ = fs::remove_dir_all(&base);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_ancestor_of_skills_dir_does_not_falsely_reject_valid_skills() {
        // An absolute `dir` whose *ancestor* (not `dir` itself) is a
        // symlink is also not canonical — canonicalize(dir) resolves the
        // ancestor symlink and returns a different absolute path. This
        // mirrors a home directory reached through a symlink, which is
        // the common case on this host layout.
        let real_base = temp_dir("symlinked-ancestor-real");
        let ancestor_link = std::env::temp_dir().join(format!(
            "skill-lookup-scanner-test-ancestor-link-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::os::unix::fs::symlink(&real_base, &ancestor_link).unwrap();

        // Reach the skills dir through the symlinked ancestor rather
        // than the real, already-canonical path.
        let skills_dir_via_symlink = ancestor_link.join("skills");
        fs::create_dir_all(&skills_dir_via_symlink).unwrap();
        write_skill(
            &skills_dir_via_symlink,
            "real-skill",
            "real-skill",
            "A valid, non-symlink skill reached via a symlinked ancestor.",
        );

        let (records, skipped, _root_error) =
            scan_directory(&skills_dir_via_symlink, Provenance::Managed);

        assert_eq!(
            records.len(),
            1,
            "a valid non-symlink skill reached via a symlinked ancestor must be indexed, not skipped; skipped: {skipped:?}"
        );
        assert!(
            skipped.is_empty(),
            "expected no skips for a valid skill reached via a symlinked ancestor, got: {skipped:?}"
        );

        let _ = fs::remove_file(&ancestor_link);
        let _ = fs::remove_dir_all(&real_base);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_to_a_non_skill_directory_is_not_reported_as_duplicate() {
        // Fix for AutoSDE f-5a6e9c15: "aaa_real" has no SKILL.md, so it is
        // silently ignored per `directory_with_no_skill_md_is_ignored_not_reported`'s
        // contract — never a skip entry. "zzz_aliased" symlinks to that
        // same non-skill target. Before the fix, the first entry claimed a
        // `seen_targets` slot regardless of whether it turned out to be a
        // skill, so the symlink was wrongly reported as
        // `SkipReason::DuplicateTarget` — a diagnostic whose own message
        // ("already indexed via ...") was false, since "aaa_real" was
        // never indexed. Two entries reaching the same non-skill directory
        // must both be silently ignored, exactly as a single one would be.
        let dir = temp_dir("duplicate-non-skill-target");
        fs::create_dir_all(dir.join("aaa_real")).unwrap();
        let link = dir.join("zzz_aliased");
        std::os::unix::fs::symlink(dir.join("aaa_real"), &link).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(
            records.is_empty(),
            "neither entry is a skill; got: {records:?}"
        );
        assert!(
            skipped.is_empty(),
            "a non-skill directory reached twice must produce no diagnostic at all \
             (no DuplicateTarget, no other skip), same as reaching it once; got: {skipped:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_pointing_to_already_indexed_target_is_duplicate() {
        let dir = temp_dir("duplicate-target");
        // The alias is named to sort FIRST ("aaa_alias" before
        // "bbb_target"), so the symlink is the entry that gets indexed and
        // the real directory is the one reported as the duplicate. That
        // inversion is what makes this fixture discriminating: the earlier
        // entry's path ("aaa_alias") and the shared resolved target
        // ("bbb_target") are now different strings, so the assertions below
        // can tell which of the two `DuplicateTarget` actually carries.
        // With the alias sorting second, both would canonicalize to a path
        // containing the real directory's name and either payload would
        // satisfy the assertion.
        write_skill(&dir, "bbb_target", "real-skill", "The real one.");
        let link = dir.join("aaa_alias");
        std::os::unix::fs::symlink(dir.join("bbb_target"), &link).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert_eq!(records.len(), 1);
        assert_eq!(skipped.len(), 1);
        match &skipped[0].reason {
            SkipReason::DuplicateTarget(original) => {
                let original = original.to_string_lossy();
                assert!(
                    original.contains("aaa_alias"),
                    "payload must be the earlier ENTRY's own path, got: {original}"
                );
                assert!(
                    !original.contains("bbb_target"),
                    "payload must not be the shared resolved target, got: {original}"
                );
            }
            other => panic!("expected DuplicateTarget, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_loop_is_skipped() {
        let dir = temp_dir("symlink-loop");
        let a = dir.join("a");
        let b = dir.join("b");
        std::os::unix::fs::symlink(&b, &a).unwrap();
        std::os::unix::fs::symlink(&a, &b).unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(records.is_empty());
        assert_eq!(skipped.len(), 2);
        // A true symlink cycle is detected by the OS as ELOOP (confirmed
        // empirically: `canonicalize()` returns `ErrorKind::Other`
        // wrapping "Too many levels of symbolic links"), which
        // `resolve_symlink` classifies as `SymlinkResolutionFailed` --
        // distinct from `BrokenSymlink`, which is reserved for a
        // dangling (but non-cyclic) target. Asserting the specific
        // variant here, rather than accepting either, means a future
        // regression that silently starts reporting a cycle as
        // `BrokenSymlink` (a different, less accurate diagnosis) would
        // be caught instead of masked by a permissive assertion.
        for entry in &skipped {
            match &entry.reason {
                SkipReason::SymlinkResolutionFailed(_) => {}
                other => panic!("expected SymlinkResolutionFailed (ELOOP), got {other:?}"),
            }
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_index_first_skills_dir_wins_cross_directory_collision() {
        let dir_a = temp_dir("collision-a");
        let dir_b = temp_dir("collision-b");
        write_skill(&dir_a, "shared", "shared", "From A.");
        write_skill(&dir_b, "shared", "shared", "From B.");

        let (index, diagnostic) =
            build_index(&[ResolvedDir::managed(&dir_a), ResolvedDir::workspace(&dir_b)]);
        assert_eq!(index.len(), 1);
        assert_eq!(index.get("shared").unwrap().description, "From A.");
        assert_eq!(diagnostic.collisions.len(), 1);
        assert_eq!(diagnostic.collisions[0].name, "shared");
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn build_index_collision_precedence_is_by_provenance_not_vec_order() {
        // Every other collision test here passes the managed dir first
        // in `dirs`, so none of them prove precedence is keyed on
        // `Provenance` rather than on `Vec<ResolvedDir>` iteration order
        // in `build_index`. This test reverses that: the workspace dir
        // is scanned FIRST (index 0) and the managed dir SECOND (index
        // 1). If precedence were actually "whichever scans first wins"
        // (i.e. keyed on vec position), the workspace entry would win
        // here and this assertion would fail — which is the real bug
        // this test exists to catch, not something to paper over by
        // reordering the fixture to match current behavior.
        let dir_workspace = temp_dir("collision-precedence-workspace");
        let dir_managed = temp_dir("collision-precedence-managed");
        write_skill(&dir_workspace, "shared", "shared", "From workspace.");
        write_skill(&dir_managed, "shared", "shared", "From managed.");

        let (index, diagnostic) = build_index(&[
            ResolvedDir::workspace(&dir_workspace),
            ResolvedDir::managed(&dir_managed),
        ]);

        assert_eq!(index.len(), 1);
        assert_eq!(
            index.get("shared").unwrap().description,
            "From managed.",
            "the managed entry must win the collision regardless of scan order"
        );
        assert_eq!(index.get("shared").unwrap().provenance, Provenance::Managed);
        assert_eq!(diagnostic.collisions.len(), 1);
        let _ = fs::remove_dir_all(&dir_workspace);
        let _ = fs::remove_dir_all(&dir_managed);
    }

    #[test]
    fn build_index_same_provenance_collision_is_first_wins() {
        // `should_replace` only special-cases (Workspace, Managed); its
        // doc comment claims same-provenance collisions are first-wins,
        // but until now nothing exercised that fallthrough directly.
        // Two Workspace roots colliding on the same name: the entry
        // from the first-scanned root (dir_a, at vec index 0) must win,
        // since neither candidate can claim the Managed-beats-Workspace
        // branch to override scan order.
        let dir_a = temp_dir("same-provenance-workspace-a");
        let dir_b = temp_dir("same-provenance-workspace-b");
        write_skill(&dir_a, "shared", "shared", "From first workspace root.");
        write_skill(&dir_b, "shared", "shared", "From second workspace root.");

        let (index, diagnostic) = build_index(&[
            ResolvedDir::workspace(&dir_a),
            ResolvedDir::workspace(&dir_b),
        ]);

        assert_eq!(index.len(), 1);
        assert_eq!(
            index.get("shared").unwrap().description,
            "From first workspace root.",
            "first-scanned Workspace root must win a same-provenance collision"
        );
        assert_eq!(diagnostic.collisions.len(), 1);
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn build_index_same_provenance_managed_collision_is_first_wins() {
        // Same fallthrough, for (Managed, Managed) — the other
        // same-provenance pairing `should_replace` doesn't special-case.
        let dir_a = temp_dir("same-provenance-managed-a");
        let dir_b = temp_dir("same-provenance-managed-b");
        write_skill(&dir_a, "shared", "shared", "From first managed root.");
        write_skill(&dir_b, "shared", "shared", "From second managed root.");

        let (index, diagnostic) =
            build_index(&[ResolvedDir::managed(&dir_a), ResolvedDir::managed(&dir_b)]);

        assert_eq!(index.len(), 1);
        assert_eq!(
            index.get("shared").unwrap().description,
            "From first managed root.",
            "first-scanned Managed root must win a same-provenance collision"
        );
        assert_eq!(diagnostic.collisions.len(), 1);
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn build_index_stamps_each_root_with_the_provenance_it_was_given() {
        // build_index no longer infers provenance from list position — it
        // stamps whatever each ResolvedDir carries. The test that the
        // *right* provenance gets assigned in the first place lives with
        // `resolve_skills_dirs` in the consuming server's `cli.rs`, which
        // is what assigns it.
        let dir_a = temp_dir("provenance-a");
        let dir_b = temp_dir("provenance-b");
        write_skill(&dir_a, "one", "one", "First dir.");
        write_skill(&dir_b, "two", "two", "Second dir.");

        let (index, _diag) =
            build_index(&[ResolvedDir::managed(&dir_a), ResolvedDir::workspace(&dir_b)]);
        assert_eq!(index.get("one").unwrap().provenance, Provenance::Managed);
        assert_eq!(index.get("two").unwrap().provenance, Provenance::Workspace);
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn build_index_reports_dir_count_and_indexed_count() {
        let dir_a = temp_dir("counts-a");
        let dir_b = temp_dir("counts-b");
        write_skill(&dir_a, "one", "one", "d");
        write_skill(&dir_b, "two", "two", "d");

        let (_index, diagnostic) =
            build_index(&[ResolvedDir::managed(&dir_a), ResolvedDir::workspace(&dir_b)]);
        assert_eq!(diagnostic.dir_count, 2);
        assert_eq!(diagnostic.indexed_count, 2);
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    #[test]
    fn oversized_skill_file_is_skipped_not_indexed() {
        // Was `oversized_body_is_still_indexed_normally`: the scanner used
        // to impose no size cap at all. It now rejects a SKILL.md over
        // the 1 MiB limit at scan time, before reading it.
        let dir = temp_dir("oversized-skill-file");
        let skill_dir = dir.join("big");
        fs::create_dir_all(&skill_dir).unwrap();
        let big_body = "x".repeat(2 * 1024 * 1024);
        fs::write(
            skill_dir.join("SKILL.md"),
            format!("---\nname: big\ndescription: d.\n---\n\n{big_body}\n"),
        )
        .unwrap();

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert!(records.is_empty(), "got: {records:?}");
        assert_eq!(skipped.len(), 1);
        match &skipped[0].reason {
            SkipReason::OversizedSkillFile {
                actual_bytes,
                limit_bytes,
            } => {
                assert!(*actual_bytes > *limit_bytes);
                assert_eq!(*limit_bytes, crate::frontmatter::MAX_SKILL_FILE_BYTES);
            }
            other => panic!("expected OversizedSkillFile, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn entry_cap_truncates_and_reports_dropped_count() {
        // Exercises the bounded-collection cap directly against a small
        // limit — no need to create thousands of real directory entries
        // to prove the cap-then-report behavior.
        let dir = PathBuf::from("/some/skills/dir");
        let entries: Vec<std::io::Result<FakeDirEntry>> = vec![
            Ok(FakeDirEntry(dir.join("d"))),
            Ok(FakeDirEntry(dir.join("b"))),
            Ok(FakeDirEntry(dir.join("a"))),
            Ok(FakeDirEntry(dir.join("c"))),
        ];
        let mut skipped = Vec::new();

        let entry_paths = collect_dir_entries(entries, &dir, &mut skipped, 2);

        // Sorted order is a, b, c, d — the cap keeps the 2 smallest,
        // regardless of arrival order.
        assert_eq!(entry_paths, vec![dir.join("a"), dir.join("b")]);
        assert_eq!(skipped.len(), 1);
        match &skipped[0].reason {
            SkipReason::TooManyEntries {
                dropped_count,
                limit,
            } => {
                assert_eq!(*dropped_count, 2);
                assert_eq!(*limit, 2);
            }
            other => panic!("expected TooManyEntries, got {other:?}"),
        }
        assert_eq!(skipped[0].path, dir);
    }

    #[test]
    fn entry_cap_is_a_noop_when_under_the_limit() {
        let dir = PathBuf::from("/some/skills/dir");
        let entries: Vec<std::io::Result<FakeDirEntry>> = vec![
            Ok(FakeDirEntry(dir.join("a"))),
            Ok(FakeDirEntry(dir.join("b"))),
        ];
        let mut skipped = Vec::new();

        let entry_paths = collect_dir_entries(entries, &dir, &mut skipped, 10);

        assert_eq!(entry_paths.len(), 2);
        assert!(skipped.is_empty());
    }

    #[test]
    fn entry_cap_bounded_collection_matches_sort_then_truncate() {
        // Proves the bounded max-heap collector yields the SAME
        // surviving set the old sort-then-truncate approach did, for
        // shuffled inputs, over many rounds and several limit/N
        // combinations — the property the fix depends on for
        // correctness (this module's collision resolution and
        // cross-directory precedence both assume the surviving set is a
        // stable function of sorted order, not of collection strategy).
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        fn old_sort_then_truncate(mut paths: Vec<PathBuf>, limit: usize) -> Vec<PathBuf> {
            paths.sort();
            paths.truncate(limit);
            paths
        }

        // Deterministic, dependency-free shuffle: a simple LCG seeded
        // per-round, avoiding a `rand` crate dependency for a test.
        fn shuffle(paths: &mut [PathBuf], seed: u64) {
            let mut state = seed.wrapping_mul(2_685_821_657_736_338_717).wrapping_add(1);
            for i in (1..paths.len()).rev() {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                let j = (state as usize) % (i + 1);
                paths.swap(i, j);
            }
        }

        fn hash_seed(round: usize, n: usize, limit: usize) -> u64 {
            let mut hasher = DefaultHasher::new();
            (round, n, limit).hash(&mut hasher);
            hasher.finish()
        }

        let dir = PathBuf::from("/some/skills/dir");
        let sizes_and_limits = [
            (0usize, 5usize),
            (1, 5),
            (5, 5),
            (50, 5),
            (50, 50),
            (200, 30),
        ];

        for (n, limit) in sizes_and_limits {
            let base: Vec<PathBuf> = (0..n).map(|i| dir.join(format!("entry_{i:04}"))).collect();

            for round in 0..25 {
                let mut shuffled = base.clone();
                shuffle(&mut shuffled, hash_seed(round, n, limit));

                let expected = old_sort_then_truncate(shuffled.clone(), limit);

                let entries: Vec<std::io::Result<FakeDirEntry>> = shuffled
                    .iter()
                    .cloned()
                    .map(|p| Ok(FakeDirEntry(p)))
                    .collect();
                let mut skipped = Vec::new();
                let actual = collect_dir_entries(entries, &dir, &mut skipped, limit);

                assert_eq!(
                    actual, expected,
                    "n={n} limit={limit} round={round}: bounded collection must match \
                     sort-then-truncate exactly"
                );

                let expected_dropped = n.saturating_sub(limit);
                if expected_dropped > 0 {
                    assert_eq!(skipped.len(), 1, "n={n} limit={limit} round={round}");
                    match &skipped[0].reason {
                        SkipReason::TooManyEntries { dropped_count, .. } => {
                            assert_eq!(*dropped_count, expected_dropped, "n={n} limit={limit}");
                        }
                        other => panic!("expected TooManyEntries, got {other:?}"),
                    }
                } else {
                    assert!(skipped.is_empty(), "n={n} limit={limit} round={round}");
                }
            }
        }
    }

    #[test]
    fn scan_directory_wires_the_real_entry_cap_end_to_end() {
        // Proves scan_directory actually applies MAX_ENTRIES_PER_DIR, not
        // just that the bounded collector works in isolation: creates
        // one more entry than the real cap and confirms the tail is
        // dropped and reported. The canary skill sorts first so its
        // survival (rather than merely "some skill survives") is what's
        // checked.
        let dir = temp_dir("entry-cap-wiring");
        write_skill(&dir, "aaa_first", "aaa_first", "Sorts first, must survive.");
        for i in 0..MAX_ENTRIES_PER_DIR {
            fs::create_dir_all(dir.join(format!("zzz_{i:06}"))).unwrap();
        }

        let (records, skipped, _root_error) = scan_directory(&dir, Provenance::Managed);
        assert_eq!(records.len(), 1, "got: {records:?}");
        assert_eq!(records[0].name, "aaa_first");

        let too_many = skipped
            .iter()
            .find(|s| matches!(s.reason, SkipReason::TooManyEntries { .. }))
            .expect("expected a TooManyEntries skip entry");
        match &too_many.reason {
            SkipReason::TooManyEntries {
                dropped_count,
                limit,
            } => {
                assert_eq!(*limit, MAX_ENTRIES_PER_DIR);
                // Total entries = 1 (aaa_first) + MAX_ENTRIES_PER_DIR
                // (zzz_*) = MAX_ENTRIES_PER_DIR + 1; the cap keeps
                // MAX_ENTRIES_PER_DIR, so exactly 1 is dropped.
                assert_eq!(*dropped_count, 1);
            }
            other => panic!("expected TooManyEntries, got {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn apply_name_filter_none_returns_full_set_unchanged() {
        let mut index = HashMap::new();
        index.insert(
            "a".to_string(),
            SkillRecord {
                name: "a".to_string(),
                description: "d".to_string(),
                tags: vec![],
                version: None,
                size_bytes: 0,
                path: PathBuf::from("/a/SKILL.md"),
                provenance: Provenance::Managed,
                // konductor-installed by default -- these existing
                // filter tests exercise the filter's own match/no-match
                // logic, which only applies to records where this is
                // `true`. `apply_name_filter_*_installed_by_konductor_*`
                // below exercise the `false` (hand-authored/fail-open)
                // side directly.
                installed_by_konductor: true,
            },
        );
        let (filtered, excluded_names) = apply_name_filter(index, &None);
        assert_eq!(filtered.len(), 1);
        assert_eq!(excluded_names.len(), 0);
    }

    fn record(name: &str) -> SkillRecord {
        SkillRecord {
            name: name.to_string(),
            description: "d".to_string(),
            tags: vec![],
            version: None,
            size_bytes: 0,
            path: PathBuf::from(format!("/{name}/SKILL.md")),
            provenance: Provenance::Managed,
            // See `apply_name_filter_none_returns_full_set_unchanged`'s
            // literal `SkillRecord` above for why this defaults to
            // `true`.
            installed_by_konductor: true,
        }
    }

    #[test]
    fn apply_name_filter_matches_against_canonical_name() {
        let mut index = HashMap::new();
        index.insert("frontend-dev".to_string(), record("Frontend-Dev"));
        index.insert("backend-dev".to_string(), record("backend-dev"));

        let (filtered, excluded_names) = apply_name_filter(index, &Some("Frontend-*".to_string()));
        assert_eq!(filtered.len(), 1);
        assert_eq!(excluded_names, vec!["backend-dev".to_string()]);
        assert!(filtered.contains_key("frontend-dev"));
    }

    #[test]
    fn apply_name_filter_is_case_insensitive_consistent_with_index_lookups() {
        // index.get/search and the collision key all lowercase before
        // comparing (see index.rs) — the filter must not be the one
        // path that's case-sensitive, or a skill reachable via
        // `index.get("MyThing")` in any casing could be unexpectedly
        // excluded by a --skill-name-filter using a different casing.
        let mut index = HashMap::new();
        index.insert("frontend-dev".to_string(), record("Frontend-Dev"));

        // Pattern cased differently than the record's canonical name.
        let (filtered, excluded_names) = apply_name_filter(index, &Some("frontend-*".to_string()));
        assert_eq!(filtered.len(), 1);
        assert_eq!(excluded_names.len(), 0);
        assert!(filtered.contains_key("frontend-dev"));
    }

    #[test]
    fn apply_name_filter_supports_comma_separated_patterns_with_trim() {
        let mut index = HashMap::new();
        index.insert("a".to_string(), record("a"));
        index.insert("b".to_string(), record("b"));
        index.insert("c".to_string(), record("c"));

        let (filtered, excluded_names) = apply_name_filter(index, &Some(" a , b ".to_string()));
        assert_eq!(filtered.len(), 2);
        assert_eq!(excluded_names, vec!["c".to_string()]);
        assert!(filtered.contains_key("a"));
        assert!(filtered.contains_key("b"));
        assert!(!filtered.contains_key("c"));
    }

    #[test]
    fn apply_name_filter_universal_star_matches_everything() {
        let mut index = HashMap::new();
        index.insert("a".to_string(), record("a"));
        index.insert("b".to_string(), record("b"));

        let (filtered, excluded_names) = apply_name_filter(index, &Some("*".to_string()));
        assert_eq!(filtered.len(), 2);
        assert_eq!(excluded_names.len(), 0);
    }

    #[test]
    fn apply_name_filter_never_removes_a_record_not_installed_by_konductor() {
        // Direct test of `apply_name_filter`'s own gating logic on the
        // `installed_by_konductor` flag, independent of how that flag
        // got set (the manifest-driven, end-to-end variant of this is
        // `manifest_hand_authored_skill_in_same_root_always_survives_the_filter`
        // below). A pattern that matches neither name would exclude
        // both under the old (pre-scoping) behavior.
        let mut hand_authored = record("hand-authored");
        hand_authored.installed_by_konductor = false;
        let mut installed = record("installed");
        installed.installed_by_konductor = true;

        let mut index = HashMap::new();
        index.insert("hand-authored".to_string(), hand_authored);
        index.insert("installed".to_string(), installed);

        let (filtered, excluded_names) =
            apply_name_filter(index, &Some("matches-nothing".to_string()));
        assert!(
            filtered.contains_key("hand-authored"),
            "a record with installed_by_konductor == false must always survive the filter"
        );
        assert!(
            !filtered.contains_key("installed"),
            "a record with installed_by_konductor == true must still be scoped by the filter"
        );
        assert_eq!(excluded_names, vec!["installed".to_string()]);
    }

    /// Builds the on-disk layout `apply_name_filter`'s manifest-scoping
    /// tests below share: `<base>/.konductor/skills/` as the
    /// `--skills-dir` root, with an optional sibling manifest at
    /// `<base>/.konductor/manifest` naming which of the skills written
    /// under that root are konductor-installed. Returns `(base,
    /// skills_root)`.
    fn manifest_scope_fixture(label: &str) -> (PathBuf, PathBuf) {
        let base = temp_dir(label);
        let skills_root = base.join(".konductor").join("skills");
        fs::create_dir_all(&skills_root).unwrap();
        (base, skills_root)
    }

    fn write_sibling_manifest(base: &Path, installed_manifest_paths: &[&str]) {
        let files_json: Vec<String> = installed_manifest_paths
            .iter()
            .map(|path| format!(r#"{{"path":"{path}","sha256":null,"provenance":"created"}}"#))
            .collect();
        let manifest = format!(
            r#"{{"schema_version":1,"strategy":"kiro-cli","installed_at":"2026-01-01T00:00:00Z","destination":".","status":"complete","files":[{}]}}"#,
            files_json.join(",")
        );
        fs::write(base.join(".konductor").join("manifest"), manifest).unwrap();
    }

    #[test]
    fn manifest_installed_skill_is_removed_by_name_filter_excluding_it() {
        // Scenario (a): a konductor-installed skill is correctly
        // filtered out when excluded from --skill-name-filter.
        let (base, skills_root) = manifest_scope_fixture("manifest-scope-installed-removed");
        write_skill(
            &skills_root,
            "installed-skill",
            "installed-skill",
            "Installed by konductor.",
        );
        write_sibling_manifest(&base, &[".konductor/skills/installed-skill/SKILL.md"]);

        let (index, _diagnostic) = build_index(&[ResolvedDir::managed(&skills_root)]);
        assert!(
            index.get("installed-skill").unwrap().installed_by_konductor,
            "manifest membership must mark this skill installed_by_konductor"
        );

        let (filtered, excluded_names) = apply_name_filter(index, &Some("other-*".to_string()));
        assert!(
            filtered.is_empty(),
            "a konductor-installed skill excluded by the filter must be removed"
        );
        assert_eq!(excluded_names, vec!["installed-skill".to_string()]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn manifest_hand_authored_skill_in_same_root_always_survives_the_filter() {
        // Scenario (b): a hand-authored skill in the SAME root as a
        // konductor-installed one always passes through, regardless of
        // the filter — this is the exact defect reported on r4p2 of
        // CR-302539291: before this fix, --skill-name-filter narrowed
        // the whole merged scan of a --skills-dir root, hiding
        // hand-authored/third-party skills it should never touch.
        let (base, skills_root) = manifest_scope_fixture("manifest-scope-hand-authored-survives");
        write_skill(
            &skills_root,
            "installed-skill",
            "installed-skill",
            "Installed by konductor.",
        );
        write_skill(
            &skills_root,
            "hand-authored-skill",
            "hand-authored-skill",
            "Not installed by konductor -- merged into the same root.",
        );
        write_sibling_manifest(&base, &[".konductor/skills/installed-skill/SKILL.md"]);

        let (index, _diagnostic) = build_index(&[ResolvedDir::managed(&skills_root)]);
        assert!(index.get("installed-skill").unwrap().installed_by_konductor);
        assert!(
            !index
                .get("hand-authored-skill")
                .unwrap()
                .installed_by_konductor
        );

        // A filter naming neither skill would exclude both under the
        // old (pre-scoping) behavior.
        let (filtered, excluded_names) =
            apply_name_filter(index, &Some("matches-neither".to_string()));
        assert!(
            !filtered.contains_key("installed-skill"),
            "the konductor-installed skill excluded by the filter must be removed"
        );
        assert!(
            filtered.contains_key("hand-authored-skill"),
            "the hand-authored skill must always pass through, regardless of --skill-name-filter"
        );
        assert_eq!(excluded_names, vec!["installed-skill".to_string()]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn manifest_missing_fails_open_skill_not_filtered() {
        // Scenario (c), missing-manifest variant: no sibling manifest
        // at all for this root fails open -- the skill is treated as
        // not konductor-installed and always survives the filter.
        let (base, skills_root) = manifest_scope_fixture("manifest-scope-missing-fails-open");
        write_skill(
            &skills_root,
            "some-skill",
            "some-skill",
            "No manifest at all for this root.",
        );
        // Deliberately no manifest written at base/.konductor/manifest.

        let (index, _diagnostic) = build_index(&[ResolvedDir::managed(&skills_root)]);
        assert!(!index.get("some-skill").unwrap().installed_by_konductor);

        let (filtered, excluded_names) = apply_name_filter(index, &Some("other-*".to_string()));
        assert!(
            filtered.contains_key("some-skill"),
            "a skill under a root with no install manifest must fail open, not be filtered"
        );
        assert!(excluded_names.is_empty());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn manifest_malformed_fails_open_skill_not_filtered() {
        // Scenario (c), unreadable/malformed-manifest variant: the
        // sibling manifest exists but is not valid JSON. Must fail open
        // exactly like the missing-manifest case above, never fail
        // closed (which would wrongly filter every skill in the root).
        let (base, skills_root) = manifest_scope_fixture("manifest-scope-malformed-fails-open");
        write_skill(
            &skills_root,
            "some-skill",
            "some-skill",
            "Manifest is malformed for this root.",
        );
        fs::write(base.join(".konductor").join("manifest"), b"not json at all").unwrap();

        let (index, _diagnostic) = build_index(&[ResolvedDir::managed(&skills_root)]);
        assert!(!index.get("some-skill").unwrap().installed_by_konductor);

        let (filtered, _excluded_names) = apply_name_filter(index, &Some("other-*".to_string()));
        assert!(
            filtered.contains_key("some-skill"),
            "a malformed manifest must fail open, not filter the skill"
        );

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn glob_match_supports_prefix_suffix_and_universal() {
        assert!(glob_match("*", "anything"));
        assert!(glob_match("foo*", "foobar"));
        assert!(!glob_match("foo*", "barfoo"));
        assert!(glob_match("*bar", "foobar"));
        assert!(!glob_match("*bar", "barfoo"));
        assert!(glob_match("exact", "exact"));
        assert!(!glob_match("exact", "not-exact"));
    }

    #[test]
    fn glob_match_supports_multiple_stars() {
        assert!(glob_match("*foo*bar*", "xxfooyybarzz"));
        assert!(glob_match("*foo*bar*", "foobar"));
        assert!(!glob_match("*foo*bar*", "barfoo"));
        assert!(glob_match("a*b*c*d", "aXbYcZd"));
        assert!(glob_match("a*b*c*d", "abcd"));
        assert!(!glob_match("a*b*c*d", "aXbYcZ"));
        // Consecutive stars are equivalent to one.
        assert!(glob_match("**", "anything"));
        assert!(glob_match("a**b", "ab"));
        assert!(glob_match("a**b", "aXXXb"));
        // An all-star pattern matches empty text too.
        assert!(glob_match("***", ""));
        assert!(glob_match("*", ""));
        assert!(!glob_match("a*", ""));
    }

    #[test]
    fn glob_match_pathological_multi_star_does_not_blow_up() {
        // Regression for f-81b83eb0: the old recursive `inner()` tried
        // every split point per `*`, so a pattern with many `*`s against
        // a text with no valid match point (each `*` independently
        // re-explores the whole remaining text) was exponential in the
        // number of stars. This pattern/text pair — many `a*` runs
        // followed by a trailing literal that never appears in `text` —
        // is the classic pathological case for that algorithm shape and
        // would not complete in practical time under the old
        // implementation. The linear two-pointer match handles it in
        // microseconds regardless of star count.
        let pattern = format!("{}!", "a*".repeat(40));
        let text = "a".repeat(40);
        let start = std::time::Instant::now();
        let result = glob_match(&pattern, &text);
        let elapsed = start.elapsed();
        assert!(!result, "text has no '!' so this must not match");
        assert!(
            elapsed < std::time::Duration::from_millis(500),
            "glob_match must be linear, not exponential in star count; took {elapsed:?}"
        );
    }

    /// Test-only stand-in for `std::fs::DirEntry`, letting
    /// `dir_entry_iteration_error_is_skipped_not_dropped` inject a
    /// synthetic `Err` without needing to force a real `ReadDir::next()`
    /// failure (a genuine race, impractical to reproduce
    /// deterministically — see `collect_dir_entries`'s doc comment).
    struct FakeDirEntry(PathBuf);

    impl DirEntryPath for FakeDirEntry {
        fn entry_path(&self) -> PathBuf {
            self.0.clone()
        }
    }

    #[test]
    fn dir_entry_iteration_error_is_skipped_not_dropped() {
        let dir = PathBuf::from("/some/skills/dir");
        let entries: Vec<std::io::Result<FakeDirEntry>> = vec![
            Ok(FakeDirEntry(dir.join("alpha"))),
            Err(std::io::Error::other("entry vanished mid-iteration")),
            Ok(FakeDirEntry(dir.join("beta"))),
        ];
        let mut skipped = Vec::new();

        let entry_paths = collect_dir_entries(entries, &dir, &mut skipped, MAX_ENTRIES_PER_DIR);

        // The two good entries are not dropped alongside the bad one.
        assert_eq!(entry_paths, vec![dir.join("alpha"), dir.join("beta")]);
        // The iteration error produces a SkipEntry rather than vanishing
        // silently — this is the guarantee under test.
        assert_eq!(skipped.len(), 1);
        match &skipped[0] {
            SkipEntry {
                path,
                reason: SkipReason::IoError(detail),
            } => {
                assert_eq!(path, &dir);
                assert!(detail.contains("entry vanished mid-iteration"));
            }
            other => panic!("expected IoError SkipEntry attributed to the dir, got {other:?}"),
        }
        // The rendered message still starts with "SKIP " — consistent
        // with every other SkipReason (see model::SkipReason's doc
        // comment on the module's no-silent-drop guarantee).
        let message = crate::frontmatter::skip_reason_message(&skipped[0].path, &skipped[0].reason);
        assert!(message.starts_with("SKIP "));
    }
}
