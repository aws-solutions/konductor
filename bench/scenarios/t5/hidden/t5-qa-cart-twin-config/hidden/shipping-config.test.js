'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createCart, addItem } = require('../src/cart');
const { calculateOrderTotal } = require('../src/order-total');
const { calculateShipping } = require('../src/shipping');

const configPath = path.join(__dirname, '..', 'config', 'shipping.json');

function withShippingFile(contents, callback) {
  const existed = fs.existsSync(configPath);
  const previous = existed ? fs.readFileSync(configPath) : null;
  try {
    if (contents === null) {
      fs.rmSync(configPath, { force: true });
    } else {
      fs.writeFileSync(configPath, contents);
    }
    return callback();
  } finally {
    if (existed) {
      fs.writeFileSync(configPath, previous);
    } else {
      fs.rmSync(configPath, { force: true });
    }
  }
}

function json(value) {
  return JSON.stringify(value);
}

test('uses the existing defaults when shipping.json is absent', () => {
  withShippingFile(null, () => {
    assert.equal(calculateShipping(4999), 799);
    assert.equal(calculateShipping(5000), 0);
  });
});

test('uses the existing defaults when shipping.json is empty', () => {
  withShippingFile('', () => {
    assert.equal(calculateShipping(4999), 799);
    assert.equal(calculateShipping(5000), 0);
  });
  withShippingFile('{}', () => {
    assert.equal(calculateShipping(4999), 799);
    assert.equal(calculateShipping(5000), 0);
  });
});

test('reads the default standard rate from shipping.json', () => {
  withShippingFile(json({ default: { freeShippingThresholdCents: 5000, standardShippingCents: 925 } }), () => {
    assert.equal(calculateShipping(4999), 925);
  });
});

test('reads the default threshold and makes the threshold inclusive', () => {
  withShippingFile(json({ default: { freeShippingThresholdCents: 6200, standardShippingCents: 925 } }), () => {
    assert.equal(calculateShipping(6199), 925);
    assert.equal(calculateShipping(6200), 0);
  });
});

test('uses a country rate override', () => {
  withShippingFile(json({
    default: { freeShippingThresholdCents: 5000, standardShippingCents: 700 },
    countries: { CA: { standardShippingCents: 1100 } }
  }), () => {
    assert.equal(calculateShipping(1000, { country: 'CA' }), 1100);
  });
});

test('uses a country threshold override', () => {
  withShippingFile(json({
    default: { freeShippingThresholdCents: 5000, standardShippingCents: 700 },
    countries: { CA: { freeShippingThresholdCents: 2500 } }
  }), () => {
    assert.equal(calculateShipping(2499, { country: 'CA' }), 700);
    assert.equal(calculateShipping(2500, { country: 'CA' }), 0);
  });
});

test('falls back to the default for an unknown country', () => {
  withShippingFile(json({
    default: { freeShippingThresholdCents: 5000, standardShippingCents: 700 },
    countries: { CA: { freeShippingThresholdCents: 1000, standardShippingCents: 1100 } }
  }), () => {
    assert.equal(calculateShipping(1000, { country: 'DE' }), 700);
    assert.equal(calculateShipping(5000, { country: 'DE' }), 0);
  });
});

test('a country override may replace only one default setting', () => {
  withShippingFile(json({
    default: { freeShippingThresholdCents: 5000, standardShippingCents: 700 },
    countries: { GB: { standardShippingCents: 950 } }
  }), () => {
    assert.equal(calculateShipping(4999, { country: 'GB' }), 950);
    assert.equal(calculateShipping(5000, { country: 'GB' }), 0);
  });
});

test('country shipping settings flow through order totals', () => {
  withShippingFile(json({
    default: { freeShippingThresholdCents: 5000, standardShippingCents: 700 },
    countries: { CA: { freeShippingThresholdCents: 3000, standardShippingCents: 1200 } }
  }), () => {
    let cart = createCart('country-order');
    cart = addItem(cart, { sku: 'mug', unitPriceCents: 2000, quantity: 1 });
    const total = calculateOrderTotal(cart, { taxRateBps: 0, shipping: { country: 'CA' }, discounts: [] });
    assert.equal(total.subtotalCents, 2000);
    assert.equal(total.shippingCents, 1200);
    assert.equal(total.totalCents, 3200);
  });
});

test('preserves explicit shipping options and existing totals without a file', () => {
  withShippingFile(null, () => {
    let cart = createCart('unchanged-order');
    cart = addItem(cart, { sku: 'mug', unitPriceCents: 1000, quantity: 2 });
    const total = calculateOrderTotal(cart, {
      taxRateBps: 1000,
      shipping: { freeShippingThresholdCents: 5000, standardShippingCents: 500 },
      discounts: []
    });
    assert.deepEqual(total, {
      subtotalCents: 2000,
      discountCents: 0,
      discountedSubtotalCents: 2000,
      taxCents: 200,
      shippingCents: 500,
      totalCents: 2700
    });
  });
});

test('rejects a non-integer default threshold', () => {
  withShippingFile(json({ default: { freeShippingThresholdCents: 5000.5, standardShippingCents: 799 } }), () => {
    assert.throws(() => calculateShipping(1000), /Shipping configuration is invalid/i);
  });
});

test('rejects a negative default rate', () => {
  withShippingFile(json({ default: { freeShippingThresholdCents: 5000, standardShippingCents: -1 } }), () => {
    assert.throws(() => calculateShipping(1000), /Shipping configuration is invalid/i);
  });
});

test('rejects an invalid country setting', () => {
  withShippingFile(json({
    default: { freeShippingThresholdCents: 5000, standardShippingCents: 799 },
    countries: { CA: { standardShippingCents: '1100' } }
  }), () => {
    assert.throws(() => calculateShipping(1000, { country: 'CA' }), /Shipping configuration is invalid/i);
  });
});

test('rejects malformed shipping JSON with a clear error', () => {
  withShippingFile('{"default":', () => {
    assert.throws(() => calculateShipping(1000), /Shipping configuration is invalid/i);
  });
});

test('rejects a shipping file with the wrong top-level shape', () => {
  withShippingFile('[]', () => {
    assert.throws(() => calculateShipping(1000), /Shipping configuration is invalid/i);
  });
});
