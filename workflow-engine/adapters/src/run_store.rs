// SPDX-License-Identifier: Apache-2.0
//! Run state on disk: `<project root>/.konductor/runs/<run-id>/state.json`, git-ignored through
//! `.konductor/.gitignore`.
//!
//! Nothing is read or written through a link: `.konductor`, `runs`, a run folder, `state.json` and `.gitignore` must
//! each be what they say, or the store refuses. A state document is replaced as one step: it is written to a new file
//! in the same folder and renamed over the old one.

use std::collections::hash_map::RandomState;
use std::fs::{self, File, OpenOptions};
use std::hash::{BuildHasher, Hasher};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use workflow_core::ports::{PortError, RunStore};
use workflow_core::time::is_run_id;

/// The folder under the project root that holds the runs.
pub const RUNS_DIR: &str = ".konductor/runs";
/// The file in each run folder that holds its state.
pub const STATE_FILE: &str = "state.json";
/// The line in `.konductor/.gitignore` that keeps the runs out of git.
pub const RUNS_IGNORE_PATTERN: &str = "runs/";

/// A state document bigger than this is not read.
const MAX_STATE_BYTES: u64 = 16 * 1024 * 1024;
/// A `.konductor/.gitignore` bigger than this is not read or changed.
const MAX_GITIGNORE_BYTES: u64 = 1024 * 1024;
/// How many ids [`FileRunStore::reserve`] tries before it gives up.
const RESERVE_ATTEMPTS: usize = 16;
/// How many temp names [`write_replacing`] tries before it gives up.
const TEMP_ATTEMPTS: usize = 16;
const SUFFIX_CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// The run folders of one project.
#[derive(Debug, Clone)]
pub struct FileRunStore {
    runs: PathBuf,
}

impl FileRunStore {
    /// Gets `<project_root>/.konductor/runs/` ready: makes sure `.konductor/.gitignore` ignores `runs/` (see
    /// [`ensure_runs_ignored`]) and then makes the folder, so the runs are never there without the ignore line.
    pub fn open(project_root: &Path) -> Result<FileRunStore, PortError> {
        ensure_runs_ignored(project_root)?;
        let runs = project_root.join(RUNS_DIR);
        make_dir(&runs)?;
        Ok(FileRunStore { runs })
    }

    /// `<project root>/.konductor/runs`.
    pub fn runs_dir(&self) -> &Path {
        &self.runs
    }

    fn run_dir(&self, run_id: &str) -> Result<PathBuf, PortError> {
        if !is_run_id(run_id) {
            return Err(PortError(format!("`{run_id}` is not a run id")));
        }
        let dir = self.runs.join(run_id);
        match fs::symlink_metadata(&dir) {
            Ok(meta) if meta.is_dir() => Ok(dir),
            Ok(_) => Err(PortError(format!("{} is not a folder", dir.display()))),
            Err(e) => Err(io_error("could not read", &dir, e)),
        }
    }
}

impl RunStore for FileRunStore {
    fn reserve(&mut self, prefix: &str) -> Result<String, PortError> {
        for _ in 0..RESERVE_ATTEMPTS {
            let run_id = format!("{prefix}-{}", random_suffix());
            match fs::create_dir(self.runs.join(&run_id)) {
                Ok(()) => return Ok(run_id),
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(io_error("could not make a folder in", &self.runs, e)),
            }
        }
        Err(PortError(format!(
            "could not find a free run id in {}",
            self.runs.display()
        )))
    }

    fn discard(&mut self, run_id: &str) -> Result<(), PortError> {
        let dir = self.run_dir(run_id)?;
        // `remove_dir` removes only an empty folder, so a run with a state is never lost here.
        fs::remove_dir(&dir).map_err(|e| io_error("could not remove", &dir, e))
    }

    fn write_state(&mut self, run_id: &str, text: &str) -> Result<(), PortError> {
        let dir = self.run_dir(run_id)?;
        write_replacing(&dir.join(STATE_FILE), text.as_bytes())
    }

    fn read_state(&self, run_id: &str) -> Result<Option<String>, PortError> {
        let path = self.run_dir(run_id)?.join(STATE_FILE);
        read_regular(&path, MAX_STATE_BYTES)
    }

    fn list(&self) -> Result<Vec<String>, PortError> {
        let entries =
            fs::read_dir(&self.runs).map_err(|e| io_error("could not read", &self.runs, e))?;
        let mut ids = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| io_error("could not read", &self.runs, e))?;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
            if is_dir && is_run_id(&name) {
                ids.push(name);
            }
        }
        ids.sort();
        Ok(ids)
    }
}

/// Makes sure `<project_root>/.konductor/.gitignore` has the line `runs/`. A missing file is made with that line. A
/// file without it gets it added at the end, and every other line stays as it was. A file that has it is left alone.
/// `.konductor` is made if it is missing.
pub fn ensure_runs_ignored(project_root: &Path) -> Result<(), PortError> {
    let konductor = project_root.join(".konductor");
    make_dir(&konductor)?;
    let path = konductor.join(".gitignore");
    let mut text = read_regular(&path, MAX_GITIGNORE_BYTES)?.unwrap_or_default();
    if text.lines().any(|line| line.trim() == RUNS_IGNORE_PATTERN) {
        return Ok(());
    }
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(RUNS_IGNORE_PATTERN);
    text.push('\n');
    write_replacing(&path, text.as_bytes())
}

