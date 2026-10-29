'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGateway, HttpError, manualClock } = require('../src');

const handlers = {
  'GET /ok': () => ({ fine: true }),
  'GET /denied': () => { throw new HttpError(403, 'nope'); },
  'GET /boom': () => { throw new Error('bad'); },
  'GET /items/:id': (req, ctx) => ({ id: ctx.params.id, user: req.user }),
};

test('a handler result becomes a 200 response', () => {
  const g = createGateway({ handlers, clock: manualClock(0) });
  assert.deepEqual(g.handle({ method: 'GET', path: '/ok' }), { status: 200, body: { fine: true } });
});

test('an unknown route is a 404', () => {
  const g = createGateway({ handlers, clock: manualClock(0) });
  assert.equal(g.handle({ method: 'GET', path: '/missing' }).status, 404);
});

test('HttpError keeps its status and other errors are a 500', () => {
  const g = createGateway({ handlers, clock: manualClock(0) });
  assert.deepEqual(g.handle({ method: 'GET', path: '/denied' }), { status: 403, body: { error: 'nope' } });
  assert.equal(g.handle({ method: 'GET', path: '/boom' }).status, 500);
});

test('route params reach the handler', () => {
  const g = createGateway({ handlers, clock: manualClock(0) });
  assert.deepEqual(g.handle({ method: 'GET', path: '/items/42', user: 'ana' }).body, { id: '42', user: 'ana' });
});
