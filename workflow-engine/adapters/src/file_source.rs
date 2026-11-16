// SPDX-License-Identifier: Apache-2.0
//! The file source: reads workflow bytes from a folder and applies the file rules of the spec.
//!
//! A file is read only if it is a regular file with the exact expected name, reached through real directories only,
//! and within the size limit. A link, a directory, a pipe or a missing file all read as not there, and nothing is
//! read through them.
//!
//! Each step below the base is looked at without following a link, so a link in the folder, in a directory above the
//! file or at the file itself is refused. The open then adds `O_NOFOLLOW` on Unix, which covers the last component
//! only. A directory above the file that is swapped for a link between the look and the open is caught by comparing the
//! device and inode of the opened file with the one that was looked at, not by the open.

use std::fs::{self, File, Metadata, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};

use workflow_core::limits::MAX_FILE_BYTES;
use workflow_core::rules::{is_name, path_problem};
use workflow_core::WorkflowSource;

/// Why a file that is there is treated as not there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skip {
    /// The file or a directory above it is a link.
    Link,
    /// The file is a directory, a pipe or another kind that is not a regular file.
    NotRegular,
    /// The file is over the size limit.
    TooLarge,
    /// The file is not UTF-8.
    NotUtf8,
    /// The file could not be opened or read, for example for lack of permission.
    Unreadable,
}

impl Skip {
    /// A phrase for a message, such as "is a link".
    pub fn reason(self) -> &'static str {
        match self {
            Skip::Link => "is a link",
            Skip::NotRegular => "is not a regular file",
            Skip::TooLarge => "is over 256 KiB",
            Skip::NotUtf8 => "is not UTF-8",
            Skip::Unreadable => "could not be read",
        }
    }
}

/// Why a workflow file could not be written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteError {
    /// An exclusive write found the file there.
    Exists,
    /// Anything else. The text is for a log, never for a client, because it can hold a path.
    Other(String),
}

impl WriteError {
    fn io(error: std::io::Error) -> WriteError {
        WriteError::Other(error.to_string())
    }
}

/// One folder of workflows, such as `<repo>/.konductor/workflows`.
#[derive(Debug, Clone)]
pub struct FileSource {
    // The directory the folder lies under. It is trusted, and not checked for links: the user chose it.
    base: PathBuf,
    // The directories from `base` to the folder.
    folder: Vec<&'static str>,
}

impl FileSource {
    /// The folder `<base>/.konductor/workflows`. `base` is the project root for the project folder and the user's home
    /// for the user folder.
    pub fn under(base: &Path) -> FileSource {
        FileSource {
            base: base.to_path_buf(),
            folder: vec![".konductor", "workflows"],
        }
    }

    /// The bytes of workflow `name`. `Ok(None)` if nothing of that name is there, and `Err` if something is there
    /// that the file rules do not allow the engine to read.
    pub fn try_workflow_bytes(&self, name: &str) -> Result<Option<Vec<u8>>, Skip> {
        if !is_name(name) {
            return Ok(None);
        }
        self.read_below(&[&format!("{name}.yml")])
    }

    /// Writes the bytes of workflow `name` as one step: a new file in the same folder, flushed, then moved into place.
    /// With `exclusive` the file must not exist, and an existing one, even one made a moment ago, is
    /// [`WriteError::Exists`]. Without it the file is replaced. The bytes are written as they are given. The folder is
    /// made if it is missing, and a link or a file in the way of it is refused.
    pub fn write_workflow(
        &self,
        name: &str,
        bytes: &[u8],
        exclusive: bool,
    ) -> Result<(), WriteError> {
        if !is_name(name) {
            return Err(WriteError::Other("not a workflow name".to_string()));
        }
        let mut folder = self.base.clone();
        for step in &self.folder {
            folder.push(step);
            match fs::create_dir(&folder) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let meta = fs::symlink_metadata(&folder).map_err(WriteError::io)?;
                    if !meta.is_dir() {
                        return Err(WriteError::Other(
                            "a folder is a link or a file".to_string(),
                        ));
                    }
                }
                Err(e) => return Err(WriteError::io(e)),
            }
        }
        let path = folder.join(format!("{name}.yml"));
        if fs::symlink_metadata(&path).is_ok_and(|m| !m.is_file()) {
            return Err(WriteError::Other(
                "the file is a link or not a regular file".to_string(),
            ));
        }
        // A replaced file keeps the permissions it had, and its temporary file has them from the first byte. A new file
        // gets the default of the process, which is what an editor would give it.
        let old_mode = fs::metadata(&path).ok().map(|m| m.permissions());
        let mut written = None;
        for _ in 0..16 {
            let temp = crate::run_store::temp_path(&path);
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            if let Some(mode) = &old_mode {
                use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
                options.mode(mode.mode() & 0o777);
            }
            match options.open(&temp) {
                Ok(file) => {
                    written = Some((file, temp));
                    break;
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(WriteError::io(e)),
            }
        }
        let (mut file, temp) =
            written.ok_or_else(|| WriteError::Other("no free temporary name".to_string()))?;
        let done = (|| {
            use std::io::Write;
            file.write_all(bytes)?;
            if let Some(mode) = old_mode {
                file.set_permissions(mode)?;
            }
            file.sync_all()?;
            // A hard link fails when the name exists, so a file made after the caller looked is not replaced.
            if exclusive {
                fs::hard_link(&temp, &path)
            } else {
                fs::rename(&temp, &path)
            }
        })();
        let _ = if exclusive || done.is_err() {
            fs::remove_file(&temp)
        } else {
            Ok(())
        };
        match done {
            Ok(()) => Ok(()),
            Err(e) if exclusive && e.kind() == std::io::ErrorKind::AlreadyExists => {
                Err(WriteError::Exists)
            }
            Err(e) => Err(WriteError::io(e)),
        }
    }

    fn read_below(&self, components: &[&str]) -> Result<Option<Vec<u8>>, Skip> {
        let mut path = self.base.clone();
        let steps: Vec<&str> = self
            .folder
            .iter()
            .copied()
            .chain(components.iter().copied())
            .collect();
        let mut meta: Option<Metadata> = None;
        for (n, name) in steps.iter().enumerate() {
            let Some(next) = entry_named(&path, name)? else {
                return Ok(None);
            };
            path = next;
            // `symlink_metadata` does not follow a link, so a link is neither a file nor a directory here.
            let found = fs::symlink_metadata(&path).map_err(|_| Skip::Unreadable)?;
            let kind = found.file_type();
            if kind.is_symlink() {
                return Err(Skip::Link);
            }
            let last = n + 1 == steps.len();
            if (last && !kind.is_file()) || (!last && !kind.is_dir()) {
                return Err(Skip::NotRegular);
            }
            meta = Some(found);
        }
        match meta {
            Some(meta) => read_regular_file(&path, &meta).map(Some),
            None => Ok(None),
        }
    }
}

