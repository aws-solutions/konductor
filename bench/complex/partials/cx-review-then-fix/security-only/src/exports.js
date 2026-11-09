'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createExports({ dir }) {
  const root = path.resolve(dir);

  function readStatement(name) {
    const file = path.resolve(root, name);
    if (file !== root && !file.startsWith(root + path.sep)) {
      return Promise.reject(new Error(`statement is outside the export directory: ${name}`));
    }
    return fs.promises.readFile(file, 'utf8');
  }

  async function listStatements() {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.csv')).map((e) => e.name).sort();
  }

  return { readStatement, listStatements };
}

module.exports = { createExports };
