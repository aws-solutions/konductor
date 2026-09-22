// SPDX-License-Identifier: Apache-2.0
//
// telemetry/identity.rs — `.konductor/telemetry-id.json` schema,
// generation, and write mechanics.
//
// ── Write mechanics ──────────────────────────────────────────────────
// Never `write_atomic`'s rename: `rename(2)` unconditionally replaces
// whatever is at the destination, so two concurrent installs against the
// same target could both generate a UUID and race to publish, with the
// loser's rename silently clobbering the winner's file. Instead: write
// the full identity JSON to a uniquely-named temp file in the same
// directory (`telemetry-id.json.tmp-<pid>`), then publish via
// `std::fs::hard_link()` (POSIX `link(2)`), which is atomic AND exclusive
// -- it fails with `AlreadyExists` if the destination already has an
// entry. The loser discards its own temp file and reads the winner's
// published file instead of generating a second UUID.
//
// ── Recovery from a malformed destination ─────────────────────────────────
// `AlreadyExists` only means a directory entry is present, not that it's
// well-formed. A losing caller that reads a malformed destination
// removes it (best-effort) and retries its own `hard_link` exactly once,
// republishing its own already-generated UUID. One retry is the cap.
//
// ── Read policy ────────────────────────────────────────────────────────────
// Missing, unreadable, malformed, or a UUID failing `^[a-f0-9]{64}$` all
// read back as "absent" -- never an error at the call-site level.
//
// A `schema_version` NEWER than this binary's own is NOT "absent" and
// must never be treated as malformed: an older binary reading a file a
// newer binary already published is reading a real, live identity it
// just can't fully parse -- not a missing or corrupt file. Collapsing
// that case into "absent" previously fed straight into `ensure_identity`'s
// race-publish path, which deletes-and-republishes on a destination it
// believes is malformed -- silently clobbering a real device identity
// during any rollout where old and new binaries run concurrently against
// a shared install. `read_identity` returns `ReadOutcome::NewerSchema`
// for this case so callers can special-case it: read the `UUID` back
// read-only if it still parses, and never touch the file on disk.
//
// ── Dead in production, alive in tests ────────────────────────────────
// No install path writes this file anymore (the per-target consent
// signal is `install_info::read_install_info`); the write mechanics
// above have no production caller left. `identity_path` itself is the
// exception -- `uninstall` still calls it to clean up a
// `telemetry-id.json` left behind by an install that predates this
// file's retirement. The rest stays as test-only infrastructure:
// `uninstall`'s own tests need a way to simulate that same pre-
// retirement machine. One module-level allow, not a function-by-
// function scatter of the same justification.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::super::config::KONDUCTOR_DIR_NAME;
use super::super::install::artifact::sha256_hex;

/// Identity record schema version. Bump when the shape changes
/// incompatibly.
pub(crate) const SCHEMA_VERSION: u64 = 1;

/// The nil-UUID sentinel: used for a single event when a real identity
/// exists on disk but this binary cannot safely extract its `UUID` (a
/// `NewerSchema` read whose `UUID` field didn't parse as a well-shaped
/// string). Never persisted -- this value is only ever attached to the
/// in-memory record returned for the current call; the file on disk is
/// left untouched.
///
/// Re-exported from the shared `konductor_telemetry` crate --
/// `skill-lookup-core` depends on the same constant, so the two can
/// never drift.
pub(crate) use konductor_telemetry::NIL_UUID_SENTINEL;

/// File name within `KONDUCTOR_DIR_NAME`.
const IDENTITY_FILE_NAME: &str = "telemetry-id.json";

/// `0o644`: owner read/write, group/other read -- same deterministic,
/// umask-independent mode `write_atomic` uses for every file it
/// produces (see atomic_write.rs's module docstring). Not tightened to
/// `0o600` in this revision -- left as an open follow-up.
const FILE_MODE: u32 = 0o644;

/// A 64-character lowercase hex `sha256_hex()` digest -- the shape a
/// well-formed `UUID` must match.
///
/// Re-exported from the shared `konductor_telemetry` crate.
pub(crate) use konductor_telemetry::is_valid_uuid_shape;

/// `.konductor/telemetry-id.json`'s on-disk shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct IdentityRecord {
    pub schema_version: u64,
    pub version: String,
    #[serde(rename = "UUID")]
    pub uuid: String,
    pub harness: String,
}

impl IdentityRecord {
    fn new(uuid: String, harness: impl Into<String>) -> Self {
        IdentityRecord {
            schema_version: SCHEMA_VERSION,
            version: env!("CARGO_PKG_VERSION").to_string(),
            uuid,
            harness: harness.into(),
        }
    }
}

/// `<target_dir>/.konductor/telemetry-id.json`.
pub(crate) fn identity_path(target_dir: &Path) -> PathBuf {
    target_dir.join(KONDUCTOR_DIR_NAME).join(IDENTITY_FILE_NAME)
}

