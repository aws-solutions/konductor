// SPDX-License-Identifier: Apache-2.0
//! The trust record: `~/.konductor/trust.json`, in the user's home and outside every repository, with mode 0600.
//!
//! ```text
//! {"schema_version": 1, "trusted": {"<canonical repo root>": {"<workflow name>": "<trust hash>"}}}
//! ```
//!
//! A change reads the file, edits it and writes it back while it holds an exclusive advisory lock on
//! `~/.konductor/.trust.lock`, so two writers do not lose an update. The new text goes to a file of its own in the same
//! folder, which is renamed over the record, so a reader sees the old record or the new one and never half of one.
//!
//! An entry is read on its own, so one that is malformed trusts nothing and does not hide the others. A change keeps
//! every entry it does not touch, malformed ones included. A record that is not JSON, has no usable `schema_version` or
//! `trusted` object, or comes from a newer Konductor trusts nothing and is never replaced: every change, `--revoke`
//! included, stops with an error that names the file.
//!
//! The home folder must be an absolute path. A relative `HOME` would put the record in the current folder, which can be
//! the repository.

use std::collections::BTreeMap;
use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use workflow_core::json::{self, Json};
use workflow_core::ports::{PortError, TrustStore};

use crate::run_store::{io_error, read_regular, temp_path};

const FILE_NAME: &str = "trust.json";
const LOCK_NAME: &str = ".trust.lock";
const SCHEMA_VERSION: u64 = 1;
/// A record bigger than this is not read.
const MAX_RECORD_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct FileTrustStore {
    /// `~/.konductor`, or `None` when there is no usable home folder.
    dir: Option<PathBuf>,
}

/// What the record file holds.
enum Record {
    /// There is no file.
    Missing,
    /// The repos of the `trusted` object, each as it was written.
    Entries(BTreeMap<String, Json>),
    /// Written by a newer Konductor.
    Newer,
    /// There is a file and it is not a record this version can read. The text says why, after the file's path.
    Damaged(String),
    /// There is something at the path that cannot be read. The text is the whole error.
    Unreadable(String),
}

const NO_HOME: &str =
    "HOME is not set to an absolute path, so the trust record ~/.konductor/trust.json cannot be kept.";

impl FileTrustStore {
    /// The record under `home`. With no home folder, or one that is not an absolute path, nothing is trusted and
    /// nothing can be recorded.
    pub fn new(home: Option<&Path>) -> FileTrustStore {
        FileTrustStore {
            dir: home
                .filter(|h| h.is_absolute())
                .map(|h| h.join(".konductor")),
        }
    }

