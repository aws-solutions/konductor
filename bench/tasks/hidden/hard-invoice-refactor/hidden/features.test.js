'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderReport } = require('../src');

const L = (sku, description, qty, unitPrice, extra = {}) => ({ sku, description, qty, unitPrice, ...extra });
const inv = (over = {}) => ({
  number: 'N-1', customer: { name: 'Acme', country: 'US' }, currency: 'USD', issuedAt: '2025-05-05T10:00:00Z',
  lines: [L('A', 'Item', 1, 10)], ...over,
});
const csv = (invoice) => renderReport(invoice, { format: 'csv' });
const rows = (text) => text.split('\r\n').slice(0, -1);

test('the default format is text and format text is the same', () => {
  const i = inv({ notes: 'hello there' });
  assert.equal(renderReport(i, { format: 'text' }), renderReport(i));
  assert.equal(renderReport(i, { format: undefined, width: 60 }), renderReport(i, { width: 60 }));
});

test('any other format throws RangeError', () => {
  for (const format of ['pdf', 'CSV', '', 42, null]) {
    assert.throws(() => renderReport(inv(), { format }), RangeError, String(format));
  }
});

test('csv of a simple invoice', () => {
  assert.equal(csv(inv({ lines: [L('B', 'Second', 2, 4.5), L('A', 'First', 1, 10)] })),
    'sku,description,qty,unit_price,discount,net\r\nA,First,1,10.00,0.00,10.00\r\nB,Second,2,4.50,0.00,9.00\r\n'
    + 'subtotal,,,,,19.00\r\ntax,,,,,0.00\r\nshipping,,,,,0.00\r\ntotal,,,,,19.00\r\n');
});

test('csv rows follow the text report order and keep equal skus in input order', () => {
  const r = rows(csv(inv({ lines: [L('b', 'lower', 1, 1), L('B', 'upper 1', 1, 2), L('B', 'upper 2', 1, 3), L('a', 'first', 1, 4)] })));
  assert.deepEqual(r.slice(1, 5).map((x) => x.split(',')[1]), ['upper 1', 'upper 2', 'first', 'lower']);
});

test('csv quotes fields with commas, quotes and line breaks', () => {
  const r = csv(inv({ lines: [L('A,1', 'Cable, 2m "black"', 1, 5), L('B', 'two\nlines', 1, 1), L('C', 'carriage\rreturn', 1, 1), L('D', 'plain', 1, 1)] }));
  assert.ok(r.includes('"A,1","Cable, 2m ""black""",1,5.00,0.00,5.00\r\n'));
  assert.ok(r.includes('B,"two\nlines",1,1.00,0.00,1.00\r\n'));
  assert.ok(r.includes('C,"carriage\rreturn",1,1.00,0.00,1.00\r\n'));
  assert.ok(r.includes('D,plain,1,1.00,0.00,1.00\r\n'));
});

test('csv passes unicode through unchanged', () => {
  assert.ok(csv(inv({ lines: [L('A', 'Caf\u00e9 \u65e5\u672c\u8a9e \u{1F389}', 1, 2)] })).includes('A,Caf\u00e9 \u65e5\u672c\u8a9e \u{1F389},1,2.00,0.00,2.00\r\n'));
});

test('csv shows the discount amount as a positive number', () => {
  const r = rows(csv(inv({ lines: [L('S', 'Support', 1, 1200, { discountPct: 12.5 })] })));
  assert.equal(r[1], 'S,Support,1,1200.00,150.00,1050.00');
  assert.equal(r[2], 'subtotal,,,,,1050.00');
});

test('csv amounts have no symbol and no thousands separator', () => {
  const r = rows(csv(inv({ currency: 'GBP', lines: [L('A', 'big', 1, 1234567.5)] })));
  assert.equal(r[1], 'A,big,1,1234567.50,0.00,1234567.50');
});

test('csv uses zero decimals for yen', () => {
  const r = rows(csv(inv({ currency: 'JPY', customer: { name: 'J', country: 'JP' }, shipping: 800, lines: [L('P', 'Bearing', 12, 1480)] })));
  assert.deepEqual(r, ['sku,description,qty,unit_price,discount,net', 'P,Bearing,12,1480,0,17760',
    'subtotal,,,,,17760', 'tax,,,,,1776', 'shipping,,,,,0', 'total,,,,,19536']);
});

