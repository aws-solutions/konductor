'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Rows of data/ledger.csv as { id, postedAt, orderId, type, amountCents, status }.
function loadLedger(dataDir) {
  const file = path.join(dataDir, 'ledger.csv');
  if (!fs.existsSync(file)) return [];
  const [header, ...lines] = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  if (!header) return [];
  const names = header.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const row = Object.fromEntries(names.map((n, i) => [n, cells[i]]));
    return { ...row, amountCents: Number(row.amountCents) };
  });
}

module.exports = { loadLedger };
