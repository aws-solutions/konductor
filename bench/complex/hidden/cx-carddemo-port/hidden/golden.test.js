// SPDX-License-Identifier: Apache-2.0
'use strict';

// Both jobs on the 50-account sample files, compared byte for byte with saved outputs (timestamps masked).
// The inputs in golden/in are the CardDemo sample files. The outputs in golden/ were written by the reference port;
// to write them again from a workspace that holds it: CARDDEMO_GOLDEN_WRITE=1 node --test hidden/golden.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cd = require('./lib/cd.js');

const GOLDEN = path.join(__dirname, 'golden');
const WRITE = process.env.CARDDEMO_GOLDEN_WRITE === '1';
const read = (...p) => fs.readFileSync(path.join(GOLDEN, ...p), 'utf8');
const sample = (names) => Object.fromEntries(names.map((n) => [n, read('in', n)]));

/** Check (or write, when regenerating) the output files `names` of result `r` against golden/<dir>. */
function compare(r, dir, names, maskOptions) {
  for (const name of names) {
    let text = r.read(name);
    if (name === 'transact.txt') text = cd.maskStamps(text, maskOptions);
    if (name === 'summary.json') text = `${JSON.stringify(JSON.parse(text))}\n`;
    const file = path.join(GOLDEN, dir, name);
    if (WRITE) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); } else assert.equal(text, fs.readFileSync(file, 'utf8'), `${dir}/${name}`);
  }
}

test('post on the sample files gives the saved outputs', () => {
  cd.run('post', sample(['dailytran.txt', 'cardxref.txt', 'acctdata.txt', 'tcatbal.txt']), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.deepEqual(r.files, cd.POST_FILES);
    compare(r, 'post', ['transact.txt', 'dalyrejs.txt', 'acctdata.txt', 'tcatbal.txt'], { proc: true });
    compare(r, 'post', ['summary.json']);
    assert.equal(JSON.parse(r.read('summary.json')).processed, 300);
  });
});

test('interest on the sample files gives the saved outputs', () => {
  cd.run('interest', sample(['tcatbal.txt', 'discgrp.txt', 'acctdata.txt', 'cardxref.txt']), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.files, cd.INTEREST_FILES);
    compare(r, 'interest', ['transact.txt', 'acctdata.txt'], { orig: true, proc: true });
    compare(r, 'interest', ['summary.json']);
  }, { args: ['--run-date', '2026-11-25'] });
});

test('interest after post on the sample files gives the saved outputs', () => {
  cd.run('post', sample(['dailytran.txt', 'cardxref.txt', 'acctdata.txt', 'tcatbal.txt']), (p) => {
    const inputs = sample(['discgrp.txt', 'cardxref.txt']);
    inputs['acctdata.txt'] = p.read('acctdata.txt');
    inputs['tcatbal.txt'] = p.read('tcatbal.txt');
    cd.run('interest', inputs, (r) => {
      assert.equal(r.status, 0, r.stderr);
      compare(r, 'chain', ['transact.txt', 'acctdata.txt'], { orig: true, proc: true });
      compare(r, 'chain', ['summary.json']);
    }, { args: ['--run-date', '2026-11-25'] });
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
  cd.run('post', sample(['dailytran.txt', 'cardxref.txt', 'acctdata.txt', 'tcatbal.txt']), (r) => {
    const posted = sum(r.read('transact.txt'), 132, 11);
    assert.equal(sum(r.read('acctdata.txt'), 12, 12) - sum(read('in', 'acctdata.txt'), 12, 12), posted);
    assert.equal(sum(r.read('tcatbal.txt'), 17, 11) - sum(read('in', 'tcatbal.txt'), 17, 11), posted);
    const { posted: n, rejected } = JSON.parse(r.read('summary.json'));
    assert.equal(n + rejected, 300);
    assert.ok(rejected > 0 && n > 0);
  });
});
