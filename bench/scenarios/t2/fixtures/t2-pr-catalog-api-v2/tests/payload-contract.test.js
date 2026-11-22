import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCreateBody, normalizeStoredProduct } from '../src/catalog/normalizers.js';

const body = {
  name: 'Field Radio',
  subtitle: 'Small emergency receiver',
  price: 39.95,
  labels: ['outdoor'],
  attributes: { material: 'plastic' }
};

test('normalizes a complete create body', () => {
  const product = normalizeCreateBody(body);
  assert.equal(product.name, 'Field Radio');
  assert.equal(product.subtitle, 'Small emergency receiver');
  assert.equal(product.priceCents, 3995);
  assert.deepEqual(product.labels, ['outdoor']);
});

test('keeps supplied attributes', () => {
  const product = normalizeCreateBody(body);
  assert.deepEqual(product.attributes, { material: 'plastic' });
});

test('normalizes missing collections and note', () => {
  const product = normalizeStoredProduct({
    id: 'p-77',
    name: 'Camp Towel',
    status: 'draft',
    priceCents: 900
  });
  assert.equal(product.warehouseNote, '');
  assert.deepEqual(product.labels, []);
  assert.deepEqual(product.attributes, {});
});

test('keeps labels in their input order', () => {
  const product = normalizeCreateBody({ ...body, labels: ['blue', 'sale', 'blue'] });
  assert.deepEqual(product.labels, ['blue', 'sale', 'blue']);
});

test('rejects a negative price', () => {
  assert.throws(() => normalizeCreateBody({ ...body, price: -1 }), /price/);
});

test('rejects a missing name', () => {
  assert.throws(() => normalizeCreateBody({ ...body, name: '' }), /name/);
});

test('keeps a supplied warehouse note', () => {
  const product = normalizeCreateBody({ ...body, warehouseNote: 'Keep upright' });
  assert.equal(product.warehouseNote, 'Keep upright');
});

test('preserves a supplied identifier', () => {
  const product = normalizeCreateBody({ ...body, id: 'p-lantern-7' });
  assert.equal(product.id, 'p-lantern-7');
});

test('uses the requested status when present', () => {
  const product = normalizeCreateBody({ ...body, status: 'active' });
  assert.equal(product.status, 'active');
});

test('copies input arrays instead of retaining them', () => {
  const labels = ['quiet'];
  const product = normalizeCreateBody({ ...body, labels });
  labels.push('changed');
  assert.deepEqual(product.labels, ['quiet']);
});

test('copies input attributes instead of retaining them', () => {
  const attributes = { material: 'wool' };
  const product = normalizeCreateBody({ ...body, attributes });
  attributes.material = 'cotton';
  assert.deepEqual(product.attributes, { material: 'wool' });
});

test('accepts a zero price', () => {
  const product = normalizeCreateBody({ ...body, price: 0 });
  assert.equal(product.priceCents, 0);
});

test('rounds fractional cents for stored values', () => {
  const product = normalizeCreateBody({ ...body, price: 1.239 });
  assert.equal(product.priceCents, 124);
});