/// Generates a fresh `UUID`: `sha256_hex()` over
/// `SystemTime::now()` + `process::id()` + `target_dir`. Mixing in a
/// moment of entropy (now, this process's own pid) plus the target path
/// is what a stateless re-derivation could never reconstruct later.
fn generate_uuid(target_dir: &Path) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let input = format!("{nanos}-{}-{}", std::process::id(), target_dir.display());
    sha256_hex(input.as_bytes())
}

/// The outcome of a `read_identity_raw` attempt, distinguishing
/// "genuinely malformed/absent" (safe to clobber-and-republish) from
/// "a real identity this binary can't fully parse" (never safe to
/// touch on disk).
#[derive(Debug)]
pub(crate) enum ReadOutcome {
    /// A well-formed record at this binary's own `SCHEMA_VERSION`.
    Ok(IdentityRecord),
    /// The file parses as a JSON object and carries a `schema_version`
    /// field, but its value is LARGER than this binary's own
    /// `SCHEMA_VERSION` -- a real identity published by a newer
    /// binary. NOT malformed, NOT safe to delete/overwrite. Carries
    /// the `UUID` value read out verbatim if it was present as a
    /// string, so a caller can use it read-only without needing to
    /// parse the rest of the (possibly newer-shaped) record.
    NewerSchema { uuid: Option<String> },
    /// Missing, unreadable, not valid JSON, has no `schema_version`
    /// field at all, has a `schema_version` at or below this binary's
    /// own (but otherwise fails to deserialize / has a UUID failing
    /// `^[a-f0-9]{64}$`) -- genuinely malformed or absent. Safe to
    /// treat as "no identity here" and eligible for the existing
    /// clobber-and-republish recovery path.
    Absent,
}

/// Reads `<target_dir>/.konductor/telemetry-id.json` and classifies the
/// result per `ReadOutcome`. This is the one place that decides
/// "malformed/absent" vs "newer schema I can't fully parse" -- every
/// other read in this module goes through here (directly or via
/// `read_identity`) so the distinction can never be reintroduced by a
/// caller re-deriving it ad hoc.
///
/// Only a file that fails to parse as a JSON object at all, has NO
/// `schema_version` field, or has a `UUID` failing
/// `^[a-f0-9]{64}$` collapses to `Absent`. A `schema_version` present
/// as a valid, non-negative integer but LARGER than `SCHEMA_VERSION`
/// is `NewerSchema`, never `Absent` -- see this module's docstring.
fn read_identity_raw(target_dir: &Path) -> ReadOutcome {
    let path = identity_path(target_dir);
    let contents = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return ReadOutcome::Absent,
    };
    let value: serde_json::Value = match serde_json::from_str(&contents) {
        Ok(v) => v,
        Err(_) => return ReadOutcome::Absent,
    };
    let Some(schema_version) = value.get("schema_version").and_then(|v| v.as_u64()) else {
        // No `schema_version` field at all (or not a valid non-negative
        // integer) -- genuinely malformed, not a recognized-but-newer
        // schema.
        return ReadOutcome::Absent;
    };

    if schema_version > SCHEMA_VERSION {
        // A real identity this binary's schema predates. Try to pull
        // the UUID out read-only; if it's not a well-shaped string,
        // the caller falls back to the nil-UUID sentinel for its own
        // event -- but the file itself is never touched either way.
        let uuid = value
            .get("UUID")
            .and_then(|v| v.as_str())
            .filter(|s| is_valid_uuid_shape(s))
            .map(|s| s.to_string());
        return ReadOutcome::NewerSchema { uuid };
    }

    // schema_version <= SCHEMA_VERSION: must deserialize cleanly into
    // this binary's own known shape and carry a well-shaped UUID, or
    // it's malformed.
    let record: IdentityRecord = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(_) => return ReadOutcome::Absent,
    };
    if record.schema_version != SCHEMA_VERSION || !is_valid_uuid_shape(&record.uuid) {
        return ReadOutcome::Absent;
    }
    ReadOutcome::Ok(record)
}

/// Reads `<target_dir>/.konductor/telemetry-id.json`. Returns `None` for
/// every "absent" case: the file doesn't exist, isn't readable, isn't
/// valid JSON, doesn't match the expected shape, or has a `UUID` failing
/// `^[a-f0-9]{64}$` -- never an `Err` (missing/malformed both mean
/// "treat as absent").
///
/// A recognized-but-newer `schema_version` is NOT "absent" (see this
/// module's docstring) and is intentionally NOT surfaced by this
/// function -- callers on the write/publish path that need to
/// distinguish it MUST use `read_identity_raw` directly instead of
/// this convenience wrapper, so the distinction can't be silently lost
/// by defaulting back to this function.
///
/// No production caller remains; kept only as test infrastructure that
/// verifies `ensure_identity`'s own write path actually persists a
/// well-formed record (see `assert_identity_persisted` below).
pub(crate) fn read_identity(target_dir: &Path) -> Option<IdentityRecord> {
    match read_identity_raw(target_dir) {
        ReadOutcome::Ok(record) => Some(record),
        ReadOutcome::NewerSchema { .. } | ReadOutcome::Absent => None,
    }
}

