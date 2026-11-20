#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { parseCatalog } = require('./catalog');
const { applyMovements } = require('./inventory');
const { renderInventoryTable } = require('./report');

function run(input) {
  const data = JSON.parse(input);
  const catalog = parseCatalog(data.catalog);
  const items = applyMovements(catalog, data.movements || []);
  return renderInventoryTable(items);
}

if (require.main === module) {
  try {
    const input = fs.readFileSync(0, 'utf8');
    process.stdout.write(`${run(input)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { run };
