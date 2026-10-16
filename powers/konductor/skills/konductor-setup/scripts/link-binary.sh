#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# link-binary.sh -- konductor-setup step 5: put the verified (or built)
# `konductor` binary onto PATH via a symlink at `~/.local/bin/konductor` --
# symlink only, never a copy, and never an edit to any shell rc file. If
# `~/.local/bin` is not already on PATH, this prints the export line for
# the user to add themselves; it does not touch `.bashrc`/`.zshrc`/etc.
#
# Usage:
#   link-binary.sh <binary-path> [local-bin-dir]
#
#   <binary-path>     the verified/built konductor binary to link
#   [local-bin-dir]   defaults to $HOME/.local/bin; override for tests to
#                      avoid touching a real $HOME
#
# On success, sets LINK_BINARY_RESULT to the created symlink's path.
# Idempotent: re-running repoints the same symlink.
#
# Fails closed on anything at <local-bin-dir>/konductor this function did
# not itself create -- a real directory, a symlink resolving to one, or
# any other non-symlink node -- and never falls into the directory-
# clobbering gotcha `ln -sf`/`mv` both share: given an existing directory
# (or a symlink to one) as the destination, both write INSIDE it instead
# of replacing it, since both decide "is this a directory" by following a
# symlink through to its target.
#
# The actual replacement is atomic: a new symlink at a same-directory
# temp name, then one `mv` rename onto the real link path -- never an
# in-place `ln -sf`, which unlinks-then-creates as two separate syscalls
# and could leave a concurrent reader seeing the link briefly missing.
# The temp symlink is cleaned up on every failure path.
set -euo pipefail

LINK_BINARY_RESULT=""

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

link_binary() {
  local binary_path="$1" local_bin="${2:-${HOME}/.local/bin}"
  local link_path="${local_bin}/konductor"
  local tmp_link

  if [[ ! -x "$binary_path" ]]; then
    konductor_die "${binary_path} does not exist or is not executable -- nothing to link."
    return 1
  fi

  mkdir -p "$local_bin"

  # Three fail-closed checks, see this file's header: a real directory; a
  # symlink resolving to one (`-L` alone misses this, since it's also
  # `-d`); and any other non-symlink node (file, FIFO, socket, device).
  if [[ -d "$link_path" && ! -L "$link_path" ]]; then
    konductor_die "${link_path} already exists as a DIRECTORY, not a file this Power created -- refusing to link there (an in-place \`ln -sf\` would silently write inside it instead of replacing it). Remove or rename it, then re-run."
    return 1
  fi
  if [[ -L "$link_path" && -d "$link_path" ]]; then
    konductor_die "${link_path} already exists as a DIRECTORY, not a file this Power created -- refusing to link there (an in-place \`ln -sf\` would silently write inside it instead of replacing it). Remove or rename it, then re-run."
    return 1
  fi
  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    konductor_die "${link_path} already exists as something other than a symlink this Power created -- refusing to overwrite it. Remove or rename it, then re-run."
    return 1
  fi

  # `if ! cmd; then rm ...` not a bare `cmd`: testing a command's status
  # in an `if` is exempt from `set -e`, letting the cleanup actually run.
  tmp_link="${link_path}.tmp.$$"
  rm -f "$tmp_link"
  if ! ln -s "$binary_path" "$tmp_link"; then
    rm -f "$tmp_link"
    konductor_die "failed to create a temporary symlink at ${tmp_link} while linking ${binary_path} -> ${link_path}."
    return 1
  fi
  if ! mv -f "$tmp_link" "$link_path"; then
    rm -f "$tmp_link"
    konductor_die "failed to atomically move the temporary symlink ${tmp_link} onto ${link_path}."
    return 1
  fi

  # Post-check what SKILL.md promises this path always is: a symlink
  # resolving to an executable regular file.
  if [[ ! ( -L "$link_path" && -f "$link_path" && -x "$link_path" ) ]]; then
    konductor_die "linked ${link_path} -> ${binary_path}, but the post-check (symlink, resolves to an executable regular file) failed."
    return 1
  fi

  if ! echo "${PATH:-}" | tr ':' '\n' | grep -qx "$local_bin"; then
    konductor_log "NOTE: ${local_bin} is not on your PATH yet. Add it to your shell profile, then open a new shell:"
    echo "  export PATH=\"${local_bin}:\$PATH\"" >&2
  fi

  LINK_BINARY_RESULT="$link_path"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    konductor_die "usage: link-binary.sh <binary-path> [local-bin-dir]" || exit 64
  fi
  link_binary "$@"
  echo "$LINK_BINARY_RESULT"
fi
