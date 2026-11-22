import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function load(name) {
  return JSON.parse(fs.readFileSync(new URL(`../schemas/${name}`, import.meta.url), 'utf8'));
}

test('create schema describes the current request fields', () => {
  const schema = load('product-create.json');
  assert.equal(schema.properties.subtitle.type, 'string');
  assert.equal(schema.properties.warehouseNote.default, '');
});

test('event schema keeps cents numeric', () => {
  const schema = load('product-event.json');
  assert.equal(schema.properties.product.properties.priceCents.type, 'integer');
});
