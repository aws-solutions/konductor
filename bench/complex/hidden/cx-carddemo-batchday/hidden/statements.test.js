// SPDX-License-Identifier: Apache-2.0
'use strict';

// Job 4, customer statements (CBSTM03A and CBSTM03B): rules R5 to R8 and what the COBOL does where they are silent.
// Expected statements are written from the COBOL line pictures (lib/day.js `statement`), then compared byte for byte.

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const cd = require('./lib/cd.js');
const d = require('./lib/day.js');

const { xref, account, run, assertRefused, pad } = cd;

const statements = (inputs, check, options) => run('statements', inputs, check, options);
const C = { first: 'John', middle: 'Q', last: 'Public', addr1: '1 Main Street', addr2: 'Apt 2', addr3: 'Springfield', state: 'IL', country: 'USA', zip: '62701', fico: '700' };
const A = { id: '00000000001', balance: '100.00' };

/** A posted transaction on the default card. */
const t = (n, amount = '1.00', o = {}) => d.posted({ id: d.tid(n), amount, desc: `item ${n}`, ...o });
const row = (n, amount = '1.00', desc = `item ${n}`) => ({ id: d.tid(n), desc, amount });

/** Run and return { text, html, summary } with the files split into lines (each line must end with a newline). */
function go(inputs, options) {
  let out;
  statements(inputs, (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.files, ['statement.html', 'statement.txt', 'summary.json']);
    const split = (name) => { const parts = r.read(name).split('\n'); assert.equal(parts.pop(), ''); return parts; };
    out = { text: split('statement.txt'), html: split('statement.html'), summary: JSON.parse(r.read('summary.json')), stdout: r.stdout };
  }, options);
  return out;
}

/** Inputs for `n` cards 4000000000000001.. on accounts 1.., each with its own customer. */
function many(n, trans = []) {
  const id = (i) => String(i).padStart(11, '0');
  return d.statementInputs({
    trans,
    xrefs: Array.from({ length: n }, (_, i) => xref({ card: `40000000000${String(i + 1).padStart(5, '0')}`, customer: String(i + 1).padStart(9, '0'), account: id(i + 1) })),
    customers: Array.from({ length: n }, (_, i) => d.customer({ id: String(i + 1).padStart(9, '0'), first: `Cust${i + 1}` })),
    accounts: Array.from({ length: n }, (_, i) => account({ id: id(i + 1), balance: '10.00' })),
  });
}

test('R6: one card with two transactions gives the whole statement, line by line', () => {
  const got = go(d.statementInputs({ trans: [t(2, '-5.00', { desc: 'second' }), t(1, '12.30', { desc: 'first' })], accounts: [account({ balance: '100.00' })] }));
  assert.deepEqual(got.text, d.statement(C, A, [row(1, '12.30', 'first'), row(2, '-5.00', 'second')]));
  assert.deepEqual(got.summary, { statements: 1, transactions: 2, skipped: 0 });
  assert.match(got.stdout, /^statements: 1$/m);
});

test('every text record is 80 characters and every HTML record is 100 (R7)', () => {
  const got = go(d.statementInputs({ trans: [t(1)] }));
  for (const l of got.text) assert.equal(l.length, 80);
  for (const l of got.html) assert.equal(l.length, 100);
});

test('the name is the first word of each part: a name with no middle name keeps two blanks', () => {
  const got = go(d.statementInputs({ customers: [d.customer({ first: 'Mary Ann', middle: '', last: 'Smith Jones' })] }));
  assert.equal(got.text[1], pad('Mary  Smith ', 80));
});

test('the last address line is the first word of the line, the state, the country and the zip code', () => {
  const got = go(d.statementInputs({ customers: [d.customer({ addr3: 'West Palm Beach', state: 'FL', country: 'USA', zip: '33401' })] }));
  assert.equal(got.text[4], pad('West FL USA 33401 ', 80));
  const bare = go(d.statementInputs({ customers: [d.customer({ addr3: '', state: '', country: '', zip: '' })] }));
  assert.equal(bare.text[4], ' '.repeat(80));
});

