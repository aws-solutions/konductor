// SPDX-License-Identifier: Apache-2.0
'use strict';

// The two places where the cx-carddemo-port hidden tests accept either behaviour, because the signed rules are
// silent: an interest row of +0.00 (I3 to I5) and CRLF line ends in output files. Each case also checks that a
// wrong row is still caught. Only the hidden test helpers run here; no port, no model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkScratch } = require('./scratch.js');
const path = require('node:path');
const cd = require('../../scenarios/lib/hidden/carddemo-cd.js');

const DATE = '2026-11-25';
const A1 = '00000000001';
const A2 = '00000000002';
const CARD1 = '4000000000000001';
const CARD2 = '4000000000000002';
const cards = { [A1]: CARD1, [A2]: CARD2 };

/** One masked interest row, as I5 writes it, with overrides of any transaction field. */
const row = (n, amount, o = {}) => cd.tran({
  id: `${DATE}${String(n).padStart(6, '0')}`, type: '01', cat: '0005', source: 'System', desc: `Int. for a/c ${o.account || A1}`, amount, merchantId: '000000000',
  merchant: '', city: '', zip: '', card: CARD1, orig: cd.MASKED_STAMP, proc: cd.MASKED_STAMP, ...o,
});

test('a correct +0.00 interest row is dropped and the counter renumbered, so both behaviours compare equal', () => {
  const skipped = cd.lines([row(1, '18.51'), row(2, '0.08'), row(3, '2082.49', { account: A2, card: CARD2 })]);
  const written = cd.lines([row(1, '18.51'), row(2, '0.00'), row(3, '0.08'), row(4, '2082.49', { account: A2, card: CARD2 })]);
  assert.deepEqual(cd.dropZeroInterest(written, { cards, date: DATE }), { text: skipped, dropped: 1 });
  assert.deepEqual(cd.dropZeroInterest(skipped, { cards, date: DATE }), { text: skipped, dropped: 0 });
  assert.deepEqual(cd.dropZeroInterest('', { cards, date: DATE }), { text: '', dropped: 0 });
});

test('a wrong non-zero row and a +0.00 row that is wrong in any other field are kept, so the comparison fails', () => {
  const expected = cd.lines([row(1, '18.51'), row(2, '0.08')]);
  const wrongAmount = cd.lines([row(1, '18.52'), row(2, '0.00'), row(3, '0.08')]);
  assert.notEqual(cd.dropZeroInterest(wrongAmount, { cards, date: DATE }).text, expected);
  for (const bad of [{ type: '02' }, { cat: '0001' }, { source: 'POS TERM' }, { desc: 'interest' }, { card: CARD2 }, { merchantId: '000000001' }, { account: A2 }]) {
    const text = cd.lines([row(1, '18.51'), row(2, '0.00', bad), row(3, '0.08')]);
    const out = cd.dropZeroInterest(text, { cards, date: DATE });
    assert.equal(out.dropped, 0, JSON.stringify(bad));
    assert.notEqual(out.text, expected, JSON.stringify(bad));
  }
  const minusZero = cd.lines([row(1, '18.51'), row(2, '-0.00'), row(3, '0.08')]);
  assert.equal(cd.dropZeroInterest(minusZero, { cards, date: DATE }).dropped, 0);
});

test('rows with a broken counter are left as they are', () => {
  const text = cd.lines([row(1, '18.51'), row(3, '0.00'), row(4, '0.08')]);
  assert.deepEqual(cd.dropZeroInterest(text, { cards, date: DATE }), { text, dropped: 0 });
});

test('the lowest card of each account comes from the cross reference, CRLF or LF', () => {
  const text = `${cd.xref({ card: '4000000000000009' })}\r\n${cd.xref({ card: '4000000000000003' })}\n${cd.xref({ card: CARD2, account: A2 })}\n`;
  assert.deepEqual(cd.lowestCards(text), { [A1]: '4000000000000003', [A2]: CARD2 });
});

test('output files are read with CRLF as LF, and every other byte still counts', () => {
  const dir = mkScratch('cdrelax-');
  try {
    const script = path.join(dir, 'w.js');
    fs.writeFileSync(script, "require('fs').writeFileSync(process.argv[2], 'a\\r\\nb\\n c\\r\\n');\n");
    // Stand in for the port: a "python3" on PATH that writes one file into --out.
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'python3'), `#!/bin/sh\nmkdir -p "$7" && exec "${process.execPath}" "${script}" "$7/x.txt"\n`, { mode: 0o755 });
    const saved = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${saved}`;
    try {
      cd.run('post', {}, (r) => assert.equal(r.read('x.txt'), 'a\nb\n c\n'));
    } finally { process.env.PATH = saved; }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
