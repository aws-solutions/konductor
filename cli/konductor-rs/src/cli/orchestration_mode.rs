// SPDX-License-Identifier: Apache-2.0
//
// orchestration_mode.rs: reads `orchestration.mode` from the user's
// `~/.konductor/config.yml`. The session hook and `doctor` share this one
// reader. Only the user layer is read; a project file's value is ignored;
// `doctor` reports one.
//
// The mode is not a gate setting, so no gate command may fail on it. The
// section therefore stays out of `config::RawConfig`: the gate loader ignores
// it like any unknown key, `config set` keeps it (it edits the YAML mapping),
// and this module parses it on its own, turning a bad shape into a fallback.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::cli::config::user_config_path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Auto,
    Coordinator,
}

impl Mode {
    /// The only place that decides which values are accepted. Case-sensitive.
    pub(crate) fn parse(value: &str) -> Option<Mode> {
        match value {
            "auto" => Some(Mode::Auto),
            "coordinator" => Some(Mode::Coordinator),
            _ => None,
        }
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Mode::Auto => "auto",
            Mode::Coordinator => "coordinator",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ModeResolution {
    /// No `~/.konductor/config.yml`, or no `orchestration.mode` in it.
    Default,
    /// The user file names a valid mode.
    Explicit(Mode),
    /// The file exists but cannot be used; the session runs `auto` and says why.
    Fallback(FallbackReason),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum FallbackReason {
    HomeUnresolved,
    Unreadable {
        path: PathBuf,
        kind: std::io::ErrorKind,
    },
    Malformed {
        path: PathBuf,
        message: String,
    },
    UnknownValue {
        value: String,
    },
}

/// `home` comes from `index::env_home_dir`, which treats an empty `HOME`
/// as unset. Only `NotFound` (which covers a dangling symlink) counts as no
/// file. Unlike the gate loader's `is_file()` check, a path that cannot be
/// stat'ed or is not a file is a `Fallback`, so a set mode is never lost
/// without a reason shown.
pub(crate) fn resolve_user_mode(home: Option<&Path>) -> ModeResolution {
    let Some(home) = home else {
        return ModeResolution::Fallback(FallbackReason::HomeUnresolved);
    };
    let path = user_config_path(home);
    match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(metadata) => {
            let kind = if metadata.is_dir() {
                std::io::ErrorKind::IsADirectory
            } else {
                std::io::ErrorKind::Unsupported
            };
            return ModeResolution::Fallback(FallbackReason::Unreadable { path, kind });
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return ModeResolution::Default
        }
        Err(error) => {
            return ModeResolution::Fallback(FallbackReason::Unreadable {
                path,
                kind: error.kind(),
            })
        }
    }
    let section = match read_section(&path) {
        Ok(Some(section)) => section,
        Ok(None) => return ModeResolution::Default,
        // Removed between the stat and the read: same as never there.
        Err(SectionError::Unreadable(source)) if source.kind() == std::io::ErrorKind::NotFound => {
            return ModeResolution::Default
        }
        Err(SectionError::Unreadable(source)) => {
            return ModeResolution::Fallback(FallbackReason::Unreadable {
                path,
                kind: source.kind(),
            })
        }
        Err(SectionError::Malformed(message)) => {
            return ModeResolution::Fallback(FallbackReason::Malformed { path, message })
        }
    };
    match section.mode {
        // A misspelled `mode` must not read as "no mode set". A known `mode`
        // next to an unknown key is a newer sibling and is left alone.
        None if !section.unknown_keys.is_empty() => {
            let keys: Vec<&str> = section.unknown_keys.keys().map(String::as_str).collect();
            ModeResolution::Fallback(FallbackReason::Malformed {
                path,
                message: format!(
                    "unknown key {} under orchestration (expected mode)",
                    keys.join(", ")
                ),
            })
        }
        None => ModeResolution::Default,
        Some(value) => match Mode::parse(&value) {
            Some(mode) => ModeResolution::Explicit(mode),
            None => ModeResolution::Fallback(FallbackReason::UnknownValue { value }),
        },
    }
}

/// The `orchestration:` mapping of a config file.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct OrchestrationSection {
    pub(crate) mode: Option<String>,
    /// Keys this CLI does not know, such as a misspelled `mdoe`. Kept, not
    /// rejected, so a newer sibling key does not break an older CLI;
    /// `resolve_user_mode` reports them instead of silently using auto.
    #[serde(flatten)]
    pub(crate) unknown_keys: std::collections::BTreeMap<String, serde_yaml::Value>,
}

#[derive(Debug)]
pub(crate) enum SectionError {
    Unreadable(std::io::Error),
    Malformed(String),
}

/// Reads the `orchestration:` section of the config file at `path`.
/// An empty file, a missing key and a null section are `Ok(None)`.
pub(crate) fn read_section(path: &Path) -> Result<Option<OrchestrationSection>, SectionError> {
    let contents = std::fs::read_to_string(path).map_err(SectionError::Unreadable)?;
    let document: serde_yaml::Value = serde_yaml::from_str(&contents)
        .map_err(|error| SectionError::Malformed(first_line(&error.to_string())))?;
    let section = match document {
        serde_yaml::Value::Null => return Ok(None),
        serde_yaml::Value::Mapping(mapping) => {
            match mapping.get(serde_yaml::Value::String("orchestration".to_string())) {
                None | Some(serde_yaml::Value::Null) => return Ok(None),
                Some(section) => section.clone(),
            }
        }
        _ => {
            return Err(SectionError::Malformed(
                "config file is not a mapping".to_string(),
            ))
        }
    };
    serde_yaml::from_value(section)
        .map(Some)
        .map_err(|error| SectionError::Malformed(first_line(&error.to_string())))
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::config::{
        load_config_with_home, set_config_value, CONFIG_FILE_NAME, KONDUCTOR_DIR_NAME,
    };
    use std::fs;

    fn scratch_home(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "konductor-orchestration-mode-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join(KONDUCTOR_DIR_NAME)).unwrap();
        dir
    }

    fn resolve_with(name: &str, contents: &str) -> ModeResolution {
        let home = scratch_home(name);
        fs::write(user_config_path(&home), contents).unwrap();
        let resolution = resolve_user_mode(Some(&home));
        fs::remove_dir_all(&home).ok();
        resolution
    }

    fn assert_malformed(resolution: ModeResolution) {
        match resolution {
            ModeResolution::Fallback(FallbackReason::Malformed { message, .. }) => {
                assert!(!message.is_empty());
                assert!(!message.contains('\n'));
            }
            other => panic!("expected Malformed, got {other:?}"),
        }
    }

    fn unknown(value: &str) -> ModeResolution {
        ModeResolution::Fallback(FallbackReason::UnknownValue {
            value: value.to_string(),
        })
    }

    #[test]
    fn no_home_is_home_unresolved() {
        assert_eq!(
            resolve_user_mode(None),
            ModeResolution::Fallback(FallbackReason::HomeUnresolved)
        );
    }

    #[test]
    fn missing_file_is_default() {
        let home = scratch_home("missing");
        assert_eq!(resolve_user_mode(Some(&home)), ModeResolution::Default);
        fs::remove_dir_all(&home).ok();
    }

    #[cfg(unix)]
    #[test]
    fn dangling_symlink_is_default() {
        let home = scratch_home("dangling");
        std::os::unix::fs::symlink(home.join("nowhere.yml"), user_config_path(&home)).unwrap();
        assert_eq!(resolve_user_mode(Some(&home)), ModeResolution::Default);
        fs::remove_dir_all(&home).ok();
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_file_is_unreadable() {
        use std::os::unix::fs::PermissionsExt;
        let home = scratch_home("unreadable");
        let path = user_config_path(&home);
        fs::write(&path, "orchestration:\n  mode: coordinator\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::read_to_string(&path).is_ok() {
            // Running as root: permissions do not block the read.
            fs::remove_dir_all(&home).ok();
            return;
        }
        let resolution = resolve_user_mode(Some(&home));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::remove_dir_all(&home).ok();
        assert_eq!(
            resolution,
            ModeResolution::Fallback(FallbackReason::Unreadable {
                path,
                kind: std::io::ErrorKind::PermissionDenied,
            })
        );
    }

    #[test]
    fn directory_at_path_is_unreadable() {
        let home = scratch_home("directory");
        let path = user_config_path(&home);
        fs::create_dir(&path).unwrap();
        let resolution = resolve_user_mode(Some(&home));
        fs::remove_dir_all(&home).ok();
        assert_eq!(
            resolution,
            ModeResolution::Fallback(FallbackReason::Unreadable {
                path,
                kind: std::io::ErrorKind::IsADirectory,
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn untraversable_konductor_dir_is_unreadable() {
        use std::os::unix::fs::PermissionsExt;
        let home = scratch_home("untraversable");
        let path = user_config_path(&home);
        fs::write(&path, "orchestration:\n  mode: coordinator\n").unwrap();
        let dir = home.join(KONDUCTOR_DIR_NAME);
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::metadata(&path).is_ok() {
            // Running as root: permissions do not block the stat.
            fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
            fs::remove_dir_all(&home).ok();
            return;
        }
        let resolution = resolve_user_mode(Some(&home));
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_dir_all(&home).ok();
        assert_eq!(
            resolution,
            ModeResolution::Fallback(FallbackReason::Unreadable {
                path,
                kind: std::io::ErrorKind::PermissionDenied,
            })
        );
    }

    #[test]
    fn non_yaml_is_malformed() {
        assert_malformed(resolve_with("non-yaml", "not: valid: yaml: ["));
    }

    #[test]
    fn non_mapping_orchestration_is_malformed() {
        assert_malformed(resolve_with("scalar-section", "orchestration: 3\n"));
    }

    #[test]
    fn non_string_mode_is_malformed() {
        assert_malformed(resolve_with("list-mode", "orchestration:\n  mode: [a]\n"));
    }

    #[test]
    fn empty_file_is_default() {
        assert_eq!(resolve_with("empty", ""), ModeResolution::Default);
    }

    #[test]
    fn missing_orchestration_key_is_default() {
        assert_eq!(
            resolve_with("no-key", "tier: minor\n"),
            ModeResolution::Default
        );
    }

    #[test]
    fn empty_orchestration_section_is_default() {
        assert_eq!(
            resolve_with("empty-section", "orchestration: {}\n"),
            ModeResolution::Default
        );
    }

    #[test]
    fn misspelled_mode_key_is_malformed() {
        for (name, contents) in [
            ("typo", "orchestration:\n  mdoe: coordinator\n"),
            ("case", "orchestration:\n  Mode: coordinator\n"),
        ] {
            match resolve_with(name, contents) {
                ModeResolution::Fallback(FallbackReason::Malformed { message, .. }) => {
                    assert!(message.contains("unknown key"), "{message}");
                    assert!(message.contains("under orchestration"), "{message}");
                }
                other => panic!("{name}: expected Malformed, got {other:?}"),
            }
        }
    }

    #[test]
    fn unknown_sibling_of_a_valid_mode_is_ignored() {
        assert_eq!(
            resolve_with(
                "sibling",
                "orchestration:\n  mode: coordinator\n  later: 1\n"
            ),
            ModeResolution::Explicit(Mode::Coordinator)
        );
    }

    #[test]
    fn null_mode_is_default() {
        assert_eq!(
            resolve_with("null-mode", "orchestration:\n  mode: ~\n"),
            ModeResolution::Default
        );
    }

    #[test]
    fn valid_values_are_explicit() {
        assert_eq!(
            resolve_with("auto", "orchestration:\n  mode: auto\n"),
            ModeResolution::Explicit(Mode::Auto)
        );
        assert_eq!(
            resolve_with("coordinator", "orchestration:\n  mode: coordinator\n"),
            ModeResolution::Explicit(Mode::Coordinator)
        );
    }

    #[test]
    fn unquoted_trailing_space_is_stripped_by_yaml() {
        assert_eq!(
            resolve_with("trailing-space", "orchestration:\n  mode: auto \n"),
            ModeResolution::Explicit(Mode::Auto)
        );
    }

    #[test]
    fn other_values_are_unknown() {
        for (name, yaml_value, parsed) in [
            ("upper", "AUTO", "AUTO"),
            ("title", "Auto", "Auto"),
            ("strict", "strict", "strict"),
            ("single", "single", "single"),
            ("quoted-space", "\"coordinator \"", "coordinator "),
        ] {
            let contents = format!("orchestration:\n  mode: {yaml_value}\n");
            assert_eq!(
                resolve_with(name, &contents),
                unknown(parsed),
                "{yaml_value}"
            );
        }
    }

    #[test]
    fn non_mapping_document_is_malformed() {
        assert_malformed(resolve_with("sequence-doc", "- a\n- b\n"));
    }

    #[test]
    fn malformed_user_orchestration_section_leaves_load_config_working() {
        let root = scratch_home("malformed-gate-root");
        let home = scratch_home("malformed-gate-home");
        fs::write(user_config_path(&home), "orchestration: 3\n").unwrap();

        let loaded = load_config_with_home(&root, Some(&home));
        let resolution = resolve_user_mode(Some(&home));
        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&home).ok();

        assert!(loaded.is_ok(), "{loaded:?}");
        assert!(
            matches!(
                resolution,
                ModeResolution::Fallback(FallbackReason::Malformed { .. })
            ),
            "{resolution:?}"
        );
    }

    #[test]
    fn malformed_project_orchestration_section_leaves_gates_working() {
        let root = scratch_home("malformed-project");
        fs::write(
            root.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME),
            "orchestration:\n  mode: [a]\ntier: minor\n",
        )
        .unwrap();

        let loaded = load_config_with_home(&root, None);
        fs::remove_dir_all(&root).ok();

        assert!(loaded.is_ok(), "{loaded:?}");
    }

    #[test]
    fn project_only_mode_is_not_read_by_the_resolver() {
        let home = scratch_home("project-only-home");
        let project = scratch_home("project-only-project");
        let project_file = project.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME);
        fs::write(&project_file, "orchestration:\n  mode: coordinator\n").unwrap();

        let resolution = resolve_user_mode(Some(&home));
        let project_section = read_section(&project_file).unwrap().expect("section kept");
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&project).ok();

        assert_eq!(resolution, ModeResolution::Default);
        assert_eq!(project_section.mode.as_deref(), Some("coordinator"));
    }

    #[test]
    fn config_set_keeps_orchestration_section_and_unknown_keys() {
        let root = scratch_home("set-keeps-section");
        let path = root.join(KONDUCTOR_DIR_NAME).join(CONFIG_FILE_NAME);
        fs::write(
            &path,
            "orchestration:\n  mode: coordinator\n  mdoe: x\ntier: minor\n",
        )
        .unwrap();

        set_config_value(&root, "tier", "full").expect("set tier must succeed");

        let section = read_section(&path).unwrap().expect("section kept");
        fs::remove_dir_all(&root).ok();
        assert_eq!(section.mode.as_deref(), Some("coordinator"));
        assert_eq!(
            section.unknown_keys.get("mdoe"),
            Some(&serde_yaml::Value::String("x".to_string()))
        );
    }

    #[test]
    fn parse_accepts_exactly_the_two_values() {
        assert_eq!(Mode::parse("auto"), Some(Mode::Auto));
        assert_eq!(Mode::parse("coordinator"), Some(Mode::Coordinator));
        for value in ["", "Auto", "COORDINATOR", " auto", "strict", "single"] {
            assert_eq!(Mode::parse(value), None, "{value:?}");
        }
        assert_eq!(Mode::Auto.as_str(), "auto");
        assert_eq!(Mode::Coordinator.as_str(), "coordinator");
    }
}
