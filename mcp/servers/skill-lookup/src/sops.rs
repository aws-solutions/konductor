// SPDX-License-Identifier: Apache-2.0
//
// sops.rs — agent-SOP scanning and the in-memory SOP index.
//
// Serves `.sop.md` files from the configured `--agent-sop-paths`
// directories as MCP prompts, mirroring a comparable SOP-delivery
// mechanism's `--agent-sop-paths`/`--agent-sop-filter` convention but for
// konductor's own external-facing server. It reuses the skill-lookup
// path's split of concerns — `cli.rs` decides *where* to scan
// (`resolve_agent_sop_paths`), this module builds the index over *what
// was scanned*, and `handlers.rs` answers the MCP `prompts/list` and
// `prompts/get` calls over that index — but a SOP is deliberately
// simpler than a skill:
//   - a SOP is a flat `<name>.sop.md` file directly in an
//     `--agent-sop-paths` directory, not a `<name>/SKILL.md`
//     subdirectory;
//   - it carries no frontmatter to parse — the prompt `name` is the
//     filename with the `.sop.md` suffix stripped, and the prompt
//     content is the file's raw text;
//   - the content is read fresh on each `get_prompt` (never cached),
//     the same way `get_skill` re-reads a skill body rather than
//     serving the startup snapshot.
//
// Symlink containment IS carried over from the skill scanner, not
// dropped as an over-simplification: a `<name>.sop.md` entry is
// canonicalized and rejected (as `SkipReason`-style stderr diagnostic)
// unless it resolves to a regular file *inside* the configured
// `--agent-sop-paths` root it was found under — otherwise a symlink
// could make `prompts/get` hand back the raw bytes of any file the
// server's user can read (`~/.ssh/id_rsa`, `/etc/passwd`, another
// package's files). `get_skill` accepts a residual after-scan TOCTOU
// window because the skill index has a `reload` tool to re-validate;
// the SOP index has no reload, so `get_prompt` additionally
// re-canonicalizes and re-checks containment on every call (see
// `handlers::get_prompt_by_name`) rather than trusting the startup
// snapshot for the lifetime of the process.
//
// Scope of the containment model: it defeats symlink-based escapes
// (`canonicalize` resolves the link, `starts_with` rejects an
// out-of-root target). It does NOT attempt to defend against a hardlink
// named `<name>.sop.md` sharing an inode with a file outside the root —
// such an entry canonicalizes to itself, inside the root, and passes.
// That vector is left to the OS: Linux `protected_hardlinks` (default
// since ~3.6) already blocks hardlinking to a file the user doesn't own,
// which is the same trust boundary `--agent-sop-paths` assumes.
//
// The `glob_match` here is a deliberate, in-scope reimplementation of
// the same `*`-wildcard matcher `skill_lookup_core::scanner` uses for
// `--skill-name-filter`. That core copy is `pub(crate)` + a private
// helper, unreachable from this crate, and this change is scoped to the
// `mcp/servers/skill-lookup/` server rather than to the shared core
// library — so the two implementations stay independent, the same way
// `frontmatter.rs` documents the intentional cli/mcp duplication of its
// own parser.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::MAX_SKILL_BODY_BYTES;

/// The `.sop.md` suffix a file must carry to be served as a SOP prompt.
/// The prompt `name` is the filename with exactly this suffix removed.
const SOP_SUFFIX: &str = ".sop.md";

/// Per-directory cap on how many raw directory entries `collect_sop_files`
/// will canonicalize and stat, mirroring
/// `skill_lookup_core::scanner::MAX_ENTRIES_PER_DIR` (same value, same
/// rationale: bounding enumeration memory and the per-entry
/// `canonicalize()` syscall cost against a hostile tree with
/// attacker-controlled fan-out under `--agent-sop-paths`). Applied to the
/// raw `read_dir` listing before any per-entry symlink/canonicalize work,
/// the same point in the pipeline the scanner's own `collect_dir_entries`
/// applies it — capping afterward would still pay the syscall cost this
/// exists to avoid.
const MAX_ENTRIES_PER_DIR: usize = 10_000;

/// One indexed agent SOP — metadata only. The raw body is never held
/// here: `get_prompt` re-reads it from `path` on each call (see this
/// module's doc comment), so the index carries just what
/// `prompts/list` advertises plus where to read the body from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SopRecord {
    /// The SOP's filename with the `.sop.md` suffix stripped. This is
    /// the prompt name advertised over MCP and matched (case-insensitively)
    /// by `get`.
    pub(crate) name: String,
    /// Canonicalized path to the `<name>.sop.md` file, resolved and
    /// containment-checked at scan time. Stored canonical (not the raw
    /// directory entry) so `get_prompt` reads the already-resolved
    /// target rather than re-following the original symlink.
    pub(crate) path: PathBuf,
    /// The canonicalized `--agent-sop-paths` root this SOP was found
    /// under. Always present — see `SopIndex::build`'s handling of an
    /// uncanonicalizable root — so `get_prompt` always has a real root
    /// to re-check `path` against on every call (see this module's doc
    /// comment for why that re-check exists).
    pub(crate) root: PathBuf,
}

