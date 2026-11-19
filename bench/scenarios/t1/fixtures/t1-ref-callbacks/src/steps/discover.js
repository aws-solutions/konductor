'use strict';

const fs = require('node:fs');
const path = require('node:path');

function discoverFiles(inputDir, callback) {
  fs.readdir(inputDir, { withFileTypes: true }, (err, entries) => {
    if (err) return callback(err);
    const names = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.txt')).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
    callback(null, names.map((name) => path.join(inputDir, name)));
  });
}

module.exports = { discoverFiles };