test('addresses one and two are copied as they are, even when empty', () => {
  const got = go(d.statementInputs({ customers: [d.customer({ addr1: '12  Two  Blanks Road', addr2: '' })] }));
  assert.equal(got.text[2], pad('12  Two  Blanks Road', 80));
  assert.equal(got.text[3], ' '.repeat(80));
});

test('R5: the balance is nine digits with leading zeros and a minus after a credit balance', () => {
  for (const [balance, want] of [['877.34', '000000877.34 '], ['-12.50', '000000012.50-'], ['0.00', '000000000.00 '], ['0.05', '000000000.05 ']]) {
    const got = go(d.statementInputs({ accounts: [account({ balance })] }));
    assert.equal(got.text[9], pad(`Current Balance    :${want}`, 80), balance);
  }
});

test('R5: a transaction amount is Z(9).99- with the units digit always printed', () => {
  const amounts = ['0.05', '-0.99', '12.30', '0.00', '1234567.89', '-100.00'];
  const got = go(d.statementInputs({ trans: amounts.map((a, i) => t(i + 1, a)) }));
  const lines = got.text.slice(16, 16 + amounts.length);
  assert.deepEqual(lines.map((l) => l.slice(67)), amounts.map(d.stmtAmt));
  assert.equal(lines[0].slice(67), '        0.05 ');
  assert.equal(lines[1].slice(67), '        0.99-');
  assert.equal(lines[4].slice(67), '  1234567.89 ');
  assert.equal(got.text.at(-2).slice(67), d.stmtAmt(d.sum(amounts)));
});

test('the details are cut at 49 characters and the transaction id is padded to 16', () => {
  const long = 'D'.repeat(60);
  const got = go(d.statementInputs({ trans: [t(1, '2.00', { desc: long })] }));
  assert.equal(got.text[16].slice(17, 66), 'D'.repeat(49));
  assert.equal(got.text[16].slice(66, 67), '$');
});

test('the total is the sum of every amount of the card, payments included', () => {
  const got = go(d.statementInputs({ trans: [t(1, '40.00'), t(2, '-15.25'), t(3, '0.75')] }));
  assert.equal(got.text.at(-2), `Total EXP:${' '.repeat(56)}$${d.stmtAmt('25.50')}`);
});

test('R6: a card with no transaction still gets a statement with no lines and a total of 0.00', () => {
  const got = go(d.statementInputs({ trans: [] }));
  assert.deepEqual(got.text, d.statement(C, A, []));
  assert.deepEqual(got.summary, { statements: 1, transactions: 0, skipped: 0 });
  assert.equal(got.html.at(-1).trim(), '</html>');
});

test('R6: cards come in card number order, whatever the order of the files', () => {
  const xrefs = [xref({ card: '4000000000000009', customer: '000000009', account: '00000000009' }), xref({ card: '4000000000000002', customer: '000000002', account: '00000000002' }), xref({ card: '4000000000000005', customer: '000000005', account: '00000000005' })];
  const customers = ['000000005', '000000009', '000000002'].map((id) => d.customer({ id, first: `Cust${id.slice(-1)}` }));
  const accounts = ['00000000009', '00000000005', '00000000002'].map((id) => account({ id }));
  const got = go(d.statementInputs({ xrefs, customers, accounts }));
  assert.deepEqual(got.text.filter((l) => l.startsWith('Account ID')).map((l) => l.slice(20, 31)), ['00000000002', '00000000005', '00000000009']);
});

test('R6: the transactions of a card come in transaction id order', () => {
  const got = go(d.statementInputs({ trans: [t(30), t(7), t(100), t(8)] }));
  assert.deepEqual(got.text.slice(16, 20).map((l) => l.slice(0, 16)), [d.tid(7), d.tid(8), d.tid(30), d.tid(100)]);
});

test('R6: more than ten transactions on one card are all printed', () => {
  const got = go(d.statementInputs({ trans: Array.from({ length: 14 }, (_, i) => t(i + 1, '1.00')) }));
  assert.equal(got.text.filter((l) => /^\d{16} item/.test(l)).length, 14);
  assert.equal(got.text.at(-2), `Total EXP:${' '.repeat(56)}$${d.stmtAmt('14.00')}`);
  assert.equal(got.summary.transactions, 14);
});

