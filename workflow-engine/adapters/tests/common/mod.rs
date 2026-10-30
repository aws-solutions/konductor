// SPDX-License-Identifier: Apache-2.0
//! Helpers shared by the tests of the adapters.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

/// A folder in the system temporary directory that is removed when the value is dropped.
pub struct TempDir {
    path: PathBuf,
}

static COUNTER: AtomicUsize = AtomicUsize::new(0);

impl TempDir {
    pub fn new(label: &str) -> TempDir {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "workflow-adapters-{label}-{}-{n}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        TempDir { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Writes a file under the folder, creating the directories above it.
    pub fn write(&self, relative: &str, bytes: &[u8]) -> PathBuf {
        let target = self.path.join(relative);
        fs::create_dir_all(target.parent().expect("parent")).expect("create dirs");
        fs::write(&target, bytes).expect("write file");
        target
    }

    pub fn mkdir(&self, relative: &str) -> PathBuf {
        let target = self.path.join(relative);
        fs::create_dir_all(&target).expect("create dir");
        target
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub const WORKFLOWS: &str = ".konductor/workflows";
