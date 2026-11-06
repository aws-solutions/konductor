// SPDX-License-Identifier: Apache-2.0
//! The repo tool configuration files (spec: "Repo tool configuration"): the files a headless run loads from the repo
//! with no tool prompt. They are `.claude/settings.json`, `.mcp.json`, and the files under `.kiro/agents/` and
//! `.claude/agents/`.
//!
//! The folders searched are the project root and each folder above it up to the git root. Claude Code finds
//! `.claude/agents/` that way, and the other three paths are searched in every one of those folders because a tool that
//! looks only in the folder it starts in costs nothing to over-cover.
//!
//! A file that Konductor's install manifest records, and that still has the hash the install gave it, is left out, so
//! a project install does not ask on every run. Everything else that is there counts.
//!
//! The scan never skips what it cannot read. Anything it cannot hash from its content, whether a read or stat failed,
//! a link it does not follow, a folder with more files than the scan reads, a folder nested too deep, or a name that
//! is not UTF-8, is kept as an unreadable entry with the reason. An unreadable entry cannot vouch for the files behind
//! it, so a caller must refuse to trust anything while one exists ([`ConfigContent::Unreadable`]).

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use workflow_core::trust::{sha256_hex, ConfigContent, ConfigFile};

const FILES: &[&str] = &[".claude/settings.json", ".mcp.json"];
const DIRECTORIES: &[&str] = &[".kiro/agents", ".claude/agents"];
/// A file over this many bytes is marked unreadable and not read.
const MAX_BYTES: u64 = 1024 * 1024;
/// How deep below `.kiro/agents` or `.claude/agents` the scan goes. The folder itself is depth 0.
pub const MAX_DEPTH: usize = 4;
/// How many files the scan reads below one of the two agent folders. A folder with more is marked unreadable.
pub const MAX_FILES: usize = 512;

/// The files and hashes an install recorded, as `(path relative to the project root, sha256 hex)`.
pub type InstalledFiles = BTreeSet<(String, String)>;

/// The folders whose tool configuration counts: `project_root`, then each folder above it up to the git root, nearest
/// first. A folder is the git root when it has a `.git` entry (a folder, or a file in a worktree or submodule). With
/// no git root, or when the git root is the home folder, only `project_root` counts.
pub fn config_folders(project_root: &Path, home: Option<&Path>) -> Vec<PathBuf> {
    let start = fs::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());
    let home = home.and_then(|h| fs::canonicalize(h).ok());
    let mut chain = Vec::new();
    for folder in start.ancestors() {
        if home.as_deref() == Some(folder) {
            break;
        }
        chain.push(folder.to_path_buf());
        if fs::symlink_metadata(folder.join(".git")).is_ok() {
            return chain;
        }
    }
    vec![project_root.to_path_buf()]
}

