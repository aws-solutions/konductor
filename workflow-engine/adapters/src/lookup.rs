// SPDX-License-Identifier: Apache-2.0
//! Lookup of a bare name: the project file, then the user file (D5).
//!
//! Shipped workflows (`library/<name>`) are not part of this step, because none exist yet.

use std::path::Path;

use workflow_core::rules::decode_file;

use crate::file_source::{FileSource, Skip};

/// Where a workflow was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Project,
    User,
}

/// A workflow file that lookup found: its text, and the folder it came from, which is where its prompt files are.
#[derive(Debug)]
pub struct Found {
    pub scope: Scope,
    pub text: String,
    pub source: FileSource,
}

/// A nearer file that exists and was passed over, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Skipped {
    pub scope: Scope,
    pub reason: Skip,
}

/// What lookup found, and what it passed over on the way.
#[derive(Debug)]
pub struct Located {
    pub found: Option<Found>,
    pub skipped: Vec<Skipped>,
}

/// The folders to look in, nearest first.
#[derive(Debug)]
pub struct Lookup {
    project: FileSource,
    user: Option<FileSource>,
}

impl Lookup {
    /// `project_root` is the root of the project and `home` the user's home folder, if there is one.
    pub fn new(project_root: &Path, home: Option<&Path>) -> Lookup {
        Lookup {
            project: FileSource::under(project_root),
            user: home.map(FileSource::under),
        }
    }

    /// The nearest workflow named `name` that the engine may read. A file that the file rules treat as not there, such
    /// as a link or one over the size limit, does not hide a farther one, and is listed in `skipped` so the caller can
    /// say which file was used and why a nearer one was not.
    pub fn find(&self, name: &str) -> Located {
        let mut skipped = Vec::new();
        let candidates = [
            (Scope::Project, Some(&self.project)),
            (Scope::User, self.user.as_ref()),
        ];
        for (scope, source) in candidates {
            let Some(source) = source else { continue };
            let bytes = match source.try_workflow_bytes(name) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => continue,
                Err(reason) => {
                    skipped.push(Skipped { scope, reason });
                    continue;
                }
            };
            match decode_file(bytes) {
                Some(text) => {
                    let found = Found {
                        scope,
                        text,
                        source: source.clone(),
                    };
                    return Located {
                        found: Some(found),
                        skipped,
                    };
                }
                None => skipped.push(Skipped {
                    scope,
                    reason: Skip::NotUtf8,
                }),
            }
        }
        Located {
            found: None,
            skipped,
        }
    }
}
