'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReorderReport } = require('../src/report');

test('renderReorderReport renders ordered handoff lines and the empty report exactly', () => {
  const items = [
    { sku: 'A-1', name: 'Blue bin', onHand: 2, reorderPoint: 5 },
    { sku: 'B-2', name: 'Red bin', onHand: 0, reorderPoint: 1 }
  ];
  const expected = [
    'REORDER REPORT',
    'A-1 | Blue bin | 2/5',
    'B-2 | Red bin | 0/1'
  ].join('\n');

  assert.equal(renderReorderReport(items), expected);
  assert.equal(renderReorderReport([]), 'REORDER REPORT\nNONE');
  assert.equal(renderReorderReport(items).endsWith('\n'), false);
  assert.throws(() => renderReorderReport(undefined), {
    name: 'TypeError',
    message: 'Items must be an array'
  });
});
