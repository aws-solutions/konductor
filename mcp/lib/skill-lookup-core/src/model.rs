// SPDX-License-Identifier: Apache-2.0
//
// model.rs — data model for the skill index: `SkillRecord`, `Provenance`,
// `SkipReason`, and the diagnostic types the scanner produces.
//
// This module holds pure data types only. Directory traversal,
// frontmatter parsing, and collision resolution live in `scanner.rs`
// and `frontmatter.rs`.

use std::path::PathBuf;

/// One successfully-indexed skill.
///
/// `name` keeps the casing read from frontmatter as-is. The index keys
/// entries by a separate lowercased string (see `scanner::build_index`),
/// so lookups are case-insensitive without losing the original casing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkillRecord {
    /// Canonical casing, as read from the `name` frontmatter field.
    pub name: String,
    pub description: String,
    /// Empty if the `tags` field was absent from frontmatter.
    pub tags: Vec<String>,
    /// `None` if the `version` field was absent from frontmatter.
    pub version: Option<String>,
    /// Size, in bytes, of the `SKILL.md` file this record was read from.
    /// Lets a caller budget context before reading the full body.
    ///
    /// Always `<= frontmatter::MAX_SKILL_FILE_BYTES`: the scanner stats
    /// the file before reading it and rejects anything over that cap as
    /// `SkipReason::OversizedSkillFile`, so a record here always came
    /// from a file that was fully read.
    pub size_bytes: u64,
    /// Absolute path to the skill's `SKILL.md` file.
    pub path: PathBuf,
    /// Which `--skills-dir` (by position) this skill was found under.
    pub provenance: Provenance,
    /// Whether this skill's `SKILL.md` is a file the Konductor CLI
    /// installer itself wrote, per the sibling install manifest
    /// (`<skills-dir>/../manifest` -- see `install_manifest.rs`).
    ///
    /// This is a DIFFERENT axis from `provenance` above: `provenance`
    /// says which `--skills-dir` root a skill was found under (managed
    /// vs. workspace); `installed_by_konductor` says whether THIS
    /// specific skill within that root was actually written by a
    /// konductor install, as opposed to a hand-authored or third-party
    /// skill directory sitting alongside konductor-installed ones in
    /// the SAME root (konductor's own installer merges into
    /// `.konductor/skills/` rather than replacing it wholesale, so the
    /// two kinds of content coexist side by side; root position alone
    /// cannot tell them apart).
    ///
    /// Computed once per `--skills-dir` root in `scanner::build_index`
    /// (see `scanner::mark_konductor_installed`), after `scan_directory`
    /// has already produced the record with a provisional `false`.
    /// `false` for a hand-authored/third-party skill, and also `false`
    /// (fail-open) whenever the sibling manifest is missing,
    /// unreadable, or malformed -- see `install_manifest.rs`'s module
    /// doc comment for why failing open here is the safe default.
    ///
    /// This is the discriminator `scanner::apply_name_filter` uses to
    /// scope `--skill-name-filter` to konductor's own skills only,
    /// leaving every other skill in the same root untouched regardless
    /// of the filter value.
    pub installed_by_konductor: bool,
}

/// Trust provenance, derived from which `--skills-dir` a skill was found
/// in: the first directory in argument order is treated as the managed/
/// installed root; any later directory is a workspace-local root.
///
/// Assigned once, from a directory's position in the *requested* list,
/// and then carried on the `ResolvedDir` for the rest of the pipeline.
/// It is deliberately not re-derived from a later, filtered list's
/// positions: the managed root not existing yet is the normal state
/// before anything has been installed, and re-deriving would then make
/// whatever workspace-local root happens to sort first inherit
/// `Managed` — the strongest trust label in this enum — purely because
/// the root above it was dropped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provenance {
    /// First `--skills-dir` in argument order (the managed/installed
    /// directory).
    Managed,
    /// Any subsequent `--skills-dir` (project-local workspace
    /// directories).
    Workspace,
}

/// One skills-dir root to scan, paired with the provenance its position
/// in the requested `--skills-dir` order earns it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedDir {
    pub path: PathBuf,
    pub provenance: Provenance,
}

impl ResolvedDir {
    /// A managed/installed root — the first requested directory.
    pub fn managed(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            provenance: Provenance::Managed,
        }
    }

    /// A workspace-local root — any requested directory after the first.
    pub fn workspace(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            provenance: Provenance::Workspace,
        }
    }
}