/// PID alone repeats across the two calls a single process makes in a
/// race (both threads share one PID), so a monotonic counter is
/// appended per call. An `AtomicU64` counter, not a nanosecond
/// timestamp (`atomic_write.rs`'s `unique_suffix` collides under
/// thread scheduling for exactly this reason): each `fetch_add` is a
/// single atomic op, so two threads calling this in the same instant
/// still get distinct values.
static TEMP_NAME_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn temp_path(target_dir: &Path) -> PathBuf {
    let dir = target_dir.join(KONDUCTOR_DIR_NAME);
    let counter = TEMP_NAME_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    dir.join(format!(
        "{IDENTITY_FILE_NAME}.tmp-{}-{counter}",
        std::process::id()
    ))
}

/// Removes the temp file at `path` when dropped. Exists so every
/// `ensure_identity`/`publish_loser` return path cleans up its own
/// temp file by construction, rather than each branch needing its own
/// `remove_file` call -- including the winning `hard_link` branch:
/// the temp file's inode is also linked at `final_path` by then, so
/// removing the temp NAME leaves the final path's data untouched (two
/// links, one inode; dropping one link never deletes the data while
/// the other remains).
struct TempFileGuard<'a> {
    path: &'a Path,
}

impl<'a> TempFileGuard<'a> {
    fn new(path: &'a Path) -> Self {
        TempFileGuard { path }
    }
}

impl Drop for TempFileGuard<'_> {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.path);
    }
}

/// Writes `record` to `tmp_path` with explicit `0o644` permissions.
///
/// The temp name includes a per-call counter (see `temp_path` above),
/// so nothing else in this process ever targets the same path while
/// this call is in flight -- unlike the old PID-only scheme, a
/// pre-existing entry here is never a live sibling call's own temp
/// file. It can only be a pre-planted symlink (a local attacker
/// predicting this path) or debris from an unrelated prior process
/// that reused this exact pid+counter pair. Removing it best-effort
/// before `create_new` (`remove_file` doesn't follow a symlink) covers
/// both without weakening `create_new`'s own `O_EXCL` guarantee for
/// concurrent, legitimate callers, since no such caller ever computes
/// this same name. `O_NOFOLLOW` is defense in depth on top, matching
/// `report.rs`'s `write_verified`.
///
/// `.mode(FILE_MODE)` is passed to the `open(2)` call itself, so the
/// file is never created wider than `0o644` at any point -- without
/// it, `OpenOptions`'s default mode (`0o666` ANDed with the process
/// umask) could leave the file briefly group/world-writable under a
/// permissive umask, between creation and the `set_permissions` call
/// that follows. `open(2)`'s own mode is only ever narrowed by umask,
/// never widened, so this can only make the creation-time mode equal
/// to or stricter than `0o644`. The subsequent `set_permissions` call
/// is kept as a defensive, umask-independent normalization step: it
/// guarantees the FINAL on-disk mode is deterministically `0o644`
/// regardless of the process umask (matching `FILE_MODE`'s own doc
/// comment and `file_is_written_with_0o644_permissions`'s pinned
/// expectation), even on a strict umask that would otherwise leave the
/// creation-time mode narrower than `0o644`.
#[cfg(unix)]
fn write_temp(tmp_path: &Path, record: &IdentityRecord) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let _ = std::fs::remove_file(tmp_path);

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(FILE_MODE)
        .custom_flags(O_NOFOLLOW)
        .open(tmp_path)?;
    file.set_permissions(std::fs::Permissions::from_mode(FILE_MODE))?;
    let mut rendered =
        serde_json::to_string_pretty(record).expect("IdentityRecord must always serialize");
    rendered.push('\n');
    file.write_all(rendered.as_bytes())
}

/// Non-Unix fallback: no `O_NOFOLLOW`/`create_new`/explicit-mode
/// machinery is available via `std::fs` alone on these targets, so this
/// is a plain best-effort write -- same trade-off `report.rs`'s own
/// `write_verified` non-Unix fallback makes (see that function's own
/// `#[cfg(not(unix))]` arm) rather than pulling in a third-party crate
/// for parity this binary does not otherwise need. The symlink/TOCTOU
/// hardening above is a Unix-specific concern this fallback does not
/// attempt to reproduce.
#[cfg(not(unix))]
fn write_temp(tmp_path: &Path, record: &IdentityRecord) -> std::io::Result<()> {
    let _ = std::fs::remove_file(tmp_path);
    let mut rendered =
        serde_json::to_string_pretty(record).expect("IdentityRecord must always serialize");
    rendered.push('\n');
    std::fs::write(tmp_path, rendered)
}

