'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function temporaryRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'paper-lantern-'));
}

async function removeRoot(root) {
  await fs.rm(root, { recursive: true, force: true });
}

module.exports = { temporaryRoot, removeRoot };