test('R6: more than 51 cards all get a statement', () => {
  const got = go(many(60));
  assert.equal(got.text.filter((l) => l.startsWith('*') && l.includes('START OF STATEMENT')).length, 60);
  assert.deepEqual(got.summary, { statements: 60, transactions: 0, skipped: 0 });
});

test('each card has its own statement, with its own transactions, even when two cards share an account', () => {
  const xrefs = [xref({ card: '4000000000000002', account: '00000000001' }), xref({ card: '4000000000000001', account: '00000000001' })];
  const got = go(d.statementInputs({ xrefs, trans: [t(1, '1.00'), t(2, '2.00', { card: '4000000000000002' }), t(3, '4.00', { card: '4000000000000002' })] }));
  assert.equal(got.text.filter((l) => l.startsWith('Total EXP:')).length, 2);
  assert.deepEqual(got.text.filter((l) => l.startsWith('Total EXP:')).map((l) => l.slice(67)), [d.stmtAmt('1.00'), d.stmtAmt('6.00')]);
});

test('transactions of a card that is not in the cross reference are left out of every statement', () => {
  const got = go(d.statementInputs({ trans: [t(1, '1.00'), t(2, '9.00', { card: '4999999999999999' })] }));
  assert.equal(got.summary.transactions, 1);
  assert.equal(got.text.at(-2), `Total EXP:${' '.repeat(56)}$${d.stmtAmt('1.00')}`);
});

test('R8: a card whose customer or account is missing gets no statement, and the run goes on', () => {
  const xrefs = [xref({ card: '4000000000000001' }), xref({ card: '4000000000000002', customer: '000000002', account: '00000000001' }), xref({ card: '4000000000000003', customer: '000000001', account: '00000000077' })];
  const got = go(d.statementInputs({ xrefs, trans: [t(1, '1.00'), t(2, '2.00', { card: '4000000000000002' }), t(3, '3.00', { card: '4000000000000003' })] }));
  assert.equal(got.text.filter((l) => l.includes('START OF STATEMENT')).length, 1);
  assert.deepEqual(got.summary, { statements: 1, transactions: 1, skipped: 2 });
});

test('R6: a card and transaction id that appear twice in transact.txt are bad input', () => {
  statements(d.statementInputs({ trans: [t(1, '1.00'), t(1, '2.00')] }), (r) => assertRefused(assert, r));
  const ok = go(d.statementInputs({ trans: [t(1, '1.00'), t(1, '2.00', { card: '4000000000000002' })], xrefs: [xref(), xref({ card: '4000000000000002', account: '00000000001' })] }));
  assert.equal(ok.summary.transactions, 2);
});

test('R7: the HTML has one complete document for each statement, with the fixed lines of the COBOL', () => {
  const got = go(many(3));
  const trim = got.html.map((l) => l.trimEnd());
  assert.equal(trim.filter((l) => l === '<!DOCTYPE html>').length, 3);
  assert.equal(trim.filter((l) => l === '</html>').length, 3);
  assert.deepEqual(trim.slice(0, 8), ['<!DOCTYPE html>', '<html lang="en">', '<head>', '<meta charset="utf-8">', '<title>HTML Table Layout</title>', '</head>', '<body style="margin:0px;">',
    '<table  align="center" frame="box" style="width:70%; font:12px Segoe UI,sans-serif;">']);
  assert.deepEqual(trim.slice(-8), ['<tr>', '<td colspan="3" style="padding:0px 5px;background-color:#1d1d96b3;">', '<h3>End of Statement</h3>', '</td>', '</tr>', '</table>', '</body>', '</html>']);
});

test('R7: a fixed line that the source continues is joined with nothing between the parts', () => {
  const got = go(d.statementInputs({ trans: [t(1)] })).html.map((l) => l.trimEnd());
  for (const want of [
    '<td colspan="3" style="padding:0px 5px;background-color:#FFAF33;">', '<td colspan="3" style="padding:0px 5px;background-color:#f2f2f2;">',
    '<td colspan="3" style="padding:0px 5px;background-color:#33FFD1; text-align:center;">',
    '<td style="width:25%; padding:0px 5px; background-color:#33FF5E; text-align:left;">',
    '<td style="width:55%; padding:0px 5px; background-color:#f2f2f2; text-align:left;">',
    '<td style="width:20%; padding:0px 5px; background-color:#f2f2f2; text-align:right;">',
  ]) assert.ok(got.includes(want), want);
});