/// The tool configuration files of the repo that count toward trust, sorted by path. Paths are relative to the
/// outermost folder searched, which is the git root, with `/` between the parts. `installed` names files relative to
/// `project_root`.
pub fn scan(
    project_root: &Path,
    home: Option<&Path>,
    installed: &InstalledFiles,
) -> Vec<ConfigFile> {
    let folders = config_folders(project_root, home);
    let outermost = folders
        .last()
        .cloned()
        .unwrap_or_else(|| project_root.to_path_buf());
    let mut found = Vec::new();
    for (n, folder) in folders.iter().enumerate() {
        let prefix = relative_to(folder, &outermost);
        let mut scan = Scan {
            root: folder,
            prefix: &prefix,
            found: Vec::new(),
        };
        scan.run();
        // Only the project root is the folder an install writes to.
        let from_install = if n == 0 { Some(installed) } else { None };
        found.extend(
            scan.found
                .into_iter()
                .filter(|file| match (&file.content, from_install) {
                    (ConfigContent::Bytes(bytes), Some(installed)) => {
                        let inside = file
                            .path
                            .strip_prefix(&prefix_with_slash(&prefix))
                            .unwrap_or(&file.path);
                        !installed.contains(&(inside.to_string(), sha256_hex(bytes)))
                    }
                    _ => true,
                }),
        );
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

/// `folder` below `outermost`, with `/` between the parts. Empty for `outermost` itself.
fn relative_to(folder: &Path, outermost: &Path) -> String {
    let below = folder.strip_prefix(outermost).unwrap_or(Path::new(""));
    below
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn prefix_with_slash(prefix: &str) -> String {
    if prefix.is_empty() {
        String::new()
    } else {
        format!("{prefix}/")
    }
}

/// One folder's scan. `relative` paths are below `root`, and `shown` paths, the ones in the result, start with
/// `prefix`.
struct Scan<'a> {
    root: &'a Path,
    prefix: &'a str,
    found: Vec<ConfigFile>,
}

/// How far the walk of one agent folder has gone.
struct Budget {
    files: usize,
    /// Set when the cap was hit. The rest of the folder is not read, and the folder is marked once.
    stopped: bool,
}

/// A name from a directory listing and its place below the scan root.
struct Place {
    /// Where it is on disk, below the scan root.
    relative: PathBuf,
    /// What the user sees: below the scan root, with `/`, and lossy for a name that is not UTF-8.
    shown: String,
}

impl Scan<'_> {
    fn run(&mut self) {
        for path in FILES {
            let place = Place {
                relative: PathBuf::from(path),
                shown: (*path).to_string(),
            };
            self.read_entry(&place);
        }
        for directory in DIRECTORIES {
            let place = Place {
                relative: PathBuf::from(directory),
                shown: (*directory).to_string(),
            };
            let mut budget = Budget {
                files: 0,
                stopped: false,
            };
            self.walk(&place, 0, &mut budget);
        }
    }

    fn shown(&self, place: &Place) -> String {
        format!("{}{}", prefix_with_slash(self.prefix), place.shown)
    }

    fn unreadable(&mut self, place: &Place, why: &str) {
        let path = self.shown(place);
        self.found.push(ConfigFile {
            path,
            content: ConfigContent::Unreadable(why.to_string()),
        });
    }

    /// `Ok(None)` when nothing is there. Any other failure to look is an error, which the caller marks.
    fn look(&self, place: &Place) -> io::Result<Option<fs::Metadata>> {
        match fs::symlink_metadata(self.root.join(&place.relative)) {
            Ok(meta) => Ok(Some(meta)),
            // A file in place of a parent folder means there is nothing at the path either.
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                ) =>
            {
                Ok(None)
            }
            Err(e) => Err(e),
        }
    }

    /// Reads the file at `place`, if something is there. A link to a file is followed, because the tool follows it.
    fn read_entry(&mut self, place: &Place) {
        let path = self.root.join(&place.relative);
        let looked_at = match self.look(place) {
            Ok(Some(meta)) => meta,
            Ok(None) => return,
            Err(_) => return self.unreadable(place, "could not be inspected"),
        };
        let meta = if looked_at.is_symlink() {
            match fs::metadata(&path) {
                Ok(target) if target.is_file() => target,
                Ok(_) => {
                    return self.unreadable(place, "is a link to something that is not a file")
                }
                Err(_) => return self.unreadable(place, "is a link that cannot be followed"),
            }
        } else {
            looked_at
        };
        if !meta.is_file() {
            return self.unreadable(place, "is not a regular file");
        }
        if meta.len() > MAX_BYTES {
            return self.unreadable(place, "is over 1 MiB");
        }
        let mut bytes = Vec::new();
        let read =
            fs::File::open(&path).and_then(|f| f.take(MAX_BYTES + 1).read_to_end(&mut bytes));
        match read {
            Ok(_) if bytes.len() as u64 <= MAX_BYTES => {
                let path = self.shown(place);
                self.found.push(ConfigFile {
                    path,
                    content: ConfigContent::Bytes(bytes),
                });
            }
            Ok(_) => self.unreadable(place, "is over 1 MiB"),
            Err(_) => self.unreadable(place, "could not be read"),
        }
    }

    fn walk(&mut self, place: &Place, depth: usize, budget: &mut Budget) {
        let meta = match self.look(place) {
            Ok(Some(meta)) => meta,
            Ok(None) => return,
            Err(_) => return self.unreadable(place, "could not be inspected"),
        };
        if meta.is_symlink() || !meta.is_dir() {
            // A folder is searched only when it is a real directory. A link to a folder is not followed, and it is
            // marked so that it still counts.
            let why = if meta.is_symlink() {
                "is a link, which is not followed"
            } else {
                "is not a directory"
            };
            return self.unreadable(place, why);
        }
        if depth > MAX_DEPTH {
            return self.unreadable(place, "is nested too deep to scan");
        }
        let entries = match fs::read_dir(self.root.join(&place.relative)) {
            Ok(entries) => entries,
            Err(_) => return self.unreadable(place, "could not be listed"),
        };
        let mut names: Vec<OsString> = Vec::new();
        let mut listing_failed = false;
        for entry in entries {
            match entry {
                Ok(entry) => names.push(entry.file_name()),
                Err(_) => listing_failed = true,
            }
        }
        if listing_failed {
            self.unreadable(place, "could not be listed in full");
        }
        names.sort();
        for name in names {
            if budget.stopped {
                return;
            }
            let child = Place {
                relative: place.relative.join(&name),
                shown: format!("{}/{}", place.shown, name.to_string_lossy()),
            };
            if name.to_str().is_none() {
                self.unreadable(&child, "has a name that is not valid UTF-8");
                continue;
            }
            let is_dir = matches!(self.look(&child), Ok(Some(m)) if m.is_dir());
            if is_dir {
                self.walk(&child, depth + 1, budget);
                continue;
            }
            if budget.files >= MAX_FILES {
                budget.stopped = true;
                let folder = Place {
                    relative: place.relative.clone(),
                    shown: place.shown.clone(),
                };
                self.unreadable(&folder, "has more files than the scan reads");
                return;
            }
            budget.files += 1;
            self.read_entry(&child);
        }
    }
}
