// SPDX-License-Identifier: Apache-2.0
'use strict';

// Job 1, daily posting: rules P1 to P13 through the command line, output files compared byte for byte.

const test = require('node:test');
const assert = require('node:assert/strict');
const cd = require('./lib/cd.js');

const { account, xref, catbal, tran, reject, TEXT, maskStamps, MASKED_STAMP, lines, run, postInputs } = cd;

const id = (n) => String(n).padStart(16, '0');
const post = (inputs, check, options) => run('post', inputs, check, options);

/** The posted transaction as the job writes it, with the processed timestamp masked. */
const posted = (o) => tran({ ...o, proc: MASKED_STAMP });

test('P1 and P11: posted transactions keep file order, copy the daily record and get the run clock', () => {
  const oa = { id: id(3), amount: '10.00', merchant: 'Alpha', city: 'Rome', zip: '00100' };
  const ob = { id: id(1), amount: '20.00', desc: 'second line', merchantId: '000000042' };
  const oc = { id: id(2), amount: '30.00', type: '02', cat: '0003', source: 'OPERATOR' };
  post(postInputs({ trans: [tran(oa), tran(ob), tran(oc)] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(maskStamps(r.read('transact.txt')), lines([posted(oa), posted(ob), posted(oc)]));
    assert.equal(r.read('dalyrejs.txt'), '');
  });
});

/** The amount text of a transaction record, read back from its zoned field (test-side decoder). */
function amountOf(rec) {
  const field = rec.slice(132, 143);
  const last = field.slice(-1);
  const neg = '}JKLMNOPQR'.includes(last);
  const digit = neg ? '}JKLMNOPQR'.indexOf(last) : '{ABCDEFGHI'.indexOf(last);
  const cents = BigInt(field.slice(0, -1) + digit);
  const text = String(cents).padStart(3, '0');
  return `${neg ? '-' : ''}${text.slice(0, -2)}.${text.slice(-2)}`;
}

test('the processed timestamp has the form YYYY-MM-DD HH:MM:SS.ffffff and is the same for the whole run', () => {
  post(postInputs({ trans: [tran({ id: id(1) }), tran({ id: id(2) })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    const stamps = r.read('transact.txt').split('\n').filter(Boolean).map((l) => l.slice(304, 330));
    assert.equal(stamps.length, 2);
    for (const s of stamps) assert.match(s, cd.STAMP);
    assert.equal(stamps[0], stamps[1]);
    const age = Date.now() - new Date(stamps[0].replace(' ', 'T')).getTime();
    assert.ok(Math.abs(age) < 10 * 60 * 1000, `the stamp ${stamps[0]} is not the current local time`);
  });
});

test('P2, P12: a card that is not in the cross reference is rejected with code 100, and the reject record has the exact layout', () => {
  const bad = tran({ id: id(1), card: '4999999999999999', amount: '12.34' });
  post(postInputs({ trans: [bad] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(bad, 100, TEXT[100])]));
    assert.equal(r.read('dalyrejs.txt').length, 431);
    assert.equal(r.read('transact.txt'), '');
  });
});

test('P3: a card whose account is not in the account file is rejected with code 101', () => {
  const t = tran({ id: id(1), card: '4000000000000002' });
  post(postInputs({ trans: [t], xrefs: [xref(), xref({ card: '4000000000000002', account: '00000000009' })] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(t, 101, TEXT[101])]));
  });
});

test('P4: a transaction dated after the expiry date is rejected with 103; the expiry day itself is allowed', () => {
  const onDay = tran({ id: id(1), orig: '2026-12-31 23:59:59.999999' });
  const after = tran({ id: id(2), orig: '2027-01-01 00:00:00.000000' });
  const before = tran({ id: id(3), orig: '2026-12-30 12:00:00.000000' });
  post(postInputs({ trans: [onDay, after, before], accounts: [account({ expiry: '2026-12-31' })] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(after, 103, TEXT[103])]));
    assert.equal(r.read('transact.txt').split('\n').filter(Boolean).length, 2);
  });
});

