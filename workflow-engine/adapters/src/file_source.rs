// SPDX-License-Identifier: Apache-2.0
//! The file source: reads workflow bytes from a folder and applies the file rules of the spec.
//!
//! A file is read only if it is a regular file with the exact expected name, reached through real directories only,
//! and within the size limit. A link, a directory, a pipe or a missing file all read as not there, and nothing is
//! read through them. The folder and the directories below it count too: a link at any step is not followed.

use std::fs::{self, File, Metadata};
use std::io::Read;
use std::path::{Path, PathBuf};

use workflow_core::limits::MAX_FILE_BYTES;
use workflow_core::rules::{is_name, path_problem};
use workflow_core::WorkflowSource;

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

    /// The bytes of the file at `components` below the folder, or `None` if the file rules do not allow it.
    fn read_below(&self, components: &[&str]) -> Option<Vec<u8>> {
        let mut path = self.base.clone();
        let steps: Vec<&str> = self
            .folder
            .iter()
            .copied()
            .chain(components.iter().copied())
            .collect();
        let mut meta: Option<Metadata> = None;
        for (n, name) in steps.iter().enumerate() {
            path = entry_named(&path, name)?;
            // `symlink_metadata` does not follow a link, so a link is neither a file nor a directory here.
            let found = fs::symlink_metadata(&path).ok()?;
            let wanted = if n + 1 == steps.len() {
                found.file_type().is_file()
            } else {
                found.file_type().is_dir()
            };
            if !wanted {
                return None;
            }
            meta = Some(found);
        }
        read_regular_file(&path, &meta?)
    }
}

impl WorkflowSource for FileSource {
    fn workflow_bytes(&self, name: &str) -> Option<Vec<u8>> {
        if !is_name(name) {
            return None;
        }
        self.read_below(&[&format!("{name}.yml")])
    }

    fn prompt_file_bytes(&self, path: &str) -> Option<Vec<u8>> {
        if path_problem(path).is_some() {
            return None;
        }
        let components: Vec<&str> = path.split('/').collect();
        self.read_below(&components)
    }
}

/// The entry of `dir` whose name is exactly `name`. Listing the directory, instead of opening the name, keeps a file
/// system that ignores case from answering for `Plan.md` with `plan.md`.
fn entry_named(dir: &Path, name: &str) -> Option<PathBuf> {
    fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .find(|entry| entry.file_name() == name)
        .map(|entry| entry.path())
}

/// Opens the file and checks that it is still the regular file that was looked at, then reads at most the size limit.
fn read_regular_file(path: &Path, looked_at: &Metadata) -> Option<Vec<u8>> {
    if looked_at.len() > MAX_FILE_BYTES as u64 {
        return None;
    }
    let file = File::open(path).ok()?;
    let opened = file.metadata().ok()?;
    if !opened.is_file() || !same_file(looked_at, &opened) {
        return None;
    }
    let mut bytes = Vec::new();
    // One byte more than the limit shows that the file grew after it was measured.
    file.take(MAX_FILE_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() <= MAX_FILE_BYTES).then_some(bytes)
}

/// Whether two sets of metadata describe one file. This closes the gap between looking at a name and opening it, in
/// which a regular file could be swapped for a link.
#[cfg(unix)]
fn same_file(a: &Metadata, b: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(not(unix))]
fn same_file(_: &Metadata, _: &Metadata) -> bool {
    true
}
