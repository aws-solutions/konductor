// SPDX-License-Identifier: Apache-2.0
'use strict';

// The four jobs on the sample files (data/ of the fixture), compared byte for byte with saved outputs (timestamps masked).
// The inputs in golden/in are copies of data/. The outputs in golden/ were written by the reference port; to write them
// again from a workspace that holds it: CARDDEMO_GOLDEN_WRITE=1 node --test hidden/golden.test.js
// Two things the signed rules leave open are accepted either way: an interest row of +0.00 (see cd.dropZeroInterest)
// and the filler of a tcatbal.txt row kept from the input (see cd.blankKeptFiller).

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
const POST_IN = ['dailytran.txt', 'cardxref.txt', 'acctdata.txt', 'tcatbal.txt'];
const DAILY = read('in', 'dailytran.txt').split('\n').filter(Boolean).length;

/**
 * Check (or write, when regenerating) the output files `names` of result `r` against golden/<dir>. With `interest`
 * the +0.00 interest rows are dropped first and the summary count is lowered by the number dropped.
 */
function compare(r, dir, names, { interest = false, ...maskOptions } = {}) {
  let dropped = 0;
  for (const name of names) {
    let text = r.read(name);
    if (name === 'transact.txt') text = cd.maskStamps(text, maskOptions);
    if (name === 'tcatbal.txt' && !WRITE) text = cd.blankKeptFiller(text, read('in', name));
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

/** Run `post` on the sample and pass its result to `check`. */
const post = (check) => cd.run('post', sample(POST_IN), check);

/** The inputs of report and statements after a post run `p`: its transact.txt and acctdata.txt, the sample's other files. */
const afterPost = (p, names) => ({ ...sample(names), 'transact.txt': p.read('transact.txt'), 'acctdata.txt': p.read('acctdata.txt') });

/** `text` (post's transact.txt) with its processed dates made fixed: line i gets 2026-11-(1 + i % 5), so a range picks lines. */
const stampDays = (text) => text.split('\n').map((l, i) => (l ? l.slice(0, 304) + `2026-11-0${1 + (i % 5)} 08:00:00.000000` + l.slice(330) : l)).join('\n');

test('post on the sample files gives the saved outputs', () => {
  post((r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.deepEqual(r.files, cd.POST_FILES);
    compare(r, 'post', ['transact.txt', 'dalyrejs.txt', 'acctdata.txt', 'tcatbal.txt'], { proc: true });
    compare(r, 'post', ['summary.json']);
    assert.equal(JSON.parse(r.read('summary.json')).processed, DAILY);
  });
});

test('the sample hits every reject code, and a payment and a credit are posted', () => {
  post((r) => {
    const codes = r.read('dalyrejs.txt').split('\n').filter(Boolean).map((l) => l.slice(350, 354));
    assert.deepEqual([...new Set(codes)].sort(), ['0100', '0101', '0102', '0103', '0104']);
    const types = new Set(r.read('transact.txt').split('\n').filter(Boolean).map((l) => l.slice(16, 18)));
    assert.ok(types.has('02') && types.has('03'));
  });
});

test('interest on the sample files gives the saved outputs', () => {
  cd.run('interest', sample(['tcatbal.txt', 'discgrp.txt', 'acctdata.txt', 'cardxref.txt']), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.files, cd.INTEREST_FILES);
    compare(r, 'interest', ['transact.txt', 'acctdata.txt', 'summary.json'], { interest: true, orig: true, proc: true });
    assert.ok(JSON.parse(r.read('summary.json')).interest_transactions > 0, 'the sample makes interest');
  }, { args: ['--run-date', DATE] });
});

