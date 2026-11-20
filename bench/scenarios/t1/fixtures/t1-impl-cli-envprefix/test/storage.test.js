'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { listObjects, uploadFiles } = require('../src/storage');

test('list objects uses bucket and prefix', async () => {
  const result = await listObjects({ bucket: 'demo', prefix: 'a/' });
  assert.equal(result[0].key, 'a/welcome.txt');
  assert.equal(result[0].bucket, 'demo');
});

test('upload records preserve tags', async () => {
  const result = await uploadFiles([{ relative: 'a.txt', size: 3 }], { bucket: 'demo', prefix: '', region: 'r1', tags: ['one'] });
  assert.deepEqual(result[0].tags, ['one']);
});
