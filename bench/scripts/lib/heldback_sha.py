#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Prints the heldBackSha256 of a held-back folder: the SHA-256 of a deterministic tar of it (sorted names, zeroed
metadata). The same value the counted set's tools/make-fields.py records at freeze, so plant-wave.sh wave 4 can check
the folder it signs is the one the owner froze. Standard library only.

    python3 bench/scripts/lib/heldback_sha.py COUNTED_SET/held-back
"""
import hashlib
import io
import os
import sys
import tarfile


def held_back_sha256(folder):
    """SHA-256 of the tar of every file under `folder`, in sorted order, with mtime, owner and group zeroed."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for root, dirs, files in os.walk(folder):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(root, name)
                info = tarfile.TarInfo(os.path.relpath(full, folder))
                info.size = os.path.getsize(full)
                info.mtime = 0
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                with open(full, "rb") as f:
                    tar.addfile(info, f)
    return hashlib.sha256(buf.getvalue()).hexdigest()


if __name__ == "__main__":
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit("usage: heldback_sha.py HELD_BACK_DIR")
    print(held_back_sha256(sys.argv[1]))
