// SPDX-License-Identifier: Apache-2.0
//
// konductor-telemetry::identity — shared identity primitives used by both
// cli/konductor-rs and mcp/lib/skill-lookup-core.
//
// Owns the machine-scoped instance record at
// `$HOME/.konductor/telemetry.json`, plus the nil-UUID sentinel and
// UUID-shape validation. Does not own the per-target
// `telemetry-id.json` (`IdentityRecord`) -- that mixes in `target_dir`
// and has uninstall/update carry-forward semantics with no MCP analog.
//
// Every function takes `home_dir: &Path` explicitly and never
// resolves `$HOME` itself.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[cfg(unix)]
pub fn current_uid() -> u32 {
    extern "C" {
        fn getuid() -> u32;
    }
    // SAFETY: getuid(2) takes no arguments and cannot fail.
    unsafe { getuid() }
}

#[cfg(not(unix))]
pub fn current_uid() -> u32 {
    0
}

/// Creates `dir` with `0o700`, then verifies the leaf is a real
/// directory owned by this process's own UID -- a pre-created
/// directory owned by another user, or a symlink at the leaf path
/// (which `chmod(2)` would follow), fails closed instead of being
/// trusted.
#[cfg(unix)]
pub fn create_private_dir_all(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    std::fs::create_dir_all(dir)?;

    let leaf_meta = std::fs::symlink_metadata(dir)?;
    if leaf_meta.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "refusing to use {}: a symlink exists at this exact path \
                 instead of a real directory",
                dir.display()
            ),
        ));
    }
    if !leaf_meta.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("refusing to use {}: not a directory", dir.display()),
        ));
    }
    if leaf_meta.uid() != current_uid() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            format!(
                "refusing to use {}: owned by uid {}, not this process's own uid {}",
                dir.display(),
                leaf_meta.uid(),
                current_uid()
            ),
        ));
    }

    std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
pub fn create_private_dir_all(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Lowercase hex SHA-256 digest of `data`.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Used when no identity is safely resolvable: unattributed usage, an
/// unreadable instance record, or a newer-schema record whose `UUID`
/// didn't parse.
pub const NIL_UUID_SENTINEL: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

pub fn is_valid_uuid_shape(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// Must match `cli/konductor-rs`'s own `config::KONDUCTOR_DIR_NAME`
/// exactly -- duplicated rather than imported, since `cli::config` is
/// CLI-internal.
pub const KONDUCTOR_DIR_NAME: &str = ".konductor";

pub const INSTANCE_SCHEMA_VERSION: u64 = 1;

const TELEMETRY_FILE_NAME: &str = "telemetry.json";

/// Stricter than the per-target identity file's `0o644`, since this
/// record also carries `telemetry_consent`.
const FILE_MODE: u32 = 0o600;

/// `$HOME/.konductor/telemetry.json`'s on-disk shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstanceRecord {
    pub schema_version: u64,
    #[serde(rename = "UUID")]
    pub uuid: String,
    pub created_at: String,
    pub telemetry_consent: bool,
}

impl InstanceRecord {
    fn new(uuid: String, telemetry_consent: bool, created_at: String) -> Self {
        InstanceRecord {
            schema_version: INSTANCE_SCHEMA_VERSION,
            uuid,
            created_at,
            telemetry_consent,
        }
    }
}

pub fn instance_path(home_dir: &Path) -> PathBuf {
    home_dir.join(KONDUCTOR_DIR_NAME).join(TELEMETRY_FILE_NAME)
}

/// No path component mixed in, unlike the per-target identity's
/// generator -- one stable UUID per machine.
pub fn generate_instance_uuid() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let input = format!("{nanos}-{}", std::process::id());
    sha256_hex(input.as_bytes())
}

/// Outcome of a `read_instance_raw` attempt.
#[derive(Debug)]
pub enum ReadOutcome {
    /// A well-formed record at this binary's own
    /// `INSTANCE_SCHEMA_VERSION`.
    Ok(InstanceRecord),
    /// A real instance record published by a newer binary. Never safe
    /// to delete or overwrite -- doing so would fragment one
    /// machine's identity into two. Carries the `UUID` verbatim if it
    /// parsed.
    NewerSchema { uuid: Option<String> },
    /// Missing, unreadable, malformed, or a UUID failing
    /// `^[a-f0-9]{64}$`.
    Absent,
}

