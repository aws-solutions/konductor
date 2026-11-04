// SPDX-License-Identifier: Apache-2.0
/**
 * Provenance unit tests: stable JSON hashing. Run: node --test bench/test/provenance.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const prov = require('../lib/provenance');

const HEX = /^[0-9a-f]{64}$/;

test('sha256 of an object does not depend on key order at any depth', () => {
  assert.equal(
    prov.sha256({ a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } }),
    prov.sha256({ b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }),
  );
  assert.notEqual(prov.sha256({ a: 1 }), prov.sha256({ a: 2 }));
});

test('sha256: array order matters and the digest is hex', () => {
  assert.notEqual(prov.sha256([1, 2]), prov.sha256([2, 1]));
  assert.match(prov.sha256({ a: [1] }), HEX);
});

test('sha256: strings and buffers hash their bytes, with a known answer', () => {
  assert.match(prov.sha256('abc'), HEX);
  assert.equal(prov.sha256('abc'), prov.sha256(Buffer.from('abc')));
  assert.equal(prov.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(prov.sha256('{"a":1}'), prov.sha256({ a: 1 }), 'an object hashes as its sorted JSON text');
});

test('stable sorts keys and leaves values and array order alone', () => {
  assert.equal(JSON.stringify(prov.stable({ b: 1, a: { d: 1, c: 2 } })), '{"a":{"c":2,"d":1},"b":1}');
  assert.deepEqual(prov.stable([3, 1, 2]), [3, 1, 2]);
  assert.equal(prov.stable(null), null);
  assert.equal(prov.stable('x'), 'x');
});

test('the module exports the hash helpers only', () => {
  assert.deepEqual(Object.keys(prov).sort(), ['sha256', 'stable']);
});
