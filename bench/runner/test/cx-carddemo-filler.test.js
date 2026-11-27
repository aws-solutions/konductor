// SPDX-License-Identifier: Apache-2.0
'use strict';

// The filler of a category balance row that came from the input is accepted either way in the cx-carddemo-port and
// cx-carddemo-batchday goldens: the signed rules do not say, the COBOL REWRITE keeps the bytes it read (the sample's
// filler is zeros), and the reference port writes blanks. Each case also checks that a wrong row is still caught.
// Only the hidden test helpers run here; no port, no model call.

const test = require('node:test');
const assert = require('node:assert/strict');

const TASKS = ['cx-carddemo-port', 'cx-carddemo-batchday'];
const ZEROS = '0'.repeat(22);
const BLANKS = ' '.repeat(22);
const KEPT = '000000000010100010000003873A';
const OTHER = '000000000020100010000005246B';

for (const task of TASKS) {
  const cd = require(`../../complex/hidden/${task}/hidden/lib/cd.js`);
  const input = `${KEPT}${ZEROS}\r\n${OTHER}`;

  test(`${task}: a kept input filler reads as blanks, so both behaviours compare equal`, () => {
    const golden = `${KEPT}${BLANKS}\n${OTHER}${BLANKS}\n`;
    assert.equal(cd.blankKeptFiller(`${KEPT}${ZEROS}\n${OTHER}${BLANKS}\n`, input), golden);
    assert.equal(cd.blankKeptFiller(golden, input), golden);
    assert.equal(cd.blankKeptFiller('', input), '');
  });

  test(`${task}: any other filler, balance or key still counts`, () => {
    const golden = `${KEPT}${BLANKS}\n`;
    for (const row of [`${KEPT}${'0'.repeat(21)}1`, `000000000010100010000003874A${ZEROS}`, `000000000030100010000003873A${ZEROS}`, `${OTHER}${ZEROS}`]) {
      assert.notEqual(cd.blankKeptFiller(`${row}\n`, input), golden, row);
    }
  });
}
