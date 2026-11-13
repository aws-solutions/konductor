// SPDX-License-Identifier: Apache-2.0
//! The repo tool configuration files (spec: "Repo tool configuration"): the files a headless run loads from the repo
//! with no tool prompt, or that can approve a tool or start a program on their own. They are:
//!
//! - `.claude/settings.json` and `.claude/settings.local.json`, which hold hooks and permissions (Claude Code loads
//!   the local one too, and a git checkout usually ignores it);
//! - `.mcp.json` and `.kiro/settings/mcp.json`, which start MCP servers;
//! - the files under `.kiro/agents/` and `.claude/agents/`, which set the tools of an agent;
//! - the files under `.claude/skills/` and `.claude/commands/`, which can pre-approve tools while they are used, and
//!   under `.claude/hooks/`, where the scripts that a hook runs are kept by convention.
//!
//! `.claude/` as a whole is not read: it also holds state that has nothing to do with what runs, such as the
//! checkouts of Claude Code worktrees, and a folder that size would refuse every run. `CLAUDE.md` and the Kiro
//! steering and skill files are text for the model and start nothing, so they are not read either.
//!
//! The folders searched are the project root and each folder above it up to the git root. Claude Code finds
//! `.claude/agents/` that way, and the other paths are searched in every one of those folders because a tool that
//! looks only in the folder it starts in costs nothing to over-cover.
//!
//! A file that Konductor's install manifest records, and that still has the hash the install gave it, is left out, so
//! a project install does not ask on every run. Everything else that is there counts.
//!
//! The scan never skips what it cannot read. Anything it cannot hash from its content, whether a read or stat failed,
//! a link it does not follow, a folder with more entries than the scan reads, a folder nested too deep, a file over
//! 1 MiB or a name that is not UTF-8, is returned as an [`UnreadableConfig`] with the reason, and the scan gives no
//! files at all. Such an entry has no hash and cannot vouch for the files behind it, so the caller refuses the run.

use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use workflow_core::trust::{sha256_hex, ConfigFile, UnreadableConfig};

const FILES: &[&str] = &[
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".mcp.json",
    ".kiro/settings/mcp.json",
];
const DIRECTORIES: &[&str] = &[
    ".kiro/agents",
    ".claude/agents",
    ".claude/commands",
    ".claude/hooks",
    ".claude/skills",
];
/// A file over this many bytes is reported as unreadable and not read.
const MAX_BYTES: u64 = 1024 * 1024;
/// How deep below one of the folders in `DIRECTORIES` the scan goes. The folder itself is depth 0.
pub const MAX_DEPTH: usize = 4;
/// How many entries, files and folders together, the scan lists below one of the folders in `DIRECTORIES`. A folder
/// that makes the total larger is reported as unreadable, and the listing stops there, so the scan cannot be made to
/// walk or collect without limit.
pub const MAX_ENTRIES: usize = 512;

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
///
/// When any entry cannot be read in full, the result is `Err` with every such entry, sorted by path, and no file is
/// returned: there is nothing to hash.
pub fn scan(
    project_root: &Path,
    home: Option<&Path>,
    installed: &InstalledFiles,
) -> Result<Vec<ConfigFile>, Vec<UnreadableConfig>> {
    let folders = config_folders(project_root, home);
    let outermost = folders
        .last()
        .cloned()
        .unwrap_or_else(|| project_root.to_path_buf());
    let mut found = Vec::new();
    let mut unreadable = Vec::new();
    for (n, folder) in folders.iter().enumerate() {
        let prefix = relative_to(folder, &outermost);
        let mut scan = Scan {
            root: folder,
            prefix: &prefix,
            found: Vec::new(),
            unreadable: Vec::new(),
        };
        scan.run();
        unreadable.append(&mut scan.unreadable);
        // Only the project root is the folder an install writes to.
        let from_install = if n == 0 { Some(installed) } else { None };
        found.extend(scan.found.into_iter().filter(|file| match from_install {
            Some(installed) => {
                let inside = file
                    .path
                    .strip_prefix(&prefix_with_slash(&prefix))
                    .unwrap_or(&file.path);
                !installed.contains(&(inside.to_string(), sha256_hex(&file.bytes)))
            }
            None => true,
        }));
    }
    if !unreadable.is_empty() {
        unreadable.sort_by(|a, b| a.path.cmp(&b.path));
        return Err(unreadable);
    }
    found.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(found)
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
    unreadable: Vec<UnreadableConfig>,
}

/// How far the walk of one of the folders in `DIRECTORIES` has gone.
struct Budget {
    /// The entries listed so far, files and folders.
    entries: usize,
    /// Set when the cap was hit. The rest of the tree is not listed, and the folder that hit it is marked once.
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
                entries: 0,
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
        self.unreadable.push(UnreadableConfig {
            path,
            reason: why.to_string(),
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
                self.found.push(ConfigFile { path, bytes });
            }
            Ok(_) => self.unreadable(place, "is over 1 MiB"),
            Err(_) => self.unreadable(place, "could not be read"),
        }
    }

    fn walk(&mut self, place: &Place, depth: usize, budget: &mut Budget) {
        if budget.stopped {
            return;
        }
        let meta = match self.look(place) {
            Ok(Some(meta)) => meta,
            Ok(None) => return,
            Err(_) => return self.unreadable(place, "could not be inspected"),
        };
        if meta.is_symlink() || !meta.is_dir() {
            // A folder is searched only when it is a real directory. A link to a folder is not followed, and it is
            // reported so that the run is refused.
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
        // The listing is cut at the cap, so a folder with millions of entries is not collected.
        let mut names: Vec<OsString> = Vec::new();
        let mut listing_failed = false;
        for entry in entries {
            if budget.entries >= MAX_ENTRIES {
                budget.stopped = true;
                break;
            }
            match entry {
                Ok(entry) => {
                    budget.entries += 1;
                    names.push(entry.file_name());
                }
                Err(_) => listing_failed = true,
            }
        }
        if budget.stopped {
            return self.unreadable(place, "has more files and folders than the scan reads");
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
            } else {
                self.read_entry(&child);
            }
        }
    }
}
