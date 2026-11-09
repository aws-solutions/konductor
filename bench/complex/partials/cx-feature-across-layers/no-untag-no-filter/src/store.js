'use strict';

const fs = require('node:fs');

const VERSION = 2;

function migrate(data) {
  if (data.version === 1) return { ...data, version: VERSION, notes: data.notes.map((n) => ({ ...n, tags: [] })) };
  if (data.version === VERSION) return data;
  throw new Error(`unsupported store version: ${data.version}`);
}

function createStore(file) {
  function load() {
    if (!fs.existsSync(file)) return { version: VERSION, nextId: 1, notes: [] };
    return migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
  }

  function save(data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ ...data, version: VERSION }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  return { load, save };
}

module.exports = { createStore, VERSION };
