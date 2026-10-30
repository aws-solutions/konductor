// SPDX-License-Identifier: Apache-2.0
//! Lookup of a bare name: the project file, then the user file (D5).
//!
//! Shipped workflows (`library/<name>`) are not part of this step, because none exist yet.

use std::path::Path;

use workflow_core::read_workflow_text;

use crate::file_source::FileSource;

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

    /// The nearest workflow named `name` that the engine may read. A project file that the file rules treat as not
    /// there, such as one over the size limit, does not hide the user file.
    pub fn find(&self, name: &str) -> Option<Found> {
        let candidates = [
            (Scope::Project, Some(&self.project)),
            (Scope::User, self.user.as_ref()),
        ];
        candidates.into_iter().find_map(|(scope, source)| {
            let source = source?;
            let text = read_workflow_text(source, name)?;
            Some(Found {
                scope,
                text,
                source: source.clone(),
            })
        })
    }
}
