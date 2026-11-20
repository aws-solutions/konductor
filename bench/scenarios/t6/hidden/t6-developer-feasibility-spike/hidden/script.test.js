'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT } = require('./doc-key.js');
const { SAMPLES, makeX, makeY, withTempFile, runMeasure } = require('./expected.js');

function checkRun(file, rows, drift) {
  const r = runMeasure(file);
  assert.equal(r.status, 0, `exit ${r.status}: ${String(r.stderr).slice(0, 300)}`);
  assert.ok(r.out && typeof r.out === 'object' && !Array.isArray(r.out), `stdout is not one JSON object: ${String(r.stdout).slice(0, 200)}`);
  assert.equal(r.out.rows, rows, 'rows');
  assert.ok(r.out.first_drift_rows && typeof r.out.first_drift_rows === 'object', 'first_drift_rows missing');
  assert.deepEqual(r.out.first_drift_rows, drift);
}

for (const [name, s] of Object.entries(SAMPLES)) {
  test(`measure.js on ${name}: rows and drift rows match`, () => {
    checkRun(path.join(ROOT, 'data', `${name}.csv`), s.rows, s.drift);
  });
}

test('measure.js on a generated file with quoted line breaks, a leading-zero value, a blank cell and an invalid date', () => {
  const x = makeX();
  withTempFile(x.text, (f) => checkRun(f, x.rows, x.drift));
});

test('measure.js on a generated CRLF file with a BOM, empty runs and edges at rows 500 and 501', () => {
  const y = makeY();
  withTempFile(y.text, (f) => checkRun(f, y.rows, y.drift));
});
