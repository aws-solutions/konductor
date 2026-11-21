'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ROOT = fs.existsSync(path.join(__dirname, 'src')) ? __dirname : path.dirname(__dirname);
const { calculateOrder, loadConfig } = require(path.join(ROOT, 'src'));
const one = (unitPrice, quantity = 1, sku = 'sample') => ({ sku, unitPrice, quantity });

function quote(input, expected) {
  assert.deepEqual(calculateOrder(input), expected);
}

test('keeps the default Harbor quote taxable', () => {
  quote({ lines: [one(8.5, 2)] }, {
    subtotal: 17, discount: 0, shipping: 4.99, tax: 1.4, total: 23.39
  });
});

test('applies WELCOME10 to the basket before Meadow tax', () => {
  quote({ lines: [one(20, 2)], promoCode: 'WELCOME10', region: 'meadow' }, {
    subtotal: 40, discount: 4, shipping: 4.99, tax: 0, total: 40.99
  });
});

test('applies BASKET5 at its minimum basket', () => {
  quote({ lines: [one(25)], promoCode: 'BASKET5', region: 'meadow' }, {
    subtotal: 25, discount: 5, shipping: 4.99, tax: 0, total: 24.99
  });
});

test('does not apply BASKET5 below its minimum', () => {
  quote({ lines: [one(24.99)], promoCode: 'BASKET5', region: 'ridge' }, {
    subtotal: 24.99, discount: 0, shipping: 4.99, tax: 1.5, total: 31.48
  });
});

// The promo branch ignores an unknown code and the request is silent, so rejecting it or ignoring it are both right;
// giving a discount for it is not.
test('never discounts an unknown promotion code', () => {
  assert.equal(calculateOrder({ lines: [one(10)], promoCode: 'WELCOME10', region: 'meadow' }).discount, 1);
  let result;
  try {
    result = calculateOrder({ lines: [one(10)], promoCode: 'NOT-A-CODE', region: 'meadow' });
  } catch (error) {
    assert.match(String(error && error.message), /promo/i);
    return;
  }
  assert.equal(result.discount, 0);
  assert.equal(result.total, 14.99);
});

test('does not tax Harbor shipping', () => {
  quote({ lines: [one(20)], region: 'harbor' }, {
    subtotal: 20, discount: 0, shipping: 4.99, tax: 1.65, total: 26.64
  });
});

test('taxes Ridge shipping as part of the base', () => {
  quote({ lines: [one(10)], shippingMethod: 'express', region: 'ridge' }, {
    subtotal: 10, discount: 0, shipping: 12.5, tax: 1.13, total: 23.63
  });
});

test('supports the zero-rate Meadow region', () => {
  quote({ lines: [one(10)], region: 'meadow' }, {
    subtotal: 10, discount: 0, shipping: 4.99, tax: 0, total: 14.99
  });
  // The tax branch rejects a region it does not know; Meadow's zero rate must come from its entry, not from a fallback.
  assert.throws(() => calculateOrder({ lines: [one(10)], region: 'nowhere' }), /region/);
});

test('takes the promotion off before calculating regional tax', () => {
  quote({ lines: [one(100)], promoCode: 'WELCOME10', region: 'harbor' }, {
    subtotal: 100, discount: 10, shipping: 4.99, tax: 7.43, total: 102.42
  });
});

test('uses a caller supplied configuration file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lantern-price-'));
  const filename = path.join(directory, 'custom.json');
  fs.writeFileSync(filename, JSON.stringify({
    shipping: { standard: 2 },
    promos: { HALF: { kind: 'percent', value: 20, minimum: 0 } },
    regions: { custom: { rate: 0.1, taxShipping: true } }
  }));
  try {
    assert.deepEqual(calculateOrder({ lines: [one(10)], promoCode: 'HALF', region: 'custom' }, loadConfig(filename)), {
      subtotal: 10, discount: 2, shipping: 2, tax: 1, total: 11
    });
    assert.equal(loadConfig(filename).regions.custom.rate, 0.1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rounds the combined basket rather than each line', () => {
  quote({ lines: [one(0.105, 1, 'a'), one(0.105, 1, 'b')], region: 'harbor' }, {
    subtotal: 0.21, discount: 0, shipping: 4.99, tax: 0.02, total: 5.22
  });
});

test('stores both feature tables in the default JSON', () => {
  const config = loadConfig();
  assert.deepEqual(Object.keys(config.promos).sort(), ['BASKET5', 'WELCOME10']);
  assert.deepEqual(Object.keys(config.regions).sort(), ['harbor', 'meadow', 'ridge']);
});

test('keeps the promo branch tip in main history', () => {
  execFileSync('git', ['merge-base', '--is-ancestor', 'feature/promo-codes', 'HEAD'], { cwd: ROOT });
});

test('keeps the tax branch tip in main history', () => {
  execFileSync('git', ['merge-base', '--is-ancestor', 'feature/tax-regions', 'HEAD'], { cwd: ROOT });
});

test('has no conflict markers in tracked files', () => {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n');
  assert.ok(files.includes('test/feature-pricing.test.js'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.doesNotMatch(text, /^(<<<<<<<|=======|>>>>>>>)( |$)/m, file);
  }
});

test('leaves a clean working tree', () => {
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: ROOT, encoding: 'utf8' }), '');
});
