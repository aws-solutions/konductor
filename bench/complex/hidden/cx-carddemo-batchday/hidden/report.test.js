// SPDX-License-Identifier: Apache-2.0
'use strict';

// Job 3, the daily transaction report (CBTRN03C): rules R1 to R5 and what the COBOL does where they are silent.
// Expected reports are written line by line from the COBOL pictures (lib/day.js), then compared byte for byte.

const test = require('node:test');
const assert = require('node:assert/strict');
const cd = require('./lib/cd.js');
const d = require('./lib/day.js');

const { xref, account, run, assertRefused } = cd;
const START = '2026-11-01';
const END = '2026-11-30';

const report = (inputs, check, { start = START, end = END, ...options } = {}) => run('report', inputs, check, { args: ['--start', start, '--end', end], ...options });

/** A posted transaction on the default card with id number `n`. */
const t = (n, amount = '1.00', o = {}) => d.posted({ id: d.tid(n), amount, ...o });

/** Run on `trans` (and `xrefs`) and return report.txt as lines (each must be 133 characters). */
function lines(trans, extra = {}) {
  let out;
  report(d.reportInputs({ trans, ...extra }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    out = r.read('report.txt').split('\n');
    assert.equal(out.pop(), '', 'the file ends with a newline');
  });
  return out;
}

const BASE = [xref({ card: '4000000000000001', account: '00000000001' }), xref({ card: '4000000000000002', account: '00000000002' })];
const card2 = { card: '4000000000000002' };

test('R1 to R5: one transaction gives headings, the line, an account total, a page total and a grand total', () => {
  const got = lines([t(1, '12.30')]);
  assert.deepEqual(got, [...d.headings(START, END), d.detailOf(d.tid(1), '12.30'), d.accountTotal('12.30'), d.RULE, d.pageTotal('12.30'), d.RULE, d.grandTotal('12.30')]);
});

test('every report line is 133 characters and the run prints its count and nothing else about the data', () => {
  report(d.reportInputs({ trans: [t(1, '12.30'), t(2, '5.00')] }), (r) => {
    assert.equal(r.status, 0, r.stderr);
    for (const l of r.read('report.txt').split('\n').filter((x, i, a) => i < a.length - 1)) assert.equal(l.length, 133);
    assert.deepEqual(r.files, ['report.txt', 'summary.json']);
    assert.deepEqual(JSON.parse(r.read('summary.json')), { detail_lines: 2 });
    assert.match(r.stdout, /^detail_lines: 2$/m);
    assert.doesNotMatch(r.stdout + r.stderr, /12\.30|4000000000000001/);
  });
});

test('R1: both dates are in the range, by the date of the processed timestamp', () => {
  const got = lines([t(1, '1.00', { procDate: '2026-10-31' }), t(2, '2.00', { procDate: '2026-11-01' }), t(3, '3.00', { procDate: '2026-11-30' }), t(4, '4.00', { procDate: '2026-12-01' })]);
  assert.deepEqual(got.filter((l) => /^000000000000000\d /.test(l)).map((l) => l.slice(0, 16)), [d.tid(2), d.tid(3)]);
  assert.equal(got.at(-1), d.grandTotal('5.00'));
});

test('R1: the range is tested on the processed date, not the date the purchase was made', () => {
  const got = lines([t(1, '1.00', { orig: '2026-11-15 10:00:00.000000', procDate: '2026-12-15' }), t(2, '2.00', { orig: '2026-09-15 10:00:00.000000', procDate: '2026-11-15' })]);
  assert.deepEqual(got.filter((l) => /^0000000000000\d\d\d /.test(l)).map((l) => l.slice(0, 16)), [d.tid(2)]);
});

test('R1: a transaction outside the range is skipped and the report goes on with the next one', () => {
  const got = lines([t(1, '1.00'), t(2, '2.00', { procDate: '2026-09-01' }), t(3, '4.00')]);
  assert.deepEqual(got, [...d.headings(START, END), d.detailOf(d.tid(1), '1.00'), d.detailOf(d.tid(3), '4.00'), d.accountTotal('5.00'), d.RULE, d.pageTotal('5.00'), d.RULE, d.grandTotal('5.00')]);
});

