'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { retry } = require('../src');

test('retry eventually returns a callback result', async () => {
  let attempts = 0;
  await new Promise((resolve, reject) => retry((done) => { attempts += 1; if (attempts < 3) done(new Error('again')); else done(null, 'ok'); }, { retries: 2 }, (err, value) => { if (err) reject(err); else { assert.equal(value, 'ok'); resolve(); } }));
  assert.equal(attempts, 3);
});
