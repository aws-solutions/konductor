#!/usr/bin/env node
const fs = require('node:fs');
const input = process.argv[2] || 'fixtures/customers.json';
const output = process.argv[3] || '.runtime/legacy-export.csv';
const rows = JSON.parse(fs.readFileSync(input, 'utf8'));
let text = 'id,email,full_name\n';
for (const row of rows) {
  const name = String(row.full_name || '').replaceAll(',', ' ');
  text += `${row.id},${row.email},${name}\n`;
}
fs.mkdirSync(require('node:path').dirname(output), { recursive: true });
fs.writeFileSync(output, text);
console.log(`wrote ${rows.length} rows`);
