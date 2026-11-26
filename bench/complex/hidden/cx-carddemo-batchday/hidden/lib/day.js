// SPDX-License-Identifier: Apache-2.0
'use strict';

// Helpers for the report and statement tests: build the extra input records, and write the expected lines of the
// report (CBTRN03C) and of a statement (CBSTM03A) from their layouts. The expected lines here are written from the
// COBOL pictures and the DRAFT rules in docs/REQUIREMENTS.md, separately from any port.

const cd = require('./cd.js');

const { tran, xref, account, pad, lines } = cd;

/** One transaction type record (60 characters). */
const trantype = (code, desc) => pad(code, 2) + pad(desc, 50) + ' '.repeat(8);

/** One transaction category record (60 characters). */
const trancat = (type, cat, desc) => pad(type, 2) + cat + pad(desc, 50) + ' '.repeat(4);

/** One customer record (500 characters). */
function customer(o = {}) {
  const d = {
    id: '000000001', first: 'John', middle: 'Q', last: 'Public', addr1: '1 Main Street', addr2: 'Apt 2', addr3: 'Springfield',
    state: 'IL', country: 'USA', zip: '62701', fico: '700', ...o,
  };
  return d.id + pad(d.first, 25) + pad(d.middle, 25) + pad(d.last, 25) + pad(d.addr1, 50) + pad(d.addr2, 50) + pad(d.addr3, 50)
    + pad(d.state, 2) + pad(d.country, 3) + pad(d.zip, 10) + pad('(555)000-0000', 15) + pad('', 15) + '123456789' + pad('', 20)
    + pad('1970-01-01', 10) + pad('', 10) + 'Y' + d.fico + ' '.repeat(168);
}

const TYPES = [trantype('01', 'Purchase'), trantype('02', 'Payment'), trantype('03', 'Credit')];
const CATS = [trancat('01', '0001', 'Regular Sales Draft'), trancat('01', '0002', 'Regular Cash Advance'), trancat('02', '0001', 'Cash payment'), trancat('03', '0001', 'Credit to Account')];

/** A transaction that has been posted: the processed timestamp is `proc` (a date is enough: the time is added). */
const posted = (o = {}) => tran({ ...o, proc: `${o.procDate ?? '2026-11-10'} 12:00:00.000000` });

/** The inputs of `report`. */
const reportInputs = ({ trans = [], xrefs = [xref()], types = TYPES, cats = CATS } = {}) => ({
  'transact.txt': lines(trans), 'cardxref.txt': lines(xrefs), 'trantype.txt': lines(types), 'trancatg.txt': lines(cats),
});

/** The inputs of `statements`. */
const statementInputs = ({ trans = [], xrefs = [xref()], customers = [customer()], accounts = [account()] } = {}) => ({
  'transact.txt': lines(trans), 'cardxref.txt': lines(xrefs), 'custdata.txt': lines(customers), 'acctdata.txt': lines(accounts),
});

/** `n` cents or an amount string like "-12.30" as { neg, whole, frac }. */
function parts(amount) {
  const neg = String(amount).startsWith('-');
  const [whole, frac = ''] = String(amount).replace('-', '').split('.');
  return { neg, whole: String(BigInt(whole || '0')), frac: frac.padEnd(2, '0').slice(0, 2) };
}

const commas = (digits) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** PIC -ZZZ,ZZZ,ZZZ.ZZ with the last integer digit always printed (R5). */
function detailAmt(amount) {
  const p = parts(amount);
  return (p.neg ? '-' : ' ') + commas(p.whole).padStart(11) + '.' + p.frac;
}

/** PIC +ZZZ,ZZZ,ZZZ.ZZ (R5). */
function totalAmt(amount) {
  const p = parts(amount);
  return (p.neg ? '-' : '+') + commas(p.whole).padStart(11) + '.' + p.frac;
}

/** PIC Z(9).99- (R5). */
function stmtAmt(amount) {
  const p = parts(amount);
  return p.whole.padStart(9) + '.' + p.frac + (p.neg ? '-' : ' ');
}

/** PIC 9(9).99-. */
function balAmt(amount) {
  const p = parts(amount);
  return p.whole.padStart(9, '0') + '.' + p.frac + (p.neg ? '-' : ' ');
}