/// Why a would-be skill directory was not indexed.
///
/// Every variant must correspond to a `SKIP <path>: ...` message: an
/// unindexable skill is always explained, never dropped silently. See
/// `frontmatter::skip_reason_message` for how each variant renders.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SkipReason {
    /// The `name` field was absent (or explicitly `null`) from
    /// frontmatter.
    MissingName,
    /// The `description` field was absent (or explicitly `null`) from
    /// frontmatter.
    MissingDescription,
    /// `name` was present but blank/whitespace-only after trimming.
    EmptyName,
    /// A frontmatter field held a YAML value of the wrong shape (e.g.
    /// `name` was a list, `tags` was a string). An integer or boolean
    /// scalar for `name`/`description`/`version` is coerced to a string
    /// instead of triggering this — only a list or a mapping where a
    /// scalar belongs counts as the wrong shape. A float scalar is a
    /// different case entirely (see `UnquotedFloatScalar`): it's the
    /// right shape, but coercing it would silently corrupt the value.
    /// The payload names the field and the expected vs. actual type.
    FieldTypeMismatch(String),
    /// An unquoted decimal scalar was given for `name`, `description`,
    /// or `version` (e.g. `version: 1.10`). By the time this code sees
    /// the value, `serde_yaml` has already parsed it as an `f64`, and
    /// that parse is lossy: `1.10` and `1.1` become the same `f64` and
    /// so the same string, with no way to recover the original text.
    /// Coercing it the way an integer or boolean scalar is coerced would
    /// silently produce a wrong value, so this is rejected instead. The
    /// payload names the field and instructs the author to quote the
    /// value so YAML reads it as a string.
    UnquotedFloatScalar(String),
    /// The frontmatter region was present (two `---` delimiters were
    /// found) but did not parse as valid YAML, or did not resolve to a
    /// mapping. The payload carries the underlying parse error.
    MalformedYaml(String),
    /// Fewer than two `---` delimiter lines were found in the file, so no
    /// frontmatter region could be extracted at all.
    NoFrontmatterDelimiters,
    /// An I/O error occurred while canonicalizing a directory entry or
    /// reading a file (permissions, vanished-between-list-and-read,
    /// etc). The payload carries the underlying error description.
    IoError(String),
    /// The file's bytes were not valid UTF-8.
    NonUtf8,
    /// `SKILL.md`'s on-disk size, per `fs::metadata` (checked before any
    /// read), exceeded `frontmatter::MAX_SKILL_FILE_BYTES`. The payload
    /// carries the actual size and the limit, so the skip is as
    /// debuggable as every other `SkipReason`.
    OversizedSkillFile { actual_bytes: u64, limit_bytes: u64 },
    /// A directory had more entries than `scanner::MAX_ENTRIES_PER_DIR`.
    /// Entries beyond the cap (in sorted order — see `scan_directory`)
    /// were never processed. The payload carries how many were dropped
    /// and the limit that was applied, attributed to the directory
    /// itself rather than to any one dropped entry.
    TooManyEntries { dropped_count: usize, limit: usize },
    /// A symlink whose target could not be resolved (`canonicalize()`
    /// failed with the target not found — a dangling target). Applies
    /// both to a directory entry that is itself a dangling symlink, and
    /// to a skill directory's `SKILL.md` file when that is a dangling
    /// symlink; both cases are reported the same way rather than one of
    /// them being silently dropped.
    BrokenSymlink,
    /// A skill directory's `SKILL.md` exists but is not a regular file —
    /// it's a directory, fifo, socket, etc., either directly or through a
    /// symlink. Distinct from `BrokenSymlink`: nothing is dangling here,
    /// the entry simply isn't the kind of thing this scanner can read as
    /// a skill file.
    ///
    /// Scoped to `SKILL.md` only. A top-level directory *entry* that
    /// resolves to something other than a directory (a plain `README.md`
    /// sitting in a skills root, say) is not reported at all — it's an
    /// ordinary non-skill, handled the same way a subdirectory with no
    /// `SKILL.md` is.
    NotRegularFile,
    /// The entry was a symlink, and canonicalizing it failed for a
    /// reason distinct from a simply-dangling target (e.g. a loop
    /// detected partway through resolution). The payload carries the
    /// underlying error description.
    SymlinkResolutionFailed(String),
    /// The entry's canonicalized path was already indexed once this scan
    /// (a symlink pointing at an already-visited target). The payload is
    /// the *earlier* entry's own path — the one that claimed the target
    /// first — not the shared target both resolve to, so the message can
    /// point an operator at the entry they still have indexed.
    DuplicateTarget(PathBuf),
    /// Two entries in the *same* `--skills-dir` produced the same
    /// lowercased name (e.g. `Foo/` and `foo/`); this entry lost the
    /// tiebreak. The payload is the path of the entry that won.
    IntraDirCaseCollision(PathBuf),
    /// The entry's canonicalized path, or its `SKILL.md` file's own
    /// canonicalized path, resolves outside the configured
    /// `--skills-dir` root it was found under. The payload is that
    /// out-of-root canonicalized target. Rejected rather than indexed,
    /// since an unbounded symlink target would let a skill directory —
    /// or just its `SKILL.md` — point anywhere on the filesystem the
    /// process can read.
    SymlinkEscapesRoot(PathBuf),
}

