'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MemoryStore } = require('./memory-store');

function loadJson(directory, name) {
  return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
}

function createFileStore(directory = path.join(__dirname, '..', 'data')) {
  return new MemoryStore({
    issues: loadJson(directory, 'issues.json'),
    comments: loadJson(directory, 'comments.json'),
    users: loadJson(directory, 'users.json'),
  });
}

module.exports = { createFileStore };
