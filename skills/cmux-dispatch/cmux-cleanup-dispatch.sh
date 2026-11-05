#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# cmux-cleanup-dispatch.sh — Remove one dispatch's directory from the cmux registry.
# Usage: bash cmux-cleanup-dispatch.sh --id <done-key>
#
# The orchestrator's only way to remove a dispatch directory. It takes the
# dispatch id, never a path: the id must match the format the dispatch script
# generates, the registry must pass the same ownership checks the dispatch
# script applies, and the target must be a real directory, not a symlink.
# Nothing outside <registry>/<id> is touched. Removing an id that is already
# gone is not an error.
set -euo pipefail

ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --id) ID="${2:-}"; shift 2 ;;
    *) echo "ERROR: Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ "$ID" =~ ^surface_[0-9]+-[0-9a-f]{8}$ ]] || { echo "ERROR: --id must be a done key like surface_3-0123abcd (got '$ID'); nothing removed" >&2; exit 1; }

# The same registry override the dispatch script reads.
REGISTRY_DIR="${KONDUCTOR_CMUX_REGISTRY_DIR:-/tmp/konductor-cmux}"

# The registry holds every dispatch's files, so it must be a real directory
# owned by this user that no one else can write to. Prints the problem and
# fails when it isn't. KONDUCTOR_REGISTRY_OWNER_UID names the owner to expect
# (default: this user); it cannot turn the check off.
registry_problem() {
  python3 - "$1" "${KONDUCTOR_REGISTRY_OWNER_UID:-$(id -u)}" <<'PY'
import os, stat, sys
path, uid = sys.argv[1], int(sys.argv[2])
try:
    st = os.lstat(path)
except OSError as e:
    sys.exit(f"cannot be read ({e.strerror})")
if stat.S_ISLNK(st.st_mode):
    sys.exit("is a symlink")
if not stat.S_ISDIR(st.st_mode):
    sys.exit("is not a directory")
if st.st_uid != uid:
    sys.exit(f"is owned by uid {st.st_uid}, not {uid}")
if st.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
    sys.exit("is group- or world-writable")
PY
}

if ! problem="$(registry_problem "$REGISTRY_DIR" 2>&1)"; then
  echo "ERROR: dispatch registry $REGISTRY_DIR $problem; nothing removed" >&2
  exit 1
fi

TARGET="$REGISTRY_DIR/$ID"
if [[ -L "$TARGET" ]]; then
  echo "ERROR: $TARGET is a symlink; nothing removed" >&2
  exit 1
fi
if [[ ! -e "$TARGET" ]]; then
  echo "NOTHING TO REMOVE $TARGET"
  exit 0
fi
[[ -d "$TARGET" ]] || { echo "ERROR: $TARGET is not a directory; nothing removed" >&2; exit 1; }
rm -rf -- "$TARGET"
echo "REMOVED $TARGET"
