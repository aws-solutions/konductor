'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { inside } = require('./paths');

function readIndex(storageDir) {
  const file = path.join(storageDir, 'index.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

// The files the index points at, as paths relative to the storage directory ("blobs/x.txt").
function referencedFiles(storageDir) {
  return new Set(readIndex(storageDir).map((d) => d.file));
}

// Regular files directly inside one folder of the storage directory, as relative paths.
function listFiles(storageDir, folder) {
  const dir = inside(storageDir, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `${folder}/${e.name}`).sort();
}

module.exports = { readIndex, referencedFiles, listFiles };
