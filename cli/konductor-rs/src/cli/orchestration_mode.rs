// SPDX-License-Identifier: Apache-2.0
//
// orchestration_mode.rs: reads `orchestration.mode` from the user's
// `~/.konductor/config.yml`. The session hook and `doctor` share this one
// reader. Only the user layer is read; a project file's value is ignored.

use std::path::{Path, PathBuf};

use crate::cli::config::{self, user_config_path, ConfigError};

#[allow(dead_code)] // Callers arrive with the session hook.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Mode {
    Auto,
    Coordinator,
}

#[allow(dead_code)]
impl Mode {
    /// The only place the allowed values are listed. Case-sensitive.
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

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ModeResolution {
    /// No `~/.konductor/config.yml`, or no `orchestration.mode` in it.
    Default,
    /// The user file names a valid mode.
    Explicit(Mode),
    /// The file exists but cannot be used; the session runs `auto` and says why.
    Fallback(FallbackReason),
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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
    let raw = match config::load_raw_config(&path) {
        Ok(raw) => raw,
        Err(error) => return ModeResolution::Fallback(load_failure(path, error)),
    };
    match raw.orchestration.and_then(|section| section.mode) {
        None => ModeResolution::Default,
        Some(value) => match Mode::parse(&value) {
            Some(mode) => ModeResolution::Explicit(mode),
            None => ModeResolution::Fallback(FallbackReason::UnknownValue { value }),
        },
    }
}

#[allow(dead_code)]
fn load_failure(path: PathBuf, error: ConfigError) -> FallbackReason {
    match error {
        ConfigError::ProjectConfigNotReadable { source, .. } => FallbackReason::Unreadable {
            path,
            kind: source.kind(),
        },
        ConfigError::ProjectConfigMalformed { source, .. } => FallbackReason::Malformed {
            path,
            message: first_line(&source.to_string()),
        },
        other => FallbackReason::Malformed {
            path,
            message: first_line(&other.to_string()),
        },
    }
}

#[allow(dead_code)]
fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or_default().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::config::KONDUCTOR_DIR_NAME;
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
