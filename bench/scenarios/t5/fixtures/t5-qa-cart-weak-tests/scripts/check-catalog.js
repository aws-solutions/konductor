'use strict';

const fs = require('node:fs');
const catalog = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
const seen = new Set();
for (const item of catalog) {
  if (seen.has(item.sku) || !Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) process.exitCode = 1;
  seen.add(item.sku);
}
if (process.exitCode) console.error('catalog validation failed');
else console.log(`checked ${catalog.length} catalog entries`);
