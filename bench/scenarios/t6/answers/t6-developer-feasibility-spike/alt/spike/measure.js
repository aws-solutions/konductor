#!/usr/bin/env node
'use strict';

// Usage: node spike/measure.js <csv path>
// Prints { rows, first_drift_rows } as one JSON object.
// first_drift_rows maps each column name to the 1-based data row (header not counted) where
// the type inferred by lib/infer.js, from all rows read so far, first differs from the type it
// had after row 500. null when it never differs.

const path = require('node:path');
const { readRecords } = require(path.join(__dirname, '..', 'lib', 'csv.js'));
const { createInferrer } = require(path.join(__dirname, '..', 'lib', 'infer.js'));

const WINDOW = 500;

async function measure(file) {
  const inferrers = {};
  const baseline = {};
  const drift = {};
  let rows = 0;
  for await (const { row, cells } of readRecords(file)) {
    rows = row;
    for (const [name, value] of Object.entries(cells)) {
      if (!(name in inferrers)) { inferrers[name] = createInferrer(); drift[name] = null; }
      const inf = inferrers[name];
      inf.add(value);
      if (row === WINDOW) baseline[name] = inf.type();
      else if (row > WINDOW && drift[name] === null && inf.type() !== baseline[name]) drift[name] = row;
    }
  }
  return { rows, first_drift_rows: drift };
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node spike/measure.js <csv path>');
  process.exit(2);
}
measure(file).then(
  (result) => process.stdout.write(JSON.stringify(result) + '\n'),
  (err) => { console.error(err.message); process.exit(1); },
);
