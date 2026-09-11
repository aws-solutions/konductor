# Design: Home-Level Install Index for `update`/`uninstall`

Status: Proposed Scope: `cli/konductor-rs/` — design only, no code in this artifact Grounded against: `cli/konductor-rs/src/cli/install/manifest.rs`, `cli/konductor-rs/src/cli/install.rs`, `cli/konductor-rs/src/cli/dispatch.rs`, `cli/konductor-rs/src/cli/install/registry.rs`, `cli/konductor-rs/src/cli/synth/registry.rs`, `.konductor/skills/ws-konductor-cli-notes/SKILL.md` (sibling internal package)

## Decision log (quick reference)

| # | Question | Decision |
|---|---|---|
| 3 | Uninstall selection UX when the index has 2+ entries | **No default target on a bare `uninstall`.** 0 entries → informational no-op, exit 0. 1 entry → uninstall that target directly, no prompt. 2+ entries → **require an explicit target**: either an interactive picker (TTY, human session) or a mandatory `--target <dir>` (non-interactive/`--json`/piped stdin). A bare `uninstall` with 2+ entries and no way to prompt is a **usage error (64)**, never a silent choice. `--all` is a separate, explicit opt-in flag that removes every tracked install in one invocation; it is never implied by omitting a target. |
| 4 | **[SUPERSEDES prior "preserve silently" decision]** Update's hash-divergence behavior (`ManifestFile` hash no longer matches on-disk content) | **Block by default; require `--force` to overwrite, and always back up before a forced overwrite.** On a hash mismatch, `update` refuses to touch that file and reports it as **blocked** (visible in the summary: count + paths), rather than silently leaving it untouched forever with no way back in. `--force` overwrites every blocked file with the fresh synth content, but only after a successful backup of the pre-overwrite bytes — a backup failure aborts that file's overwrite (§4 below). Resolved 2026-08-21 by Nihit Kasabwala and Simon Krol, superseding this design's original silent-preservation stance; see §4 for full mechanics. |
| 5 | Uninstall's hash-divergence behavior (`Created`/`ReplacedOurs` file, hash no longer matches manifest) | **Delete it anyway.** A hand-edited file at a `Created`/`ReplacedOurs` path is still Konductor's own file at a path Konductor owns end-to-end — the user edited *our* content, not content we merely clobbered. This is categorically different from `ReplacedForeign` (content we never owned, whose deletion would destroy data we have no record of and no right to touch). Uninstalling is "make it as if this install never happened" for paths we own; preserving a hand-edited copy would leave silent, undocumented debris behind after a supposedly-clean uninstall. Provenance — not hash state — is the only signal that already gates deletion safety in this codebase. **Reassessed under decision #4 (still holds — see §4's "Item 5: uninstall consistency reassessment" subsection): update's blocked-file report is a per-invocation signal, not a durable record `uninstall` consults, so uninstall's delete-anyway/report-after-the-fact behavior is unchanged. Reassessed AGAIN under decision #6 (still holds — see §4's rewritten close): §6's own logic never depended on `update` reporting anything in the first place, so removing that report changes nothing here either.** |
| 6 | **[SUPERSEDES decision #4's block-by-default/`--force`/backup stance]** Update's file-overwrite semantics, second revision | **Unconditional overwrite. No hash comparison, no divergence classification, no `--force` flag, no backup mechanism.** `update` re-runs the exact same fresh-copy path `install` uses (`InstallStrategy::install_from_local`) against every resolved target, full stop. Resolved 2026-08-24 by the design owner in direct conversation, superseding decision #4's block-by-default/backup stance entirely — **this is a second supersession of the original silent-preservation design, not a reversion to it**: v1 preserved diverged files silently; v5 blocked them by default and offered a backed-up force-overwrite; this decision removes the divergence question altogether, in either direction. Stated reasoning, treated as authoritative: once `update` is going to overwrite anyway, the only thing that still meaningfully distinguishes it from re-running `install` is that `update` can *discover* which target directory to act on via the home-directory index (§1-§3), rather than requiring the user to know and retype `--target` the way a fresh `install` does. Target-resolution is `update`'s sole remaining distinguishing value versus `install` — its file-content behavior should therefore be identical to `install`'s, not merely similar. A command that still computes on-disk hashes, classifies divergence, and threads a `--force` flag through backup/restore machinery just to arrive at "overwrite anyway" carries the full bug surface of the feature being removed (symlink-safety edge cases, restore-failure handling, backup retention, reconciliation branching) with none of its safety payoff, since the end state — fresh content on disk — is identical to just calling `install` again. See §4 (rewritten below) for the new mechanics and the explicit removal list. |
| 7 | **[NOT YET DESIGN-OWNER-CONFIRMED — implemented pending CR review]** Bare `uninstall`'s behavior against decision #3's own 2+-entries row | `cli/konductor-rs/src/cli/uninstall.rs`'s `dispatch_uninstall` now resolves a bare invocation's (no `--target`, no `--all`) destination to `$HOME` — the same default `install`/`doctor` already apply to their own omitted `--target` — and proceeds through the identical single-target path an explicit `--target $HOME` would take, when 2+ installs are tracked. This directly diverges from decision #3's "2+ entries → require an explicit target, usage error (64)" row: it means a bare `uninstall` no longer always demands disambiguation once 2+ installs exist, resolving deterministically to `$HOME` instead. Decision #3's own rationale for requiring disambiguation (a default that silently picks *a* target among several tracked installs risks deleting one "the user forgot they had" — see §3 below) still applies verbatim to this divergence: `$HOME` is a deterministic choice rather than an arbitrary one, but it is still a choice made without confirming which of 2+ tracked installs the user actually intended, when one of the others might be the one they meant. This row records the divergence for the design-owner review decision #3 itself calls for changes of this kind to receive, per §3's own sign-off note; it is not itself that sign-off. |
| 8 | Mitigation for decision #7's still-open risk | **Adds an interactive confirmation prompt, scoped to exactly the case decision #7 flagged: bare invocation, 2+ tracked installs, resolved to `$HOME`.** Before deleting, `dispatch_target` (via `confirm_destructive_uninstall`) prints `Are you sure you want to uninstall from <dir>?` and requires an explicit `y`/`yes` to proceed; `--yes`/`-y` bypasses it, and `--json` or a non-interactive stdin without `--yes` aborts (`EXIT_USER_ABORTED`, 4) rather than blocking or silently proceeding. This is deliberately narrower than decision #3's own "2+ entries, interactive" row, which specifies a full numbered-list picker across every tracked target — that picker is still not implemented; this is a plain yes/no gate on the one target `$HOME` already resolved to, not a selection mechanism. It does not fully resolve decision #7's own risk statement (a user could still answer "yes" while having forgotten `$HOME` was one of 2+ tracked installs), but it converts what was previously a fully silent, unconfirmed delete into one requiring an explicit affirmative step, and the discoverability note printed on success (naming every other tracked install left untouched) gives the user a chance to notice a forgotten install even after confirming. Whether this closes decision #7's open question, or the full picker/usage-error row is still wanted, remains for the design owner. |

---

## 1. Index file schema

### Location

`~/.konductor/installs` — no extension, mirroring `manifest`'s own extension-less naming (`install/manifest.rs`'s module docstring: "Named `.konductor/manifest` ... per the design doc's own naming"). Lives **beside**, not inside, the home directory's own per-target manifest (`~/.konductor/manifest`, when `$HOME` is itself an install target) and beside `~/.konductor/config.yml` (the user-level config tier `config.rs` already documents). Three files can legitimately coexist under `~/.konductor/`:

```
~/.konductor/
├── config.yml     # user-level config tier (config.rs, pre-existing)
├── manifest       # per-target manifest, IF $HOME is itself an install target
└── installs       # NEW: the home-level index, this design
```

No collision: `config.yml` is user config, `manifest` is per-target file-level state for the target `$HOME` happens to be, `installs` is the cross-target pointer table. All three are independent documents under the same directory; none of this design's writes ever touch `config.yml`.

### Schema

```jsonc
{
  "schema_version": 1,
  "installs": [
    {
      "target_dir": "/home/alice/work/other-project",
      "strategy": "kiro-cli",
      "installed_at": "2026-01-15T09:30:00Z",
      "status": "complete"
    }
  ]
}
```

Rust shape (mirrors `manifest.rs`'s struct/enum conventions exactly — same derive set, same `#[serde(default)]` back-compat pattern, same snake_case string enums):

```rust
pub(crate) const INDEX_SCHEMA_VERSION: u64 = 1;
pub(crate) const INDEX_FILE_NAME: &str = "installs";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IndexEntryStatus {
    InProgress,
    #[default]
    Complete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexEntry {
    pub target_dir: String,      // absolute path, string form (see rationale below)
    pub strategy: String,        // InstallStrategy::name(), e.g. "kiro-cli"
    pub installed_at: String,    // RFC 3339, same format as Manifest::installed_at
    #[serde(default)]
    pub status: IndexEntryStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Index {
    pub schema_version: u64,
    pub installs: Vec<IndexEntry>,
}
```

Field-by-field:

- **`target_dir`** — absolute path, stored as a `String` (not a `PathBuf`) for the same byte-determinism reason `manifest.rs` serializes everything as plain JSON strings: a `PathBuf`'s `Serialize` impl is platform-dependent in edge cases (non-UTF-8 paths), and this codebase's own precedent (`ManifestFile.path: String`) already made this call. Absolute, because unlike the manifest (whose location IS its own target_dir, "by construction, not by convention" per `manifest.rs`'s docstring), the index's target_dir must be resolved and portable across cwd's — the index is read from `~/.konductor/`, not from inside the target it names, so there is no filesystem position to derive it from implicitly. `resolve_destination()` already returns whatever `--target` string the user passed (potentially relative, e.g. `--target .`) — the index write path MUST canonicalize (`std::fs::canonicalize` / equivalent absolute-path resolution) before recording `target_dir`, otherwise two installs to the same real directory via different relative spellings would register as two different index entries and `uninstall` could never present a single stable identity for one physical target.
- **`strategy`** — copied verbatim from the same string `install_from_local`'s caller already has (`InstallStrategy::name()`), identical value to what gets written into that target's own `Manifest.strategy`. Purely informational at this schema version — see §7 for why nothing consumes it yet.
- **`installed_at`** — same RFC 3339 timestamp format already used by `Manifest.installed_at`, captured at the same instant install computes that value (so the index entry and the manifest's own `installed_at` for that run are identical strings, not two clocks read moments apart).
- **`status`** — `IndexEntryStatus::{InProgress, Complete}`, mirroring `manifest.rs`'s `Status` enum name-for-name and defaulting the same way (`#[serde(default)]` → `Complete`, the conservative choice for an index predating this field — see §1's crash-safety subsection for why this is a distinct concept from `Manifest.status` despite the identical shape).
- **`schema_version`** — top-level discriminator, checked with the exact same pre-deserialize `as_i64` guard `read_manifest` uses (reject unknown versions as `UnsupportedSchemaVersion` before generic `Malformed`, so a future incompatible index shape fails legibly instead of producing a confusing generic deserialize error).

### Staleness detection

An index entry is **stale** if `<target_dir>/.konductor/manifest` no longer exists (target was manually deleted, moved, or `rm -rf`'d outside Konductor's own tooling) — checked lazily, at read time, by every consumer that lists entries for `update`/`uninstall`, never precomputed or cached into the index file itself. Concretely: an entry is stale IFF `manifest::read_manifest(Path::new(&entry.target_dir))` returns `Ok(None)` (no manifest at that path) — `Err` (unreadable/malformed manifest) is a **different**, harder failure that must surface to the user directly rather than being silently treated as "stale," since it may indicate a manifest that IS there but corrupted, which is not the same problem as "nothing is there."

Rationale for lazy detection over a cached `is_stale` bool field: the manifest at `target_dir` can change (or vanish) at any time independent of the index — writing that fact into the index itself would require the index to be kept in lockstep with every target's manifest, which reintroduces exactly the two-independent-files consistency problem this design already has to solve once (see the crash-safety subsection below) for a second, unnecessary reason. A lazy check has one source of truth (the manifest itself) and never goes stale itself.

Uninstall's selection UX (§3) surfaces stale entries to the user (e.g. "target no longer has a manifest — remove from index?") rather than silently pruning them on every read; pruning happens only as an explicit consequence of a `konductor uninstall` run against that target (§3) or a future `konductor doctor` pass (out of scope here, noted only as a natural home for a "prune stale entries" diagnostic).

### Write-ahead crash safety

`manifest.rs`'s `Status::{InProgress, Complete}` protects against a crash **inside a single file's write** (many files copied, one manifest). The index's crash-safety problem is different in kind: it protects against a crash **between two independent file writes** — the index file and that target's manifest file — either of which can succeed while the other fails. `IndexEntryStatus` reuses the identical two-state shape not because the underlying risk is identical, but because it is the same **class** of risk (a write-ahead record naming an intended future state before that state is guaranteed true), and reusing the established idiom keeps a second, subtly-different crash-safety mechanism from being invented for a variant of the same problem. See §2 for the exact ordering that makes this safe.

Both files are written atomically via `write_atomic` (already used by both `write_manifest` and `config::set_config_value`) — this design introduces no new atomic-write primitive, only a new `write_index` function in the new module that calls the existing one.

---

## 2. Install integration

### Ordering: index write-ahead, THEN manifest write-ahead, THEN manifest complete, THEN index complete

```
1. install begins, target_dir resolved + canonicalized
2. write_index(  entry: {target_dir, strategy, installed_at, status: InProgress}  )
   -- upsert by target_dir (see "re-installs" below); INDEX FIRST.
3. write_manifest(  Status::InProgress, files: [...], sha256: all null  )
   -- exactly today's existing write-ahead behavior, unchanged.
4. <copy every file>
5. write_manifest(  Status::Complete, files: [...with real sha256...]  )
   -- exactly today's existing behavior, unchanged.
6. write_index(  entry: {..., status: Complete}  )
   -- upsert the SAME entry (by target_dir) to Complete. INDEX LAST.
```

**Why index-first on the way in, index-last on the way out (bracketing the manifest write-ahead, not sequenced after it):** the four crash windows and what each leaves behind:

| Crash after step... | Index state | Manifest state | Recoverable? |
|---|---|---|---|
| 2 (index InProgress written, manifest not yet) | Entry present, `in_progress` | absent | Yes — index names an install attempt with no manifest yet; a future `update`/`uninstall` sees `in_progress` + unreadable/absent manifest and treats it as "install never got past its own write-ahead," safe to either retry-install or drop the index entry. |
| 3 (manifest InProgress written) | Entry present, `in_progress` | present, `in_progress` | Yes — both records agree: an install was attempted and got as far as declaring intent, nothing more. |
| 4 (mid-copy) | Entry present, `in_progress` | present, `in_progress`, real files partially on disk | Yes — identical to today's existing single-target crash story; the index adds nothing new to recover here, it just also says "in progress," consistent with the manifest. |
| 5 (manifest Complete written, index not yet updated) | Entry present, **stale `in_progress`** | present, `Complete` | Yes, but asymmetric: the index under-reports (says in-progress when the install actually finished). This is the ONE case that must be handled explicitly — see below. |

The asymmetric case (crash between steps 5 and 6) is the reason index writes bracket the manifest instead of simply happening once, after step 5: if the index were written **only after** the manifest reaches `Complete`, a crash there would leave a **fully successful, fully functional install with zero index entry** — silently reproducing the exact unreachable-by-uninstall bug this whole design exists to close, just delayed by one step instead of eliminated by `--target`. Writing the index first (step 2) guarantees the entry exists — at worst under-reporting status — the moment ANY file-copy work has begun; the final index rewrite (step 6) is then a pure status-flip on an entry that is already guaranteed present, not a first-time creation that could itself be lost to a crash.

**Self-healing the asymmetric case, without new machinery:** the staleness/status check described in §1 already treats an index entry that says `in_progress` as needing verification against the real manifest, not as gospel. A consumer (`update`/`uninstall`) that finds an index entry `in_progress` MUST re-read that target's own manifest and trust the manifest's `status` over the index's — the manifest is already established (per `manifest.rs`'s own docstring) as the sole source of truth for a target's file-level state; the index's `status` is only a fast-path hint to avoid opening every target's manifest on every listing, never authoritative on its own. Concretely: if `index_entry.status == InProgress` but `manifest.status == Complete`, treat the target as complete and silently self-heal the index entry to `Complete` as a side effect of that read (best-effort — if the self-heal write itself fails, proceed with the correct in-memory answer anyway and let the next successful write fix the on-disk index). This means the index's `status` field is a **cache**, not a second independent crash-safety authority — the manifest remains the sole authority per §6.

### Idempotency / upsert-by-target_dir

Every install writes the index, including a re-install to an already-indexed target: `write_index` performs a read-modify-write — read the current `installs` list, replace the entry whose `target_dir` equals the canonicalized destination (if present) or append a new one (if absent), write back the full list via `write_atomic`. This exactly mirrors `write_manifest`'s own re-install behavior (a fresh manifest supersedes the prior one at the same path) applied at index granularity: **one entry per distinct canonicalized `target_dir`, always**, never a growing history of repeat installs to the same place.

Re-reading the index for the upsert happens **before** step 2 above (not shown as a separate numbered step — it's the read half of step 2's read-modify-write) — this is the one point where a second CLI invocation running install concurrently against a *different* target could race on the *same* index file. This design does not add file locking for that race (no existing precedent for cross-process locking anywhere in this codebase, and `install`/`update`/`uninstall` were never concurrency-safe against each other even before this design); `write_atomic`'s rename-based write means the index file itself is never observed half-written, but a lost-update race (two concurrent installs each read-modify-write and the second overwrites the first's entry) remains a known, accepted limitation — identical in kind to the existing, already-accepted single-target manifest race this codebase has never guarded against either.