test('R1: a first transaction outside the range does not end the report', () => {
  const got = lines([t(1, '9.00', { procDate: '2026-01-01' }), t(2, '2.50')]);
  assert.equal(got.at(-1), d.grandTotal('2.50'));
  assert.ok(got.includes(d.detailOf(d.tid(2), '2.50')));
});

test('R1: --start after --end, a missing date and a bad date are usage errors that write nothing', () => {
  const inputs = d.reportInputs({ trans: [t(1)] });
  for (const args of [['--start', END, '--end', START], ['--start', START], ['--end', END], ['--start', '2026-13-01', '--end', END], ['--start', START, '--end', '30/11/2026']]) {
    run('report', inputs, (r) => {
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.equal(r.exists, false);
      assert.deepEqual(r.siblings, ['in']);
    }, { args });
  }
});

test('R1: --start and --end belong to report only', () => {
  run('post', cd.postInputs(), (r) => assert.equal(r.status, 2, r.stderr), { args: ['--start', START, '--end', END] });
  run('statements', d.statementInputs(), (r) => assert.equal(r.status, 2, r.stderr), { args: ['--start', START, '--end', END] });
});

test('R2: the account total of the last account is written before the page total, and the grand total is every amount once', () => {
  const got = lines([t(1, '10.00'), t(2, '20.00'), t(3, '7.25', card2)], { xrefs: BASE });
  assert.equal(got.at(-5), d.accountTotal('7.25'));
  assert.equal(got.at(-4), d.RULE);
  assert.equal(got.at(-3), d.pageTotal('37.25'));
  assert.equal(got.at(-2), d.RULE);
  assert.equal(got.at(-1), d.grandTotal('37.25'));
});

test('the account total comes when the card changes, and each card has its own', () => {
  const got = lines([t(1, '10.00'), t(2, '20.00'), t(3, '7.25', card2)], { xrefs: BASE });
  assert.deepEqual(got.slice(4), [d.detailOf(d.tid(1), '10.00'), d.detailOf(d.tid(2), '20.00'), d.accountTotal('30.00'), d.RULE,
    d.detail({ id: d.tid(3), acct: '00000000002', type: '01', typeDesc: 'Purchase', cat: '0001', catDesc: 'Regular Sales Draft', amount: '7.25' }),
    d.accountTotal('7.25'), d.RULE, d.pageTotal('37.25'), d.RULE, d.grandTotal('37.25')]);
});

test('a card that comes back later in the file starts a new account total (the break is on a change of card)', () => {
  const got = lines([t(1, '1.00'), t(2, '2.00', card2), t(3, '4.00')], { xrefs: BASE });
  assert.equal(got.filter((l) => l.startsWith('Account Total')).length, 3);
  assert.equal(got.at(-1), d.grandTotal('7.00'));
});

test('R3: nothing in the range gives one set of headings and zero page and grand totals', () => {
  const want = [...d.headings(START, END), d.pageTotal('0.00'), d.RULE, d.grandTotal('0.00')];
  assert.deepEqual(lines([t(1, '5.00', { procDate: '2026-02-02' })]), want);
  assert.deepEqual(lines([]), want);
});

test('R4: a card missing from the cross reference stops the run and writes nothing', () => {
  report(d.reportInputs({ trans: [t(1), t(2, '1.00', { card: '4999999999999999' })] }), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /cardxref\.txt/);
    assert.doesNotMatch(r.stderr, /4999999999999999/);
  });
});

test('R4: a type or a category missing from its file stops the run and names the file', () => {
  report(d.reportInputs({ trans: [t(1, '1.00', { type: '07' })] }), (r) => assert.match(assertRefused(assert, r).stderr, /trantype\.txt/));
  report(d.reportInputs({ trans: [t(1, '1.00', { cat: '0009' })] }), (r) => assert.match(assertRefused(assert, r).stderr, /trancatg\.txt/));
});

