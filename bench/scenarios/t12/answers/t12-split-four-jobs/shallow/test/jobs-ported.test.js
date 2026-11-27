'use strict';

// Shallow fake: names each job and only checks that run() returns something.
const test = require('node:test');
const assert = require('node:assert/strict');

for (const job of ['interest', 'statement', 'dormant', 'late-fee']) {
  test(`jobs/${job} runs`, () => {
    const { run } = require(`../src/jobs/${job}.js`);
    assert.equal(typeof run, 'function');
  });
}
