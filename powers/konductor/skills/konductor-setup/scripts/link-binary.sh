#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# link-binary.sh -- konductor-setup step 5: put the verified (or built)
# `konductor` binary onto PATH via a symlink at `~/.local/bin/konductor` --
# symlink only, never a copy, and never an edit to any shell rc file
# (design §5.3 step 5). If `~/.local/bin` is not already on PATH, this
# prints the export line for the user to add themselves; it does not touch
# `.bashrc`/`.zshrc`/etc.
#
# Usage:
#   link-binary.sh <binary-path> [local-bin-dir]
#
#   <binary-path>     the verified/built konductor binary to link
#   [local-bin-dir]   defaults to $HOME/.local/bin; override for tests to
#                      avoid touching a real $HOME
#
# On success, sets LINK_BINARY_RESULT to the path of the created symlink
# and returns 0 -- same rationale as fetch-verify-binary.sh's
# FETCH_VERIFY_BINARY_RESULT (this function's own PATH note, printed via
# konductor_log, must stay visible rather than be captured away by a
# caller retrieving the result). Idempotent: re-running with the same
# binary re-creates the same symlink; re-running after a rebuild repoints
# it.
#
# Fails closed rather than writing anywhere unexpected (adversarial-review
# finding I1): if <local-bin-dir>/konductor already exists as a directory
# -- a REAL one, OR a symlink that itself RESOLVES to one -- or as a
# regular file that is not a symlink this Power itself created, this
# function refuses and returns non-zero -- it never overwrites a foreign
# file, and it never falls into the directory-clobbering gotcha both
# `ln -sf` AND plain `mv` share: `ln -sf target existing-dir` silently
# creates `existing-dir/<basename of target>` INSTEAD of replacing
# `existing-dir` (reproduced directly against this host's own `ln`), and
# `mv src existing-dir` does the exact same "move src INSIDE me" thing
# for ANY existing-dir, symlink or not, since `mv` decides "is the
# destination a directory" the same way `-d` does: by following a
# symlink straight through to what it resolves to. The `mv -f "$tmp_link"
# "$link_path"` step below would otherwise hit this identical footgun
# whenever $link_path was a symlink pointing AT a directory (a case the
# original I1 fix's directory check missed, since that check required
# `! -L` and a symlink IS `-L` -- residual gap, closed by the explicit
# `-L && -d` check below) -- which is exactly a "writes somewhere else"
# bug this file's own header claims cannot happen, regardless of which of
# `ln -sf`'s or `mv`'s two independent codepaths would have caused it.
#
# The actual replacement is atomic: a new symlink is created at a
# same-directory temp name, then `mv`d onto the real link path in one
# rename -- never an in-place `ln -sf`, which first unlinks the old target
# and then creates the new one as two separate syscalls, leaving a window
# where a concurrent reader (a second onboarding run in a different
# project, invoked at the same moment) could observe the link briefly
# missing entirely (design review finding C2's "concurrent-onboarding
# race"). A rename onto an existing filename is atomic on every POSIX
# filesystem this Power supports, on both Linux and macOS -- no GNU-only
# `mv -T` needed, since every directory-shaped case above (real directory
# or symlink-to-directory) is already refused before this point is ever
# reached. The temp symlink itself is cleaned up on every failure path
# after it is created -- a failed `ln`/`mv` never leaves a stray
# `konductor.tmp.<pid>` file behind at $local_bin.
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

  # Fail closed on anything at $link_path this function did not itself
  # create -- see this file's header for exactly why (I1: never fall into
  # the directory gotcha `ln -sf` and `mv` both share, never clobber a
  # foreign file).
  if [[ -d "$link_path" && ! -L "$link_path" ]]; then
    konductor_die "${link_path} already exists as a DIRECTORY, not a file this Power created -- refusing to link there (an in-place \`ln -sf\` would silently write inside it instead of replacing it). Remove or rename it, then re-run."
    return 1
  fi
  # A symlink pointing AT a directory has `-L` true (it IS a symlink) but
  # ALSO `-d` true (it RESOLVES to a directory) -- the check above
  # requires `! -L` and so never catches this case, and neither does the
  # foreign-regular-file check below (same `! -L` requirement). Left
  # unguarded, the `mv -f "$tmp_link" "$link_path"` step further down
  # would hit the identical "moves INSIDE the directory instead of
  # replacing it" footgun the directory check above exists to prevent --
  # see this file's own header for why `mv` shares that behavior with
  # `ln -sf`. Same refusal message as the real-directory case: from a
  # caller's perspective a symlink-to-a-directory and a real directory at
  # $link_path are the identical hazard.
  if [[ -L "$link_path" && -d "$link_path" ]]; then
    konductor_die "${link_path} already exists as a DIRECTORY, not a file this Power created -- refusing to link there (an in-place \`ln -sf\` would silently write inside it instead of replacing it). Remove or rename it, then re-run."
    return 1
  fi
  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    konductor_die "${link_path} already exists as a regular file that is not a symlink this Power created -- refusing to overwrite it. Remove or rename it, then re-run."
    return 1
  fi

  # Atomic replace: symlink at a same-directory temp name, then one
  # rename onto the real path -- see this file's header for why this is
  # never a two-step in-place `ln -sf`. Every failure path below cleans up
  # $tmp_link explicitly -- `if ! cmd; then ...` (not a bare `cmd`) is
  # deliberate: under this file's own `set -e`, testing a command's exit
  # status in an `if` is exempt from triggering `-e` directly, which is
  # what lets the matching `rm -f "$tmp_link"` actually run on failure
  # instead of the whole function exiting out from under it first.
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

  # Post-check exactly what design/SKILL.md promise this path always is:
  # a symlink (-L), resolving to a regular file (-f, follows the link),
  # that is executable (-x, follows the link). $tmp_link no longer exists
  # by this point (already renamed onto $link_path above), so there is
  # nothing left to clean up on this remaining failure path either.
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