/// The set of agent SOPs served as MCP prompts, built once at startup
/// from the configured `--agent-sop-paths` directories. Immutable after
/// construction: unlike the skill index there is no reload tool in this
/// change, so no interior mutability is needed.
#[derive(Clone, Debug, Default)]
pub(crate) struct SopIndex {
    /// Survivors of scan + filter + dedup, sorted by lowercased name so
    /// `prompts/list` output is deterministic regardless of directory
    /// iteration order.
    sops: Vec<SopRecord>,
}

impl SopIndex {
    /// Builds the index by scanning each already-validated directory in
    /// `dirs` (in order) for `*.sop.md` regular files, applying
    /// `filter`, and deduplicating by lowercased name.
    ///
    /// `dirs` is assumed already tilde-expanded, deduplicated, and
    /// validated (exists, is a directory) by `cli::resolve_agent_sop_paths`
    /// — this function does not re-check that, matching how
    /// `scanner::build_index` trusts `resolve_skills_dirs`' output.
    ///
    /// Collision policy is first-wins by scan order: the first directory
    /// (and, within a directory, the lexicographically-first filename by
    /// the sort below) to claim a lowercased name keeps it; a later
    /// duplicate is dropped and reported in the returned messages rather
    /// than silently discarded. Two filenames differing only in case
    /// share a lowercased sort key, so a secondary compare on the
    /// original spelling breaks that tie deterministically rather than
    /// leaving it to `read_dir`'s OS-dependent order.
    ///
    /// Dedup is two-layered, mirroring `scanner::scan_directory`'s own
    /// two mechanisms: this name-based layer catches two DIFFERENT
    /// on-disk files claiming the same (lowercased) prompt name; a
    /// separate canonical-target layer, applied per directory in the
    /// loop below, catches the opposite case — a symlink alias whose
    /// name differs but whose canonicalized target is a file ALREADY
    /// indexed under another name in the same directory (e.g.
    /// `zzz-alias.sop.md -> aaa-real.sop.md`). Without the target layer,
    /// both names would be indexed, silently serving one SOP body under
    /// two distinct MCP prompt names — the target layer keeps the
    /// sorted-first name as the sole owner, mirroring the skill
    /// scanner's own `seen_targets`/`DuplicateTarget` handling for the
    /// identical alias shape.
    ///
    /// Scope, same as its skill-scanner precedent: the target layer is
    /// reset per directory (see `dir_seen_targets` below), so it only
    /// catches an alias colliding with a target already indexed from
    /// the SAME `--agent-sop-paths` directory. A symlink in one
    /// configured directory pointing at a file also reachable (via a
    /// separate real entry or its own symlink) from a DIFFERENT
    /// configured directory — only possible with overlapping/nested
    /// `--agent-sop-paths` roots — is not caught by either dedup layer,
    /// so it can still be served under two prompt names. This mirrors
    /// `scan_directory`'s own per-directory `seen_targets` scope
    /// exactly, rather than being a gap unique to this port.
    ///
    /// Returns the index plus every warning collected along the way (an
    /// unreadable directory, a per-entry iteration error, a dropped
    /// collision) so `main` can emit them to stderr the same way
    /// `ScanDiagnostic::emit_to_stderr` surfaces skill-scan diagnostics —
    /// the "no silent drop" posture the skill path already takes.
    pub(crate) fn build(dirs: &[PathBuf], filter: &Option<String>) -> (Self, Vec<String>) {
        let mut messages = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut sops: Vec<SopRecord> = Vec::new();

        // Comma-separated glob patterns, trimmed and lowercased once —
        // matched case-insensitively against the (lowercased) SOP name,
        // exactly as `apply_name_filter` treats `--skill-name-filter`.
        let patterns: Option<Vec<String>> = filter
            .as_ref()
            .map(|f| f.split(',').map(|p| p.trim().to_lowercase()).collect());

        for dir in dirs {
            // Canonicalize the root once per directory so each candidate's
            // containment check compares canonical-against-canonical, the
            // same way `scanner::scan_directory` does. If the root can't
            // be canonicalized (e.g. removed between validation and this
            // scan), skip the whole directory with a message rather than
            // indexing its SOPs with an unverifiable root — failing closed,
            // because the no-reload SOP index has no later chance to
            // re-validate what a fail-open scan would let through.
            let canonical_root = match std::fs::canonicalize(dir) {
                Ok(root) => root,
                Err(e) => {
                    messages.push(format!(
                        "SKIP {}: cannot canonicalize --agent-sop-paths root ({e}) — no SOPs served from it",
                        dir.display()
                    ));
                    continue;
                }
            };
            let mut candidates =
                collect_sop_files(dir, &canonical_root, &mut messages, MAX_ENTRIES_PER_DIR);
            // Sort within the directory so "first file wins" a
            // same-lowercased-name collision is deterministic
            // (mirrors `scan_directory`'s sorted-order intra-dir
            // tiebreak), independent of `read_dir` order. The secondary
            // compare on the original spelling breaks a case-only tie
            // (e.g. `Foo.sop.md` vs `foo.sop.md`, equal lowercased keys)
            // so the winner isn't left to OS enumeration order.
            candidates.sort_by(|a, b| {
                a.0.to_lowercase()
                    .cmp(&b.0.to_lowercase())
                    .then_with(|| a.0.cmp(&b.0))
            });

            // Canonical-target dedup — see `build`'s doc comment above
            // for the full rationale and scope. A fresh map each time
            // through this loop, not shared across `for dir in dirs`.
            let mut dir_seen_targets: HashMap<PathBuf, String> = HashMap::new();

            for (name, path) in candidates {
                let name_lower = name.to_lowercase();
                if let Some(patterns) = &patterns {
                    if !patterns.iter().any(|p| glob_match(p, &name_lower)) {
                        // Excluded by the operator's own filter choice —
                        // not a drop worth a warning, matching how
                        // `apply_name_filter` silently excludes filtered
                        // skills.
                        continue;
                    }
                }
                if let Some(winning_name) = dir_seen_targets.get(&path) {
                    messages.push(format!(
                        "WARN duplicate SOP target: '{name}' resolves to the same file as \
                         prompt '{winning_name}' — keeping '{winning_name}' only"
                    ));
                    continue;
                }
                if !seen.insert(name_lower) {
                    messages.push(format!(
                        "WARN duplicate SOP name '{}' at {} — keeping first occurrence",
                        name,
                        path.display()
                    ));
                    continue;
                }
                dir_seen_targets.insert(path.clone(), name.clone());
                sops.push(SopRecord {
                    name,
                    path,
                    root: canonical_root.clone(),
                }); // canonical_root: PathBuf, cloned per surviving record
            }
        }

        sops.sort_by_key(|a| a.name.to_lowercase());
        (Self { sops }, messages)
    }

