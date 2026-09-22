// SPDX-License-Identifier: Apache-2.0
//
// install/mcp_server.rs — copies MCP server binaries
// (`MCP_SERVER_BINARY_NAMES`) alongside whatever `kiro_cli.rs`'s
// `install_from_local` already installs.
//
// ── Source and destination ──────────────────────────────────────────────
// `konductor install` copies a pre-built `mcp/servers/<name>/` release
// binary from `<repo_root>/mcp/target/release/<name>` into
// `<target_dir>/.konductor/bin/<name>`. Not wired through synth's
// `dist/` staging tree -- a compiled binary isn't part of the
// `CanonicalModel` synth renders; `mcp/`'s own `cargo build --release`
// is a separate build step. `update`/`uninstall` need no changes since
// both already walk `manifest.files` generically.
//
// A missing binary is not an error: an install with real
// agent/skill/context content but no built MCP binary must still
// succeed, exactly as before this feature existed. `rewrite_mcp_servers`
// (in `kiro_cli.rs`) uses the same absence as its own gate -- no
// binary copied means no `mcpServers` entry injected either.
//
// ── Why install-time injection, not a static spec + PATH symlink ────────
// An earlier version declared `mcpServers.konductor-skills` directly
// in the committed `konductor`/`k-developer` specs, launched by bare
// name via a `$HOME/.local/bin` symlink. Two problems with that:
//
// 1. A static entry in a committed spec ships to every install,
//    including downstream installs with no use for it -- there's no
//    signal inside `konductor-rs` to distinguish that case, so the fix
//    is to never bake it into the spec and inject it only where the
//    binary was actually built and copied.
// 2. The bare-name + `$HOME`-symlink approach only worked for
//    `--target $HOME` installs; a project-local `--target` copied the
//    binary but produced no usable `mcpServers` entry at all.
//
// So: gate on the local build artifact existing, inject an absolute
// path -- never a bare name, never PATH-dependent. See `kiro_cli.rs`'s
// `rewrite_mcp_servers` for the injection itself.

use std::path::Path;

use super::artifact::sha256_hex;
use super::kiro_cli::{
    content_manifest_path, reject_unsafe_file_name, set_executable, PlannedFile,
    KONDUCTOR_DESTINATION_ROOT,
};
use super::manifest::{classify_provenance, ManifestFile, Provenance, StrategyManifest};

/// Names of `mcp/servers/<name>/` binaries `konductor install` copies
/// into `<target_dir>/.konductor/bin/`, if present at
/// `<repo_root>/mcp/target/release/<name>`. Adding a binary here needs
/// no other change -- `install_from_local`/`update`/`uninstall` all
/// operate generically over `manifest.files`.
pub(super) const MCP_SERVER_BINARY_NAMES: &[&str] = &["skill-lookup-mcp"];

/// Content-type segment binaries are copied into, under
/// `KONDUCTOR_DESTINATION_ROOT` -- e.g. `.konductor/bin/skill-lookup-mcp`.
/// Kept out of `.kiro/`: this is Konductor tooling, not a Kiro CLI concept.
pub(super) const BIN_CONTENT_TYPE_DIR: &str = "bin";

/// Where `install_from_local` looks for a pre-built MCP server binary,
/// relative to `--from <repo-root>`. Covers the plain `cargo build
/// --release` path only; a redirected `CARGO_TARGET_DIR` isn't picked
/// up by this exact path.
///
/// `pub(super)`, not private: `remote.rs`'s no-`--from` MCP-binary
/// fetch (`install_mcp_server_binary_into_remote_temp_dir`) writes the
/// remotely-fetched binary to this EXACT path, inside the ephemeral
/// unpacked-archive temp dir it treats as this run's own
/// `repo_root` -- reusing this single destination-path computation
/// rather than duplicating it, so `plan_bin_files`/`install_bin_files`
/// (which also call this) can never disagree with where the remote
/// fetch itself writes.
pub(super) fn mcp_binary_source_path(repo_root: &Path, binary_name: &str) -> std::path::PathBuf {
    repo_root
        .join("mcp")
        .join("target")
        .join("release")
        .join(binary_name)
}

/// Plans copying `MCP_SERVER_BINARY_NAMES` into `<target_dir>/.konductor/bin/`.
/// A binary not yet built contributes nothing -- never an error, unlike
/// agents/skills/context.
pub(super) fn plan_bin_files(
    repo_root: &Path,
    target_dir: &Path,
    prior_manifest: Option<&StrategyManifest>,
) -> Result<Vec<PlannedFile>, String> {
    let destination_dir = target_dir
        .join(KONDUCTOR_DESTINATION_ROOT)
        .join(BIN_CONTENT_TYPE_DIR);
    let mut plan = Vec::new();
    for binary_name in MCP_SERVER_BINARY_NAMES {
        let source = mcp_binary_source_path(repo_root, binary_name);
        if !source.is_file() {
            continue;
        }
        let manifest_path = content_manifest_path(
            KONDUCTOR_DESTINATION_ROOT,
            BIN_CONTENT_TYPE_DIR,
            binary_name,
        );
        let provenance = classify_provenance(
            &destination_dir.join(binary_name),
            &manifest_path,
            prior_manifest,
        );
        plan.push(PlannedFile {
            manifest_path,
            provenance,
        });
    }
    Ok(plan)
}

/// Copies every present `MCP_SERVER_BINARY_NAMES` entry, preserving the
/// executable bit. Returns manifest entries with a placeholder
/// `Provenance::Created`, overwritten by `attach_provenance` against
/// the write-ahead plan. Empty `Vec` (not an error) when nothing is
/// present at its source path.
pub(super) fn install_bin_files(
    repo_root: &Path,
    target_dir: &Path,
) -> Result<Vec<ManifestFile>, String> {
    let mut files = Vec::new();
    for binary_name in MCP_SERVER_BINARY_NAMES {
        let source = mcp_binary_source_path(repo_root, binary_name);
        if !source.is_file() {
            continue;
        }
        reject_unsafe_file_name(binary_name)?;

        let destination_dir = target_dir
            .join(KONDUCTOR_DESTINATION_ROOT)
            .join(BIN_CONTENT_TYPE_DIR);
        std::fs::create_dir_all(&destination_dir)
            .map_err(|e| format!("failed to create {}: {e}", destination_dir.display()))?;
        let destination = destination_dir.join(binary_name);

        let bytes = std::fs::read(&source)
            .map_err(|e| format!("failed to read {}: {e}", source.display()))?;
        crate::cli::atomic_write::write_atomic(&destination, &bytes)
            .map_err(|e| format!("failed to write {}: {e}", destination.display()))?;
        // Must be executable regardless of the source build's bit --
        // unlike a skill's auxiliary file, a non-executable binary
        // would be silently unlaunchable.
        set_executable(&destination, true).map_err(|e| {
            format!(
                "failed to set permissions on {}: {e}",
                destination.display()
            )
        })?;

        files.push(ManifestFile {
            path: content_manifest_path(
                KONDUCTOR_DESTINATION_ROOT,
                BIN_CONTENT_TYPE_DIR,
                binary_name,
            ),
            sha256: Some(sha256_hex(&bytes)),
            provenance: Provenance::Created,
        });
    }
    Ok(files)
}
