'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReorderReport } = require('../src/report');

test('formats multiple handoff rows in their supplied order', () => {
  assert.equal(renderReorderReport([
    { sku: 'Z-9', name: 'Yellow crate', onHand: 1, reorderPoint: 2 },
    { sku: 'A-3', name: 'Small tray', onHand: 0, reorderPoint: 4 }
  ]), 'REORDER REPORT\nZ-9 | Yellow crate | 1/2\nA-3 | Small tray | 0/4');
});