    /// The indexed SOPs, sorted by lowercased name. Backs `prompts/list`.
    pub(crate) fn list(&self) -> &[SopRecord] {
        &self.sops
    }

    /// Exact-name, case-insensitive lookup — the `prompts/get` counterpart
    /// of `SkillIndex::get`, so a prompt advertised as `Reload-Skills` is
    /// still fetchable as `reload-skills`. Returns `None` when no SOP
    /// matches.
    pub(crate) fn get(&self, name: &str) -> Option<&SopRecord> {
        let needle = name.to_lowercase();
        self.sops.iter().find(|s| s.name.to_lowercase() == needle)
    }
}

/// Reads `dir` and returns every `(name, canonical_path)` pair for a
/// `*.sop.md` file directly inside it that resolves to a regular file
/// *inside* `canonical_root` (name = filename minus the `.sop.md`
/// suffix; `canonical_path` is the resolved target). An unreadable
/// directory yields an empty vec plus a message rather than aborting the
/// whole scan.
///
/// Every rejected entry that is *not* simply "no such SOP" is reported
/// with a `SKIP <path>: ...` message (the same prefix
/// `skip_reason_message` uses, so an operator grepping `SKIP` catches
/// SOP skips too), never dropped via `.ok()` — matching the skill
/// scanner's "no silent drop" posture. The rejected cases, mirroring
/// `scanner::scan_directory`:
///   - a dangling symlink → `broken symlink`;
///   - a symlink (or plain entry) resolving to something that isn't a
///     regular file (a directory, fifo, socket) → `not a regular file`;
///   - a target that resolves outside `canonical_root` →
///     `escapes the configured --agent-sop-paths root` (the arbitrary-
///     file-read guard — without it a `<name>.sop.md` symlink could make
///     `prompts/get` return any file the server's user can read);
///   - a file whose size exceeds `MAX_SKILL_BODY_BYTES` → `file too
///     large`. Without this check the file would still be indexed and
///     advertised by `prompts/list`, then fail every subsequent
///     `prompts/get` call against the same cap enforced at fetch time
///     (`handlers::get_prompt_by_name`'s stat guard) — rejecting it here
///     instead keeps `prompts/list` limited to prompts that can actually
///     be fetched, mirroring `frontmatter::parse_frontmatter`'s
///     stat-before-read guard for skills.
///
/// A `.sop.md` entry that simply doesn't exist by the time it's read
/// (vanished mid-scan) is skipped silently — like the skill scanner's
/// `NotFound` handling, "nothing is there" is not a diagnosable skip.
///
/// `canonical_root` is the already-canonicalized root (the caller skips a
/// directory whose root can't be canonicalized before reaching here), so
/// containment is always enforced. Returns the surviving candidates; an
/// unreadable directory yields an empty vec plus a message rather than a
/// distinct sentinel, since the caller has nothing else to do with it.
///
/// `entry_cap` is threaded through to `collect_bounded_entry_paths` (the
/// caller passes `MAX_ENTRIES_PER_DIR` in production) rather than read
/// from the module constant directly, so a test can exercise a real cap
/// firing through this function without creating `MAX_ENTRIES_PER_DIR`
/// on-disk entries. `entry_cap` bounds every raw directory entry, not
/// just `.sop.md` candidates — a directory dominated by unrelated files
/// (scratch files, `.git`, editor artifacts) counts against the same
/// budget as real SOPs, the same characteristic `scanner::scan_directory`
/// has for `SKILL.md` scanning.
fn collect_sop_files(
    dir: &Path,
    canonical_root: &Path,
    messages: &mut Vec<String>,
    entry_cap: usize,
) -> Vec<(String, PathBuf)> {
    let mut candidates = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => {
            messages.push(format!("--agent-sop-paths {}: {e}", dir.display()));
            return candidates;
        }
    };

    for path in collect_bounded_entry_paths(entries, dir, messages, entry_cap) {
        let Some(file_name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(base) = file_name.strip_suffix(SOP_SUFFIX) else {
            continue;
        };
        if base.is_empty() {
            // A bare `.sop.md` with no name before the suffix isn't a SOP.
            continue;
        }

        // Distinguish "vanished" (silent) from a symlink whose target is
        // dangling/wrong-type (reported), the same split
        // `scanner::scan_directory` makes via `symlink_metadata`.
        let is_symlink = match path.symlink_metadata() {
            Ok(meta) => meta.file_type().is_symlink(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => {
                messages.push(format!("SKIP {}: {e}", path.display()));
                continue;
            }
        };

        let canonical = match std::fs::canonicalize(&path) {
            Ok(canonical) => canonical,
            Err(e) if is_symlink && e.kind() == std::io::ErrorKind::NotFound => {
                messages.push(format!("SKIP {}: broken symlink", path.display()));
                continue;
            }
            Err(e) => {
                messages.push(format!("SKIP {}: {e}", path.display()));
                continue;
            }
        };

        // A single `metadata()` call on the canonical target backs both
        // the regular-file check and the size check below, rather than
        // two separate stats (`Path::is_file()` plus a fresh
        // `fs::metadata()`).
        let metadata = match std::fs::metadata(&canonical) {
            Ok(metadata) => metadata,
            Err(e) => {
                messages.push(format!("SKIP {}: {e}", path.display()));
                continue;
            }
        };

        if !metadata.is_file() {
            messages.push(format!(
                "SKIP {}: exists but is not a regular file",
                path.display()
            ));
            continue;
        }

        if !canonical.starts_with(canonical_root) {
            messages.push(format!(
                "SKIP {}: symlink target {} escapes the configured --agent-sop-paths root",
                path.display(),
                canonical.display()
            ));
            continue;
        }

        // Reject an oversized `.sop.md` file at scan time — see this
        // function's doc comment for why: an oversized SOP that made it
        // into the index would be advertised by `prompts/list` and then
        // fail every `prompts/get` call against the same
        // `MAX_SKILL_BODY_BYTES` cap enforced at fetch time.
        if metadata.len() > MAX_SKILL_BODY_BYTES {
            messages.push(format!(
                "SKIP {}: file too large ({} bytes exceeds the {MAX_SKILL_BODY_BYTES}-byte limit)",
                path.display(),
                metadata.len()
            ));
            continue;
        }

        candidates.push((base.to_string(), canonical));
    }
    candidates
}

/// Bounds a raw `read_dir` listing to at most `limit` paths — the
/// lexicographically smallest `limit`, so a truncation is deterministic
/// regardless of `read_dir`'s OS-dependent order — before any per-entry
/// symlink/canonicalize work runs. A deliberate in-scope reimplementation
/// of `skill_lookup_core::scanner::collect_dir_entries`'s bounded max-heap
/// collection (kept independent for the same reason `glob_match` below
/// is: see this module's doc comment), specialized to the one concrete
/// entry type (`std::fs::ReadDir`) this crate ever scans, so it doesn't
/// need that function's generic `DirEntryPath` trait.
fn collect_bounded_entry_paths(
    entries: std::fs::ReadDir,
    dir: &Path,
    messages: &mut Vec<String>,
    limit: usize,
) -> Vec<PathBuf> {
    let mut heap: std::collections::BinaryHeap<PathBuf> = std::collections::BinaryHeap::new();
    let mut total = 0usize;

    for entry in entries {
        match entry {
            Ok(entry) => {
                total += 1;
                heap.push(entry.path());
                if heap.len() > limit {
                    // Evict the current largest — the heap never holds
                    // more than `limit` + 1 paths at any instant.
                    heap.pop();
                }
            }
            Err(e) => messages.push(format!("--agent-sop-paths {}: {e}", dir.display())),
        }
    }

    if total > limit {
        let dropped_count = total - limit;
        messages.push(format!(
            "--agent-sop-paths {}: too many entries ({dropped_count} entr{} beyond the {limit}-entry-per-directory cap were dropped)",
            dir.display(),
            if dropped_count == 1 { "y" } else { "ies" }
        ));
    }

    // `into_sorted_vec()` drains the heap in ascending order directly.
    heap.into_sorted_vec()
}

/// Minimal `*`-wildcard glob match: `*` matches any run of characters
/// (including none); every other byte must match literally. Both
/// `pattern` and `text` are expected already lowercased by the caller
/// (see `SopIndex::build`), so this is case-sensitive at this level.
///
/// A deliberate in-scope reimplementation of the identical linear
/// two-pointer matcher `skill_lookup_core::scanner::glob_match` uses for
/// `--skill-name-filter` — see this module's doc comment for why the two
/// are kept independent rather than shared. Linear (O(pattern * text)
/// worst case), never the exponential recursive-backtracking shape.
fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern = pattern.as_bytes();
    let text = text.as_bytes();

    let mut pattern_idx = 0;
    let mut text_idx = 0;
    let mut star_pattern_idx = usize::MAX;
    let mut star_text_idx = 0usize;

    while text_idx < text.len() {
        if pattern_idx < pattern.len() && pattern[pattern_idx] == b'*' {
            star_pattern_idx = pattern_idx;
            star_text_idx = text_idx;
            pattern_idx += 1;
        } else if pattern_idx < pattern.len() && pattern[pattern_idx] == text[text_idx] {
            pattern_idx += 1;
            text_idx += 1;
        } else if star_pattern_idx != usize::MAX {
            star_text_idx += 1;
            pattern_idx = star_pattern_idx + 1;
            text_idx = star_text_idx;
        } else {
            return false;
        }
    }

    pattern[pattern_idx..].iter().all(|&b| b == b'*')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skill-lookup-sops-test-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes a `<name>.sop.md` file with the given body directly under
    /// `dir` — the flat, no-subdirectory layout SOPs use.
    fn write_sop(dir: &Path, name: &str, body: &str) {
        fs::write(dir.join(format!("{name}.sop.md")), body).unwrap();
    }

    #[test]
    fn build_indexes_sop_files_stripping_the_suffix() {
        let dir = temp_dir("indexes");
        write_sop(&dir, "reload-skills", "Reload body.");
        write_sop(&dir, "adversarial-cr-review", "Review body.");

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        assert!(messages.is_empty(), "unexpected messages: {messages:?}");
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["adversarial-cr-review", "reload-skills"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_ignores_files_without_the_sop_suffix() {
        let dir = temp_dir("ignores-non-sop");
        write_sop(&dir, "real", "body");
        fs::write(dir.join("README.md"), "not a sop").unwrap();
        fs::write(dir.join("notes.txt"), "not a sop").unwrap();
        fs::write(dir.join("SKILL.md"), "not a sop").unwrap();

        let (index, _messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["real"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_ignores_a_bare_suffix_with_no_name() {
        // A file literally named `.sop.md` has no name before the suffix
        // and must not be indexed as an empty-named prompt.
        let dir = temp_dir("bare-suffix");
        fs::write(dir.join(".sop.md"), "no name").unwrap();
        write_sop(&dir, "real", "body");

        let (index, _messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["real"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_reports_a_subdirectory_named_like_a_sop_as_not_regular() {
        // A directory named `foo.sop.md` is not a regular file. It is
        // excluded from the index AND reported (not silently dropped),
        // mirroring the skill scanner's `NotRegularFile` diagnostic for a
        // non-regular SKILL.md.
        let dir = temp_dir("subdir-named-sop");
        fs::create_dir_all(dir.join("fake.sop.md")).unwrap();
        write_sop(&dir, "real", "body");

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["real"]);
        assert!(
            messages
                .iter()
                .any(|m| m.contains("fake.sop.md") && m.contains("not a regular file")),
            "a non-regular .sop.md must be reported, not silently dropped: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_rejects_an_oversized_sop_file_and_reports_it() {
        // A `.sop.md` file whose size exceeds `MAX_SKILL_BODY_BYTES` must
        // be rejected at scan time, not indexed — otherwise it would be
        // advertised by `prompts/list` and then fail every `prompts/get`
        // call against the same cap enforced at fetch time
        // (`handlers::get_prompt_by_name`'s stat guard). Mirrors the
        // skill scanner's `parse_frontmatter` stat-before-read guard.
        let dir = temp_dir("oversized-sop");
        let padding = "x".repeat((MAX_SKILL_BODY_BYTES as usize) + 1);
        write_sop(&dir, "huge", &padding);
        write_sop(&dir, "real", "body");

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["real"],
            "an oversized .sop.md must not be indexed: {names:?}"
        );
        assert!(index.get("huge").is_none());
        assert!(
            messages
                .iter()
                .any(|m| m.contains("huge.sop.md") && m.contains("file too large")),
            "the oversized file must be reported, not silently dropped: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_indexes_a_sop_file_exactly_at_the_size_limit() {
        // A file exactly at `MAX_SKILL_BODY_BYTES` must still be indexed
        // — the guard rejects files that exceed the limit, not files at
        // it, mirroring `parse_frontmatter`'s own boundary behavior.
        let dir = temp_dir("at-size-limit");
        let padding = "x".repeat(MAX_SKILL_BODY_BYTES as usize);
        write_sop(&dir, "at-limit", &padding);
        assert_eq!(
            fs::metadata(dir.join("at-limit.sop.md")).unwrap().len(),
            MAX_SKILL_BODY_BYTES,
            "test setup must produce a file exactly at the limit"
        );

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        assert!(messages.is_empty(), "unexpected messages: {messages:?}");
        assert!(index.get("at-limit").is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_applies_the_glob_filter() {
        let dir = temp_dir("filter");
        write_sop(&dir, "keep-me", "body");
        write_sop(&dir, "keep-also", "body");
        write_sop(&dir, "drop-me", "body");

        let (index, _messages) =
            SopIndex::build(std::slice::from_ref(&dir), &Some("keep-*".to_string()));
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["keep-also", "keep-me"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_filter_is_case_insensitive() {
        let dir = temp_dir("filter-case");
        write_sop(&dir, "Reload-Skills", "body");

        let (index, _messages) =
            SopIndex::build(std::slice::from_ref(&dir), &Some("reload-*".to_string()));
        assert_eq!(index.list().len(), 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_filter_supports_comma_separated_patterns_with_trim() {
        let dir = temp_dir("filter-comma");
        write_sop(&dir, "alpha", "body");
        write_sop(&dir, "beta", "body");
        write_sop(&dir, "gamma", "body");

        let (index, _messages) = SopIndex::build(
            std::slice::from_ref(&dir),
            &Some(" alpha , beta ".to_string()),
        );
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta"]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_deduplicates_across_dirs_first_dir_wins_and_reports_it() {
        let dir_a = temp_dir("dedup-a");
        let dir_b = temp_dir("dedup-b");
        write_sop(&dir_a, "shared", "From A.");
        write_sop(&dir_b, "shared", "From B.");

        let (index, messages) = SopIndex::build(&[dir_a.clone(), dir_b.clone()], &None);
        assert_eq!(index.list().len(), 1);
        // The first directory's copy is the one kept. The stored path is
        // canonical, so compare against the canonicalized dir_a rather
        // than dir_a's possibly-non-canonical spelling.
        let canonical_a = std::fs::canonicalize(&dir_a).unwrap();
        assert!(index.get("shared").unwrap().path.starts_with(&canonical_a));
        assert_eq!(
            messages.len(),
            1,
            "expected one collision message: {messages:?}"
        );
        assert!(
            messages[0].contains("duplicate SOP name 'shared'"),
            "got: {}",
            messages[0]
        );
        let _ = fs::remove_dir_all(&dir_a);
        let _ = fs::remove_dir_all(&dir_b);
    }

    /// Probes whether `dir`'s filesystem treats file names as
    /// case-sensitive. `build_case_only_collision_first_wins_deterministically`
    /// below needs two ACTUALLY DISTINCT on-disk files whose stripped
    /// names differ only in case — on a case-insensitive filesystem
    /// (e.g. macOS's default APFS/HFS+; `#[cfg(unix)]` does not rule
    /// this out, since macOS is unix too) the second `write_sop` below
    /// would silently overwrite the first, leaving only one file on
    /// disk and no real collision to exercise. Unlike the equivalent
    /// skill-scanner test, a SOP's name IS its filename (there is no
    /// separate frontmatter field to carry the case difference instead —
    /// see `same_dir_case_only_collision_first_wins_second_skipped` in
    /// `scanner.rs`, which sidesteps the problem that way), so detecting
    /// and skipping is the only option here.
    fn fs_is_case_sensitive(dir: &Path) -> bool {
        let probe = dir.join("__CaSe_PrObE__");
        fs::write(&probe, "x").unwrap();
        let lower_exists = dir.join("__case_probe__").exists();
        let _ = fs::remove_file(&probe);
        !lower_exists
    }

    #[test]
    fn build_case_only_collision_first_wins_deterministically() {
        // Two distinct on-disk filenames whose stripped names differ only
        // in case collide on the lowercased key. The secondary compare on
        // the original spelling breaks the tie deterministically: `Shared`
        // (uppercase `S`, 0x53) sorts before `shared` (0x73) in byte
        // order, so `Shared` wins regardless of `read_dir` order.
        let dir = temp_dir("case-collision");
        if !fs_is_case_sensitive(&dir) {
            // See `fs_is_case_sensitive`'s doc comment: on this
            // filesystem the two writes below collapse to one file, so
            // there is no real collision to assert against here.
            let _ = fs::remove_dir_all(&dir);
            return;
        }
        write_sop(&dir, "Shared", "From Shared.");
        write_sop(&dir, "shared", "From shared.");

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        assert_eq!(index.list().len(), 1);
        assert_eq!(
            index.get("shared").unwrap().name,
            "Shared",
            "the byte-order-first spelling must win the case-only tie deterministically"
        );
        assert_eq!(
            messages.len(),
            1,
            "expected one collision message: {messages:?}"
        );
        assert!(messages[0].contains("duplicate SOP name"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_skips_a_dir_whose_root_cannot_be_canonicalized_and_reports_it() {
        // A directory whose root can't be canonicalized (here: nonexistent
        // — a dir can vanish between the caller's validation and this scan)
        // is skipped wholesale with a message, so nothing from it is
        // indexed with an unverifiable root. Any other valid directory is
        // still scanned. This is the fail-closed posture that keeps every
        // indexed SopRecord carrying a real root for the get-time
        // containment re-check to enforce.
        let good = temp_dir("unreadable-good");
        write_sop(&good, "real", "body");
        let missing = PathBuf::from("/definitely/does/not/exist/anywhere");

        let (index, messages) = SopIndex::build(&[missing.clone(), good.clone()], &None);
        assert_eq!(index.list().len(), 1, "the good dir's SOP must still index");
        assert!(
            messages
                .iter()
                .any(|m| m.contains("cannot canonicalize --agent-sop-paths root")),
            "expected a fail-closed skip message for the uncanonicalizable root: {messages:?}"
        );
        let _ = fs::remove_dir_all(&good);
    }

    #[test]
    fn build_with_no_dirs_is_empty() {
        let (index, messages) = SopIndex::build(&[], &None);
        assert!(index.list().is_empty());
        assert!(messages.is_empty());
    }

    #[test]
    fn get_is_case_insensitive_and_none_for_unknown() {
        let dir = temp_dir("get-case");
        write_sop(&dir, "ReloadSkills", "body");
        let (index, _messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        assert!(index.get("reloadskills").is_some());
        assert!(index.get("RELOADSKILLS").is_some());
        assert_eq!(index.get("reloadskills").unwrap().name, "ReloadSkills");
        assert!(index.get("does-not-exist").is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_is_sorted_deterministically_by_name() {
        let dir = temp_dir("list-sorted");
        for name in ["zeta", "alpha", "mu", "beta"] {
            write_sop(&dir, name, "body");
        }
        let (index, _messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "beta", "mu", "zeta"]);
        let _ = fs::remove_dir_all(&dir);
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
    fn glob_match_supports_multiple_stars_and_empty() {
        assert!(glob_match("*foo*bar*", "xxfooyybarzz"));
        assert!(glob_match("a*b*c*d", "aXbYcZd"));
        assert!(!glob_match("a*b*c*d", "aXbYcZ"));
        assert!(glob_match("**", "anything"));
        assert!(glob_match("*", ""));
        assert!(!glob_match("a*", ""));
    }

    #[test]
    fn glob_match_pathological_multi_star_does_not_blow_up() {
        // This copy of `glob_match` is deliberately independent of the
        // skill scanner's (see the module doc comment). It uses the same
        // linear two-pointer algorithm, so it is not vulnerable to the
        // exponential blowup a recursive backtracking matcher would hit
        // on many `*`s against a no-match text — but since the two
        // implementations are maintained separately, this guards the SOP
        // copy against a future edit reintroducing that behavior.
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

    // ── per-directory entry cap ────────────────────────────────────────

    #[test]
    fn collect_bounded_entry_paths_is_a_noop_under_the_limit() {
        let dir = temp_dir("entry-cap-under");
        write_sop(&dir, "a", "body");
        write_sop(&dir, "b", "body");

        let mut messages = Vec::new();
        let paths =
            collect_bounded_entry_paths(fs::read_dir(&dir).unwrap(), &dir, &mut messages, 10);
        assert_eq!(paths.len(), 2);
        assert!(messages.is_empty(), "unexpected messages: {messages:?}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_bounded_entry_paths_keeps_the_smallest_paths_and_reports_the_drop() {
        // Bounds how many entries proceed to per-entry `canonicalize()`
        // after `read_dir` enumeration, so a hostile-fan-out directory
        // cannot force unbounded syscalls. With a cap of 2 over 3
        // candidates, only the lexicographically smallest 2 survive, and
        // the drop is reported rather than silently discarded.
        let dir = temp_dir("entry-cap-over");
        write_sop(&dir, "aaa", "body");
        write_sop(&dir, "bbb", "body");
        write_sop(&dir, "ccc", "body");

        let mut messages = Vec::new();
        let paths =
            collect_bounded_entry_paths(fs::read_dir(&dir).unwrap(), &dir, &mut messages, 2);
        assert_eq!(paths.len(), 2, "cap must bound the survivor count");
        let names: Vec<String> = paths
            .iter()
            .map(|p| p.file_name().unwrap().to_str().unwrap().to_string())
            .collect();
        assert_eq!(
            names,
            vec!["aaa.sop.md".to_string(), "bbb.sop.md".to_string()],
            "the two lexicographically smallest paths must survive, deterministically"
        );
        assert!(
            messages
                .iter()
                .any(|m| m.contains("too many entries") && m.contains("1 entry ")),
            "the dropped entry must be reported, not silently discarded: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn collect_sop_files_truncates_through_the_real_wiring_not_just_the_helper() {
        // Verifies truncation through `collect_sop_files`'s real production
        // wiring, not just the standalone `collect_bounded_entry_paths`
        // helper — `entry_cap` is a real parameter (not a hardcoded module
        // constant) specifically so a test can pass a small cap and
        // observe a real truncation through the actual call path a caller
        // uses.
        let dir = temp_dir("entry-cap-real-wiring");
        write_sop(&dir, "aaa-real", "kept");
        write_sop(&dir, "zzz-dropped", "must be truncated by the cap");
        let canonical_root = fs::canonicalize(&dir).unwrap();

        let mut messages = Vec::new();
        let candidates = collect_sop_files(&dir, &canonical_root, &mut messages, 1);
        assert_eq!(
            candidates.len(),
            1,
            "the cap must truncate the raw listing before either file is parsed as a SOP"
        );
        assert_eq!(candidates[0].0, "aaa-real");
        assert!(
            messages
                .iter()
                .any(|m| m.contains("too many entries") && m.contains("1 entry ")),
            "the truncated file must be reported, not silently dropped: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // ── symlink containment (arbitrary-file-read guard) ──────────────

    #[cfg(unix)]
    #[test]
    fn build_rejects_a_sop_symlink_escaping_the_root() {
        // A `<name>.sop.md` symlink whose target resolves OUTSIDE the
        // configured --agent-sop-paths root must be rejected, not indexed
        // — otherwise `prompts/get` would hand back the raw bytes of any
        // file the server's user can read. Mirrors the skill scanner's
        // `symlink_escaping_the_skills_dir_root_is_skipped_not_indexed`.
        let dir = temp_dir("symlink-escape-root");
        let outside = temp_dir("symlink-escape-outside");
        let secret = outside.join("secret.txt");
        fs::write(&secret, "SENSITIVE CONTENTS").unwrap();
        std::os::unix::fs::symlink(&secret, dir.join("leak.sop.md")).unwrap();
        write_sop(&dir, "real", "body");

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["real"],
            "an out-of-root .sop.md symlink must not be indexed"
        );
        assert!(index.get("leak").is_none());
        assert!(
            messages
                .iter()
                .any(|m| m.contains("leak.sop.md") && m.contains("escapes the configured")),
            "the escape must be reported, not silently dropped: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&outside);
    }

    #[cfg(unix)]
    #[test]
    fn build_deduplicates_a_sop_symlink_alias_to_an_already_indexed_target() {
        // A symlink whose target stays inside the same root (an in-repo
        // alias) is not rejected as an escape — but nor is it indexed as
        // a second prompt: `aaa-real.sop.md` and `zzz-alias.sop.md` both
        // canonicalize to the SAME file, and only the sorted-first name
        // ("aaa-real") survives. Dedup in `build` is keyed on the
        // lowercased NAME (`seen`), which does not by itself catch two
        // DIFFERENT names resolving to the same canonical target — that
        // is exactly what `dir_seen_targets` (the per-directory
        // canonical-target layer) exists to catch, and this test fails
        // if that layer is ever removed (`index.list()` would then
        // report 2, not 1, and `zzz-alias` would incorrectly resolve).
        let dir = temp_dir("symlink-within-root");
        write_sop(&dir, "aaa-real", "The real body.");
        std::os::unix::fs::symlink(dir.join("aaa-real.sop.md"), dir.join("zzz-alias.sop.md"))
            .unwrap();

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        assert_eq!(
            index.list().len(),
            1,
            "the alias must not be indexed as a second prompt: {:?}",
            index.list().iter().map(|s| &s.name).collect::<Vec<_>>()
        );
        assert!(index.get("aaa-real").is_some());
        assert!(
            index.get("zzz-alias").is_none(),
            "the alias name must not resolve to a second prompt"
        );
        assert!(
            messages
                .iter()
                .any(|m| m.contains("zzz-alias") && m.contains("same file as prompt 'aaa-real'")),
            "the collapsed alias must be reported, not silently dropped: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn build_reports_a_dangling_sop_symlink_as_broken() {
        // A `<name>.sop.md` symlink whose target does not exist is
        // reported as broken, not silently dropped — mirroring the skill
        // scanner's `dangling_skill_md_symlink_is_reported_not_silently_dropped`.
        let dir = temp_dir("symlink-dangling");
        std::os::unix::fs::symlink(dir.join("nope.txt"), dir.join("broken.sop.md")).unwrap();
        write_sop(&dir, "real", "body");

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["real"]);
        assert!(
            messages
                .iter()
                .any(|m| m.contains("broken.sop.md") && m.contains("broken symlink")),
            "a dangling .sop.md symlink must be reported: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn build_reports_a_sop_symlink_to_a_directory_as_not_regular() {
        // A symlink whose target exists but is a directory (not a regular
        // file) is reported as not-regular, not as broken — mirroring the
        // skill scanner's `skill_md_symlink_to_existing_directory_is_not_reported_as_broken`.
        let dir = temp_dir("symlink-to-dir");
        let target_dir = dir.join("a-real-dir");
        fs::create_dir_all(&target_dir).unwrap();
        std::os::unix::fs::symlink(&target_dir, dir.join("dirlink.sop.md")).unwrap();
        write_sop(&dir, "real", "body");

        let (index, messages) = SopIndex::build(std::slice::from_ref(&dir), &None);
        let names: Vec<&str> = index.list().iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["real"]);
        assert!(
            messages
                .iter()
                .any(|m| m.contains("dirlink.sop.md") && m.contains("not a regular file")),
            "a symlink to a directory must be reported as not-regular: {messages:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