pub fn read_instance_raw(home_dir: &Path) -> ReadOutcome {
    let path = instance_path(home_dir);
    let contents = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return ReadOutcome::Absent,
    };
    let value: serde_json::Value = match serde_json::from_str(&contents) {
        Ok(v) => v,
        Err(_) => return ReadOutcome::Absent,
    };
    let Some(schema_version) = value.get("schema_version").and_then(|v| v.as_u64()) else {
        return ReadOutcome::Absent;
    };

    if schema_version > INSTANCE_SCHEMA_VERSION {
        let uuid = value
            .get("UUID")
            .and_then(|v| v.as_str())
            .filter(|s| is_valid_uuid_shape(s))
            .map(|s| s.to_string());
        return ReadOutcome::NewerSchema { uuid };
    }

    let record: InstanceRecord = match serde_json::from_value(value) {
        Ok(r) => r,
        Err(_) => return ReadOutcome::Absent,
    };
    if record.schema_version != INSTANCE_SCHEMA_VERSION || !is_valid_uuid_shape(&record.uuid) {
        return ReadOutcome::Absent;
    }
    ReadOutcome::Ok(record)
}

pub fn read_instance(home_dir: &Path) -> Option<InstanceRecord> {
    match read_instance_raw(home_dir) {
        ReadOutcome::Ok(record) => Some(record),
        ReadOutcome::NewerSchema { .. } | ReadOutcome::Absent => None,
    }
}

