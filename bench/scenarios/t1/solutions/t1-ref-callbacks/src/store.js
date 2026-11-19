'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { withCallback } = require('./bridge');

class FileStore {
  ensureDir(dir, callback) {
    const promise = fs.mkdir(dir, { recursive: true });
    return withCallback(promise, callback);
  }

  readText(file, callback) {
    const promise = fs.readFile(file, 'utf8');
    return withCallback(promise, callback);
  }

  writeJson(file, value, callback) {
    const promise = this.ensureDir(path.dirname(file)).then(() => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8'));
    return withCallback(promise, callback);
  }
}

module.exports = { FileStore };
