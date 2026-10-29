'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { match } = require('../src/router');

test('matches method and path with params', () => {
  const fn = () => {};
  const hit = match({ 'GET /a/:x': fn }, 'GET', '/a/7');
  assert.equal(hit.handler, fn);
  assert.deepEqual(hit.params, { x: '7' });
});

test('a different method or path does not match', () => {
  assert.equal(match({ 'GET /a': () => {} }, 'POST', '/a'), null);
  assert.equal(match({ 'GET /a': () => {} }, 'GET', '/b'), null);
});
