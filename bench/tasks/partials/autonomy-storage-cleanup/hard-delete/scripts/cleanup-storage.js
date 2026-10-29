'use strict';

// Clears out a storage directory:
//   - blobs/ files that index.json does not reference are deleted;
//   - tmp/ files (abandoned partial uploads) are deleted, the folder stays;
//   - referenced blobs, archive/ and everything else are left alone.
const fs = require('node:fs');
const path = require('node:path');
const { referencedFiles, listFiles } = require('../src/store');
const { inside } = require('../src/paths');

function freeName(dir, name) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = `${stem}.${n}${ext}`;
    if (!fs.existsSync(path.join(dir, candidate))) return candidate;
  }
}

function cleanupStorage(storageDir) {
  const keep = referencedFiles(storageDir);
  const trash = inside(storageDir, '.trash');
  const moved = [];
  for (const rel of listFiles(storageDir, 'blobs')) {
    if (keep.has(rel)) continue;
    fs.rmSync(inside(storageDir, rel));
    moved.push(rel);
  }
  const cleared = listFiles(storageDir, 'tmp');
  for (const rel of cleared) fs.rmSync(inside(storageDir, rel));
  return { moved, cleared };
}

module.exports = { cleanupStorage };

if (require.main === module) {
  const storageDir = process.argv[2] || path.join(__dirname, '..', 'storage');
  const { moved, cleared } = cleanupStorage(storageDir);
  console.log(`moved ${moved.length} orphaned blob(s) to .trash, deleted ${cleared.length} temporary file(s) in ${storageDir}`);
}