const W = 133;
const RULE = '-'.repeat(W);
const line = (text) => text.padEnd(W);

/** The four heading lines of a report page. */
const headings = (start, end) => [
  line(`${pad('DALYREPT', 38)}${pad('Daily Transaction Report', 41)}Date Range: ${start} to ${end}`),
  line(''),
  line(`${pad('Transaction ID', 17)}${pad('Account ID', 12)}${pad('Transaction Type', 19)}${pad('Tran Category', 35)}${pad('Tran Source', 14)} ${pad('        Amount', 16)}`),
  RULE,
];

/** One detail line. `o`: id, acct, type, typeDesc, cat, catDesc, source, amount. */
const detail = (o) => line(`${pad(o.id, 16)} ${o.acct} ${o.type}-${pad(o.typeDesc.slice(0, 15), 15)} ${o.cat}-${pad(o.catDesc.slice(0, 29), 29)} ${pad(o.source ?? 'POS TERM', 10)}    ${detailAmt(o.amount)}`);

const totalLine = (label, labelWidth, amount) => line(`${pad(label, labelWidth)}${'.'.repeat(112 - 15 - labelWidth)}${totalAmt(amount)}`);
const pageTotal = (amount) => totalLine('Page Total', 11, amount);
const accountTotal = (amount) => totalLine('Account Total', 13, amount);
const grandTotal = (amount) => totalLine('Grand Total', 11, amount);

/** A detail line for the default transaction builder values: purchase of category 0001 on the default card and account. */
const detailOf = (id, amount, o = {}) => detail({ id, acct: '00000000001', type: '01', typeDesc: 'Purchase', cat: '0001', catDesc: 'Regular Sales Draft', amount, ...o });

/** A 16-digit transaction id from a number. */
const tid = (n) => String(n).padStart(16, '0');

/** Sum of amount strings, as a string with 2 decimals (the test-side money maths, in cents). */
function sum(amounts) {
  const cents = amounts.reduce((s, a) => { const p = parts(a); const c = BigInt(p.whole) * 100n + BigInt(p.frac); return s + (p.neg ? -c : c); }, 0n);
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Report text of `lines`, each ended by a newline. */
const text = (ls) => ls.map((l) => `${l}\n`).join('');

const first = (v) => String(v).split(' ')[0];
const W80 = (text) => text.padEnd(80);
const R80 = '-'.repeat(80);

/**
 * The text statement of CBSTM03A for customer record fields `c`, account fields `a` ({ id, balance }) and transactions
 * `trans` ({ id, desc, amount }, already in id order): the 80-character lines.
 */
function statement(c, a, trans) {
  const name = `${first(c.first)} ${first(c.middle)} ${first(c.last)} `;
  const add3 = `${first(c.addr3)} ${first(c.state)} ${first(c.country)} ${first(c.zip)} `;
  const head = [
    `${'*'.repeat(31)}START OF STATEMENT${'*'.repeat(31)}`, W80(name), W80(c.addr1), W80(c.addr2), W80(add3), R80,
    `${' '.repeat(33)}${pad('Basic Details', 14)}${' '.repeat(33)}`, R80,
    W80(`Account ID         :${pad(a.id, 20)}`), W80(`Current Balance    :${balAmt(a.balance)}`), W80(`FICO Score         :${pad(c.fico, 20)}`),
    R80, `${' '.repeat(30)}TRANSACTION SUMMARY ${' '.repeat(30)}`, R80, `Tran ID         ${pad('Tran Details', 51)}  Tran Amount`, R80,
  ];
  const body = trans.map((t) => `${pad(t.id, 16)} ${pad(t.desc.slice(0, 49), 49)}$${stmtAmt(t.amount)}`);
  return [...head, ...body, R80, `Total EXP:${' '.repeat(56)}$${stmtAmt(sum(trans.map((t) => t.amount)))}`, `${'*'.repeat(32)}END OF STATEMENT${'*'.repeat(32)}`];
}

module.exports = {
  statement, first,
  trantype, trancat, customer, TYPES, CATS, posted, reportInputs, statementInputs, detailAmt, totalAmt, stmtAmt, balAmt, W, RULE, line, headings,
  detail, detailOf, pageTotal, accountTotal, grandTotal, tid, sum, text,
};
