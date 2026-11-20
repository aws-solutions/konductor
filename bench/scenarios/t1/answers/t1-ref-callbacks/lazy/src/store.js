'use strict';

const fs = require('node:fs');
const path = require('node:path');

class FileStore {
  ensureDir(dir, callback) {
    fs.mkdir(dir, { recursive: true }, callback);
  }

  readText(file, callback) {
    fs.readFile(file, 'utf8', callback);
  }

  writeJson(file, value, callback) {
    this.ensureDir(path.dirname(file), (mkdirError) => {
      if (mkdirError) return callback(mkdirError);
      fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8', callback);
    });
  }
}

module.exports = { FileStore };
