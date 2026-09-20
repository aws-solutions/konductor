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
/// absolute, containing a path separator, a `..`/`.` component, or any
/// of the control/whitespace/format-character set
/// `synth::path_safety::reject_unsafe_name_segment` rejects. Delegates
/// to that function -- the crate's single shared source of truth for
/// this exact containment check -- rather than carrying its own
/// independent boolean chain, so every caller of this function inherits
/// whatever coverage that shared check has, without the two ever being
/// able to drift apart the way a hand-maintained duplicate could.
/// Mirrors `synth::kiro_cli_v2`'s own `reject_unsafe_agent_name` check at
/// the point of path construction -- copying a synthed name into a
/// destination path must not be able to escape `destination`. The
/// control-character coverage extends that same
/// safety-at-path-construction contract to callers that also render the
/// name into other contexts (e.g. a YAML scalar): rejecting it here means
/// a downstream renderer that assumes control-character-free input, such
/// as `install::claude`'s `yaml_double_quote`, never sees one.
///
/// `pub(in crate::cli::install)`: the sibling `mcp_server` module reuses
/// this for its own binary/symlink names rather than duplicating the
/// check.
pub(in crate::cli::install) fn reject_unsafe_file_name(file_name: &str) -> Result<(), String> {
    if crate::cli::synth::path_safety::reject_unsafe_name_segment(file_name) {
        return Err(format!(
            "unsafe file name for install destination: {file_name:?}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reject_unsafe_file_name_rejects_a_name_containing_a_newline() {
        assert!(reject_unsafe_file_name("weird\nname").is_err());
    }

    #[test]
    fn reject_unsafe_file_name_rejects_a_name_containing_a_tab() {
        assert!(reject_unsafe_file_name("weird\tname").is_err());
    }

    /// Regression guard for the delegation to
    /// `synth::path_safety::reject_unsafe_name_segment`: a bidirectional
    /// override or zero-width character (Unicode category `Cf`, not
    /// covered by `char::is_control`) must be rejected here too, now
    /// that this function no longer carries its own independent
    /// (narrower) boolean chain.
    #[test]
    fn reject_unsafe_file_name_rejects_a_name_containing_a_cf_character() {
        assert!(reject_unsafe_file_name("weird\u{202E}name").is_err());
        assert!(reject_unsafe_file_name("weird\u{200B}name").is_err());
    }

    /// Regression guard for the same delegation: plain whitespace (not a
    /// control character at all -- an ASCII space is category Zs, not
    /// Cc) must be rejected here too.
    #[test]
    fn reject_unsafe_file_name_rejects_a_name_containing_a_space() {
        assert!(reject_unsafe_file_name("weird name").is_err());
    }
}
