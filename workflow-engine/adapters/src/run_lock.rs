// SPDX-License-Identifier: Apache-2.0
//! The workspace lock: an OS file lock on `<project root>/.konductor/runs/lock`, held for the whole run.
//!
//! The kernel gives an OS lock back when the process that holds it ends, however it ends. So a dead owner never leaves
//! a lock behind, and nothing has to decide whether an owner still lives. The lock belongs to the open file, not to a
//! PID, so it also works across PID namespaces on one host, such as a run in a container and a run on the host over
//! the same checkout.
//!
//! The holder writes its record (PID, start time and run id, as one line of JSON) into `lock`, so a refused start can
//! name the active run. A record is only written or read under a second, short lock on the file `claim`. Without it, a
//! refused start could read the record of an earlier holder that died, in the moment before the new holder replaces
//! it. A start that finds `claim` taken is refused with the owner unknown: another start is taking or reading the lock
//! at that moment.
//!
//! Neither file is ever deleted. A process that opened a file before it was deleted would lock a file that others can
//! no longer open, and two runs could be active at once.
//!
//! Rust opens files with close-on-exec, so a harness session that a run starts does not inherit the lock and cannot
//! keep it after the run ends. A child holds a copy of the open files only from its fork to its exec. In a process
//! with many threads, a lock that one thread has just given back can look held for that moment.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use workflow_core::ports::{Claim, LockRecord, PortError, RunLock};

use crate::run_store::{io_error, RUNS_DIR};

/// The name of the lock file in `.konductor/runs/`.
pub const LOCK_FILE: &str = "lock";
/// The name of the file in `.konductor/runs/` whose lock is held while the record in `lock` is written or read.
pub const CLAIM_FILE: &str = "claim";

/// A record bigger than this is not read.
const MAX_LOCK_BYTES: u64 = 4096;

#[derive(Debug)]
pub struct FileRunLock {
    path: PathBuf,
    claim: PathBuf,
    /// The open `lock` file while this value holds the lock. Dropping it gives the lock back.
    held: Option<File>,
}

impl FileRunLock {
    /// The lock of the project at `project_root`. The folder `.konductor/runs/` must exist, and
    /// [`crate::FileRunStore::open`] makes it.
    pub fn new(project_root: &Path) -> FileRunLock {
        let runs = project_root.join(RUNS_DIR);
        FileRunLock {
            path: runs.join(LOCK_FILE),
            claim: runs.join(CLAIM_FILE),
            held: None,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl RunLock for FileRunLock {
    fn try_claim(&mut self, record: &LockRecord) -> Result<Claim, PortError> {
        let claim = open_lock_file(&self.claim)?;
        match claim.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => return Ok(Claim::Held(None)),
            Err(TryLockError::Error(e)) => return Err(io_error("could not lock", &self.claim, e)),
        }
        let mut file = open_lock_file(&self.path)?;
        match file.try_lock() {
            Ok(()) => {
                // A write that fails drops `file`, which gives the lock back.
                write_record(&mut file, record)
                    .map_err(|e| io_error("could not write", &self.path, e))?;
                self.held = Some(file);
                Ok(Claim::Acquired)
            }
            Err(TryLockError::WouldBlock) => Ok(Claim::Held(read_record(&file))),
            Err(TryLockError::Error(e)) => Err(io_error("could not lock", &self.path, e)),
        }
        // `claim` is given back here, after the record is written or read.
    }

    fn release(&mut self) {
        self.held = None;
    }
}

/// Opens a lock file, and makes it if it is missing. It is never truncated here, because another process may hold
/// the lock and its record. A link is not followed, and anything but a regular file is refused.
fn open_lock_file(path: &Path) -> Result<File, PortError> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|e| io_error("could not open", path, e))?;
    let meta = file
        .metadata()
        .map_err(|e| io_error("could not read", path, e))?;
    if !meta.is_file() {
        return Err(PortError(format!(
            "{} is not a regular file",
            path.display()
        )));
    }
    Ok(file)
}

/// Replaces what the file holds with `record`. A `File` has no buffer, so the record is in the file when this returns.
/// It is not synced to disk: after a crash the lock is free, and the next holder writes its own record.
fn write_record(file: &mut File, record: &LockRecord) -> io::Result<()> {
    file.set_len(0)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(record.to_text().as_bytes())
}

/// The record in the file, or `None` if it cannot be read or is not a whole record.
fn read_record(mut file: &File) -> Option<LockRecord> {
    file.seek(SeekFrom::Start(0)).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_LOCK_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_LOCK_BYTES {
        return None;
    }
    LockRecord::from_text(std::str::from_utf8(&bytes).ok()?)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use workflow_core::ports::Owner;

    /// A folder with `.konductor/runs/` in it, removed when the value is dropped.
    struct Project(PathBuf);

    impl Project {
        fn new(label: &str) -> Project {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir().join(format!(
                "workflow-run-lock-{label}-{}-{n}",
                std::process::id()
            ));
            fs::create_dir_all(root.join(RUNS_DIR)).expect("create runs dir");
            Project(root)
        }

        fn lock(&self) -> FileRunLock {
            FileRunLock::new(&self.0)
        }
    }

    impl Drop for Project {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn record(pid: u32, run_id: &str) -> LockRecord {
        LockRecord {
            owner: Owner {
                pid,
                started: "s".to_string(),
            },
            run_id: run_id.to_string(),
        }
    }

    #[test]
    fn a_start_that_meets_another_start_taking_the_lock_does_not_know_the_owner() {
        let project = Project::new("claim-busy");
        let mut lock = project.lock();
        // Another start holds `claim`, and may be about to replace the record that is in `lock` now.
        let other = open_lock_file(&lock.claim).unwrap();
        other.try_lock().unwrap();
        fs::write(lock.path(), record(1, "20261105-1200-old01").to_text()).unwrap();
        assert_eq!(
            lock.try_claim(&record(2, "20261105-1200-new01")).unwrap(),
            Claim::Held(None)
        );
        drop(other);
        assert_eq!(
            lock.try_claim(&record(2, "20261105-1200-new01")).unwrap(),
            Claim::Acquired
        );
    }

    #[test]
    fn a_lock_file_that_is_not_a_regular_file_is_an_error() {
        let project = Project::new("not-a-file");
        let lock = project.lock();
        fs::create_dir(lock.path()).unwrap();
        let error = open_lock_file(lock.path()).unwrap_err();
        assert!(error.0.contains("could not open"), "{}", error.0);

        let project = Project::new("a-link");
        let mut lock = project.lock();
        let target = project.0.join("elsewhere");
        fs::write(&target, b"theirs").unwrap();
        std::os::unix::fs::symlink(&target, lock.path()).unwrap();
        assert!(lock.try_claim(&record(1, "20261105-1200-aaaaa")).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "theirs");
    }

    #[test]
    fn a_record_over_the_limit_or_not_utf8_is_not_read() {
        let project = Project::new("record-size");
        let path = project.0.join(RUNS_DIR).join(LOCK_FILE);
        fs::write(&path, vec![b' '; MAX_LOCK_BYTES as usize + 1]).unwrap();
        assert_eq!(read_record(&File::open(&path).unwrap()), None);
        fs::write(&path, [0xff, 0xfe]).unwrap();
        assert_eq!(read_record(&File::open(&path).unwrap()), None);
        let good = record(1, "20261105-1200-aaaaa");
        fs::write(&path, good.to_text()).unwrap();
        assert_eq!(read_record(&File::open(&path).unwrap()), Some(good));
    }
}
