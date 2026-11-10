const fs = require('node:fs');
const path = require('node:path');
const { UPLOAD_DIR, MAX_BYTES } = require('./config');

function saveUpload(filename, contents) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('filename required');
  }
  if (Buffer.byteLength(contents) > MAX_BYTES) {
    throw new Error('file too large');
  }
  const target = path.join(UPLOAD_DIR, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function readUpload(filename) {
  const target = path.join(UPLOAD_DIR, filename);
  return fs.readFileSync(target, 'utf8');
}

module.exports = { saveUpload, readUpload };