test('a transaction outside the range is not looked up, so its unknown card does not stop the run', () => {
  const got = lines([t(1, '3.00'), t(2, '9.00', { card: '4999999999999999', procDate: '2026-01-01' })]);
  assert.equal(got.at(-1), d.grandTotal('3.00'));
});

test('the account id comes from the cross reference and the descriptions are cut at 15 and 29 characters', () => {
  const types = [d.trantype('01', 'Purchase of everything under the sun')];
  const cats = [d.trancat('01', '0001', 'A category with a name much longer than 29')];
  const got = lines([t(1, '2.00')], { xrefs: [xref({ account: '00000000042' })], types, cats });
  assert.equal(got[4], d.detail({ id: d.tid(1), acct: '00000000042', type: '01', typeDesc: 'Purchase of everything under the sun', cat: '0001', catDesc: 'A category with a name much longer than 29', amount: '2.00' }));
  assert.equal(got[4].slice(32, 47), 'Purchase of eve');
  assert.equal(got[4].slice(53, 82), 'A category with a name much l');
});

test('R5: edited amounts keep the picture widths, the sign place and the last integer digit', () => {
  const amounts = ['0.05', '-12.30', '1234567.89', '0.00', '100.00', '-0.99'];
  const got = lines(amounts.map((a, i) => t(i + 1, a)));
  amounts.forEach((a, i) => assert.equal(got[4 + i], d.detailOf(d.tid(i + 1), a)));
  assert.equal(got[4].slice(97, 112), '           0.05');
  assert.equal(got[5].slice(97, 112), '-         12.30');
  assert.equal(got[6].slice(97, 112), '   1,234,567.89');
  const total = d.sum(amounts);
  assert.equal(total, '1234654.65');
  assert.equal(got.at(-1), d.grandTotal(total));
});

test('R5: a negative total shows the minus in the first place of the total picture', () => {
  const got = lines([t(1, '-30.00', { type: '02', cat: '0001' }), t(2, '5.50')]);
  assert.equal(got.at(-1), d.grandTotal('-24.50'));
  assert.equal(got.at(-1).slice(97, 112), '-         24.50');
});

test('R5: a total over 999,999,999.99 does not fit its picture and stops the run', () => {
  report(d.reportInputs({ trans: [t(1, '900000000.00'), t(2, '900000000.00')] }), (r) => assertRefused(assert, r));
});

test('page break: a page ends when the line count reaches a multiple of 20, and the headings are written again', () => {
  const trans = Array.from({ length: 17 }, (_, i) => t(i + 1));
  const got = lines(trans);
  const rows = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => d.detailOf(d.tid(from + i), '1.00'));
  assert.deepEqual(got, [...d.headings(START, END), ...rows(1, 16), d.pageTotal('16.00'), d.RULE, ...d.headings(START, END), ...rows(17, 17),
    d.accountTotal('17.00'), d.RULE, d.pageTotal('1.00'), d.RULE, d.grandTotal('17.00')]);
});

test('page break: every line counts, so the second page is shorter and the third falls 14 lines later', () => {
  const got = lines(Array.from({ length: 31 }, (_, i) => t(i + 1)));
  const pages = got.map((l, i) => (l.startsWith('Page Total') ? i : -1)).filter((i) => i >= 0);
  assert.equal(pages.length, 3);
  const detailsBetween = (a, b) => got.slice(a, b).filter((l) => /^\d{16} /.test(l)).length;
  assert.deepEqual([detailsBetween(0, pages[0]), detailsBetween(pages[0], pages[1]), detailsBetween(pages[1], pages[2])], [16, 14, 1]);
  assert.equal(got[pages[0]], d.pageTotal('16.00'));
  assert.equal(got[pages[1]], d.pageTotal('14.00'));
  assert.equal(got[pages[2]], d.pageTotal('1.00'));
  assert.equal(got.at(-1), d.grandTotal('31.00'));
});