/// `O_NOFOLLOW` -- NOT a single numeric value shared across
/// Linux/BSD/macOS: on Linux/Android/illumos/Solaris it is `0o400_000`
/// (`0x20000`); on macOS and the *BSDs it is `0o400` (`0x100`).
/// cfg-gated per platform rather than pulling in a `libc` dependency
/// for a single flag (matching `report.rs`'s own local constant of the
/// same name and this crate's established convention of avoiding
/// `libc` for single-syscall/single-flag needs -- see `report.rs`'s
/// own `current_uid` doc comment). Unix-only, matching `write_temp`'s
/// own `#[cfg(unix)]` arm above, which is this constant's only user.
#[cfg(any(
    target_os = "linux",
    target_os = "android",
    target_os = "illumos",
    target_os = "solaris"
))]
const O_NOFOLLOW: i32 = 0o400_000;
#[cfg(all(
    unix,
    not(any(
        target_os = "linux",
        target_os = "android",
        target_os = "illumos",
        target_os = "solaris"
    ))
))]
const O_NOFOLLOW: i32 = 0o400;

/// Ensures the identity record exists at `target_dir`, creating one if
/// absent. Idempotent: a second call against
/// an already-populated target reads and reuses the existing `UUID`
/// rather than generating a new one. Returns the record now on disk
/// (either freshly written, or another writer's already-published one).
///
/// Concurrency: two callers racing this function against the same
/// `target_dir` both generate a `UUID` and both attempt to `hard_link`
/// their own temp file to the same final path. Exactly one `hard_link`
/// succeeds; the loser reads the winner's file and discards its own
/// generated `UUID`, so both callers end up returning the SAME record.
///
/// Schema skew: if a `NewerSchema` identity is already on disk (an
/// older binary running against an install a newer binary already
/// touched), this function skips the entire write/publish attempt --
/// it never generates a UUID, never writes a temp file, and never
/// touches the existing file. It returns the newer file's `UUID`
/// read-only if that value was extractable, or a freshly-generated,
/// unpersisted record otherwise (the same "absent" fallback shape
/// `read_identity` callers already get elsewhere, just never written
/// to disk here).
pub(crate) fn ensure_identity(target_dir: &Path, harness: &str) -> IdentityRecord {
    match read_identity_raw(target_dir) {
        ReadOutcome::Ok(existing) => return existing,
        ReadOutcome::NewerSchema { uuid: Some(uuid) } => {
            // A real, newer-schema identity exists. Use its UUID
            // read-only; never delete/overwrite the file.
            return IdentityRecord::new(uuid, harness);
        }
        ReadOutcome::NewerSchema { uuid: None } => {
            // Newer schema, but UUID itself isn't safely extractable.
            // Fall back to the nil-UUID sentinel for THIS event only
            // -- still never touching the file on disk.
            return IdentityRecord::new(NIL_UUID_SENTINEL.to_string(), harness);
        }
        ReadOutcome::Absent => {}
    }

    let dir = target_dir.join(KONDUCTOR_DIR_NAME);
    if std::fs::create_dir_all(&dir).is_err() {
        // Cannot even create the directory -- fall back to a fresh,
        // unpersisted record rather than panicking. A caller in this
        // state has no on-disk identity to read back later either, so
        // this is the same "absent" state `read_identity` would report,
        // just surfaced immediately instead of on a later read.
        return IdentityRecord::new(generate_uuid(target_dir), harness);
    }

    let uuid = generate_uuid(target_dir);
    let record = IdentityRecord::new(uuid, harness);
    let tmp = temp_path(target_dir);
    let final_path = identity_path(target_dir);
    let _tmp_guard = TempFileGuard::new(&tmp);

    if write_temp(&tmp, &record).is_err() {
        return record;
    }

    match std::fs::hard_link(&tmp, &final_path) {
        Ok(()) => {
            // Winner: dropping `tmp_guard` at the end of this call
            // removes the temp NAME only. The underlying inode now
            // has two names; removing one leaves `final_path` (and
            // its data) untouched.
            record
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            publish_loser(target_dir, &tmp, &record, &final_path)
        }
        Err(_) => {
            // Some other I/O error (e.g. permissions). Fall back to
            // the freshly-generated, unpersisted record -- consistent
            // with the "cannot create directory" fallback above. The
            // guard cleans up the temp file on the way out.
            record
        }
    }
}

