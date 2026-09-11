// SPDX-License-Identifier: Apache-2.0
//
// install/kiro_cli/fs_util.rs — file-system primitives shared by the
// Kiro CLI install strategy's planning and copy phases.
//
// No Kiro-specific literal lives in this module: every item here is
// reused verbatim by sibling modules (`copy`, `mcp_server`, `claude`)
// with no rewrite. Split out of `kiro_cli.rs` as part of that file's
// 3-way modularization (write-ahead planning / copy execution /
// filesystem primitives) -- see `kiro_cli.rs`'s own module doc comment
// for the full split rationale.

use std::path::Path;

/// Whether `path`'s owner-execute bit is set. Always `false` on
/// non-Unix targets, which have no equivalent permission bit.
///
/// `pub(in crate::cli::install)`: the sibling `copy` module (`copy_skill_dir_recursive`)
/// and this strategy's own tests both call this across the
/// `kiro_cli/fs_util` module boundary.
#[cfg(unix)]
pub(in crate::cli::install) fn is_executable(path: &Path) -> std::io::Result<bool> {
    use std::os::unix::fs::PermissionsExt;
    Ok(std::fs::metadata(path)?.permissions().mode() & 0o100 != 0)
}

#[cfg(not(unix))]
pub(in crate::cli::install) fn is_executable(_path: &Path) -> std::io::Result<bool> {
    Ok(false)
}

/// Sets the file mode to `0o755` when `executable`, `0o644` otherwise.
/// No-op on non-Unix targets, which have no equivalent permission bit.
/// `pub(in crate::cli::install)`: the sibling `mcp_server` module reuses this for its
/// own installed binary's executable bit rather than duplicating it.
#[cfg(unix)]
pub(in crate::cli::install) fn set_executable(
    path: &Path,
    executable: bool,
) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = if executable { 0o755 } else { 0o644 };
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
pub(in crate::cli::install) fn set_executable(
    _path: &Path,
    _executable: bool,
) -> std::io::Result<()> {
    Ok(())
}

/// Rejects a synthed file name that isn't a plain path segment: empty,
/// absolute, containing a path separator, or a `..`/`.` component.
/// Mirrors `synth::kiro_cli_v2`'s own `reject_unsafe_agent_name` check
/// at the point of path construction -- copying a synthed name into a
/// destination path must not be able to escape `destination`.
/// Rejects a file name that is empty, `.`/`..`, contains a path
/// separator, or is otherwise unsafe to join onto a destination
/// directory without escaping it. `pub(in crate::cli::install)`: the sibling
/// `mcp_server` module reuses this for its own binary/symlink names
/// rather than duplicating the check.
pub(in crate::cli::install) fn reject_unsafe_file_name(file_name: &str) -> Result<(), String> {
    let is_unsafe = file_name.is_empty()
        || Path::new(file_name).is_absolute()
        || file_name == ".."
        || file_name == "."
        || file_name.contains('/')
        || file_name.contains('\\');
    if is_unsafe {
        return Err(format!(
            "unsafe file name for install destination: {file_name:?}"
        ));
    }
    Ok(())
}
