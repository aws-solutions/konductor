// SPDX-License-Identifier: Apache-2.0
'use strict';

// Both jobs on the 50-account sample files, compared byte for byte with saved outputs (timestamps masked).
// The inputs in golden/in are the CardDemo sample files. The outputs in golden/ were written by the reference port;
// to write them again from a workspace that holds it: CARDDEMO_GOLDEN_WRITE=1 node --test hidden/golden.test.js
// Two things the signed rules leave open are accepted either way: the sample tcatbal.txt ends its lines with CRLF
// (a port may read it or refuse it; a refusal is checked, then the run is repeated on LF lines), and an interest row
// of +0.00 (see cd.dropZeroInterest).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cd = require('./lib/cd.js');

const GOLDEN = path.join(__dirname, 'golden');
const WRITE = process.env.CARDDEMO_GOLDEN_WRITE === '1';
const DATE = '2026-11-25';
const read = (...p) => fs.readFileSync(path.join(GOLDEN, ...p), 'utf8');
const sample = (names) => Object.fromEntries(names.map((n) => [n, read('in', n)]));
const CARDS = cd.lowestCards(read('in', 'cardxref.txt'));

/**
 * Run `job` on the sample `inputs` and pass the result to `check`. A port that refuses a CRLF input line must do so as
 * a clean failed run that names the file and line 1 of the first such file; the run is then repeated on LF lines.
 */
function runSample(job, inputs, check, options) {
  const crlf = Object.keys(inputs).sort().find((n) => inputs[n].includes('\r\n'));
  return cd.run(job, inputs, (r) => {
    if (WRITE || !crlf || r.status !== 2) return check(r);
    cd.assertRefused(assert, r);
    assert.match(r.stderr, new RegExp(`${crlf.replace('.', '\\.')} line 1\\b`), r.stderr);
    const lf = Object.fromEntries(Object.entries(inputs).map(([n, t]) => [n, t.replace(/\r\n/g, '\n')]));
    return cd.run(job, lf, check, options);
  }, options);
}

/**
 * Check (or write, when regenerating) the output files `names` of result `r` against golden/<dir>. With `interest`
 * the +0.00 interest rows are dropped first and the summary count is lowered by the number dropped.
 */
function compare(r, dir, names, { interest = false, ...maskOptions } = {}) {
  let dropped = 0;
  for (const name of names) {
    let text = r.read(name);
    if (name === 'transact.txt') text = cd.maskStamps(text, maskOptions);
    if (name === 'transact.txt' && interest && !WRITE) ({ text, dropped } = cd.dropZeroInterest(text, { cards: CARDS, date: DATE }));
    if (name === 'summary.json') {
      const summary = JSON.parse(text);
      if (interest && !WRITE && Number.isInteger(summary.interest_transactions)) summary.interest_transactions -= dropped;
      text = `${JSON.stringify(summary)}\n`;
    }
    const file = path.join(GOLDEN, dir, name);
    if (WRITE) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } else assert.equal(text, fs.readFileSync(file, 'utf8'), `${dir}/${name}`);
  }
}

test('post on the sample files gives the saved outputs', () => {
  runSample('post', sample(['dailytran.txt', 'cardxref.txt', 'acctdata.txt', 'tcatbal.txt']), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.deepEqual(r.files, cd.POST_FILES);
    compare(r, 'post', ['transact.txt', 'dalyrejs.txt', 'acctdata.txt', 'tcatbal.txt'], { proc: true });
    compare(r, 'post', ['summary.json']);
    assert.equal(JSON.parse(r.read('summary.json')).processed, 300);
  });
});

test('interest on the sample files gives the saved outputs', () => {
  runSample('interest', sample(['tcatbal.txt', 'discgrp.txt', 'acctdata.txt', 'cardxref.txt']), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.files, cd.INTEREST_FILES);
    compare(r, 'interest', ['transact.txt', 'acctdata.txt', 'summary.json'], { interest: true, orig: true, proc: true });
  }, { args: ['--run-date', DATE] });
});

test('interest after post on the sample files gives the saved outputs', () => {
  runSample('post', sample(['dailytran.txt', 'cardxref.txt', 'acctdata.txt', 'tcatbal.txt']), (p) => {
    const inputs = sample(['discgrp.txt', 'cardxref.txt']);
    inputs['acctdata.txt'] = p.read('acctdata.txt');
    inputs['tcatbal.txt'] = p.read('tcatbal.txt');
    cd.run('interest', inputs, (r) => {
      assert.equal(r.status, 0, r.stderr);
      compare(r, 'chain', ['transact.txt', 'acctdata.txt', 'summary.json'], { interest: true, orig: true, proc: true });
    }, { args: ['--run-date', DATE] });
  });
});

test('the sample run keeps the books: posted amounts equal the change in account and category balances', () => {
  const sum = (text, from, width) => text.split('\n').filter(Boolean).reduce((s, l) => s + decode(l.slice(from, from + width)), 0n);
  /** Cents of a zoned field (test-side decoder). */
  function decode(field) {
    const last = field.slice(-1);
    const neg = '}JKLMNOPQR'.includes(last);
    const digit = neg ? '}JKLMNOPQR'.indexOf(last) : '{ABCDEFGHI'.indexOf(last);
    const cents = BigInt(field.slice(0, -1) + digit);
    return neg ? -cents : cents;
  }
  runSample('post', sample(['dailytran.txt', 'cardxref.txt', 'acctdata.txt', 'tcatbal.txt']), (r) => {
    const posted = sum(r.read('transact.txt'), 132, 11);
    assert.equal(sum(r.read('acctdata.txt'), 12, 12) - sum(read('in', 'acctdata.txt'), 12, 12), posted);
    assert.equal(sum(r.read('tcatbal.txt'), 17, 11) - sum(read('in', 'tcatbal.txt'), 17, 11), posted);
    const { posted: n, rejected } = JSON.parse(r.read('summary.json'));
    assert.equal(n + rejected, 300);
    assert.ok(rejected > 0 && n > 0);
  });
});