/// Handles the losing side of a `hard_link` race: read the winner's
/// file; if malformed, remove it and retry the
/// `hard_link` exactly once (republishing this caller's own already-
/// generated `UUID` from its still-intact temp file); if that retry also
/// loses, read once more and either use that value or fall back to the
/// nil-UUID sentinel path (by returning `own_record` unpersisted, which
/// the report module's identity cache treats as "no identity" the same
/// way a missing file would be).
///
/// A `NewerSchema` destination is NOT "malformed" -- it's a real
/// identity a newer binary already published, mid-write or otherwise.
/// This function never deletes it: it discards its own temp file and
/// returns the newer file's UUID read-only (or the nil-UUID sentinel
/// for this event only, if the UUID itself wasn't extractable),
/// leaving the on-disk file exactly as it was.
///
/// `tmp`'s `TempFileGuard` is constructed once here and stays armed
/// across the whole call, including the one retry: every return path
/// removes `tmp` on the way out via that guard's drop, without needing
/// its own `remove_file` call.
fn publish_loser(
    target_dir: &Path,
    tmp: &Path,
    own_record: &IdentityRecord,
    final_path: &Path,
) -> IdentityRecord {
    let _tmp_guard = TempFileGuard::new(tmp);

    match read_identity_raw(target_dir) {
        ReadOutcome::Ok(winner) => return winner,
        ReadOutcome::NewerSchema { uuid } => {
            let uuid = uuid.unwrap_or_else(|| NIL_UUID_SENTINEL.to_string());
            return IdentityRecord::new(uuid, own_record.harness.clone());
        }
        ReadOutcome::Absent => {}
    }

    // Destination exists but is genuinely malformed (not newer-schema).
    // Remove it and retry our own hard_link exactly once.
    let _ = std::fs::remove_file(final_path);
    match std::fs::hard_link(tmp, final_path) {
        Ok(()) => own_record.clone(),
        Err(_) => {
            // A second writer won in the interim, or another error.
            // Read once more; if still malformed, proceed unattributed
            // -- one retry is the cap, never an unbounded loop. A
            // NewerSchema result here is treated the same as the first
            // check above: read-only, never re-deleted.
            match read_identity_raw(target_dir) {
                ReadOutcome::Ok(winner) => winner,
                ReadOutcome::NewerSchema { uuid } => {
                    let uuid = uuid.unwrap_or_else(|| NIL_UUID_SENTINEL.to_string());
                    IdentityRecord::new(uuid, own_record.harness.clone())
                }
                ReadOutcome::Absent => own_record.clone(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Confirms the identity record at `dir` actually persisted and
    /// returns it. `ensure_identity` fails closed to an unpersisted,
    /// in-memory record on a write failure (same UUID it generated,
    /// never written) rather than a sentinel, so its return value
    /// alone can't tell a real mint apart from one that never reached
    /// disk. Panics naming the write failure -- never lets a caller
    /// assert on a record that isn't really there.
    fn assert_identity_persisted(dir: &Path) -> IdentityRecord {
        read_identity(dir).unwrap_or_else(|| {
            panic!(
                "telemetry-id.json did not persist at {} -- this is a write failure, not the \
                 record's own field values; see stderr for the failing syscall",
                dir.display()
            )
        })
    }

    fn scratch_dir(name: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-telemetry-test-{name}-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_then_read_round_trips() {
        let dir = scratch_dir("round-trip");
        let record = ensure_identity(&dir, "kiro-cli");
        let read_back = assert_identity_persisted(&dir);
        assert_eq!(read_back, record);
        assert_eq!(read_back.harness, "kiro-cli");
        assert!(is_valid_uuid_shape(&read_back.uuid));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn second_ensure_reuses_existing_uuid() {
        let dir = scratch_dir("reuse");
        let first = ensure_identity(&dir, "kiro-cli");

        // Precondition: on a write failure, `ensure_identity` returns
        // its own freshly-generated UUID unpersisted, so a second call
        // would generate ANOTHER fresh UUID rather than reusing
        // anything -- the assert_eq below would already fail loudly
        // in that case, but without naming the write failure as the
        // cause.
        assert_identity_persisted(&dir);

        let second = ensure_identity(&dir, "kiro-cli");
        assert_eq!(first.uuid, second.uuid);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_returns_none_when_absent() {
        let dir = scratch_dir("absent");
        assert_eq!(read_identity(&dir), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_returns_none_for_corrupted_file() {
        let dir = scratch_dir("corrupted");
        let path = identity_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not json").unwrap();
        assert_eq!(read_identity(&dir), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_returns_none_for_malformed_uuid_shape() {
        let dir = scratch_dir("bad-uuid-shape");
        let path = identity_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            br#"{"schema_version":1,"version":"0.1.0","UUID":"not-a-valid-hash","harness":"kiro-cli"}"#,
        )
        .unwrap();
        assert_eq!(read_identity(&dir), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn read_returns_none_for_unsupported_schema_version() {
        let dir = scratch_dir("bad-schema");
        let path = identity_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            format!(
                r#"{{"schema_version":99,"version":"0.1.0","UUID":"{}","harness":"kiro-cli"}}"#,
                "a".repeat(64)
            ),
        )
        .unwrap();
        assert_eq!(read_identity(&dir), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn file_is_written_with_0o644_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch_dir("permissions");
        ensure_identity(&dir, "kiro-cli");

        // Precondition: names a write failure instead of a bare
        // `unwrap()` panic on the metadata call below, which would
        // otherwise blame a missing file on this test's own logic.
        assert_identity_persisted(&dir);

        let mode = fs::metadata(identity_path(&dir))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o644);
        fs::remove_dir_all(&dir).ok();
    }

    /// Symlink/TOCTOU regression: a symlink pre-placed at the exact
    /// deterministic temp path (`telemetry-id.json.tmp-<pid>`) must
    /// never be followed -- `write_temp`'s best-effort `remove_file`
    /// removes the symlink itself (never its target) and `create_new`
    /// then creates a genuine regular file in its place, so the write
    /// lands in a fresh file, not through the symlink into whatever it
    /// pointed at.
    #[test]
    fn write_temp_never_writes_through_a_symlink_at_the_temp_path() {
        let dir = scratch_dir("symlink-temp-path");
        let konductor_dir = dir.join(KONDUCTOR_DIR_NAME);
        fs::create_dir_all(&konductor_dir).unwrap();

        let real_elsewhere = dir.join("elsewhere.json");
        fs::write(&real_elsewhere, b"untouched").unwrap();
        let tmp_path = temp_path(&dir);
        std::os::unix::fs::symlink(&real_elsewhere, &tmp_path).unwrap();

        let record = IdentityRecord::new(generate_uuid(&dir), "kiro-cli");
        let result = write_temp(&tmp_path, &record);

        assert!(
            result.is_ok(),
            "the pre-placed symlink is removed and a fresh regular file created in its place: {result:?}"
        );
        assert_eq!(
            fs::read(&real_elsewhere).unwrap(),
            b"untouched",
            "must never write through the symlink into its target"
        );
        assert!(
            !tmp_path
                .symlink_metadata()
                .unwrap()
                .file_type()
                .is_symlink(),
            "the symlink at tmp_path must be replaced by a real regular file, not left in place"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// Regression: a second `ensure_identity` call in the SAME process
    /// against the SAME target, immediately after the first call was
    /// forced onto the loser side of a `hard_link` race, must still
    /// persist a record on THAT second call. `temp_path` is PID-
    /// derived (pre-fix), so both calls compute the identical tmp
    /// path; if the first call's own temp file were ever left behind,
    /// the second call's `create_new` would collide with it and fail
    /// closed.
    #[test]
    fn second_ensure_identity_call_after_a_loser_path_in_the_same_process_still_persists() {
        let dir = scratch_dir("second-call-after-loser");
        fs::create_dir_all(dir.join(KONDUCTOR_DIR_NAME)).unwrap();

        // Pre-populate the final record directly so the first
        // ensure_identity call below reads it back via
        // ReadOutcome::Ok, matching the shape a genuine loser-path
        // call would leave behind.
        let winner = IdentityRecord::new(generate_uuid(&dir), "kiro-cli");
        let final_path = identity_path(&dir);
        let winner_tmp = dir
            .join(KONDUCTOR_DIR_NAME)
            .join("telemetry-id.json.tmp-winner");
        write_temp(&winner_tmp, &winner).unwrap();
        std::fs::hard_link(&winner_tmp, &final_path).unwrap();
        std::fs::remove_file(&winner_tmp).ok();

        let first = ensure_identity(&dir, "kiro-cli");
        assert_eq!(first.uuid, winner.uuid);

        // Second call, same process, same target: temp_path(&dir)
        // resolves to the exact same PID-derived path (pre-fix) any
        // call this process makes for this target. If anything
        // upstream ever left that name occupied, this call's own
        // write_temp would hit create_new's AlreadyExists and fail
        // closed.
        let second = ensure_identity(&dir, "kiro-cli");
        let persisted = assert_identity_persisted(&dir);
        assert_eq!(persisted.uuid, winner.uuid);
        assert_eq!(second.uuid, winner.uuid);

        fs::remove_dir_all(&dir).ok();
    }

    /// Regression: two threads in ONE process calling `temp_path`
    /// against the SAME target must never compute the same name.
    /// `temp_path` is PID-derived; PID is identical across threads in
    /// one process, so without a per-call unique component, two
    /// concurrent callers collide on `create_new`.
    ///
    /// This test exercises `temp_path` alone -- it does not call
    /// `write_temp` or `ensure_identity`, so a regression in either's
    /// exclusive-create or `O_NOFOLLOW` handling would not be caught
    /// here. See
    /// `concurrent_ensure_identity_calls_in_one_process_converge_on_one_persisted_record`
    /// below for the end-to-end version of this same race.
    #[test]
    fn concurrent_callers_in_one_process_never_pick_the_same_temp_name() {
        let dir = std::sync::Arc::new(scratch_dir("concurrent-same-process"));
        fs::create_dir_all(dir.join(KONDUCTOR_DIR_NAME)).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let names_a = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let names_b = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

        let run = |dir: std::sync::Arc<PathBuf>,
                   barrier: std::sync::Arc<std::sync::Barrier>,
                   names: std::sync::Arc<std::sync::Mutex<Vec<PathBuf>>>| {
            move || {
                barrier.wait();
                for _ in 0..50 {
                    let path = temp_path(&dir);
                    names.lock().unwrap().push(path);
                }
            }
        };

        let handle_a = std::thread::spawn(run(dir.clone(), barrier.clone(), names_a.clone()));
        let handle_b = std::thread::spawn(run(dir.clone(), barrier, names_b.clone()));
        handle_a.join().unwrap();
        handle_b.join().unwrap();

        let a = names_a.lock().unwrap();
        let b = names_b.lock().unwrap();
        let a_set: std::collections::HashSet<_> = a.iter().collect();
        let b_set: std::collections::HashSet<_> = b.iter().collect();
        assert!(
            a_set.is_disjoint(&b_set),
            "two concurrent callers in one process must never compute the same temp-file \
             name; thread A and thread B both produced: {:?}",
            a_set.intersection(&b_set).collect::<Vec<_>>()
        );

        fs::remove_dir_all(dir.as_ref()).ok();
    }

    /// End-to-end version of the race above: two threads in ONE
    /// process racing `ensure_identity` (not just `temp_path`) against
    /// the SAME target must converge on ONE persisted `UUID`, with no
    /// leftover `.tmp-` files -- exercising `write_temp`'s
    /// `create_new`/`O_NOFOLLOW` and `ensure_identity`'s `hard_link`
    /// race-loser handling for real, not just the name-generator in
    /// isolation.
    #[test]
    fn concurrent_ensure_identity_calls_in_one_process_converge_on_one_persisted_record() {
        let dir = std::sync::Arc::new(scratch_dir("concurrent-ensure-identity-same-process"));
        fs::create_dir_all(dir.join(KONDUCTOR_DIR_NAME)).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));

        let run = |dir: std::sync::Arc<PathBuf>, barrier: std::sync::Arc<std::sync::Barrier>| {
            move || {
                barrier.wait();
                ensure_identity(&dir, "kiro-cli")
            }
        };

        let handle_a = std::thread::spawn(run(dir.clone(), barrier.clone()));
        let handle_b = std::thread::spawn(run(dir.clone(), barrier));
        let result_a = handle_a.join().unwrap();
        let result_b = handle_b.join().unwrap();

        assert_eq!(
            result_a.uuid, result_b.uuid,
            "two threads racing ensure_identity against the same target must converge on the \
             SAME uuid -- one of them lost the hard_link race and must have read the winner's \
             file back rather than persisting its own"
        );

        let persisted = assert_identity_persisted(&dir);
        assert_eq!(
            persisted.uuid, result_a.uuid,
            "the winning uuid must actually be the one on disk"
        );

        let leftovers: Vec<_> = fs::read_dir(dir.join(KONDUCTOR_DIR_NAME))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "the loser's own temp file must be cleaned up, not left behind: {leftovers:?}"
        );

        fs::remove_dir_all(dir.as_ref()).ok();
    }

    #[test]
    fn no_temp_file_left_behind_after_successful_publish() {
        let dir = scratch_dir("no-leftover");
        ensure_identity(&dir, "kiro-cli");

        // Precondition: names a write failure instead of a bare
        // `unwrap()` panic on the read_dir call below, which would
        // otherwise blame a missing .konductor/ dir on leftover-temp
        // logic rather than the write that never happened.
        assert_identity_persisted(&dir);

        let leftovers: Vec<_> = fs::read_dir(dir.join(KONDUCTOR_DIR_NAME))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftovers.is_empty());
        fs::remove_dir_all(&dir).ok();
    }

    /// Simulates a concurrent-publish race: two temp-file-then-hard_link
    /// attempts against the same final path yield exactly one winner and
    /// one `AlreadyExists` reader on the `hard_link` call, both ending on
    /// the same `UUID`, with the loser's own temp file removed.
    #[test]
    fn concurrent_publish_race_converges_on_one_uuid() {
        let dir = scratch_dir("race");
        fs::create_dir_all(dir.join(KONDUCTOR_DIR_NAME)).unwrap();

        // Simulate "process A": generate + write temp + hard_link.
        let record_a = IdentityRecord::new(generate_uuid(&dir), "kiro-cli");
        let tmp_a = dir
            .join(KONDUCTOR_DIR_NAME)
            .join("telemetry-id.json.tmp-1111");
        write_temp(&tmp_a, &record_a).unwrap();

        // Simulate "process B": generate + write temp + hard_link,
        // racing against A.
        let record_b = IdentityRecord::new(generate_uuid(&dir), "kiro-cli");
        let tmp_b = dir
            .join(KONDUCTOR_DIR_NAME)
            .join("telemetry-id.json.tmp-2222");
        write_temp(&tmp_b, &record_b).unwrap();

        let final_path = identity_path(&dir);

        // A wins.
        std::fs::hard_link(&tmp_a, &final_path).expect("A must win the race");
        std::fs::remove_file(&tmp_a).ok();

        // B loses: hard_link fails with AlreadyExists.
        let b_result = std::fs::hard_link(&tmp_b, &final_path);
        assert!(matches!(
            b_result,
            Err(ref e) if e.kind() == std::io::ErrorKind::AlreadyExists
        ));
        let winner = publish_loser(&dir, &tmp_b, &record_b, &final_path);

        assert_eq!(winner.uuid, record_a.uuid);
        assert_ne!(
            winner.uuid, record_b.uuid,
            "the loser's own UUID must not win"
        );
        assert!(!tmp_b.exists(), "loser's own temp file must be removed");

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn is_valid_uuid_shape_rejects_uppercase_and_wrong_length() {
        assert!(is_valid_uuid_shape(&"a".repeat(64)));
        assert!(!is_valid_uuid_shape(&"A".repeat(64)));
        assert!(!is_valid_uuid_shape(&"a".repeat(63)));
        assert!(!is_valid_uuid_shape(&"g".repeat(64)));
    }

    /// FINDING 1 regression: an older binary calling `ensure_identity`
    /// against a file published by a NEWER binary (higher
    /// `schema_version`, otherwise valid `UUID`) must never delete or
    /// overwrite that file. The file must be byte-identical before and
    /// after, and the returned record's UUID must be the one already on
    /// disk -- read-only, never a freshly-generated replacement.
    #[test]
    fn ensure_identity_never_clobbers_newer_schema_version() {
        let dir = scratch_dir("newer-schema-no-clobber");
        let path = identity_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();

        let newer_uuid = "b".repeat(64);
        let newer_contents = format!(
            r#"{{"schema_version":999,"version":"9.9.9","UUID":"{newer_uuid}","harness":"future-harness","new_field_this_binary_does_not_know_about":"x"}}"#
        );
        fs::write(&path, &newer_contents).unwrap();

        let before = fs::read(&path).unwrap();

        let result = ensure_identity(&dir, "kiro-cli");

        let after = fs::read(&path).unwrap();
        assert_eq!(
            before, after,
            "the on-disk newer-schema file must be byte-identical before and after"
        );
        assert_eq!(
            result.uuid, newer_uuid,
            "must read the newer file's own UUID read-only, not generate a new one"
        );

        fs::remove_dir_all(&dir).ok();
    }

    /// Same as above, but via the direct `read_identity_raw` -- confirms
    /// the classification itself (not just `ensure_identity`'s use of
    /// it) treats a higher `schema_version` as `NewerSchema`, never
    /// `Absent`.
    #[test]
    fn read_identity_raw_classifies_newer_schema_version_distinctly() {
        let dir = scratch_dir("newer-schema-classification");
        let path = identity_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let uuid = "c".repeat(64);
        fs::write(
            &path,
            format!(r#"{{"schema_version":2,"version":"2.0.0","UUID":"{uuid}","harness":"h"}}"#),
        )
        .unwrap();

        match read_identity_raw(&dir) {
            ReadOutcome::NewerSchema { uuid: Some(u) } => assert_eq!(u, uuid),
            other => panic!("expected NewerSchema with extracted UUID, got {other:?}"),
        }

        // The convenience `read_identity` wrapper still reports this as
        // "not a usable record of my own schema" (`None`) -- it is the
        // write/publish path (`ensure_identity`/`publish_loser`) that
        // must special-case `NewerSchema`, not this read-only getter.
        assert_eq!(read_identity(&dir), None);

        fs::remove_dir_all(&dir).ok();
    }

    /// A newer-schema file whose `UUID` field is missing or malformed
    /// still must not be deleted -- `ensure_identity` falls back to the
    /// nil-UUID sentinel for this event only, leaving the file on disk
    /// untouched.
    #[test]
    fn ensure_identity_falls_back_to_nil_sentinel_when_newer_schema_uuid_unreadable() {
        let dir = scratch_dir("newer-schema-bad-uuid");
        let path = identity_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let newer_contents =
            r#"{"schema_version":42,"version":"4.2.0","UUID":"not-hex-shaped","harness":"h"}"#;
        fs::write(&path, newer_contents).unwrap();
        let before = fs::read(&path).unwrap();

        let result = ensure_identity(&dir, "kiro-cli");

        let after = fs::read(&path).unwrap();
        assert_eq!(before, after, "file must remain untouched");
        assert_eq!(result.uuid, NIL_UUID_SENTINEL);

        fs::remove_dir_all(&dir).ok();
    }

    /// A genuinely malformed file (no `schema_version` field at all)
    /// remains eligible for the existing clobber-and-republish recovery
    /// path -- confirms the fix didn't accidentally widen `Absent` into
    /// `NewerSchema` for files with no version info at all.
    #[test]
    fn file_with_no_schema_version_field_is_still_treated_as_absent() {
        let dir = scratch_dir("no-schema-field");
        let path = identity_path(&dir);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            format!(
                r#"{{"version":"0.1.0","UUID":"{}","harness":"h"}}"#,
                "d".repeat(64)
            ),
        )
        .unwrap();

        assert!(matches!(read_identity_raw(&dir), ReadOutcome::Absent));

        fs::remove_dir_all(&dir).ok();
    }
}
