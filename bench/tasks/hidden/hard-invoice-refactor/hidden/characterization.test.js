'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { renderReport } = require('../src');
const { renderReport: direct } = require('../src/report');

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const byName = new Map(cases.map((c) => [c.name, c]));

function group(title, names) {
  test(title, () => {
    for (const name of names) {
      const c = byName.get(name);
      assert.ok(c, `unknown case ${name}`);
      const got = c.options ? renderReport(c.invoice, c.options) : renderReport(c.invoice);
      assert.equal(got, c.expected, name);
    }
  });
}

test('renderReport is exported from the package entry and from src/report', () => {
  assert.equal(typeof renderReport, 'function');
  assert.equal(direct, renderReport);
});

group('the sample invoices render byte for byte as before', ['fixture basic', 'fixture discounted', 'fixture yen', 'fixture credit']);
group('rounding follows Math.round on the float product', [
  'half cent rounds down through float error', 'half cent 2.675', 'negative half cent rounds toward positive infinity',
  'negative zero never prints a sign', 'yen rounding and discount', 'fraction quantity and zero price',
]);
group('tax is rounded once on the taxable sum', [
  'tax rounded once on the taxable sum', 'tax skips non taxable lines', 'canadian rate', 'unknown country pays no tax', 'pound with tax and shipping',
]);
group('the customer block handles missing data', ['no customer', 'customer without country and with empty vat id', 'customer without name']);
group('discount rows and rounding', ['discount rounding', 'discount 100 percent and 0 percent', 'negative discount is a surcharge row']);
group('shipping is waived only above a subtotal of 100', [
  'shipping not waived at exactly 100', 'shipping waived above 100', 'shipping charged below 100', 'shipping on a credit note', 'zero shipping hides the row',
]);
group('descriptions, skus and sorting keep their quirks', [
  'description length 28 and 29', 'unicode and emoji descriptions', 'long sku overflows its column', 'sku sort is by code unit and stable', 'empty lines',
]);
group('currency symbols and grouping', ['thousands separators', 'unknown currency falls back to the code', 'lower case currency code', 'missing currency means USD']);
group('notes wrap at 60 columns with the same edge cases', [
  'notes wrap at 60 columns', 'notes with blank and spaced input', 'empty and whitespace notes',
  'a first word longer than 60 characters', 'a word of exactly 60 characters then another',
]);
group('the width option', ['width 60', 'width 100', 'width 45 leaves no amount column']);
group('issue dates are shown in UTC and bad dates keep their output', [
  'missing issue date', 'unparsable issue date', 'issue date with an offset is shown in UTC', 'leap day',
]);
