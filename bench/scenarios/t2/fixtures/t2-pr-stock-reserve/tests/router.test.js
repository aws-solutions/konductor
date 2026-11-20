import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/app.js';

test('router returns a 404 for unknown routes', async () => {
  const app = makeApp();
  const response = await app.router({ method: 'GET', path: '/nope', headers: {} });
  assert.equal(response.status, 404);
});

test('router turns service failures into request errors', async () => {
  const app = makeApp({ logger: { error() {} } });
  app.inventory.getStock = async () => { throw new Error('broken store'); };
  const response = await app.router({ method: 'GET', path: '/stock/north/BEANS-1KG', headers: {} });
  assert.equal(response.status, 500);
  assert.equal(response.body.code, 'internal_error');
});
