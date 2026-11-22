import test from 'node:test';
import assert from 'node:assert/strict';
import { subtotal, taxFor, totalWithTax } from '../src/price-math.js';

test('price math stays in cents', () => {
  const lines = [{ unitPriceCents: 599, quantity: 2 }, { unitPriceCents: 875, quantity: 1 }];
  assert.equal(subtotal(lines), 2073);
  assert.equal(taxFor(2073, 0.0825), 171);
  assert.equal(totalWithTax(2073, 0.0825), 2244);
});