---

## 3. Uninstall selection UX

**Decision (see decision log above): 2+ entries never resolves implicitly.**

**Divergence (see decision log #7): the "2+ entries, non-interactive" row below is not
what `dispatch_uninstall` currently does.** The implementation resolves a bare invocation
against 2+ tracked entries to `$HOME` and proceeds via that resolved path instead of the
usage error this row specifies — pending design-owner review, per #7. Decision #8 adds a
narrower interactive confirmation gate on top of that resolved path (not the full
numbered-list picker the "2+ entries, interactive" row below describes) as a partial
mitigation for #7's own open risk.

| Index state | Bare `konductor uninstall` behavior |
|---|---|
| 0 entries | Print "no tracked Konductor installs found" and exit **0** (informational, not an error — there is nothing wrong, just nothing to do). |
| 1 entry | Uninstall that target directly. No prompt, no flag required — there is only one possible answer, so asking would be friction with no safety benefit. |
| 2+ entries, interactive (TTY attached, no `--json`) | Print a numbered list of tracked targets (`target_dir`, `strategy`, `installed_at`, and a `[STALE]` marker per §1 for any entry whose manifest is gone) and prompt for a selection by number, or accept `--target <dir>` / `--all` non-interactively as an escape hatch even in a TTY session. |
| 2+ entries, non-interactive (`--json`, or stdin is not a TTY) | **Usage error (64)**: "multiple installs are tracked; pass --target <dir> or --all". Never guesses, never defaults to $HOME, never defaults to "the most recent." |
| Any entry count, `--target <dir>` given | Uninstall exactly that target (after canonicalizing `<dir>` the same way install does, so `--target .` from inside the target directory matches an absolute-path index entry). If `<dir>` doesn't match any index entry, this is a usage error (not silently "nothing happens") — the design already established the index is the single source of truth for what `uninstall` can reach, so a target that resolves to nothing in the index means the user's own path is wrong or Konductor never installed there in a way this tool tracks. |
| Any entry count, `--all` given | Uninstall every tracked entry, one at a time, continuing on a per-target failure (report which targets succeeded/failed rather than aborting the whole batch on the first error) — the batch nature of `--all` is exactly why it must be an explicit, separately-named flag rather than 2+ entries' default behavior. |

**Rationale for treating 2+ entries as "must choose" rather than "default to something reasonable":** uninstall is destructive and explicitly non-restorable (`manifest.rs`'s own docstring: "there is no restore-from-backup"). A default that silently picks *a* target when 2+ exist is a coin-flip with data-loss consequences dressed up as convenience — the failure mode of guessing wrong is "the user's actual intended target survives, but a DIFFERENT tracked install they forgot about (or didn't realize was still tracked) gets deleted," which is strictly worse than the friction of asking, because it fails silently from the user's perspective (the command "succeeded") while doing the wrong thing. `--all` exists as the one legitimate case where a user genuinely wants every tracked target gone, and naming that explicitly (rather than letting it fall out of "no target given, N entries exist") means a bare `uninstall` can never accidentally become a mass-delete just because the user forgot they had two installs.

This also composes cleanly with the existing "uninstall takes no flags today, and the design doc specifies it flagless" note recorded in `ws-konductor-cli-notes/SKILL.md` (sibling package's `.konductor/skills/`) — that note explicitly says adding a `--target` flag to `uninstall` needs "explicit owner sign-off" before implementation. This design's recommendation for item 3 inherently requires `--target` (and adds `--all`); consider this design document itself the requested sign-off request — flag the implementer to confirm with the design owner before landing the `uninstall` flag surface, since that prior note is still standing and this design does not unilaterally override it.

---

## 4. Update's overwrite semantics

> **Supersedes, again.** This section previously specified (v1) silent preservation of hash-diverged files, then (v5) block-by-default with a `--force`/backup escape hatch. Decision #6 (2026-08-24) replaces both: **`update` unconditionally overwrites every tracked file with fresh content. There is no hash comparison of any kind, no divergence classification, no `Blocked` state, no `--force` flag, and no backup mechanism.**

`update`, per target, in order:

1. **Resolve which target(s).** **Unchanged from today's implementation — this selection logic is correct as it stands and is NOT being touched by this decision.** Same selection surface as before: 0 entries → no-op, exit 0; 1 entry → that target directly; 2+ entries → `--target <dir>` or `--all` required, otherwise a usage error (64) listing the ambiguous targets. The implementer should preserve `dispatch_update_with`'s existing target-resolution block (index read, duplicate-`target_dir` corruption check, the `--all`/`--target`/single-entry branching, and the deterministic `EXIT_USAGE_ERROR`-wins tie-break across a `--all` batch) verbatim — none of it depends on file-overwrite policy, and none of it changes here.
2. **For each resolved target, call the exact same install code path `install` itself uses: `InstallStrategy::install_from_local(target_dir, from)`.** This is precisely what `install.rs`'s `dispatch_install_with` calls on its selected strategy — no filtering, no per-file classification, no reconciliation of any kind. `update_one_target` becomes, in essence: look up the target's currently-recorded strategy (`registry::STRATEGIES.iter().find(|s| s.name() == current.strategy)`, unchanged from today — still never re-runs `matches()` selection against the target, per §7's existing scoping) and invoke `install_from_local` on it exactly as a fresh `install --target <dir>` would. Every file `install_from_local` would write on a clean install, it writes here too — hand-edited, missing, or never-hashed alike — because there is no longer a question of "was this file hand-edited" for `update` to answer. The manifest `install_from_local` writes as a side effect of that call **is** the correct final manifest for this run, verbatim, with no post-processing: it already lists every file the fresh source produced, with real hashes and real provenance, exactly as a fresh install's manifest would. There is no forward-reconcile step because there is nothing to reconcile — every file was just freshly overwritten, so the manifest that describes "what's on disk right now" and the manifest `install_from_local` already wrote are the same document.
3. **Update the target's index entry.** Unchanged bracketing pattern: write-ahead `InProgress` before the copy, `Complete` after — identical in shape to §2's install-side bracketing and to what `update_one_target` already does today for this step.

That is the entire command. `update` in this design is: resolve a target via the index, then do exactly what `install` does to that target.

### What this removes from the design (and why each removal is safe)

- **Hash-divergence classification** (`DivergenceKind::{Matched, Blocked}`, `DivergenceEntry`, and `classify_divergence`'s per-file on-disk-vs-manifest sha256 comparison, including its symlink-safety handling). There is no longer a question this classification answers — every file is overwritten regardless of its on-disk state, so computing "does the hash match right now" produces an answer that no downstream code consults.
- **The `Blocked` state and its reporting** (the "N file(s) blocked" summary line, `--verbose`-gated per-path blocked listing, and the `blocked`/`blocked_paths` `--json` fields). Nothing is ever left un-overwritten, so there is no set of files to report as withheld.
- **The `--force` flag entirely** (its CLI surface, the `force: bool` parameter threaded through `update_one_target`/`resolve_blocked_files`/`reconcile_manifest`, and the "applies to ALL blocked files uniformly, no per-file force" scoping decision this design previously recorded). A flag that toggles between two overwrite policies has nothing to toggle when there is only one policy — `update` now always does what `--force` used to do.
- **Backup mechanics in full**: the `.bak-<unique_suffix>` sibling-rename scheme, backup-then-overwrite ordering, latest-only backup retention, and the distinct "backup failed, reverted to pre-update state" outcome and its `EXIT_USAGE_ERROR` exit-code contract. Backups existed to give the user a recovery path for content `update` was about to overwrite only conditionally (under `--force`); since overwriting is now unconditional and universal, a backup would have to run on every single `update` invocation to preserve the same safety property — which is a fundamentally different (and much larger) feature than what decision #4 approved, not a smaller version of it. The design owner's resolved direction is explicit that no backup mechanism survives this decision.
- **The cross-file-reference re-validation pass** (`revalidate_still_blocked_agent_specs` and its two triggers: default-blocked-with-no-force, and force-attempted-but-backup-failed-and-reverted). This pass existed specifically to re-check `skill://`/`file://` references in agent specs that were *not* going through the fresh-content path this run (§4 item 4's v5 reasoning: "files that were Matched or successfully `--force`-overwritten went through the identical fresh-content path a normal install already validates, so they need no additional pass" — the pass was scoped precisely to the complement of that set). Under unconditional overwrite, every file goes through that identical fresh-content path, every run, with no exceptions — the complement set the pass was built to cover is now empty by construction. Whatever consistency guarantee `install_from_local`'s own reference-existence checking already provides to a fresh `install` applies identically to every `update`, since `update` is now that exact same call. No special-casing is needed because there is no longer a class of file that skipped the install-time check.
- **The three-way outcome reporting split** (blocked / force-overwritten / backup-failed) and the restore-failure reporting path (`restore_preserved_files`'s `(path, io::Error)` failures and their dedicated non-zero exit-code contribution). Both existed to describe outcomes of a conditional-overwrite policy; under unconditional overwrite there is exactly one outcome per file ("recopied"), matching `install`'s own reporting shape (§ install.rs's `report_install_success`) rather than needing a policy-specific report at all.

### Item 6 (backward compatibility): still holds, more strongly

Decision #4's §4 item 6 already established that divergence is a *derived, per-run* comparison, never a stored manifest field, so no schema migration was needed for the block-by-default change. That holds even more directly here: this decision removes the derivation itself, not just what happens after it. `ManifestFile`'s `path`/`sha256`/`provenance` shape is completely unaffected — the manifest `install_from_local` writes under this design is byte-for-byte the same shape it always was for a fresh `install`. A user upgrading their `konductor` binary from a block-by-default build to this build sees `update` behave like `install` immediately, with no manifest rewrite, no re-migration step, and no flag of any kind — simpler than the block-by-default upgrade path was, since there is no policy state to reason about at all.

7. **Index touch:** unchanged from the original design — `update` upserts that target's index entry the same way install does (§2), using the identical bracketing pattern.

---

## 5. Uninstall's hash-divergence decision

**Decision: delete `Created`/`ReplacedOurs` files anyway, even if their on-disk hash no longer matches the manifest.** (Restated from the decision log with full rationale.)

The precedent already in the codebase is provenance-based, not hash-based: `manifest.rs`'s own docstring states the provenance field "is also the future data an `uninstall` needs to be safe: it must delete only `Created`/`ReplacedOurs` paths ... and must NEVER delete a `ReplacedForeign` path." The distinction that precedent draws is about **who created the content**, not **whether the content has since changed**. A hand-edited `Created`/`ReplacedOurs` file is still, by that same test, content that belongs to Konductor's install at that path — the user's edit doesn't retroactively change who put the file there, only what it currently contains. Extending "never delete" to cover hash-diverged-but-owned files would be inventing a FOURTH provenance-adjacent state ("ours, but modified") that the schema does not have and that this design's constraints (§ "Constraints" in the task, and restated here: implementable via targeted edits, no broader refactor) explicitly rule out introducing.

Practically: `update`'s preserve-on-divergence rule exists to protect an ongoing customization from being silently clobbered by a future `update` run that assumes it still owns that file's exact bytes. Uninstall has no "future" to protect against — it is the terminal operation for that install. Preserving a hand-edited file on uninstall would leave an orphaned, half-Konductor file sitting in the user's `.kiro`/`.konductor` tree with no manifest, no index entry, and no tool that will ever manage it again — arguably a worse outcome than deleting it, since a deleted-and-regrettable file is at least predictable and reportable (see below), whereas a silently-preserved orphan is invisible debris.

**Mitigating the actual risk (data loss of a real edit):** `uninstall` reports the count of `Created`/`ReplacedOurs` files it deleted whose hash had diverged, in the same style install already reports `replaced_foreign` counts today (`format_install_summary`'s "overwrote N pre-existing file(s)" line is the existing precedent for this kind of after-the-fact disclosure). This gives the user visibility into what was lost without silently leaving debris behind AND without blocking the uninstall on an interactive per-file prompt (which would make `--all`/batch uninstall unusable non-interactively). `--json` output includes the same count as a field, mirroring `format_install_summary_json`'s existing pattern.

---

## 6. Relationship between the index and the per-target manifest

The index is a **pointer/summary table**, never a duplicate of file-level state:

| Concern | Lives in... |
|---|---|
| "Which target directories has Konductor ever installed to?" | Index only. |
| "What strategy/timestamp/status did the MOST RECENT install/update of target X use?" | Both, by design (see below) — but the manifest is authoritative on divergence. |
| "Which individual files did target X get, with what hash and provenance?" | Manifest only. The index has no `files` field and never will — see §7's constraints for why this is a hard boundary, not a current-milestone gap. |
| "Is target X's install actually finished, or does that file need to be re-hashed to know?" | Manifest's `Status`/`ManifestFile.sha256` is authoritative; the index's `IndexEntryStatus` is a cache that self-heals against the manifest (§2) and is NEVER trusted over a disagreeing manifest read. |

The apparent duplication of `strategy`/`installed_at`/`status` between `IndexEntry` and `Manifest` is intentional, not an oversight: the index needs enough per-entry information to render a useful selection list (§3's numbered prompt) **without opening every target's manifest file** on every `uninstall`/`update` invocation just to list candidates — that would require N file opens (across potentially N different mounted filesystems, e.g. a target on a different disk or network mount) just to print a menu. The index's copies are a **cache of the manifest's own last-known values**, refreshed on every install/update write (§2/§4), and are read authoritatively ONLY for the listing/selection step; the moment a specific target is selected for a real operation (the actual uninstall or update work), that target's manifest is read and the manifest's values govern from that point forward. This is the same authority split the self-healing rule in §2 already establishes for `status` specifically, generalized to the other two cached fields.

---

## 7. Transformer/strategy registry interaction

Explicitly addressed, not solved (per the task's own framing — a second `InstallStrategy` is not registered today, so this is scoped as a forward-looking constraint on this design, not new work):

**What already works today, unchanged by this design:** with exactly one registered strategy (`KiroCliInstallStrategy`), `IndexEntry.strategy` and `Manifest.strategy` are always `"kiro-cli"`, and nothing needs to disambiguate anything — `update`/`uninstall` can safely assume whichever strategy is currently registered for a runtime is the same one that produced any given target's manifest, because there is only ever one candidate.

**What breaks the moment a second strategy is registered:** `strategy` is presently _write-only_ everywhere (per `ws-konductor-cli-notes/SKILL.md` (sibling package's `.konductor/skills/`), its own explicit note: "nothing anywhere reads that field back to confirm it still matches the currently-registered strategy for a given target"). This design's `update` (§4 step 2) inherits that same gap deliberately — it does **not** re-run `registry::STRATEGIES` selection against the target on update, it trusts the manifest's recorded `strategy` string as descriptive metadata only. If a second strategy is ever registered (e.g. a future Claude Code strategy) and BOTH strategies' `matches()` could plausibly accept the same `target_dir` (today's single-strategy `KiroCliInstallStrategy::matches()` behavior is not shown in the files read for this design and is out of scope to inspect further here), two failure modes become live that this design does not attempt to close:

1. **`update` correctness risk:** if the currently-registered strategy for a runtime changes identity between the original install and a later `update` (e.g. the kiro-cli strategy is replaced/renamed, or a target that matched strategy A now also matches a newer strategy B), `update`'s file-copy step (§4 step 2) reuses the ORIGINAL manifest's recorded `strategy` name, not a fresh `matches()` resolution — so an update never silently re-runs a _different_ strategy's install logic against a target it didn't originally install. This is actually safe by construction (update never calls `matches()` at all in this design), but it does mean update on such a target would apply strategy-A's `install_from_local` even if strategy B is now what `install` would pick fresh — a latent inconsistency between what `install` would do today vs. what `update` continues doing for an existing target.
2. **Index disambiguation:** the index's `strategy` field lets a human reading the selection list (§3) or `--json` output see which strategy produced a given entry, but nothing in this design makes the index or manifest **reject** an `update`/`uninstall` run against a target whose recorded strategy no longer matches any registered strategy, or matches a DIFFERENT one than it originally did. Per the registry-pattern convention already in this codebase (append, never edit shared logic), the correct fix — a `strategy`-aware guard that consults `registry::STRATEGIES` to confirm the recorded strategy is still registered and still `matches()` this target before proceeding — is new consuming logic that does not exist anywhere yet (confirmed directly: `ws-konductor-cli-notes/SKILL.md`, sibling package's `.konductor/skills/`, states this outright), and is intentionally left for whoever registers a second strategy to design, since only then does a concrete disambiguation rule (first match wins? exact recorded-name match required? explicit `--strategy` override flag?) have a real second case to be designed against instead of a hypothetical one.

This design's index schema does not need to change to support that future guard — `IndexEntry.strategy` already carries the data such a guard would consult; only the guard logic itself is deferred.

---

## 8. `.konductor/` non-installed-content boundary

Reconfirmed, unchanged by this design: inside a given target's `.konductor/`, the **only** content any install/update/uninstall operation ever creates, modifies, or removes is `manifest` and `skills/**` — exactly the boundary `ws-konductor-cli-notes/SKILL.md` (sibling package's `.konductor/skills/`) already states ("Inside `.konductor/`, the ONLY content this install (or a future `update`) ever writes is `manifest` itself and `skills/**`"). `config.yml`, `logs/`, and any gate-config declarative files under a target's `.konductor/` remain untouched by every operation this design introduces, with no exception.

This design adds exactly one new piece of home-directory-level content under `~/.konductor/` specifically — the `installs` index file — which is itself subject to the identical boundary rule one level up: a `konductor uninstall` run against some OTHER target never touches `~/.konductor/config.yml`, and `~/.konductor/installs` is modified ONLY by `install`/`update`/`uninstall`'s own index-upsert steps (§2, §4), never read-and-discarded or rewritten wholesale by any operation that isn't itself performing one of those three actions. `uninstall` targeting `$HOME` itself (a legitimate case — `$HOME` is `install`'s own default destination) removes that target's entry from `~/.konductor/installs` and deletes `~/.konductor/manifest` / `~/.konductor/skills/**` per the normal per-target uninstall logic, but still leaves `~/.konductor/config.yml` and `~/.konductor/installs` itself (now with one fewer entry, but the file itself persists even if the resulting `installs` list is empty — an empty list is a valid, normal state, not a signal to delete the index file) — the file `.konductor/` directory root is never removed for the same reason `manifest.rs`'s own "never remove `.kiro/`/`.konductor/` themselves" rule already applies to the runtime namespace roots, restated here for `~/.konductor/` specifically since it is the one target the index mechanism newly needs to reason about.

---

## Implementation surface (bounding this design to the stated constraint)

Per the task's explicit constraint, this design fits in:

- **One new module**: `cli/konductor-rs/src/cli/install/index.rs` — `Index`, `IndexEntry`, `IndexEntryStatus`, `index_path()`, `read_index()`, `write_index()` (upsert-by-`target_dir`), mirroring `manifest.rs`'s function shapes 1:1.
- **Targeted edits to `install.rs`'s dispatch**: `dispatch_install_with` gains the two index-upsert calls bracketing its existing manifest write-ahead/complete sequence (§2); no change to `InstallStrategy`, `registry::STRATEGIES`, or any existing strategy implementation.
- **Two new modules**, replacing today's inline stub arms in `dispatch.rs` (per the standing "extract before parallelizing" convention already recorded in `ws-konductor-cli-notes/SKILL.md`, sibling package's `.konductor/skills/`): `cli/konductor-rs/src/cli/update.rs` and `cli/konductor-rs/src/cli/uninstall.rs`, each taking over their respective `Commands::{Update,Uninstall}` match arm exactly as `install.rs`/`init.rs`/`config.rs` already did for their commands.

No change to `synth/registry.rs`, no change to the registry pattern itself, no broader refactor of `dispatch.rs`'s static-match structure (§7's TODO(design) note about that structure is explicitly out of scope here and untouched by this design).

### Decision #6's effect on the implementation surface: net shrinkage

Decision #6 (§4) is a **reduction**, not an addition, to `update.rs` as it exists today (verified against its current, post-AutoSDE-fixes state, not an earlier description). Removed entirely:

- `enum DivergenceKind` (`Matched`/`Blocked`) and `struct DivergenceEntry` (`file`, `kind`, `pre_update_bytes`, `pre_update_symlink_target`).
- `fn classify_divergence` — the per-file on-disk-vs-manifest sha256/symlink comparison, including its FIX-A symlink-safety handling.
- `fn restore_preserved_files` — restores a `Blocked` entry's pre-update bytes/symlink after `install_from_local` overwrote it.
- `fn capture_fresh_snapshots` — snapshots `install_from_local`'s fresh output for `Blocked` paths before the restore step clobbers it; existed solely to feed `--force`'s re-apply step.
- `fn resolve_blocked_files` and `enum ForceOutcome` (`Overwritten`/`BackupFailed`) — the actual force-handling function is named `resolve_blocked_files` in the current code (verified by reading `update.rs` directly, not assumed from the task's own guess at its name), backed by two helpers that go with it: `fn backup_then_apply` (the rename-then-reapply primitive) and `fn remove_stale_backups` (latest-only retention cleanup). `apply_force_overwrite`, the name floated as a guess, does not exist in the current code under that name — this is `resolve_blocked_files` plus its two helpers.
- `reconcile_manifest`'s multi-case branching (the `blocked_paths`/`overwritten_paths`/`failed_paths` set-intersection logic that decides, per path, whether to take the fresh or the preserved manifest entry, plus the AutoSDE-fixed "Blocked-but-missing-file takes fresh entry" special case and the "preserved-Blocked-entry-absent-from-fresh gets appended" special case). Replaced by: no reconciliation needed — `install_from_local`'s own freshly-written manifest is the final manifest, verbatim.
- The dangling-reference re-validation pass: `fn revalidate_still_blocked_agent_specs`, and with it, `update.rs`'s only calls to `verify_context_targets_exist`/`verify_skill_targets_exist` (imported from `install::kiro_cli`) and its use of `AGENTS_CONTENT_TYPE_DIR`/`CONTEXT_CONTENT_TYPE_DIR`/`SKILLS_CONTENT_TYPE_DIR` (imported from `synth::kiro_cli_v2`) for building `context_dir`/`skills_dir`.
- The `force: bool` parameter threaded through `dispatch_update_with` → `update_one_target` → `resolve_blocked_files`/`reconcile_manifest`/`revalidate_still_blocked_agent_specs`, and the `--force` CLI flag itself.
- Restore-failure and force-outcome reporting: the `restore_failures: &[(String, std::io::Error)]` / `force_outcomes: &[ForceOutcome]` fields on `UpdateReport`, and the three-way blocked/force-overwritten/backup-failed split inside `report_update_success` (the `blocked_not_forced`/`force_overwritten`/`backup_failed` local computations and their plain/`--json` output branches).
- The restore-failure and backup-failure non-zero-exit conditions at the end of `update_one_target` (the `if !restore_failures.is_empty() || force_outcomes.iter().any(...)` check) — replaced by: `update_one_target` returns non-zero only for the pre-existing usage-error/verify-failed cases (unresolvable target, missing/in-progress/unsupported-schema manifest, unregistered strategy, `install_from_local` failure), mirroring `install`'s own exit-code contract exactly.

**`kiro_cli.rs`'s `pub(crate)` widening — checked, not assumed, per file:**

- `verify_context_targets_exist`/`verify_skill_targets_exist` (both `pub(crate) fn` in `kiro_cli.rs`): grep against the full crate shows their only caller outside `kiro_cli.rs` itself is `update.rs`'s `revalidate_still_blocked_agent_specs`, which this decision removes entirely. `uninstall.rs` does not call either function. Once `update.rs` stops calling them, nothing outside `kiro_cli.rs` calls them — **these two should revert from `pub(crate)` back to private (`fn`, no visibility modifier)**, since `pub(crate)` was widened specifically to let `update.rs` reach them and that need goes away with this decision.
- `KIRO_DESTINATION_ROOT`/`KONDUCTOR_DESTINATION_ROOT` (both `pub(crate) const` in `kiro_cli.rs`): grep shows `uninstall.rs` imports both today (aliased `KIRO_ROOT`/`KONDUCTOR_ROOT`) to build the `.kiro`/`.konductor` root paths its own now-empty-directory cleanup logic compares against (`removes_now_empty_directories_but_keeps_kiro_and_konductor_roots`) — a use entirely independent of the two verify functions and unaffected by this decision. `update.rs` also imports both today (for `revalidate_still_blocked_agent_specs`'s `context_dir`/`skills_dir` construction, and `report_update_success`'s summary), but that caller is going away. **These two constants should stay `pub(crate)`** — `uninstall.rs` still needs them regardless of this decision, so narrowing their visibility would break a real, unrelated caller.