impl WorkflowSource for FileSource {
    fn workflow_bytes(&self, name: &str) -> Option<Vec<u8>> {
        self.try_workflow_bytes(name).ok().flatten()
    }

    fn prompt_file_bytes(&self, path: &str) -> Option<Vec<u8>> {
        if path_problem(path).is_some() {
            return None;
        }
        let components: Vec<&str> = path.split('/').collect();
        self.read_below(&components).ok().flatten()
    }
}

/// The entry of `dir` whose name is exactly `name`. Listing the directory, instead of opening the name, keeps a file
/// system that ignores case from answering for `Plan.md` with `plan.md`. A directory that is not there is a miss, and
/// one that cannot be listed is `Unreadable`, so the caller can report it.
fn entry_named(dir: &Path, name: &str) -> Result<Option<PathBuf>, Skip> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Skip::Unreadable),
    };
    for entry in entries {
        let entry = entry.map_err(|_| Skip::Unreadable)?;
        if entry.file_name() == name {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

/// Opens the file and checks that it is still the regular file that was looked at, then reads at most the size limit.
fn read_regular_file(path: &Path, looked_at: &Metadata) -> Result<Vec<u8>, Skip> {
    if looked_at.len() > MAX_FILE_BYTES as u64 {
        return Err(Skip::TooLarge);
    }
    let file = open_without_following(path).map_err(|_| Skip::Unreadable)?;
    let opened = file.metadata().map_err(|_| Skip::Unreadable)?;
    if !opened.is_file() || !same_file(looked_at, &opened) {
        return Err(Skip::Unreadable);
    }
    let mut bytes = Vec::new();
    // One byte more than the limit shows that the file grew after it was measured.
    file.take(MAX_FILE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Skip::Unreadable)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(Skip::TooLarge);
    }
    Ok(bytes)
}

/// On Unix the open neither follows a link nor waits for a writer, so a name swapped for a link or a pipe after it was
/// looked at fails or returns at once.
#[cfg(unix)]
fn open_without_following(path: &Path) -> std::io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(not(unix))]
fn open_without_following(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().read(true).open(path)
}

/// Whether two sets of metadata describe one file. This closes the gap between looking at a name and opening it, in
/// which a regular file could be swapped for a link.
#[cfg(unix)]
pub(crate) fn same_file(a: &Metadata, b: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

// Only Unix has a file identity to compare, so the guarantees about links and swaps hold on Unix only. Elsewhere the
// engine still refuses a link it sees, but it cannot detect a swap in between.
#[cfg(not(unix))]
pub(crate) fn same_file(_: &Metadata, _: &Metadata) -> bool {
    true
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("workflow-same-file-{label}-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("dir");
        dir
    }

    #[test]
    fn same_file_compares_device_and_inode() {
        let dir = scratch("inode");
        let (a, b) = (dir.join("a"), dir.join("b"));
        fs::write(&a, "x").expect("a");
        fs::write(&b, "x").expect("b");
        let (meta_a, meta_b) = (
            fs::metadata(&a).expect("meta a"),
            fs::metadata(&b).expect("meta b"),
        );
        assert!(same_file(&meta_a, &fs::metadata(&a).expect("again")));
        assert!(
            !same_file(&meta_a, &meta_b),
            "two files with equal content are not one file"
        );
        fs::remove_dir_all(dir).ok();
    }
}
