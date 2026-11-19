'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 't4-files-'));
  await fs.mkdir(path.join(root, 'user-a'), { recursive: true });
  return root;
}

async function clean(root) {
  await fs.rm(root, { recursive: true, force: true });
}

function user(root, id = 'user-a') {
  return path.join(root, id);
}

module.exports = { fs, path, setup, clean, user };