test('R7: the account, name, address, basic details and one transaction row are in the HTML', () => {
  const got = go(d.statementInputs({ trans: [t(1, '12.30', { desc: 'first' })], accounts: [account({ balance: '877.34' })] })).html;
  const at = got.findIndex((l) => l.startsWith('<h3>Statement for Account Number'));
  assert.equal(got[at], pad('<h3>Statement for Account Number: 00000000001         </h3>', 100));
  const has = (text) => assert.ok(got.includes(pad(text, 100)), text);
  has('<p style="font-size:16px">John Q Public  </p>');
  has('<p>1 Main Street  </p>');
  has('<p>Apt 2  </p>');
  has('<p>Springfield IL USA 62701  </p>');
  has('<p>Account ID         : 00000000001         </p>');
  has('<p>Current Balance    : 000000877.34 </p>');
  has('<p>FICO Score         : 700                 </p>');
  has(`<p>${d.tid(1)}</p>`);
  has(`<p>${pad('first', 49)}</p>`);
  has(`<p>${d.stmtAmt('12.30')}</p>`);
});

test('R7: the HTML name stops at the first two blanks, so a name with no middle name shows only the first name', () => {
  const got = go(d.statementInputs({ customers: [d.customer({ first: 'John', middle: '', last: 'Public' })] })).html;
  assert.ok(got.includes(pad('<p style="font-size:16px">John  </p>', 100)));
});

test('the HTML bank block and the fixed table heads come from the COBOL, in its order', () => {
  const got = go(d.statementInputs({ trans: [t(1)] })).html.map((l) => l.trimEnd());
  const idx = (text) => got.indexOf(text);
  assert.ok(idx('<p style="font-size:16px">Bank of XYZ</p>') < idx('<p style="font-size:16px">Basic Details</p>'));
  assert.ok(idx('<p style="font-size:16px">Basic Details</p>') < idx('<p style="font-size:16px">Transaction Summary</p>'));
  assert.ok(idx('<p style="font-size:16px">Tran ID</p>') < idx('<p style="font-size:16px">Tran Details</p>'));
  assert.ok(idx('<p style="font-size:16px">Tran Details</p>') < idx('<p style="font-size:16px">Amount</p>'));
  assert.ok(idx('<p style="font-size:16px">Amount</p>') < idx('<h3>End of Statement</h3>'));
});

test('bad input: a missing file, a bad customer record and a repeated customer stop the run and write nothing', () => {
  const ok = d.statementInputs({ trans: [t(1)] });
  for (const drop of ['transact.txt', 'cardxref.txt', 'custdata.txt', 'acctdata.txt']) {
    const { [drop]: gone, ...rest } = ok;
    statements(rest, (r) => assert.match(assertRefused(assert, r).stderr, new RegExp(drop.replace('.', '\\.'))));
  }
  statements({ ...ok, 'custdata.txt': `${d.customer({ id: '00000000x' })}\n` }, (r) => assert.match(assertRefused(assert, r).stderr, /custdata\.txt line 1/));
  statements({ ...ok, 'custdata.txt': cd.lines([d.customer(), d.customer()]) }, (r) => assertRefused(assert, r));
  statements({ ...ok, 'custdata.txt': `${d.customer()}X\n` }, (r) => assertRefused(assert, r));
});

test('neither stream shows a customer name, a card number or an amount, and the inputs are not changed', () => {
  const inputs = d.statementInputs({ trans: [t(1, '12.30')] });
  statements(inputs, (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /John|Public|4000000000000001|12\.30|123456789/);
    for (const [name, text] of Object.entries(inputs)) assert.equal(fs.readFileSync(`${r.inDir}/${name}`, 'utf8'), text);
    assert.doesNotMatch(r.read('statement.txt') + r.read('statement.html'), /123456789|\(555\)/);
  });
});

test('a non-empty output directory is refused and left as it was', () => {
  statements(d.statementInputs({ trans: [t(1)] }), (r) => {
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(r.files, ['keep.txt']);
  }, { prepare: (inDir, outDir) => { fs.mkdirSync(outDir); fs.writeFileSync(`${outDir}/keep.txt`, 'x'); } });
});