test('interest after post on the sample files gives the saved outputs', () => {
  post((p) => {
    const inputs = { ...sample(['discgrp.txt', 'cardxref.txt']), 'acctdata.txt': p.read('acctdata.txt'), 'tcatbal.txt': p.read('tcatbal.txt') };
    cd.run('interest', inputs, (r) => {
      assert.equal(r.status, 0, r.stderr);
      compare(r, 'chain', ['transact.txt', 'acctdata.txt', 'summary.json'], { interest: true, orig: true, proc: true });
    }, { args: ['--run-date', DATE] });
  });
});

test('the sample run keeps the books: posted amounts equal the change in account and category balances', () => {
  /** Cents of a zoned field (test-side decoder). */
  function decode(field) {
    const last = field.slice(-1);
    const neg = '}JKLMNOPQR'.includes(last);
    const digit = neg ? '}JKLMNOPQR'.indexOf(last) : '{ABCDEFGHI'.indexOf(last);
    const cents = BigInt(field.slice(0, -1) + digit);
    return neg ? -cents : cents;
  }
  const sum = (text, from, width) => text.split('\n').filter(Boolean).reduce((s, l) => s + decode(l.slice(from, from + width)), 0n);
  post((r) => {
    const posted = sum(r.read('transact.txt'), 132, 11);
    assert.equal(sum(r.read('acctdata.txt'), 12, 12) - sum(read('in', 'acctdata.txt'), 12, 12), posted);
    assert.equal(sum(r.read('tcatbal.txt'), 17, 11) - sum(read('in', 'tcatbal.txt'), 17, 11), posted);
    const { posted: n, rejected } = JSON.parse(r.read('summary.json'));
    assert.equal(n + rejected, DAILY);
    assert.ok(rejected > 0 && n > 0);
  });
});

test('report after post on the sample files gives the saved report, over several pages', () => {
  post((p) => {
    cd.run('report', afterPost(p, ['cardxref.txt', 'trantype.txt', 'trancatg.txt']), (r) => {
      assert.equal(r.status, 0, r.stderr);
      compare(r, 'report-all', ['report.txt', 'summary.json']);
      assert.ok(r.read('report.txt').split('\n').filter((l) => l.startsWith('Page Total')).length >= 3, 'the sample report has several pages');
    }, { args: ['--start', '2000-01-01', '--end', '2999-12-31'] });
  });
});

test('report on the sample files with a date range gives the saved report', () => {
  post((p) => {
    const inputs = { ...afterPost(p, ['cardxref.txt', 'trantype.txt', 'trancatg.txt']), 'transact.txt': stampDays(p.read('transact.txt')) };
    cd.run('report', inputs, (r) => {
      assert.equal(r.status, 0, r.stderr);
      compare(r, 'report-range', ['report.txt', 'summary.json']);
      assert.ok(JSON.parse(r.read('summary.json')).detail_lines > 0);
    }, { args: ['--start', '2026-11-02', '--end', '2026-11-04'] });
  });
});

test('report on the interest transactions of the sample reads the interest category', () => {
  cd.run('interest', sample(['tcatbal.txt', 'discgrp.txt', 'acctdata.txt', 'cardxref.txt']), (i) => {
    const inputs = { ...sample(['cardxref.txt', 'trantype.txt', 'trancatg.txt']), 'transact.txt': i.read('transact.txt') };
    cd.run('report', inputs, (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.read('report.txt'), /0005-Interest Amount/);
    }, { args: ['--start', '2000-01-01', '--end', '2999-12-31'] });
  }, { args: ['--run-date', DATE] });
});

test('statements after post on the sample files give the saved text and HTML', () => {
  post((p) => {
    cd.run('statements', afterPost(p, ['cardxref.txt', 'custdata.txt']), (r) => {
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.files, ['statement.html', 'statement.txt', 'summary.json']);
      compare(r, 'statements', ['statement.txt', 'statement.html', 'summary.json']);
      const summary = JSON.parse(r.read('summary.json'));
      assert.equal(summary.skipped, 1, 'the card of the account with no record gets no statement');
      assert.equal(summary.transactions, JSON.parse(p.read('summary.json')).posted);
    });
  });
});