    pub fn path(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join(FILE_NAME))
    }

    fn load(path: &Path) -> Record {
        let text = match read_regular(path, MAX_RECORD_BYTES) {
            Ok(Some(text)) => text,
            Ok(None) => return Record::Missing,
            Err(error) => return Record::Unreadable(error.0),
        };
        let Ok(value) = json::parse(&text) else {
            return Record::Damaged("is not valid JSON".into());
        };
        match value.get("schema_version").and_then(Json::as_u64) {
            Some(SCHEMA_VERSION) => {}
            Some(v) if v > SCHEMA_VERSION => return Record::Newer,
            _ => return Record::Damaged("has no usable schema_version".into()),
        }
        match value.get("trusted") {
            Some(Json::Object(repos)) => Record::Entries(repos.clone()),
            _ => Record::Damaged("has no `trusted` object".into()),
        }
    }

    /// Runs `change` on the entries while holding the lock, and writes the result if `change` says it changed them.
    fn update(
        &self,
        change: impl FnOnce(&mut BTreeMap<String, Json>) -> bool,
    ) -> Result<bool, PortError> {
        let Some(dir) = &self.dir else {
            return Err(PortError(NO_HOME.into()));
        };
        make_private_dir(dir).map_err(|e| io_error("could not make", dir, e))?;
        let lock_path = dir.join(LOCK_NAME);
        let mut options = OpenOptions::new();
        options.create(true).truncate(false).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options
            .open(&lock_path)
            .map_err(|e| io_error("could not open", &lock_path, e))?;
        lock.lock()
            .map_err(|e| io_error("could not lock", &lock_path, e))?;
        let result = self.update_locked(dir, change);
        let _ = lock.unlock();
        result
    }

    fn update_locked(
        &self,
        dir: &Path,
        change: impl FnOnce(&mut BTreeMap<String, Json>) -> bool,
    ) -> Result<bool, PortError> {
        let path = dir.join(FILE_NAME);
        let mut trusted = match Self::load(&path) {
            Record::Missing => BTreeMap::new(),
            Record::Entries(repos) => repos,
            Record::Newer => {
                return Err(PortError(format!(
                    "{} was written by a newer Konductor, so this one leaves it alone.",
                    path.display()
                )))
            }
            Record::Unreadable(error) => {
                return Err(PortError(format!(
                    "{error}, so this one leaves the trust record alone."
                )))
            }
            Record::Damaged(why) => {
                return Err(PortError(format!(
                    "{} {why}, so this one leaves it alone. Move it aside to start a new record.",
                    path.display()
                )))
            }
        };
        if !change(&mut trusted) {
            return Ok(false);
        }
        let mut root = Json::object();
        root.insert("schema_version", Json::Number(SCHEMA_VERSION));
        root.insert("trusted", Json::Object(trusted));
        let mut text = root.pretty();
        text.push('\n');
        write_private(&path, text.as_bytes())?;
        Ok(true)
    }
}

/// Makes `dir` and any missing folder above it, with mode 0700 where this makes one.
fn make_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(dir)
}

/// Replaces `path` with `bytes`, with mode 0600 from the moment the new file exists.
fn write_private(path: &Path, bytes: &[u8]) -> Result<(), PortError> {
    if fs::symlink_metadata(path).is_ok_and(|meta| !meta.is_file()) {
        return Err(PortError(format!(
            "{} is not a regular file (a link is not followed)",
            path.display()
        )));
    }
    let temp = temp_path(path);
    let written = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file: File = options.open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)
    })();
    written.map_err(|e| {
        let _ = fs::remove_file(&temp);
        io_error("could not write", path, e)
    })
}

impl TrustStore for FileTrustStore {
    fn recorded(&self, repo: &str, workflow: &str) -> Option<String> {
        let Record::Entries(repos) = Self::load(&self.path()?) else {
            return None;
        };
        repos.get(repo)?.get(workflow)?.as_str().map(str::to_string)
    }

    fn record(&mut self, repo: &str, workflow: &str, hash: &str) -> Result<(), PortError> {
        self.update(|trusted| {
            let names = trusted.entry(repo.to_string()).or_insert_with(Json::object);
            // Only this repo's own entry is replaced when it is malformed. The others stay as they are.
            if !matches!(names, Json::Object(_)) {
                *names = Json::object();
            }
            names.insert(workflow, Json::str(hash));
            true
        })
        .map(|_| ())
    }

    fn can_record(&self) -> Result<(), PortError> {
        match self.dir {
            Some(_) => Ok(()),
            None => Err(PortError(NO_HOME.into())),
        }
    }

    fn revoke(&mut self, repo: &str, workflow: &str) -> Result<bool, PortError> {
        // With no home folder there is no record to change, which is an error as it is for `record`, so the two do not
        // disagree about where the record is kept.
        let Some(path) = self.path() else {
            return Err(PortError(NO_HOME.into()));
        };
        // With no record file there is nothing to remove, and nothing is written. A record that cannot be changed is
        // an error here as it is for `record`.
        if matches!(Self::load(&path), Record::Missing) {
            return Ok(false);
        }
        self.update(|trusted| {
            let Some(Json::Object(names)) = trusted.get_mut(repo) else {
                return false;
            };
            let removed = names.remove(workflow).is_some();
            if names.is_empty() {
                trusted.remove(repo);
            }
            removed
        })
    }
}
