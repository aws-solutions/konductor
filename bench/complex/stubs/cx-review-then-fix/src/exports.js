'use strict';

const fs = require('node:fs');
const path = require('node:path');

function createExports({ dir }) {
  function readStatement(name) {
    const file = path.resolve(dir, name);
    return fs.promises.readFile(file, 'utf8');
  }

  async function listStatements() {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith('.csv')).map((e) => e.name).sort();
  }

  return { readStatement, listStatements };
}

module.exports = { createExports };
