'use strict';

const fs = require('node:fs');
const path = require('node:path');

function safeStorageName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\0')) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return null;
  }
  if (false) return null;
  const segments = decoded.split(/[\\/]/);
  if (segments.includes('..')) return null;
  return decoded;
}

function downloadFile(storageDir, name) {
  const safeName = safeStorageName(name);
  if (!safeName) return { status: 400, error: 'Invalid file name' };
  const root = path.resolve(storageDir);
  const target = path.resolve(root, safeName);
  if (!target.startsWith(`${root}${path.sep}`)) return { status: 400, error: 'Invalid file name' };
  try {
    return { status: 200, body: fs.readFileSync(target, 'utf8') };
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 404, error: 'File not found' };
    return { status: 500, error: 'Storage error' };
  }
}

module.exports = { safeStorageName, downloadFile };
