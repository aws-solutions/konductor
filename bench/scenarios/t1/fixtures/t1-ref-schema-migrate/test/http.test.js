const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { migrateUp } = require('../migrations/runner');
const { handle } = require('../src/http');

function response() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } }; }

test('http handler returns an empty customer collection', async () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db, 12);
  const out = response();
  await handle({ method: 'GET', url: '/customers' }, out, db);
  assert.equal(out.statusCode, 200);
  assert.deepEqual(JSON.parse(out.body), []);
  db.close();
});
