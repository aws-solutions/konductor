// SPDX-License-Identifier: Apache-2.0
'use strict';

// Job 2, monthly interest: rules I1 to I9 through the command line, output files compared byte for byte.

const test = require('node:test');
const assert = require('node:assert/strict');
const cd = require('./lib/cd.js');

const { account, xref, catbal, disc, tran, lines, maskStamps, MASKED_STAMP, run, interestInputs, assertRefused } = cd;

const DATE = '2026-11-25';
const A1 = '00000000001';
const A2 = '00000000002';
const A3 = '00000000003';
const CARD1 = '4000000000000001';
const CARD2 = '4000000000000002';
const CARD3 = '4000000000000003';

const interest = (inputs, check, args = ['--run-date', DATE]) => run('interest', inputs, check, { args });

/** The interest transaction as the job writes it, with both timestamps masked. */
const itran = ({ n, account: acct = A1, card = CARD1, amount, date = DATE }) => tran({
  id: `${date}${String(n).padStart(6, '0')}`, type: '01', cat: '0005', source: 'System', desc: `Int. for a/c ${acct}`, amount, merchantId: '000000000',
  merchant: '', city: '', zip: '', card, orig: MASKED_STAMP, proc: MASKED_STAMP,
});

const maskedTrans = (r) => maskStamps(r.read('transact.txt'), { orig: true, proc: true });

/** Three accounts with a card each, so job inputs only need category rows and rates. */
const three = (o = {}) => ({
  accounts: [account({ id: A1 }), account({ id: A2 }), account({ id: A3 })],
  xrefs: [xref({ card: CARD1, account: A1 }), xref({ card: CARD2, account: A2 }), xref({ card: CARD3, account: A3 })],
  ...o,
});

test('I3 (reviewed rule): interest is balance times rate over 1200, cut off at 2 places toward zero, never rounded up', () => {
  const rates = ['0001', '0002', '0003', '0004', '0005'].map((cat, i) => disc({ group: 'DEFAULT', cat, rate: ['18.00', '1.00', '1.00', '24.99', '0.01'][i] }));
  const catbals = [['0001', '1234.56'], ['0002', '100.00'], ['0003', '6.00'], ['0004', '99999.99'], ['0005', '5000.00']].map(([cat, balance]) => catbal({ cat, balance }));
  interest(interestInputs({ catbals, rates }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    // 18.5184 -> 18.51, 0.0833 -> 0.08, 0.005 -> none, 2082.4997 -> 2082.49, 0.0416 -> 0.04
    assert.equal(maskedTrans(r), lines([itran({ n: 1, amount: '18.51' }), itran({ n: 2, amount: '0.08' }), itran({ n: 3, amount: '2082.49' }), itran({ n: 4, amount: '0.04' })]));
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '2201.12' })]));
  });
});

test('I3 and M1: amounts that floating point gets wrong by one cent come out exact', () => {
  const rates = [disc({ group: 'DEFAULT', cat: '0001', rate: '12.00' }), disc({ group: 'DEFAULT', cat: '0002', rate: '24.00' }), disc({ group: 'DEFAULT', cat: '0003', rate: '24.00' })];
  const catbals = [catbal({ cat: '0001', balance: '29.00' }), catbal({ cat: '0002', balance: '57.00' }), catbal({ cat: '0003', balance: '113.00' })];
  interest(interestInputs({ catbals, rates }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(maskedTrans(r), lines([itran({ n: 1, amount: '0.29' }), itran({ n: 2, amount: '1.14' }), itran({ n: 3, amount: '2.26' })]));
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '103.69' })]));
  });
});