test('P5: a charge that takes cycle credit plus cycle debit plus the amount over the limit is rejected with 102', () => {
  const over = tran({ id: id(1), amount: '1000.01' });
  post(postInputs({ trans: [over] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(over, 102, TEXT[102])]));
  });
});

test('P5: reaching the limit exactly is allowed', () => {
  const exact = tran({ id: id(1), amount: '1000.00' });
  post(postInputs({ trans: [exact] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), '');
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '1100.00', credit: '1000.00' })]));
  });
});

test('P5 (reviewed rule): earlier payments net against charges, the COBOL would count them as charges', () => {
  // cycle credit 900, cycle debit -300: the net is 600, so a charge of 400 reaches the limit and 400.01 passes it.
  const ok = tran({ id: id(1), amount: '400.00' });
  const no = tran({ id: id(2), amount: '0.01' });
  const accounts = [account({ credit: '900.00', debit: '-300.00' })];
  post(postInputs({ trans: [ok, no], accounts }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(no, 102, TEXT[102])]));
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '500.00', credit: '1300.00', debit: '-300.00', limit: '1000.00' })]));
  });
});

test('P5: a payment in the same run lowers the total that the next charge is tested against', () => {
  const charge = tran({ id: id(1), amount: '900.00' });
  const pay = tran({ id: id(2), amount: '-500.00' });
  const next = tran({ id: id(3), amount: '550.00' });
  const tooMuch = tran({ id: id(4), amount: '100.00' });
  post(postInputs({ trans: [charge, pay, next, tooMuch] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(tooMuch, 102, TEXT[102])]));
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '1050.00', credit: '1450.00', debit: '-500.00' })]));
  });
});

test('P5: a payment is tested like any other amount, so an account already over its limit rejects it', () => {
  const pay = tran({ id: id(1), amount: '-5.00' });
  post(postInputs({ trans: [pay], accounts: [account({ credit: '1200.00' })] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(pay, 102, TEXT[102])]));
  });
});

test('P6: the first failing check wins, so an expired account that is also over its limit reports 103', () => {
  const t = tran({ id: id(1), amount: '5000.00', orig: '2031-01-01 00:00:00.000000' });
  post(postInputs({ trans: [t] }), (r) => {
    assert.equal(r.read('dalyrejs.txt'), lines([reject(t, 103, TEXT[103])]));
  });
});

test('P6: an unknown card is reported as 100 even when the same transaction would also be over any limit', () => {
  const t = tran({ id: id(1), card: '4111111111111111', amount: '999999.99' });
  post(postInputs({ trans: [t] }), (r) => {
    assert.equal(r.read('dalyrejs.txt'), lines([reject(t, 100, TEXT[100])]));
  });
});

test('P7 (reviewed rule): a repeated id is rejected with 104 and the first one stands', () => {
  const first = tran({ id: id(7), amount: '25.00' });
  const again = tran({ id: id(7), amount: '25.00' });
  post(postInputs({ trans: [first, again] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(maskStamps(r.read('transact.txt')), lines([posted({ id: id(7), amount: '25.00' })]));
    assert.equal(r.read('dalyrejs.txt'), lines([reject(again, 104, TEXT[104])]));
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '125.00', credit: '25.00' })]));
  });
});

test('P7: the id counts as seen even when the first transaction was rejected, and it is checked before everything else', () => {
  const first = tran({ id: id(7), card: '4999999999999999' });
  const again = tran({ id: id(7) });
  post(postInputs({ trans: [first, again] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('transact.txt'), '');
    assert.equal(r.read('dalyrejs.txt'), lines([reject(first, 100, TEXT[100]), reject(again, 104, TEXT[104])]));
  });
});

