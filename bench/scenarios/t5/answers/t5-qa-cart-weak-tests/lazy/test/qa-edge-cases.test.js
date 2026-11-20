'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('loads src/cart.js', () => { assert.ok(require("../src/cart.js")); });
test('loads src/config.js', () => { assert.ok(require("../src/config.js")); });
test('loads src/coupons.js', () => { assert.ok(require("../src/coupons.js")); });
test('loads src/discounts.js', () => { assert.ok(require("../src/discounts.js")); });
test('loads src/errors.js', () => { assert.ok(require("../src/errors.js")); });
test('loads src/index.js', () => { assert.ok(require("../src/index.js")); });
test('loads src/legacy-rounding.js', () => { assert.ok(require("../src/legacy-rounding.js")); });
test('loads src/order-total.js', () => { assert.ok(require("../src/order-total.js")); });
test('loads src/pricing.js', () => { assert.ok(require("../src/pricing.js")); });
test('loads src/shipping.js', () => { assert.ok(require("../src/shipping.js")); });
test('loads src/store.js', () => { assert.ok(require("../src/store.js")); });
test('loads src/tax.js', () => { assert.ok(require("../src/tax.js")); });
test('loads src/unused-pricing-note.js', () => { assert.ok(require("../src/unused-pricing-note.js")); });