/// A single skipped directory/file, paired with why it was skipped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SkipEntry {
    pub path: PathBuf,
    pub reason: SkipReason,
}

/// A single cross-directory name collision: `winning_path` was indexed,
/// `losing_path` was not (first `--skills-dir` in argument order wins).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CollisionEntry {
    pub name: String,
    pub winning_path: PathBuf,
    pub losing_path: PathBuf,
}

/// Summary of a full scan across all configured `--skills-dir` roots.
///
/// Backs the "no silent drop" guarantee at three points: an immediate
/// `emit_to_stderr()` at startup/reload (which also persists the same
/// lines to `~/.konductor/mcp/logs/` — see that method's doc
/// comment), translation into a wire-level diagnostic returned from an
/// explicit `reload_skills` call (the consuming server's job, not this
/// crate's), and the persistent log file itself as a channel a human
/// operator can inspect after the fact, independent of either of the
/// other two.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct ScanDiagnostic {
    /// Number of skills successfully indexed (before any post-scan name
    /// filter is applied).
    pub indexed_count: usize,
    /// Number of `--skills-dir` roots that were actually scanned (i.e.
    /// excluding ones that failed startup validation).
    pub dir_count: usize,
    pub skipped: Vec<SkipEntry>,
    pub collisions: Vec<CollisionEntry>,
    /// `--skills-dir` roots whose own `read_dir` failed (permission
    /// denied, vanished between validation and scan, etc.) — distinct
    /// from `skipped`, which covers failures for individual files
    /// *within* a root that opened successfully. Each entry is `(root
    /// path, underlying I/O error text)`. An
    /// unreadable scan root logs at `error`, not `warn`.
    pub root_errors: Vec<(PathBuf, String)>,
}

