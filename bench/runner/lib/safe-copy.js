// SPDX-License-Identifier: Apache-2.0
'use strict';

// Host steps after a run copy files out of the scratch HOME, which the agent could write. These helpers never
// follow a link: every path component under `root` must be a plain directory and the file itself a regular file.

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 64 * 1024 * 1024;
const CHUNK = 1024 * 1024;

// Throws unless each component of `rel` below `root`, except the last when `last` is false, is a real directory.
function assertPlainPath(root, rel, { last = 'file' } = {}) {
  const parts = rel.split(path.sep).filter(Boolean);
  let cur = root;
  parts.forEach((part, i) => {
    cur = path.join(cur, part);
    const st = fs.lstatSync(cur);
    const final = i === parts.length - 1;
    const ok = final && last === 'file' ? st.isFile() : st.isDirectory();
    if (!ok) throw new Error(`${cur} is ${st.isSymbolicLink() ? 'a symlink' : 'not a plain ' + (final && last === 'file' ? 'file' : 'directory')}`);
  });
}

/**
 * Copies `root/rel` to `dest` as a new file (mode 0600). Returns false when the source does not exist, the
 * number of bytes copied otherwise. Throws for a symlink anywhere on the path, a non-regular file, or more
 * than `maxBytes`.
 */
function copyPlainFile(root, rel, dest, { maxBytes = MAX_BYTES } = {}) {
  try {
    assertPlainPath(root, rel);
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
  const from = fs.openSync(path.join(root, rel), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const st = fs.fstatSync(from);
    if (!st.isFile()) throw new Error(`${rel} is not a regular file`);
    if (st.size > maxBytes) throw new Error(`${rel} would exceed ${maxBytes} bytes`);
    const to = fs.openSync(dest, 'w', 0o600);
    try {
      const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, st.size)));
      let total = 0;
      for (;;) {
        const n = fs.readSync(from, buf, 0, buf.length, null);
        if (n === 0) break;
        total += n;
        if (total > maxBytes) throw new Error(`${rel} would exceed ${maxBytes} bytes`);
        fs.writeSync(to, buf, 0, n);
      }
      return total;
    } finally {
      fs.closeSync(to);
    }
  } finally {
    fs.closeSync(from);
  }
}

module.exports = { copyPlainFile, assertPlainPath, MAX_BYTES };
