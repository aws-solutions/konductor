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
//! A record that cannot be read or parsed holds nothing, and the next change replaces it.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use fs2::FileExt;
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
    /// `~/.konductor`, or `None` when there is no home folder.
    dir: Option<PathBuf>,
}

impl FileTrustStore {
    /// The record under `home`. With no home folder nothing is trusted and nothing can be recorded.
    pub fn new(home: Option<&Path>) -> FileTrustStore {
        FileTrustStore {
            dir: home.map(|h| h.join(".konductor")),
        }
    }

    pub fn path(&self) -> Option<PathBuf> {
        self.dir.as_ref().map(|d| d.join(FILE_NAME))
    }

    /// The entries of the record, or `None` if it is missing, cannot be read or does not have the shape above.
    fn read(path: &Path) -> Option<Json> {
        let text = read_regular(path, MAX_RECORD_BYTES).ok().flatten()?;
        let value = json::parse(&text).ok()?;
        if value.get("schema_version")?.as_u64()? != SCHEMA_VERSION {
            return None;
        }
        let Json::Object(repos) = value.get("trusted")? else {
            return None;
        };
        let well_formed = repos.values().all(|names| match names {
            Json::Object(names) => names.values().all(|hash| hash.as_str().is_some()),
            _ => false,
        });
        well_formed.then_some(value)
    }

    /// Runs `change` on the entries while holding the lock, and writes the result if `change` says it changed them.
    fn update(
        &self,
        change: impl FnOnce(&mut std::collections::BTreeMap<String, Json>) -> bool,
    ) -> Result<bool, PortError> {
        let Some(dir) = &self.dir else {
            return Err(PortError(
                "HOME is not set, so the trust record cannot be kept.".into(),
            ));
        };
        fs::create_dir_all(dir).map_err(|e| io_error("could not make", dir, e))?;
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
        lock.lock_exclusive()
            .map_err(|e| io_error("could not lock", &lock_path, e))?;
        let result = self.update_locked(dir, change);
        let _ = FileExt::unlock(&lock);
        result
    }

    fn update_locked(
        &self,
        dir: &Path,
        change: impl FnOnce(&mut std::collections::BTreeMap<String, Json>) -> bool,
    ) -> Result<bool, PortError> {
        let path = dir.join(FILE_NAME);
        refuse_newer_schema(&path)?;
        let mut trusted = match Self::read(&path) {
            Some(Json::Object(mut root)) => match root.remove("trusted") {
                Some(Json::Object(repos)) => repos,
                _ => Default::default(),
            },
            _ => Default::default(),
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

/// A record written by a newer Konductor is not ours to replace.
fn refuse_newer_schema(path: &Path) -> Result<(), PortError> {
    let Some(text) = read_regular(path, MAX_RECORD_BYTES).ok().flatten() else {
        return Ok(());
    };
    let version = json::parse(&text)
        .ok()
        .and_then(|v| v.get("schema_version").and_then(Json::as_u64));
    match version {
        Some(v) if v > SCHEMA_VERSION => Err(PortError(format!(
            "{} was written by a newer Konductor, so this one leaves it alone.",
            path.display()
        ))),
        _ => Ok(()),
    }
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
        let value = Self::read(&self.path()?)?;
        value
            .get("trusted")?
            .get(repo)?
            .get(workflow)?
            .as_str()
            .map(str::to_string)
    }

    fn record(&mut self, repo: &str, workflow: &str, hash: &str) -> Result<(), PortError> {
        self.update(|trusted| {
            let names = trusted.entry(repo.to_string()).or_insert_with(Json::object);
            names.insert(workflow, Json::str(hash));
            true
        })
        .map(|_| ())
    }

    fn can_record(&self) -> Result<(), PortError> {
        match self.dir {
            Some(_) => Ok(()),
            None => Err(PortError(
                "HOME is not set, so the trust record cannot be kept.".into(),
            )),
        }
    }

    fn revoke(&mut self, repo: &str, workflow: &str) -> Result<bool, PortError> {
        // With no readable record there is nothing to remove, and nothing is written.
        if self.path().is_none_or(|p| Self::read(&p).is_none()) {
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