impl ScanDiagnostic {
    /// Emits a human-readable summary of this scan to stderr: one line
    /// per skip (`SKIP <path>: <reason>` — an intra-directory case
    /// collision is a `SkipReason` like any other), one line per
    /// cross-directory collision (`WARN name collision: ...`), one line
    /// per unreadable scan root (`ERROR skills directory unreadable:
    /// ...`), and a final summary line. Cheap, and run unconditionally
    /// at startup so "no silent drop" has an always-on channel.
    ///
    /// Kept deliberately alongside the persistent log rather than
    /// replaced by it: stderr is
    /// invisible to an end user in an agent runtime (kiro-cli, Claude
    /// Code capture and discard MCP child-process stderr) — which is why
    /// the persistent file exists at all — but it remains the fastest
    /// signal for a developer running this binary directly (manual
    /// testing, CI, a plain shell `2>` redirect), and this is exactly
    /// what `initialize_handshake.rs`'s integration tests assert against
    /// today. Removing it would trade that direct-invocation channel for
    /// nothing the persistent file doesn't already cover.
    ///
    /// Each line is also written to the persistent log
    /// (`crate::logging::log_file_only`: skips/collisions at
    /// `warn`, the summary at `info`) using the exact same message text
    /// as the stderr line — this is the file-logging half of the same
    /// event, not a second, independently-worded copy. Deliberately
    /// `log_file_only`, not `log`: this method already has its own,
    /// separately-tested `eprintln!` output (see
    /// `initialize_handshake.rs`'s stderr assertions), so routing
    /// through `crate::logging::log` too would print every line to
    /// stderr twice, once in each format.
    ///
    /// The skip lines and the collision lines are each written to the
    /// file as ONE combined, newline-joined `log_file_only` call (not
    /// one call per line): this method can run against a live server
    /// mid-`reload_skills`, concurrently with other tool calls that also
    /// log (or with a second MCP server sharing the same log directory —
    /// see `logging.rs`'s own top doc comment), so N independent writes
    /// for what is meant to read as one coherent report risks an
    /// unrelated line landing in the middle of it. A single
    /// `write_all` per block is not just fewer syscalls; each one lands
    /// as one indivisible write to an append-mode file descriptor
    /// (POSIX `O_APPEND`), so nothing else can interleave inside a
    /// block. Stderr keeps its original one-`eprintln!`-per-line shape
    /// unchanged, matching what `initialize_handshake.rs` already
    /// asserts against — this restructuring is file-side only.
    ///
    /// `filtered_out` is how many of `indexed_count` were then removed by
    /// `--skill-name-filter` (0 when no filter is active). The summary
    /// line always reports the same *effective* count the index actually
    /// serves — matching `indexed` in `reload_skills`' JSON response —
    /// rather than `indexed_count`, which is the raw pre-filter figure.
    /// When `filtered_out` is 0 the line keeps its original wording; a
    /// filter removing nothing (an inactive or fully-matching filter)
    /// must not be conflated with a filter that *is* dropping entries.
    pub fn emit_to_stderr(&self, filtered_out: usize) {
        let mut skip_messages = Vec::with_capacity(self.skipped.len());
        for skip in &self.skipped {
            let message = crate::frontmatter::skip_reason_message(&skip.path, &skip.reason);
            eprintln!("skill-lookup-mcp: {message}");
            skip_messages.push(message);
        }
        crate::logging::log_file_only_lines(crate::logging::Level::Warn, &skip_messages);

        let mut collision_messages = Vec::with_capacity(self.collisions.len());
        for collision in &self.collisions {
            // `message` carries no embedded level token: `log_file_only_lines`
            // below prepends the level itself when persisting, so a message
            // that also carried its own leading level text would render as a
            // doubled token (e.g. `WARN WARN ...`) in the log file. The `WARN `
            // prefix therefore lives only in the `eprintln!` format string,
            // which is stderr-only and not subject to that second prepend.
            let message = format!(
                "name collision: '{}' at {} shadows {} — keeping first occurrence",
                collision.name,
                collision.winning_path.display(),
                collision.losing_path.display()
            );
            eprintln!("skill-lookup-mcp: WARN {message}");
            collision_messages.push(message);
        }
        crate::logging::log_file_only_lines(crate::logging::Level::Warn, &collision_messages);

        // A root_error means the whole `--skills-dir` root never opened at
        // all — a different, more severe case than any entry in `skipped`
        // (which are all failures *within* a root that DID open). An
        // unreadable root logs at `error`, not `warn`, and is
        // written as its own separate call rather than folded into the
        // skip block above.
        let mut root_error_messages = Vec::with_capacity(self.root_errors.len());
        for (path, detail) in &self.root_errors {
            let message = format!(
                "skills directory unreadable, no skills indexed from it: '{}': {detail}",
                path.display()
            );
            eprintln!("skill-lookup-mcp: ERROR {message}");
            root_error_messages.push(message);
        }
        crate::logging::log_file_only_lines(crate::logging::Level::Error, &root_error_messages);

        let effective_count = self.indexed_count.saturating_sub(filtered_out);
        let filter_clause = if filtered_out > 0 {
            format!(
                " ({} total, {filtered_out} filtered out by --skill-name-filter)",
                self.indexed_count
            )
        } else {
            String::new()
        };
        let message = format!(
            "scan complete — indexed {effective_count} skill(s){filter_clause} across {} director{}, {} skipped, {} collision(s)",
            self.dir_count,
            if self.dir_count == 1 { "y" } else { "ies" },
            self.skipped.len(),
            self.collisions.len(),
        );
        eprintln!("skill-lookup-mcp: {message}");
        crate::logging::log_file_only(crate::logging::Level::Info, &message);
    }
}
