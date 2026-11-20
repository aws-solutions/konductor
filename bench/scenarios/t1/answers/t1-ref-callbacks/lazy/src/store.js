'use strict';

const fs = require('node:fs');
const path = require('node:path');

class FileStore {
  ensureDir(dir, callback) {
    const promise = fs.promises.mkdir(dir, { recursive: true });
    if (callback) {
      promise.then(() => callback(null), err => callback(err));
    }
    return promise;
  }

  readText(file, callback) {
    const promise = fs.promises.readFile(file, 'utf8');
    if (callback) {
      promise.then(data => callback(null, data), err => callback(err));
    }
    return promise;
  }

  writeJson(file, value, callback) {
    const promise = this.ensureDir(path.dirname(file)).then(() =>
      fs.promises.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
    );
    if (callback) {
      promise.then(() => callback(null), err => callback(err));
    }
    return promise;
  }
}

module.exports = { FileStore };