test('csv prints negative amounts with a minus sign and qty as given', () => {
  const r = rows(csv(inv({ lines: [L('R', 'Returned', -3, 2.5), L('S', 'Half', 0.5, 4)] })));
  assert.equal(r[1], 'R,Returned,-3,2.50,0.00,-7.50');
  assert.equal(r[2], 'S,Half,0.5,4.00,0.00,2.00');
  assert.equal(r[3], 'subtotal,,,,,-5.50');
});

test('csv never prints negative zero', () => {
  const text = csv(inv({ lines: [L('A', 'tiny', 1, -0.001)] }));
  assert.ok(!text.includes('-0'));
  assert.ok(text.includes('A,tiny,1,0.00,0.00,0.00\r\n'));
});

test('csv tax applies to taxable lines only and shipping shows the amount charged', () => {
  const r = rows(csv(inv({ customer: { name: 'D', country: 'DE' }, shipping: 5, lines: [L('A', 'a', 1, 50), L('B', 'b', 1, 30, { taxable: false })] })));
  assert.deepEqual(r.slice(3), ['subtotal,,,,,80.00', 'tax,,,,,9.50', 'shipping,,,,,5.00', 'total,,,,,94.50']);
});

test('csv shipping is 0.00 when waived or absent', () => {
  assert.ok(csv(inv({ shipping: 9.5, lines: [L('A', 'a', 1, 100.01)] })).includes('shipping,,,,,0.00\r\n'));
  assert.ok(csv(inv()).includes('shipping,,,,,0.00\r\n'));
  assert.ok(csv(inv({ shipping: 9.5 })).includes('shipping,,,,,9.50\r\n'));
});

test('csv of an invoice without lines has only the header and the summary', () => {
  assert.deepEqual(rows(csv(inv({ lines: [] }))), ['sku,description,qty,unit_price,discount,net',
    'subtotal,,,,,0.00', 'tax,,,,,0.00', 'shipping,,,,,0.00', 'total,,,,,0.00']);
});

test('csv ends every row with CRLF and nothing after the last one', () => {
  const text = csv(inv());
  assert.ok(text.endsWith('total,,,,,10.00\r\n'));
  assert.ok(!text.endsWith('\r\n\r\n'));
  assert.ok(!text.replace(/\r\n/g, '').includes('\n'));
});

test('euro amounts in the text report use a dot for thousands and a comma before the cents', () => {
  const text = renderReport(inv({ currency: 'EUR', lines: [L('A', 'Server', 1, 1234567.89), L('B', 'Cable', 3, 0.05)] }));
  for (const s of ['1.234.567,89 \u20ac', '0,15 \u20ac', '1.234.568,04 \u20ac']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('EUR'));
});

test('negative and zero euro amounts', () => {
  const text = renderReport(inv({ currency: 'EUR', lines: [L('A', 'Refund', -1, 12.3), L('B', 'Free', 1, 0)] }));
  assert.ok(text.includes('-12,30 \u20ac'));
  assert.ok(text.includes('0,00 \u20ac'));
  assert.ok(!text.includes('-0,00'));
});

test('euro rows stay aligned to the report width', () => {
  const text = renderReport(inv({ currency: 'EUR', customer: { name: 'D', country: 'DE' }, shipping: 4.5, lines: [L('A', 'Widget', 2, 19.99)] }));
  const lines = text.trimEnd().split('\n');
  const money = lines.filter((l) => l.endsWith('\u20ac'));
  assert.equal(money.length, 5);
  for (const l of money) assert.equal(l.length, 72, l);
  assert.ok(lines.some((l) => l.startsWith('Tax (19%)') && l.endsWith('7,60 \u20ac')));
  assert.ok(lines.some((l) => l.startsWith('Total') && l.endsWith('52,08 \u20ac')));
});

test('euro formatting in csv is plain', () => {
  assert.ok(csv(inv({ currency: 'EUR', lines: [L('A', 'a', 1, 1234.5)] })).includes('A,a,1,1234.50,0.00,1234.50\r\n'));
});

test('other currencies keep their text format', () => {
  const t = renderReport(inv({ currency: 'GBP', lines: [L('A', 'a', 1, 1234.5)] }));
  assert.ok(t.includes('\u00a31,234.50'));
  assert.ok(renderReport(inv({ currency: 'CHF', lines: [L('A', 'a', 1, 1234.5)] })).includes('CHF 1,234.50'));
});