test('page break: an account total that lands the count on 20 breaks before the next card', () => {
  const a = Array.from({ length: 14 }, (_, i) => t(i + 1));
  const got = lines([...a, t(100, '2.00', card2)], { xrefs: BASE });
  const at = got.findIndex((l) => l.startsWith('Account Total'));
  assert.deepEqual(got.slice(at, at + 5), [d.accountTotal('14.00'), d.RULE, d.pageTotal('14.00'), d.RULE, ...d.headings(START, END)].slice(0, 5));
  assert.deepEqual(got.slice(at + 5, at + 8), [...d.headings(START, END).slice(1)]);
});

test('page break: an account total that steps over a count of 20 does not break', () => {
  const a = Array.from({ length: 15 }, (_, i) => t(i + 1));
  const got = lines([...a, t(100, '1.00', card2), t(101, '1.00', card2), t(102, '1.00', card2)], { xrefs: BASE });
  assert.equal(got.filter((l) => l.startsWith('Page Total')).length, 1, 'only the final page total');
  assert.equal(got.filter((l) => l.startsWith('DALYREPT')).length, 1);
  assert.equal(got.at(-3), d.pageTotal('18.00'));
});

test('the page total counts only its own page, and the grand total adds the page totals', () => {
  const got = lines(Array.from({ length: 20 }, (_, i) => t(i + 1, `${i + 1}.00`)));
  const totals = got.filter((l) => l.startsWith('Page Total'));
  assert.deepEqual(totals, [d.pageTotal(d.sum(Array.from({ length: 16 }, (_, i) => `${i + 1}.00`))), d.pageTotal(d.sum(['17.00', '18.00', '19.00', '20.00']))]);
  assert.equal(got.at(-1), d.grandTotal('210.00'));
});

test('two cards of one account keep an account total each', () => {
  const both = [xref({ card: '4000000000000001' }), xref({ card: '4000000000000002', account: '00000000001' })];
  const got = lines([t(1, '1.00'), t(2, '2.00', card2)], { xrefs: both });
  assert.equal(got.filter((l) => l.startsWith('Account Total')).length, 2);
  assert.equal(got.filter((l) => /^\d{16} 00000000001 /.test(l)).length, 2);
});

test('bad input: a missing file, a repeated key and a bad record stop the run with exit 2 and write nothing', () => {
  const ok = d.reportInputs({ trans: [t(1)] });
  for (const drop of ['transact.txt', 'cardxref.txt', 'trantype.txt', 'trancatg.txt']) {
    const { [drop]: gone, ...rest } = ok;
    report(rest, (r) => assert.match(assertRefused(assert, r).stderr, new RegExp(drop.replace('.', '\\.'))));
  }
  report({ ...ok, 'trantype.txt': cd.lines([d.trantype('01', 'Purchase'), d.trantype('01', 'Again')]) }, (r) => assertRefused(assert, r));
  report({ ...ok, 'trancatg.txt': cd.lines([d.trancat('01', '0001', 'A'), d.trancat('01', '0001', 'B')]) }, (r) => assertRefused(assert, r));
  report({ ...ok, 'trancatg.txt': cd.lines([d.trancat('01', '00x1', 'A')]) }, (r) => assertRefused(assert, r));
  report({ ...ok, 'transact.txt': `${t(1).slice(0, 349)}\n${t(2)}X\n` }, (r) => assert.match(assertRefused(assert, r).stderr, /transact\.txt line 2/));
});

test('a non-empty output directory is refused and left as it was', () => {
  report(d.reportInputs({ trans: [t(1)] }), (r) => {
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(r.files, ['keep.txt']);
  }, { prepare: (inDir, outDir) => { require('node:fs').mkdirSync(outDir); require('node:fs').writeFileSync(`${outDir}/keep.txt`, 'x'); } });
});

test('the input files are not changed by a report run', () => {
  const inputs = d.reportInputs({ trans: [t(1), t(2, '3.00', card2)], xrefs: BASE });
  report(inputs, (r) => {
    assert.equal(r.status, 0, r.stderr);
    for (const [name, text] of Object.entries(inputs)) assert.equal(require('node:fs').readFileSync(`${r.inDir}/${name}`, 'utf8'), text);
  });
});