test('I4 (reviewed rule): a zero rate, a zero balance or a balance below zero makes no interest', () => {
  const rates = [disc({ group: 'DEFAULT', cat: '0001', rate: '0.00' }), disc({ group: 'DEFAULT', cat: '0002', rate: '18.00' }), disc({ group: 'DEFAULT', cat: '0003', rate: '18.00' })];
  const catbals = [catbal({ cat: '0001', balance: '500.00' }), catbal({ cat: '0002', balance: '0.00' }), catbal({ cat: '0003', balance: '-250.00' })];
  interest(interestInputs({ catbals, rates, accounts: [account({ credit: '70.00', debit: '-5.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('transact.txt'), '');
    assert.equal(r.read('acctdata.txt'), lines([account({ credit: '0.00', debit: '0.00' })]));
    assert.deepEqual(JSON.parse(r.read('summary.json')), { interest_transactions: 0, accounts: 1 });
  });
});

test('I2: the rate of the account group is used; the DEFAULT group is the fallback', () => {
  const accounts = [account({ id: A1, group: 'A' }), account({ id: A2, group: 'B' })];
  const xrefs = [xref({ card: CARD1, account: A1 }), xref({ card: CARD2, account: A2 })];
  const rates = [disc({ group: 'DEFAULT', rate: '12.00' }), disc({ group: 'B', rate: '24.00' })];
  const catbals = [catbal({ account: A1, balance: '1000.00' }), catbal({ account: A2, balance: '1000.00' })];
  interest(interestInputs({ accounts, xrefs, rates, catbals }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(maskedTrans(r), lines([itran({ n: 1, account: A1, card: CARD1, amount: '10.00' }), itran({ n: 2, account: A2, card: CARD2, amount: '20.00' })]));
  });
});

test('I2 (reviewed rule): a rate missing for both the group and DEFAULT stops the run and writes nothing', () => {
  const rates = [disc({ group: 'B', rate: '24.00' }), disc({ group: 'DEFAULT', cat: '0002', rate: '10.00' })];
  interest(interestInputs({ rates, catbals: [catbal({ balance: '1000.00' })] }), (r) => assertRefused(assert, r));
});

test('I2: a rate for another type or category is not a match', () => {
  const rates = [disc({ group: 'DEFAULT', type: '02', cat: '0001', rate: '12.00' }), disc({ group: 'A', type: '01', cat: '0009', rate: '12.00' })];
  interest(interestInputs({ rates, catbals: [catbal({ balance: '1000.00' })] }), (r) => assertRefused(assert, r));
});

test('I1 and I6: accounts and rows go in key order, and the counter runs over the whole run', () => {
  const catbals = [
    catbal({ account: A3, balance: '1200.00' }), catbal({ account: A1, type: '02', cat: '0001', balance: '2400.00' }),
    catbal({ account: A2, balance: '3600.00' }), catbal({ account: A1, type: '01', cat: '0002', balance: '1200.00' }), catbal({ account: A1, type: '01', cat: '0001', balance: '600.00' }),
  ];
  const rates = [disc({ group: 'DEFAULT', type: '01', cat: '0001', rate: '12.00' }), disc({ group: 'DEFAULT', type: '01', cat: '0002', rate: '12.00' }), disc({ group: 'DEFAULT', type: '02', cat: '0001', rate: '12.00' })];
  interest(interestInputs({ ...three(), catbals, rates }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(maskedTrans(r), lines([
      itran({ n: 1, account: A1, card: CARD1, amount: '6.00' }), itran({ n: 2, account: A1, card: CARD1, amount: '12.00' }), itran({ n: 3, account: A1, card: CARD1, amount: '24.00' }),
      itran({ n: 4, account: A2, card: CARD2, amount: '36.00' }), itran({ n: 5, account: A3, card: CARD3, amount: '12.00' }),
    ]));
    assert.equal(r.read('acctdata.txt'), lines([account({ id: A1, balance: '142.00' }), account({ id: A2, balance: '136.00' }), account({ id: A3, balance: '112.00' })]));
  });
});

test('I6: a row that makes no interest does not use up a number in the counter', () => {
  const catbals = [catbal({ account: A1, cat: '0001', balance: '0.00' }), catbal({ account: A1, cat: '0002', balance: '1200.00' }), catbal({ account: A2, cat: '0001', balance: '-5.00' }), catbal({ account: A3, cat: '0001', balance: '1200.00' })];
  const rates = [disc({ group: 'DEFAULT', cat: '0001', rate: '12.00' }), disc({ group: 'DEFAULT', cat: '0002', rate: '12.00' })];
  interest(interestInputs({ ...three(), catbals, rates }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(maskedTrans(r), lines([itran({ n: 1, account: A1, card: CARD1, amount: '12.00' }), itran({ n: 2, account: A3, card: CARD3, amount: '12.00' })]));
  });
});

test('I5: the interest transaction has exactly the fields the interface gives, and both timestamps are the run clock', () => {
  interest(interestInputs({ catbals: [catbal({ balance: '1200.00' })], rates: [disc({ group: 'DEFAULT', rate: '12.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    const [line, ...rest] = r.read('transact.txt').split('\n');
    assert.deepEqual(rest, ['']);
    assert.equal(line.length, 350);
    assert.equal(line.slice(0, 16), `${DATE}000001`);
    assert.equal(line.slice(16, 22), '010005');
    assert.equal(line.slice(22, 32), 'System    ');
    assert.equal(line.slice(32, 132).trimEnd(), `Int. for a/c ${A1}`);
    assert.equal(line.slice(143, 152), '000000000');
    assert.equal(line.slice(152, 262).trim(), '');
    const [orig, proc] = [line.slice(278, 304), line.slice(304, 330)];
    assert.match(orig, cd.STAMP);
    assert.equal(proc, orig);
    assert.ok(Math.abs(Date.now() - new Date(orig.replace(' ', 'T')).getTime()) < 10 * 60 * 1000, `the stamp ${orig} is not the current local time`);
    assert.equal(maskedTrans(r), lines([itran({ n: 1, amount: '12.00' })]));
  });
});

test('I5: the card is the lowest card number of the account, whatever the order of the cross reference', () => {
  const xrefs = [xref({ card: '4000000000000005' }), xref({ card: '4000000000000002' }), xref({ card: '4000000000000009' }), xref({ card: '4000000000000003', account: A2 })];
  const accounts = [account({ id: A1 }), account({ id: A2 })];
  const catbals = [catbal({ account: A1, balance: '1200.00' }), catbal({ account: A2, balance: '1200.00' })];
  interest(interestInputs({ accounts, xrefs, catbals, rates: [disc({ group: 'DEFAULT', rate: '12.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(maskedTrans(r), lines([itran({ n: 1, account: A1, card: '4000000000000002', amount: '12.00' }), itran({ n: 2, account: A2, card: '4000000000000003', amount: '12.00' })]));
  });
});

test('I7: the balance rises by the interest total and both cycle fields are reset, also when the interest is zero', () => {
  const accounts = [account({ id: A1, balance: '50.00', credit: '300.00', debit: '-20.00' }), account({ id: A2, balance: '60.00', credit: '40.00', debit: '-1.00' })];
  const xrefs = [xref({ card: CARD1, account: A1 }), xref({ card: CARD2, account: A2 })];
  const catbals = [catbal({ account: A1, cat: '0001', balance: '1200.00' }), catbal({ account: A1, cat: '0002', balance: '2400.00' }), catbal({ account: A2, cat: '0001', balance: '0.00' })];
  const rates = [disc({ group: 'DEFAULT', cat: '0001', rate: '12.00' }), disc({ group: 'DEFAULT', cat: '0002', rate: '6.00' })];
  interest(interestInputs({ accounts, xrefs, catbals, rates }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('acctdata.txt'), lines([account({ id: A1, balance: '74.00' }), account({ id: A2, balance: '60.00' })]));
  });
});

test('I7: an account with no category rows is written back untouched', () => {
  const accounts = [account({ id: A2, balance: '60.00', credit: '40.00', debit: '-1.00' }), account({ id: A1 })];
  const xrefs = [xref({ card: CARD1, account: A1 })];
  interest(interestInputs({ accounts, xrefs, catbals: [catbal({ balance: '1200.00' })], rates: [disc({ group: 'DEFAULT', rate: '12.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('acctdata.txt'), lines([account({ id: A1, balance: '112.00' }), accounts[0]]));
    assert.deepEqual(JSON.parse(r.read('summary.json')), { interest_transactions: 1, accounts: 2 });
  });
});

test('I8: a category row for an account that is not in the account file stops the run', () => {
  interest(interestInputs({ catbals: [catbal({ account: A2, balance: '10.00' })] }), (r) => assertRefused(assert, r));
});

test('I8: interest due on an account with no card in the cross reference stops the run', () => {
  interest(interestInputs({ xrefs: [xref({ card: CARD2, account: A2 })], catbals: [catbal({ balance: '1200.00' })] }), (r) => assertRefused(assert, r));
});

test('I8: an account with no card is fine while it owes no interest', () => {
  interest(interestInputs({ xrefs: [], catbals: [catbal({ balance: '1200.00' })], rates: [disc({ group: 'DEFAULT', rate: '0.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('transact.txt'), '');
  });
});

test('I9: no fee is charged, so the only transactions are the interest rows', () => {
  const catbals = [catbal({ balance: '1200.00' }), catbal({ cat: '0002', balance: '1200.00' })];
  const rates = [disc({ group: 'DEFAULT', cat: '0001', rate: '12.00' }), disc({ group: 'DEFAULT', cat: '0002', rate: '12.00' })];
  interest(interestInputs({ catbals, rates }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('transact.txt').split('\n').filter(Boolean).length, 2);
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '124.00' })]));
  });
});

test('the summary, the exit code and the files of an interest run', () => {
  interest(interestInputs({ ...three(), catbals: [catbal({ account: A2, balance: '1200.00' })], rates: [disc({ group: 'DEFAULT', rate: '12.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.files, cd.INTEREST_FILES);
    assert.deepEqual(JSON.parse(r.read('summary.json')), { interest_transactions: 1, accounts: 3 });
    assert.match(r.stdout, /^interest_transactions: 1$/m);
    assert.match(r.stdout, /^accounts: 3$/m);
    assert.ok(!r.stdout.includes(CARD2) && !r.stdout.includes('12.00'));
  });
});

test('with no category rows nothing is charged and the accounts come back as they went in, in key order', () => {
  const accounts = [account({ id: A2, credit: '5.00' }), account({ id: A1 })];
  interest(interestInputs({ accounts, catbals: [] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('transact.txt'), '');
    assert.equal(r.read('acctdata.txt'), lines([accounts[1], accounts[0]]));
  });
});

test('without --run-date the ids start with today\'s date', () => {
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const before = day(new Date());
  interest(interestInputs({ catbals: [catbal({ balance: '1200.00' })], rates: [disc({ group: 'DEFAULT', rate: '12.00' })] }), (r) => {
    const after = day(new Date());
    assert.equal(r.status, 0, r.stderr);
    const prefix = r.read('transact.txt').slice(0, 10);
    assert.ok(prefix === before || prefix === after, `id prefix ${prefix}, today ${before}`);
    assert.equal(r.read('transact.txt').slice(10, 16), '000001');
  }, []);
});

test('the interest job reads what the posting job wrote', () => {
  const accounts = [account({ balance: '100.00', limit: '5000.00' })];
  run('post', cd.postInputs({ trans: [tran({ id: '0000000000000001', amount: '1000.00' }), tran({ id: '0000000000000002', amount: '-200.00' })], accounts }), (p) => {
    assert.equal(p.status, 0, p.stderr);
    const inputs = interestInputs({ accounts: [], rates: [disc({ group: 'DEFAULT', rate: '18.00' })] });
    inputs['acctdata.txt'] = p.read('acctdata.txt');
    inputs['tcatbal.txt'] = p.read('tcatbal.txt');
    interest(inputs, (r) => {
      assert.equal(r.status, 0, r.stderr);
      // category balance 800.00 at 18 percent: 12.00
      assert.equal(maskedTrans(r), lines([itran({ n: 1, amount: '12.00' })]));
      assert.equal(r.read('acctdata.txt'), lines([account({ balance: '912.00', limit: '5000.00' })]));
    });
  });
});
