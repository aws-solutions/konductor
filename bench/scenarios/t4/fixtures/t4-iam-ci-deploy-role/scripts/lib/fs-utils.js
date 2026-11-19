'use strict';

const fs = require('node:fs');

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function fileSize(file) {
  return fs.statSync(file).size;
}

module.exports = { readText, fileSize };