/// Makes a folder, or accepts one that is there and is a real folder, not a link.
fn make_dir(dir: &Path) -> Result<(), PortError> {
    match fs::create_dir(dir) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() == ErrorKind::AlreadyExists => {}
        Err(e) => return Err(io_error("could not make", dir, e)),
    }
    match fs::symlink_metadata(dir) {
        Ok(meta) if meta.is_dir() => Ok(()),
        Ok(_) => Err(PortError(format!(
            "{} is not a folder (a link is not followed)",
            dir.display()
        ))),
        Err(e) => Err(io_error("could not read", dir, e)),
    }
}

/// The text of a regular file, `None` if there is none, and an error for a link, another kind of file, a file over
/// `max` bytes or one that is not UTF-8.
pub(crate) fn read_regular(path: &Path, max: u64) -> Result<Option<String>, PortError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => {}
        Ok(_) => {
            return Err(PortError(format!(
                "{} is not a regular file (a link is not followed)",
                path.display()
            )))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_error("could not read", path, e)),
    }
    let file = match open_no_follow(path) {
        Ok(file) => file,
        // Removed since it was looked at.
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io_error("could not open", path, e)),
    };
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error("could not read", path, e))?;
    if bytes.len() as u64 > max {
        return Err(PortError(format!("{} is over {max} bytes", path.display())));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| PortError(format!("{} is not UTF-8", path.display())))
}

/// Replaces `path` with `bytes` as one step: a new file in the same folder, flushed to disk, then renamed over it.
/// A link at `path` is refused, because the rename would replace the link, not what it points to, and the caller
/// asked for the file.
///
/// The folder is not synced after the rename, so if the machine goes down the file may hold what it held before, or
/// be missing if it is new. Each caller can live with that: a run state that is behind reads `running` and the next
/// run to take the lock ends it, a run folder with no state is skipped, and the next [`FileRunStore::open`] adds a
/// lost `.gitignore` line again.
pub(crate) fn write_replacing(path: &Path, bytes: &[u8]) -> Result<(), PortError> {
    write_replacing_with(path, bytes, temp_path)
}

/// [`write_replacing`] with the temp names that `temp_name` gives, so a test can choose them.
fn write_replacing_with(
    path: &Path,
    bytes: &[u8],
    mut temp_name: impl FnMut(&Path) -> PathBuf,
) -> Result<(), PortError> {
    if fs::symlink_metadata(path).is_ok_and(|meta| !meta.is_file()) {
        return Err(PortError(format!(
            "{} is not a regular file (a link is not followed)",
            path.display()
        )));
    }
    for _ in 0..TEMP_ATTEMPTS {
        let temp = temp_name(path);
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&temp) {
            Ok(file) => file,
            // Left by a writer that died, or in use by one with the same PID in another PID namespace. It is left
            // alone, and another name is tried.
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(io_error("could not write", path, e)),
        };
        let written = (|| {
            file.write_all(bytes)?;
            file.sync_all()?;
            fs::rename(&temp, path)
        })();
        return written.map_err(|e| {
            let _ = fs::remove_file(&temp);
            io_error("could not write", path, e)
        });
    }
    Err(PortError(format!(
        "could not find a free temporary name next to {}",
        path.display()
    )))
}

/// A name next to `path` for a new file: the file name, this process's PID and five random characters. The PID alone
/// is not enough: a writer that died can leave its file behind for a later process with the same PID.
pub(crate) fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    path.with_file_name(format!(
        ".{name}.tmp-{}-{}",
        std::process::id(),
        random_suffix()
    ))
}

/// Opens a file for reading without following a link at its last component.
pub(crate) fn open_no_follow(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    options.open(path)
}

pub(crate) fn io_error(what: &str, path: &Path, error: std::io::Error) -> PortError {
    PortError(format!("{what} {}: {error}", path.display()))
}

/// Five characters from `[a-z0-9]`. They need not be secret, only unlikely to repeat: a run id or a temp name that is
/// taken is tried again. The seed of the standard library's hasher differs in each process and each call.
fn random_suffix() -> String {
    let mut hasher = RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    let mut value = hasher.finish();
    (0..5)
        .map(|_| {
            let c = SUFFIX_CHARS[(value % SUFFIX_CHARS.len() as u64) as usize];
            value /= SUFFIX_CHARS.len() as u64;
            c as char
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_leftover_temp_file_with_this_pid_does_not_block_a_write() {
        let dir =
            std::env::temp_dir().join(format!("workflow-run-store-temp-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(STATE_FILE);
        // A writer with this PID died and left its temp file. The next name is free.
        let leftover = dir.join(format!(".{STATE_FILE}.tmp-{}-0", std::process::id()));
        fs::write(&leftover, b"theirs").unwrap();
        let mut names = vec![
            leftover.clone(),
            dir.join(format!(".{STATE_FILE}.tmp-{}-1", std::process::id())),
        ];
        names.reverse();
        write_replacing_with(&path, b"mine", |_| names.pop().unwrap()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "mine");
        assert_eq!(fs::read_to_string(&leftover).unwrap(), "theirs");
        assert!(names.is_empty());
        // The real names are random, so the leftover never blocks one either.
        write_replacing(&path, b"again").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "again");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_write_with_no_free_temp_name_gives_up() {
        let dir =
            std::env::temp_dir().join(format!("workflow-run-store-full-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let taken = dir.join("taken");
        fs::write(&taken, b"x").unwrap();
        let error =
            write_replacing_with(&dir.join(STATE_FILE), b"mine", |_| taken.clone()).unwrap_err();
        assert!(
            error.0.contains("could not find a free temporary name"),
            "{}",
            error.0
        );
        assert!(!dir.join(STATE_FILE).exists());
        fs::remove_dir_all(&dir).unwrap();
    }
}
