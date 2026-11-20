'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIssueHandlers } = require('../src/api/issues');
const { fixtureStore } = require('./test-fixtures');

const config = { defaultPageSize: 20, maxPageSize: 100 };

test('issue list filters by status', () => {
  const result = createIssueHandlers(fixtureStore(), config).list(new URLSearchParams('status=open'));
  assert.deepEqual(result.data.map((issue) => issue.id), ['ISS-1', 'ISS-2']);
  assert.equal(result.page.nextCursor, undefined);
});

test('issue list returns a cursor for a following page', () => {
  const result = createIssueHandlers(fixtureStore(), config).list(new URLSearchParams('cursor=&limit=1'));
  assert.deepEqual(result.data.map((issue) => issue.id), ['ISS-1']);
  assert.equal(typeof result.page.nextCursor, 'string');
});

test('unknown issue throws a not found error', () => {
  assert.throws(() => createIssueHandlers(fixtureStore(), config).get('ISS-404'), /Issue not found/);
});
