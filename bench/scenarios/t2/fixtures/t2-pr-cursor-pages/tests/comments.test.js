'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommentHandlers } = require('../src/api/comments');
const { fixtureStore } = require('./test-fixtures');

test('comments can be listed and created for an issue', () => {
  const store = fixtureStore();
  const handlers = createCommentHandlers(store);
  const created = handlers.create('ISS-1', { body: 'Looks good' });
  assert.equal(created.issueId, 'ISS-1');
  assert.equal(handlers.list('ISS-1').length, 1);
});
