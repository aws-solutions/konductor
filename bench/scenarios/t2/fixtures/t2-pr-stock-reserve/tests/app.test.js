import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/app.js';

test('app serves seeded stock', async () => {
  const app = makeApp();
  const response = await app.router({ method: 'GET', path: '/stock/north/BEANS-1KG', headers: {} });
  assert.equal(response.status, 200);
  assert.equal(response.body.quantity, 18);
});
