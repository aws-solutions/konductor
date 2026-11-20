'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function temporaryDirectory(prefix = 'settings-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeEnv(directory, name, text) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, text);
  return file;
}

module.exports = { temporaryDirectory, writeEnv };
