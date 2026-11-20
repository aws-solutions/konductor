'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('./util');

class FileStore {
  constructor() {
    // Bind promisified methods
    this._ensureDirAsync = this._ensureDirAsync.bind(this);
    this._readTextAsync = this._readTextAsync.bind(this);
    this._writeJsonAsync = this._writeJsonAsync.bind(this);
  }

  async _ensureDirAsync(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  async _readTextAsync(file) {
    return fs.promises.readFile(file, 'utf8');
  }

  async _writeJsonAsync(file, value) {
    await this._ensureDirAsync(path.dirname(file));
    await fs.promises.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
  }

  ensureDir(dir, callback) {
    const promise = this._ensureDirAsync(dir);
    if (typeof callback === 'function') {
      promise.then(() => callback(null), err => callback(err));
    }
    return promise;
  }

  readText(file, callback) {
    const promise = this._readTextAsync(file);
    if (typeof callback === 'function') {
      promise.then(data => callback(null, data), err => callback(err));
    }
    return promise;
  }

  writeJson(file, value, callback) {
    const promise = this._writeJsonAsync(file, value);
    if (typeof callback === 'function') {
      promise.then(() => callback(null), err => callback(err));
    }
    return promise;
  }
}

module.exports = { FileStore };
