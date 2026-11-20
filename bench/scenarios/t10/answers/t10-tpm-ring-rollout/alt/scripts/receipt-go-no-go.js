'use strict';

const fs = require('node:fs');
const { evaluate } = require('../src/go-no-go');

function argument(name, args) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

const args = process.argv.slice(2);
const ring = argument('--ring', args);
const snapshotPath = argument('--snapshot', args);
const now = argument('--now', args);
if (!ring || !snapshotPath) {
  console.error('usage: receipt-go-no-go.js --ring RING --snapshot FILE [--now ISO]');
  process.exitCode = 2;
} else {
  const result = evaluate({ ring, snapshot: fs.readFileSync(snapshotPath, 'utf8'), now });
  console.log(result.decision);
}
