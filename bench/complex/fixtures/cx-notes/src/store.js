'use strict';

const fs = require('node:fs');

const VERSION = 1;

function createStore(file) {
  function load() {
    if (!fs.existsSync(file)) return { version: VERSION, nextId: 1, notes: [] };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== VERSION) throw new Error(`unsupported store version: ${data.version}`);
    return data;
  }

  function save(data) {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ ...data, version: VERSION }, null, 2)}\n`);
    fs.renameSync(tmp, file);
  }

  return { load, save };
}

module.exports = { createStore, VERSION };
