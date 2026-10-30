// SPDX-License-Identifier: Apache-2.0
//
// install_info.rs - the on-disk shape of a target's
// `.konductor/install-info.json` and the rule for when a file there counts
// as a valid record. The CLI writes the file; the CLI and skill-lookup-mcp
// both read it, so they share this one validity rule.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Independent of `INSTANCE_SCHEMA_VERSION`.
pub const INSTALL_INFO_SCHEMA_VERSION: u64 = 1;

/// `.konductor/install-info.json`'s on-disk shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallInfoRecord {
    pub schema_version: u64,
    /// Null when the installed content has no readable `dist/VERSION`.
    pub agent_version: Option<String>,
    pub harness: String,
    pub installed_at: String,
}

impl InstallInfoRecord {
    pub fn new(
        agent_version: Option<String>,
        harness: impl Into<String>,
        installed_at: impl Into<String>,
    ) -> Self {
        InstallInfoRecord {
            schema_version: INSTALL_INFO_SCHEMA_VERSION,
            agent_version,
            harness: harness.into(),
            installed_at: installed_at.into(),
        }
    }
}

/// Why a read did not produce a usable [`InstallInfoRecord`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallInfoAbsence {
    /// No file at the path: the target opted out, at install or at a later
    /// `update --no-telemetry`, which deletes the record.
    NotFound,
    /// A file exists but is unreadable, not valid JSON, or carries a
    /// `schema_version` this build does not recognize. Nobody opted out,
    /// but the file cannot be trusted either.
    Broken,
}

/// Reads and validates the record at `path`.
pub fn read_install_info_record(path: &Path) -> Result<InstallInfoRecord, InstallInfoAbsence> {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(InstallInfoAbsence::NotFound);
        }
        Err(_) => return Err(InstallInfoAbsence::Broken),
    };
    let record: InstallInfoRecord =
        serde_json::from_str(&contents).map_err(|_| InstallInfoAbsence::Broken)?;
    if record.schema_version != INSTALL_INFO_SCHEMA_VERSION {
        return Err(InstallInfoAbsence::Broken);
    }
    Ok(record)
}

/// Whether `path` holds a valid record, i.e. the target is opted in.
pub fn install_info_record_is_valid(path: &Path) -> bool {
    read_install_info_record(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch_file(label: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "konductor-telemetry-install-info-{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("install-info.json")
    }

    #[test]
    fn a_written_record_reads_back_valid() {
        let path = scratch_file("valid");
        let record = InstallInfoRecord::new(Some("1.2.3".into()), "kiro-cli-v2", "t");
        fs::write(&path, serde_json::to_string(&record).unwrap()).unwrap();
        assert_eq!(read_install_info_record(&path), Ok(record));
        assert!(install_info_record_is_valid(&path));
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let path = scratch_file("missing");
        assert_eq!(
            read_install_info_record(&path),
            Err(InstallInfoAbsence::NotFound)
        );
        assert!(!install_info_record_is_valid(&path));
    }

    #[test]
    fn malformed_wrong_shape_or_wrong_schema_is_broken() {
        let wrong_schema = serde_json::json!({
            "schema_version": INSTALL_INFO_SCHEMA_VERSION + 1,
            "agent_version": null,
            "harness": "claude",
            "installed_at": "t"
        })
        .to_string();
        for contents in ["not json", "{}", wrong_schema.as_str()] {
            let path = scratch_file("broken");
            fs::write(&path, contents).unwrap();
            assert_eq!(
                read_install_info_record(&path),
                Err(InstallInfoAbsence::Broken),
                "contents: {contents}"
            );
            assert!(!install_info_record_is_valid(&path));
        }
    }

    #[test]
    fn a_directory_at_the_path_is_broken() {
        let path = scratch_file("directory");
        fs::create_dir_all(&path).unwrap();
        assert_eq!(
            read_install_info_record(&path),
            Err(InstallInfoAbsence::Broken)
        );
    }
}