/// Resolves the `UUID` to send on the wire, never minting. The
/// instance record is never unlinked and fails closed to
/// `NIL_UUID_SENTINEL` instead -- never falls back to a per-target
/// identity.
pub fn resolve_instance_uuid_for_wire(home_dir: &Path) -> String {
    match read_instance_raw(home_dir) {
        ReadOutcome::Ok(record) => record.uuid,
        ReadOutcome::NewerSchema { uuid: Some(uuid) } => uuid,
        ReadOutcome::NewerSchema { uuid: None } | ReadOutcome::Absent => {
            NIL_UUID_SENTINEL.to_string()
        }
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

fn temp_path(home_dir: &Path) -> PathBuf {
    let dir = home_dir.join(KONDUCTOR_DIR_NAME);
    let counter = TEMP_NAME_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    dir.join(format!(
        "{TELEMETRY_FILE_NAME}.tmp-{}-{counter}",
        std::process::id()
    ))
}

/// Removes the temp file at `path` when dropped. Exists so every
/// `ensure_instance`/`publish_instance_loser` return path cleans up
/// its own temp file by construction, rather than each branch needing
/// its own `remove_file` call -- including the winning `hard_link`
/// branch: the temp file's inode is also linked at `final_path` by
/// then, so removing the temp NAME leaves the final path's data
/// untouched (two links, one inode; dropping one link never deletes
/// the data while the other remains).
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

#[cfg(unix)]
fn write_temp(tmp_path: &Path, record: &InstanceRecord) -> std::io::Result<()> {
    use std::io::Write as _;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    // The temp name includes a per-call counter (see `temp_path`
    // above), so nothing else in this process ever targets the same
    // path while this call is in flight -- a pre-existing entry here
    // is never a live sibling call's own temp file, only a pre-planted
    // symlink or debris from an unrelated prior process that reused
    // this exact pid+counter pair. Removing it best-effort before
    // `create_new` covers both without weakening `O_EXCL`'s guarantee
    // for concurrent, legitimate callers.
    let _ = std::fs::remove_file(tmp_path);

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(FILE_MODE)
        .custom_flags(O_NOFOLLOW)
        .open(tmp_path)?;
    file.set_permissions(std::fs::Permissions::from_mode(FILE_MODE))?;
    let mut rendered =
        serde_json::to_string_pretty(record).expect("InstanceRecord must always serialize");
    rendered.push('\n');
    file.write_all(rendered.as_bytes())
}

#[cfg(not(unix))]
fn write_temp(tmp_path: &Path, record: &InstanceRecord) -> std::io::Result<()> {
    let _ = std::fs::remove_file(tmp_path);
    let mut rendered =
        serde_json::to_string_pretty(record).expect("InstanceRecord must always serialize");
    rendered.push('\n');
    std::fs::write(tmp_path, rendered)
}

/// `O_NOFOLLOW` -- NOT a single numeric value shared across
/// Linux/BSD/macOS: on Linux/Android/illumos/Solaris it is `0o400_000`
/// (`0x20000`); on macOS and the *BSDs it is `0o400` (`0x100`).
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

/// Ensures the instance record exists at `home_dir`, creating one if
/// absent. Idempotent: reuses the existing `UUID` on a repopulated
/// `$HOME`. `initial_consent` only applies on first mint.
///
/// Publishes via a temp file plus `hard_link`, not `rename`, for
/// exclusive creation: `link(2)` fails atomically with `AlreadyExists`
/// when the destination is already populated, so two processes racing
/// to mint the first record converge on one winner.
///
/// The record is never unlinked once published; a call that cannot
/// resolve a safe `UUID` fails closed to the nil sentinel for that
/// call alone rather than repairing the file on disk.
pub fn ensure_instance(
    home_dir: &Path,
    initial_consent: bool,
    now_iso_millis: impl Fn() -> String,
) -> InstanceRecord {
    match read_instance_raw(home_dir) {
        ReadOutcome::Ok(existing) => return existing,
        ReadOutcome::NewerSchema { uuid: Some(uuid) } => {
            // Fails closed to false: a NewerSchema read has no
            // consent field to source a real value from.
            return InstanceRecord::new(uuid, false, now_iso_millis());
        }
        ReadOutcome::NewerSchema { uuid: None } => {
            return InstanceRecord::new(NIL_UUID_SENTINEL.to_string(), false, now_iso_millis());
        }
        ReadOutcome::Absent => {}
    }

    let dir = home_dir.join(KONDUCTOR_DIR_NAME);
    if let Err(err) = create_private_dir_all(&dir) {
        // Names the failing syscall on the way to a fail-closed
        // return -- a bare `.is_err()` gave no way to tell a real
        // write failure (ENOSPC, EROFS, permission) apart from any
        // other reason this call fell through to the nil sentinel.
        eprintln!(
            "konductor-telemetry: create_private_dir_all failed, failing closed: kind={:?} path={} raw={err}",
            err.kind(),
            dir.display(),
        );
        // A failed write fails closed rather than returning an
        // unpersisted record a caller could mistake for a real mint.
        return InstanceRecord::new(NIL_UUID_SENTINEL.to_string(), false, now_iso_millis());
    }

    let uuid = generate_instance_uuid();
    let record = InstanceRecord::new(uuid, initial_consent, now_iso_millis());
    let tmp = temp_path(home_dir);
    let final_path = instance_path(home_dir);
    let _tmp_guard = TempFileGuard::new(&tmp);

    if let Err(err) = write_temp(&tmp, &record) {
        eprintln!(
            "konductor-telemetry: write_temp failed, failing closed: kind={:?} tmp_path={} raw={err}",
            err.kind(),
            tmp.display(),
        );
        return InstanceRecord::new(NIL_UUID_SENTINEL.to_string(), false, now_iso_millis());
    }

    match std::fs::hard_link(&tmp, &final_path) {
        Ok(()) => {
            // Winner: dropping `tmp_guard` at the end of this call
            // removes the temp NAME only, leaving `final_path`'s
            // linked data untouched.
            record
        }
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            publish_instance_loser(home_dir, &tmp, now_iso_millis)
        }
        Err(err) => {
            eprintln!(
                "konductor-telemetry: hard_link failed, failing closed: kind={:?} tmp={} final={} raw={err}",
                err.kind(),
                tmp.display(),
                final_path.display(),
            );
            InstanceRecord::new(NIL_UUID_SENTINEL.to_string(), false, now_iso_millis())
        }
    }
}

/// Losing side of a `hard_link` race. Unlike the per-target identity's
/// `publish_loser`, this never removes a malformed destination and
/// retries -- an instance record is this machine's one shared
/// identity; a retry could mint a second, competing one.
///
/// `tmp`'s `TempFileGuard` is constructed by the caller and stays
/// armed through this whole call, so every return path here -- `Ok`,
/// `NewerSchema`, or `Absent` -- removes `tmp` on the way out via that
/// guard's drop, without needing its own `remove_file` call.
fn publish_instance_loser(
    home_dir: &Path,
    tmp: &Path,
    now_iso_millis: impl Fn() -> String,
) -> InstanceRecord {
    let _tmp_guard = TempFileGuard::new(tmp);
    match read_instance_raw(home_dir) {
        ReadOutcome::Ok(winner) => winner,
        ReadOutcome::NewerSchema { uuid } => {
            let uuid = uuid.unwrap_or_else(|| NIL_UUID_SENTINEL.to_string());
            InstanceRecord::new(uuid, false, now_iso_millis())
        }
        ReadOutcome::Absent => {
            InstanceRecord::new(NIL_UUID_SENTINEL.to_string(), false, now_iso_millis())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// Confirms the instance record at `home` actually persisted and
    /// returns it, through `read_instance` rather than a mint call's
    /// own return value: `ensure_instance` fails closed on a write
    /// failure, so the return value alone can't distinguish an
    /// unpersisted fallback from a real mint. Panics naming the write
    /// failure -- never lets a caller assert on a shape that was never
    /// really on disk.
    fn assert_instance_persisted(home: &Path) -> InstanceRecord {
        read_instance(home).unwrap_or_else(|| {
            panic!(
                "telemetry.json did not persist at {} -- this is a write failure, not the \
                 record's own field values; see stderr for the failing syscall",
                home.display()
            )
        })
    }

    fn scratch_home(name: &str) -> PathBuf {
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

    fn fixed_now() -> String {
        "2026-01-01T00:00:00.000Z".to_string()
    }

    #[test]
    fn is_valid_uuid_shape_accepts_64_lowercase_hex() {
        assert!(is_valid_uuid_shape(&"a".repeat(64)));
        assert!(!is_valid_uuid_shape(&"A".repeat(64)));
        assert!(!is_valid_uuid_shape(&"a".repeat(63)));
    }

    #[test]
    fn nil_uuid_sentinel_is_64_zero_chars() {
        assert_eq!(NIL_UUID_SENTINEL.len(), 64);
        assert!(NIL_UUID_SENTINEL.chars().all(|c| c == '0'));
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn fresh_mint_produces_valid_shape() {
        let home = scratch_home("fresh-mint");
        let record = ensure_instance(&home, true, fixed_now);

        // Precondition, checked BEFORE the shape assertions below: a
        // write failure fails closed to the nil sentinel and
        // consent=false, which would otherwise fail these assertions
        // with a message that names the wrong cause.
        let read_back = assert_instance_persisted(&home);
        assert_eq!(read_back, record);

        assert!(is_valid_uuid_shape(&record.uuid));
        assert_eq!(record.schema_version, INSTANCE_SCHEMA_VERSION);
        assert!(record.telemetry_consent);
        fs::remove_dir_all(&home).ok();
    }

    /// Regression: must never return an in-memory record that looks
    /// like a successful mint when `create_dir_all` actually failed.
    #[test]
    fn create_dir_all_failure_never_fabricates_an_unpersisted_record() {
        let home = scratch_home("create-dir-all-fails");
        fs::write(home.join(KONDUCTOR_DIR_NAME), b"not a directory").unwrap();

        let record = ensure_instance(&home, true, fixed_now);
        assert!(
            !record.telemetry_consent,
            "a record this call could not persist must fail closed (telemetry_consent: \
             false), never report the caller's requested default as if it had been minted"
        );
        assert_eq!(
            record.uuid, NIL_UUID_SENTINEL,
            "an unpersisted record must carry the nil sentinel, never a freshly generated \
             UUID a caller could mistake for a real, readable instance identity"
        );

        assert!(
            read_instance(&home).is_none(),
            "telemetry.json must NOT exist after a call whose create_dir_all failed -- this \
             is the exact condition the prior fabricated-record bug masked: a caller reading \
             the return value alone saw what looked like a successful mint"
        );

        fs::remove_dir_all(&home).ok();
    }

    /// A symlink pre-created at the exact `.konductor` path must not
    /// be followed and chmod'd/written through.
    #[cfg(unix)]
    #[test]
    fn ensure_instance_fails_closed_when_konductor_dir_is_a_symlink() {
        let home = scratch_home("konductor-dir-is-symlink");
        let real_elsewhere = home.parent().unwrap().join(format!(
            "elsewhere-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&real_elsewhere).unwrap();
        std::os::unix::fs::symlink(&real_elsewhere, home.join(KONDUCTOR_DIR_NAME)).unwrap();

        let record = ensure_instance(&home, true, fixed_now);

        assert!(
            !record.telemetry_consent,
            "a symlinked .konductor must fail closed (telemetry_consent: false), \
             never mint through the symlink"
        );
        assert_eq!(record.uuid, NIL_UUID_SENTINEL);
        assert!(
            home.join(KONDUCTOR_DIR_NAME)
                .symlink_metadata()
                .unwrap()
                .file_type()
                .is_symlink(),
            "the symlink itself must be left in place, not deleted or replaced"
        );
        assert!(
            !real_elsewhere.join(TELEMETRY_FILE_NAME).exists(),
            "the instance record must never be written through the symlink to \
             wherever it points"
        );

        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&real_elsewhere).ok();
    }

    #[test]
    fn second_call_reuses_existing_uuid_not_remint() {
        let home = scratch_home("reuse");
        let first = ensure_instance(&home, true, fixed_now);

        // Precondition: a write failure fails closed to the same nil
        // sentinel and consent value on every call, which would make
        // the equality assertions below pass for the wrong reason --
        // proving nothing about reuse, only that both calls hit the
        // same broken write path.
        assert_instance_persisted(&home);

        let second = ensure_instance(&home, false, fixed_now);
        assert_eq!(first.uuid, second.uuid);
        assert_eq!(first.telemetry_consent, second.telemetry_consent);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn resolves_only_the_supplied_home_dir_never_a_derived_path() {
        let home_a = scratch_home("home-a");
        let home_b = scratch_home("home-b");

        let record_a = ensure_instance(&home_a, true, fixed_now);

        // Precondition: a write failure at home_a fails closed to the
        // nil sentinel, which record_b (a genuine mint) would never
        // collide with -- the assert_ne below would already fail
        // loudly in that case, but without naming the write failure
        // as the cause.
        assert_instance_persisted(&home_a);

        assert_eq!(
            read_instance(&home_b),
            None,
            "a second, distinct home_dir must not see the first home_dir's record"
        );

        let record_b = ensure_instance(&home_b, true, fixed_now);
        assert_ne!(
            record_a.uuid, record_b.uuid,
            "two distinct home_dir values must mint two distinct instance records"
        );

        fs::remove_dir_all(&home_a).ok();
        fs::remove_dir_all(&home_b).ok();
    }

    #[test]
    fn concurrent_publishers_converge_on_one_value() {
        let home = scratch_home("race");
        fs::create_dir_all(home.join(KONDUCTOR_DIR_NAME)).unwrap();

        let final_path = instance_path(&home);

        let record_a = InstanceRecord::new(generate_instance_uuid(), true, fixed_now());
        let tmp_a = home
            .join(KONDUCTOR_DIR_NAME)
            .join("telemetry.json.tmp-1111");
        write_temp(&tmp_a, &record_a).unwrap();

        let record_b = InstanceRecord::new(generate_instance_uuid(), true, fixed_now());
        let tmp_b = home
            .join(KONDUCTOR_DIR_NAME)
            .join("telemetry.json.tmp-2222");
        write_temp(&tmp_b, &record_b).unwrap();

        let record_c = InstanceRecord::new(generate_instance_uuid(), true, fixed_now());
        let tmp_c = home
            .join(KONDUCTOR_DIR_NAME)
            .join("telemetry.json.tmp-3333");
        write_temp(&tmp_c, &record_c).unwrap();

        std::fs::hard_link(&tmp_a, &final_path).expect("A must win the race");
        std::fs::remove_file(&tmp_a).ok();

        let b_result = std::fs::hard_link(&tmp_b, &final_path);
        assert!(matches!(
            b_result,
            Err(ref e) if e.kind() == std::io::ErrorKind::AlreadyExists
        ));
        let b_final = publish_instance_loser(&home, &tmp_b, fixed_now);

        let c_result = std::fs::hard_link(&tmp_c, &final_path);
        assert!(matches!(
            c_result,
            Err(ref e) if e.kind() == std::io::ErrorKind::AlreadyExists
        ));
        let c_final = publish_instance_loser(&home, &tmp_c, fixed_now);

        assert_eq!(b_final.uuid, record_a.uuid, "B must adopt A's UUID");
        assert_eq!(c_final.uuid, record_a.uuid, "C must adopt A's UUID");
        assert!(!tmp_b.exists(), "B's own temp file must be removed");
        assert!(!tmp_c.exists(), "C's own temp file must be removed");

        let on_disk = read_instance(&home).expect("winner must be readable");
        assert_eq!(on_disk.uuid, record_a.uuid);

        fs::remove_dir_all(&home).ok();
    }

    /// Regression: a second `ensure_instance` call in the SAME process
    /// against the SAME home, immediately after the first call took
    /// the loser side of a `hard_link` race, must still persist a
    /// record on THAT second call. `temp_path` is PID-derived, so both
    /// calls compute the identical tmp path; if the first call's own
    /// temp file were ever left behind, the second call's
    /// `create_new` would collide with it and fail closed.
    #[test]
    fn second_ensure_instance_call_after_a_loser_path_in_the_same_process_still_persists() {
        let home = scratch_home("second-call-after-loser");
        fs::create_dir_all(home.join(KONDUCTOR_DIR_NAME)).unwrap();

        // Pre-populate the final record so the FIRST ensure_instance
        // call below is forced onto the loser path deterministically
        // (rather than depending on a real race), exercising exactly
        // the branch the evidence's stack trace passed through.
        let winner = InstanceRecord::new(generate_instance_uuid(), true, fixed_now());
        let final_path = instance_path(&home);
        let winner_tmp = home
            .join(KONDUCTOR_DIR_NAME)
            .join("telemetry.json.tmp-winner");
        write_temp(&winner_tmp, &winner).unwrap();
        std::fs::hard_link(&winner_tmp, &final_path).unwrap();
        std::fs::remove_file(&winner_tmp).ok();

        // First call in this process: read_instance_raw sees the
        // pre-populated file directly as ReadOutcome::Ok and returns
        // early -- it never reaches write_temp/hard_link at all. To
        // exercise the loser path itself (not just an early-return),
        // remove the file back out from under it immediately before
        // calling, forcing this call through create_dir_all -> mint ->
        // hard_link -> AlreadyExists -> publish_instance_loser.
        //
        // This models: process wins the mint, but by the time a LATER
        // call in the same process runs, the file already exists again
        // (the realistic shape being tested: this call takes the
        // loser branch and must not leave its own temp behind for the
        // next call to trip over).
        let first = ensure_instance(&home, true, fixed_now);
        assert_eq!(
            first.uuid, winner.uuid,
            "the pre-populated file must already be readable as the existing record, so this \
             call takes the ReadOutcome::Ok early-return, not a fresh mint"
        );

        // Second call, same process, same home: temp_path(&home)
        // resolves to the exact same PID-derived path as any call this
        // process makes for this home. If anything upstream ever left
        // that name occupied, this call's own write_temp would hit
        // create_new's AlreadyExists and fail closed -- exactly the
        // evidence's stack trace.
        let second = ensure_instance(&home, false, fixed_now);
        let persisted = assert_instance_persisted(&home);
        assert_eq!(
            persisted.uuid, winner.uuid,
            "second call in the same process must still read back the same persisted record"
        );
        assert_eq!(second.uuid, winner.uuid);

        fs::remove_dir_all(&home).ok();
    }

    /// Regression: two threads in ONE process racing `ensure_instance`
    /// against the SAME home must never compute the same temp-file
    /// name. `temp_path` is PID-derived; PID is identical across
    /// threads in one process, so without a per-call unique component,
    /// two concurrent callers collide on `create_new`.
    ///
    /// This does not merely check that both calls eventually succeed
    /// (`write_temp`'s own pre-entry `remove_file` could paper over a
    /// collision by deleting a sibling thread's in-flight temp and
    /// letting `create_new` succeed on the second try, silently
    /// corrupting whichever thread's write got clobbered). It captures
    /// every temp-file name each call's `write_temp` actually opens and
    /// asserts the two sets are disjoint.
    #[test]
    fn concurrent_callers_in_one_process_never_pick_the_same_temp_name() {
        let home = std::sync::Arc::new(scratch_home("concurrent-same-process"));
        fs::create_dir_all(home.join(KONDUCTOR_DIR_NAME)).unwrap();

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let names_a = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let names_b = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));

        let run = |home: std::sync::Arc<PathBuf>,
                   barrier: std::sync::Arc<std::sync::Barrier>,
                   names: std::sync::Arc<std::sync::Mutex<Vec<PathBuf>>>| {
            move || {
                barrier.wait();
                for _ in 0..50 {
                    let path = temp_path(&home);
                    names.lock().unwrap().push(path);
                }
            }
        };

        let handle_a = std::thread::spawn(run(home.clone(), barrier.clone(), names_a.clone()));
        let handle_b = std::thread::spawn(run(home.clone(), barrier, names_b.clone()));
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

        fs::remove_dir_all(home.as_ref()).ok();
    }

    #[test]
    fn unreadable_record_yields_sentinel_without_removing_file() {
        let home = scratch_home("malformed-no-delete");
        let path = instance_path(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"not json at all").unwrap();
        let before = fs::read(&path).unwrap();

        let result = ensure_instance(&home, true, fixed_now);

        assert_eq!(result.uuid, NIL_UUID_SENTINEL);
        assert!(!result.telemetry_consent);
        let after = fs::read(&path).unwrap();
        assert_eq!(before, after, "the malformed file must never be touched");
        assert!(path.exists());

        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn resolve_instance_uuid_for_wire_never_writes() {
        let home = scratch_home("resolve-never-writes");
        let uuid = resolve_instance_uuid_for_wire(&home);
        assert_eq!(uuid, NIL_UUID_SENTINEL);
        assert!(
            !instance_path(&home).exists(),
            "a read-only resolve must never create the file"
        );
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn resolve_instance_uuid_for_wire_reads_existing_record() {
        let home = scratch_home("resolve-reads-existing");
        let minted = ensure_instance(&home, true, fixed_now);

        // Precondition: on a write failure, both `minted.uuid` and
        // `resolved` independently fall to the same nil sentinel, so
        // the equality below would pass without proving the read path
        // actually found a persisted record.
        assert_instance_persisted(&home);

        let resolved = resolve_instance_uuid_for_wire(&home);
        assert_eq!(resolved, minted.uuid);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn file_is_written_with_0o600_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let home = scratch_home("permissions");
        ensure_instance(&home, true, fixed_now);

        // Precondition: names a write failure instead of a bare
        // `unwrap()` panic on the metadata call below, which would
        // otherwise blame a missing file on this test's own logic.
        assert_instance_persisted(&home);

        let mode = fs::metadata(instance_path(&home))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn newer_schema_record_read_without_modification() {
        let home = scratch_home("newer-schema");
        let path = instance_path(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();

        let newer_uuid = "b".repeat(64);
        let newer_contents = format!(
            r#"{{"schema_version":999,"UUID":"{newer_uuid}","created_at":"2099-01-01T00:00:00.000Z","telemetry_consent":true,"new_field":"x"}}"#
        );
        fs::write(&path, &newer_contents).unwrap();
        let before = fs::read(&path).unwrap();

        let result = ensure_instance(&home, true, fixed_now);

        let after = fs::read(&path).unwrap();
        assert_eq!(before, after);
        assert_eq!(result.uuid, newer_uuid);

        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn ensure_instance_fails_closed_to_no_consent_on_newer_schema_uuid() {
        let home = scratch_home("newer-schema-consent-fail-closed");
        let path = instance_path(&home);
        fs::create_dir_all(path.parent().unwrap()).unwrap();

        let newer_uuid = "e".repeat(64);
        let newer_contents = format!(
            r#"{{"schema_version":999,"UUID":"{newer_uuid}","created_at":"2099-01-01T00:00:00.000Z","telemetry_consent":false,"new_field":"x"}}"#
        );
        fs::write(&path, &newer_contents).unwrap();
        let before = fs::read(&path).unwrap();

        let result = ensure_instance(&home, true, fixed_now);

        let after = fs::read(&path).unwrap();
        assert_eq!(
            before, after,
            "a NewerSchema record must never be touched on disk"
        );
        assert_eq!(result.uuid, newer_uuid);
        assert!(
            !result.telemetry_consent,
            "must fail closed to false on a NewerSchema read, never pass through initial_consent"
        );

        fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn generate_instance_uuid_produces_valid_shape() {
        let uuid = generate_instance_uuid();
        assert!(is_valid_uuid_shape(&uuid));
    }

    #[cfg(unix)]
    #[test]
    fn create_private_dir_all_rejects_symlink_at_target_path() {
        use std::os::unix::fs::PermissionsExt;

        let base = scratch_home("symlink-target-rejected");
        let real_elsewhere = base.join("elsewhere");
        fs::create_dir_all(&real_elsewhere).unwrap();
        let target = base.join("private-tmp-dir");
        std::os::unix::fs::symlink(&real_elsewhere, &target).unwrap();

        let result = create_private_dir_all(&target);

        assert!(
            result.is_err(),
            "must fail closed when a symlink sits at the exact target path"
        );
        assert!(
            target.symlink_metadata().unwrap().file_type().is_symlink(),
            "the symlink itself must be left in place -- this function must not delete or replace it"
        );
        let elsewhere_mode = fs::metadata(&real_elsewhere).unwrap().permissions().mode() & 0o777;
        assert_ne!(
            elsewhere_mode, 0o700,
            "must never chmod the symlink's target -- that would be the exact TOCTOU/symlink bug being fixed"
        );

        fs::remove_dir_all(&base).ok();
    }

    #[cfg(unix)]
    #[test]
    fn create_private_dir_all_succeeds_for_ordinary_owned_directory() {
        use std::os::unix::fs::PermissionsExt;

        let base = scratch_home("ordinary-dir-still-works");
        let target = base.join("private-tmp-dir");

        create_private_dir_all(&target).expect("must succeed for an ordinary, self-owned path");

        let mode = fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);

        fs::remove_dir_all(&base).ok();
    }

    /// Regression test: an inode-exhausted filesystem hitting one of
    /// `ensure_instance`'s three write seams (`create_private_dir_all`,
    /// `write_temp`, `hard_link`) caused a real failure on one CI
    /// architecture. This test exercises the same mechanism -- a
    /// `create_private_dir_all` failure -- through an unprivileged,
    /// portable seam (`chmod 0`) so it runs in ordinary CI without
    /// needing a real filesystem quota.
    #[cfg(unix)]
    #[test]
    fn ensure_instance_fails_closed_when_home_dir_is_unwritable() {
        use std::os::unix::fs::PermissionsExt;

        let base = scratch_home("home-dir-unwritable");
        let home = base.join("home");
        fs::create_dir_all(&home).unwrap();
        fs::set_permissions(&home, fs::Permissions::from_mode(0o000)).unwrap();

        let record = ensure_instance(&home, true, fixed_now);

        // Restore perms before cleanup, else remove_dir_all fails too.
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).unwrap();

        assert_eq!(
            record.uuid, NIL_UUID_SENTINEL,
            "a create_private_dir_all failure must produce the nil sentinel"
        );
        assert!(
            !record.telemetry_consent,
            "a create_private_dir_all failure must produce telemetry_consent=false -- \
             the same fail-closed shape a real disk/inode-exhaustion failure produces"
        );
        fs::remove_dir_all(&base).ok();
    }
}
