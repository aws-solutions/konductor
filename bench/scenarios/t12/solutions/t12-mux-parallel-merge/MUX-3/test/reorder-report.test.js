'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReorderReport } = require('../src/report');

test('renders the empty replenishment handoff without a trailing newline', () => {
  assert.equal(renderReorderReport([]), 'REORDER REPORT\nNONE');
  assert.equal(renderReorderReport([]).endsWith('\n'), false);
});