test('P7: a repeated id with an unknown card and an expired date still reports 104', () => {
  const first = tran({ id: id(8) });
  const again = tran({ id: id(8), card: '4999999999999999', orig: '2040-01-01 00:00:00.000000' });
  post(postInputs({ trans: [first, again] }), (r) => {
    assert.equal(r.read('dalyrejs.txt'), lines([reject(again, 104, TEXT[104])]));
  });
});

test('P8: charges go to cycle credit, payments to cycle debit as a negative number, and both change the balance', () => {
  const trans = [tran({ id: id(1), amount: '120.50' }), tran({ id: id(2), amount: '-30.25' }), tran({ id: id(3), amount: '0.00' }), tran({ id: id(4), amount: '-0.05' })];
  post(postInputs({ trans, accounts: [account({ credit: '10.00', debit: '-1.00', balance: '200.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '290.20', credit: '130.50', debit: '-31.30' })]));
  });
});

test('M2: all ten last digits of a zoned number, positive and negative, are read and written back', () => {
  const amounts = ['0.00', '0.01', '0.02', '0.03', '0.04', '0.05', '0.06', '0.07', '0.08', '0.09', '-0.01', '-0.02', '-0.03', '-0.04', '-0.05', '-0.06', '-0.07', '-0.08', '-0.09', '-0.10'];
  const trans = amounts.map((amount, i) => tran({ id: id(i + 1), amount }));
  post(postInputs({ trans, accounts: [account({ balance: '0.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    const out = r.read('transact.txt').split('\n').filter(Boolean).map((l) => amountOf(l));
    assert.deepEqual(out, amounts);
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '-0.10', credit: '0.45', debit: '-0.55' })]));
  });
});

test('M1: many small amounts add up exactly, with no floating point drift', () => {
  const trans = Array.from({ length: 300 }, (_, i) => tran({ id: id(i + 1), amount: '0.10' }));
  post(postInputs({ trans, accounts: [account({ balance: '0.00' })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '30.00', credit: '30.00' })]));
    assert.equal(r.read('tcatbal.txt'), lines([catbal({ balance: '30.00' })]));
  });
});

test('P9: the category balance row is created at zero when it is missing and updated when it exists', () => {
  const trans = [tran({ id: id(1), amount: '10.00' }), tran({ id: id(2), type: '02', cat: '0003', amount: '-4.00' }), tran({ id: id(3), amount: '5.00' })];
  const catbals = [catbal({ balance: '100.00' })];
  post(postInputs({ trans, catbals }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('tcatbal.txt'), lines([catbal({ balance: '115.00' }), catbal({ type: '02', cat: '0003', balance: '-4.00' })]));
  });
});

test('P9: the category balance is kept per account, type and category', () => {
  const trans = [tran({ id: id(1), amount: '1.00' }), tran({ id: id(2), card: '4000000000000002', amount: '2.00' }), tran({ id: id(3), type: '01', cat: '0002', amount: '4.00' })];
  const xrefs = [xref(), xref({ card: '4000000000000002', account: '00000000002' })];
  const accounts = [account(), account({ id: '00000000002' })];
  post(postInputs({ trans, xrefs, accounts }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('tcatbal.txt'), lines([catbal({ balance: '1.00' }), catbal({ cat: '0002', balance: '4.00' }), catbal({ account: '00000000002', balance: '2.00' })]));
  });
});

test('P10: a rejected transaction changes no balance and no category row, and rejects are kept in order', () => {
  const a = tran({ id: id(1), card: '4999999999999999', amount: '50.00' });
  const b = tran({ id: id(2), amount: '2000.00' });
  const c = tran({ id: id(3), orig: '2035-01-01 00:00:00.000000' });
  const accounts = [account({ credit: '1.00', debit: '-2.00', balance: '77.00' })];
  const catbals = [catbal({ balance: '9.00' })];
  post(postInputs({ trans: [a, b, c], accounts, catbals }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('acctdata.txt'), lines(accounts));
    assert.equal(r.read('tcatbal.txt'), lines(catbals));
    assert.equal(r.read('transact.txt'), '');
    assert.equal(r.read('dalyrejs.txt'), lines([reject(a, 100, TEXT[100]), reject(b, 102, TEXT[102]), reject(c, 103, TEXT[103])]));
  });
});

