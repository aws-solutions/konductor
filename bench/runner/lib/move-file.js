// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runner moves the live stdout and stderr files out of the scratch root, which the agent can write,
// once the agent has exited. The agent may have swapped one for a symlink, a hardlink, a FIFO or a file of
// another owner, so a move refuses anything but a regular file the runner owns and never follows a link.

const nodeFs = require('node:fs');

class UntrustedFileError extends Error {
  constructor(file, reason) {
    super(`refusing to move ${file}: ${reason}`);
    this.name = 'UntrustedFileError';
    this.code = 'EUNTRUSTED';
    this.file = file;
    this.reason = reason;
  }
}

const CHUNK = 1024 * 1024;

function problemWith(st, uid) {
  if (!st.isFile()) return 'not a regular file';
  if (st.nlink > 1) return 'more than one hard link';
  if (uid !== null && st.uid !== uid) return 'owned by another user';
  return null;
}

/**
 * Moves `src` to `dest`. Throws UntrustedFileError for a source that is not a regular file with one link
 * owned by the current user, before it is renamed, opened or read. Across filesystems (EXDEV) the content is
 * copied from a descriptor opened with O_NOFOLLOW into a new file (mode 0600, then the source's permission
 * bits), and the source is removed. `fsImpl` replaces node:fs in tests.
 */
function moveFile(src, dest, fsImpl = nodeFs) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const bad = problemWith(fsImpl.lstatSync(src), uid);
  if (bad) throw new UntrustedFileError(src, bad);
  try {
    fsImpl.renameSync(src, dest);
    return;
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
  }
  const c = fsImpl.constants;
  let from;
  try {
    from = fsImpl.openSync(src, c.O_RDONLY | (c.O_NOFOLLOW || 0));
  } catch (e) {
    if (e.code === 'ELOOP' || e.code === 'EACCES') throw new UntrustedFileError(src, e.code === 'ELOOP' ? 'replaced by a symlink' : 'not readable by its owner');
    throw e;
  }
  try {
    const st = fsImpl.fstatSync(from);
    const late = problemWith(st, uid);
    if (late) throw new UntrustedFileError(src, late);
    try { fsImpl.unlinkSync(dest); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const to = fsImpl.openSync(dest, c.O_EXCL | c.O_WRONLY | c.O_CREAT, 0o600);
    try {
      const buf = Buffer.allocUnsafe(CHUNK);
      for (;;) {
        const n = fsImpl.readSync(from, buf, 0, buf.length, null);
        if (n === 0) break;
        let off = 0;
        while (off < n) off += fsImpl.writeSync(to, buf, off, n - off);
      }
      fsImpl.fchmodSync(to, st.mode & 0o777);
    } finally {
      fsImpl.closeSync(to);
    }
  } finally {
    fsImpl.closeSync(from);
  }
  fsImpl.unlinkSync(src);
}

module.exports = { moveFile, UntrustedFileError };
