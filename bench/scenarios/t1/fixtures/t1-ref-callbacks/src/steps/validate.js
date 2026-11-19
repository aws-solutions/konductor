'use strict';
const fs = require('node:fs');
function validateInput(inputDir, callback) {
  fs.stat(inputDir, (err, stat) => {
    if (err) return callback(err);
    if (!stat.isDirectory()) return callback(new Error(`input is not a directory: ${inputDir}`));
    callback(null);
  });
}
module.exports = { validateInput };