test('P1: each transaction sees the state left by the one before it', () => {
  const trans = [tran({ id: id(1), amount: '600.00' }), tran({ id: id(2), amount: '600.00' }), tran({ id: id(3), amount: '400.00' })];
  post(postInputs({ trans }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.equal(r.read('dalyrejs.txt'), lines([reject(trans[1], 102, TEXT[102])]));
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '1100.00', credit: '1000.00' })]));
  });
});

test('two cards of one account post to the same account', () => {
  const trans = [tran({ id: id(1), amount: '10.00' }), tran({ id: id(2), card: '4000000000000002', amount: '20.00' })];
  const xrefs = [xref(), xref({ card: '4000000000000002', customer: '000000001' })];
  post(postInputs({ trans, xrefs }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '130.00', credit: '30.00' })]));
  });
});

test('output accounts and category rows are in key order, untouched rows included', () => {
  const accounts = [account({ id: '00000000003', balance: '3.00' }), account({ id: '00000000001' }), account({ id: '00000000002', balance: '2.00' })];
  const catbals = [catbal({ account: '00000000002', balance: '5.00' }), catbal({ account: '00000000001', type: '02', cat: '0001', balance: '1.00' }), catbal({ account: '00000000001', balance: '2.00' })];
  const trans = [tran({ id: id(1), amount: '1.00' })];
  post(postInputs({ trans, accounts, catbals }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.read('acctdata.txt'), lines([account({ balance: '101.00', credit: '1.00' }), accounts[2], accounts[0]]));
    assert.equal(r.read('tcatbal.txt'), lines([catbal({ account: '00000000001', balance: '3.00' }), catbals[1], catbals[0]]));
  });
});

test('P13: the summary has the counts, the exit code is 0 with no rejects and 4 with any', () => {
  const trans = [tran({ id: id(1) }), tran({ id: id(2), card: '4999999999999999' }), tran({ id: id(3) })];
  post(postInputs({ trans }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    assert.deepEqual(JSON.parse(r.read('summary.json')), { processed: 3, posted: 2, rejected: 1 });
    assert.deepEqual(r.files, cd.POST_FILES);
    assert.match(r.stdout, /^rejected: 1$/m);
    assert.match(r.stdout, /^processed: 3$/m);
    assert.match(r.stdout, /^posted: 2$/m);
  });
  post(postInputs({ trans: [tran({ id: id(1) })] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.read('summary.json')), { processed: 1, posted: 1, rejected: 0 });
  });
});

test('an empty daily file posts nothing, exits 0 and writes the other files as they came in', () => {
  const accounts = [account({ id: '00000000002' }), account()];
  const catbals = [catbal({ balance: '8.00' })];
  post(postInputs({ trans: [], accounts, catbals }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.read('summary.json')), { processed: 0, posted: 0, rejected: 0 });
    assert.equal(r.read('acctdata.txt'), lines([accounts[1], accounts[0]]));
    assert.equal(r.read('tcatbal.txt'), lines(catbals));
    assert.equal(r.read('transact.txt'), '');
    assert.equal(r.read('dalyrejs.txt'), '');
  });
});

test('the output never shows a card number or an amount on standard output', () => {
  post(postInputs({ trans: [tran({ id: id(1), card: '4999999999999999', amount: '12.34' })] }), (r) => {
    assert.equal(r.status, 4, r.stderr);
    for (const secret of ['4999999999999999', '4000000000000001', '12.34', '1234']) assert.ok(!r.stdout.includes(secret), `stdout shows ${secret}`);
  });
});
