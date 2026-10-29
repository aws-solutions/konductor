'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGateway, manualClock, HttpError } = require('../src');

const T0 = Date.UTC(2025, 0, 15, 10, 30, 0, 0);

function setup(extra = {}) {
  const clock = manualClock(T0);
  const calls = { echo: 0 };
  const handlers = {
    'GET /echo': (req) => { calls.echo++; return { said: req.query.text ?? '' }; },
    'GET /denied': () => { throw new HttpError(403, 'nope'); },
    'GET /boom': () => { throw new Error('bad'); },
    'GET /seen': (req, ctx) => ({ method: req.method, path: req.path, user: req.user, ip: req.ip, params: ctx.params }),
    'GET /items/:id': (req, ctx) => ({ id: ctx.params.id }),
    ...extra,
  };
  const gateway = createGateway({ handlers, clock });
  const hit = (who = {}, path = '/echo') => gateway.handle({ method: 'GET', path, query: { text: 'hi' }, ...who });
  return { gateway, clock, calls, hit };
}

function burst(hit, n, who) {
  let last;
  for (let i = 0; i < n; i++) last = hit(who);
  return last;
}

test('a request below the limit gets the handler response unchanged', () => {
  const { hit } = setup();
  assert.deepEqual(hit({ user: 'ana', ip: '10.0.0.1' }), { status: 200, body: { said: 'hi' } });
});

test('unknown routes, HttpError and other exceptions keep their status', () => {
  const { hit } = setup();
  const who = { user: 'ana', ip: '10.0.0.1' };
  assert.equal(hit(who, '/missing').status, 404);
  assert.deepEqual(hit(who, '/denied'), { status: 403, body: { error: 'nope' } });
  assert.equal(hit(who, '/boom').status, 500);
});

test('handlers still receive the normalized request and the route params', () => {
  const { hit } = setup();
  const r = hit({ user: 'ana', ip: '10.0.0.1' }, '/seen');
  assert.deepEqual(r.body, { method: 'GET', path: '/seen', user: 'ana', ip: '10.0.0.1', params: {} });
  assert.deepEqual(hit({ user: 'ana', ip: '10.0.0.1' }, '/items/42').body, { id: '42' });
});

test('two gateways do not share counters', () => {
  const a = setup();
  const b = setup();
  burst(a.hit, 400, { user: 'ana', ip: '10.0.0.1' });
  assert.equal(b.hit({ user: 'ana', ip: '10.0.0.1' }).status, 200);
});

test('a request with neither user nor address still gets a response', () => {
  const { hit } = setup();
  for (let i = 0; i < 300; i++) {
    const r = hit({});
    assert.equal(typeof r.status, 'number');
    assert.ok(r.status < 500, `status ${r.status}`);
  }
});

test('a refused request never reaches its handler', () => {
  const { hit, calls } = setup();
  const who = { user: 'ana', ip: '10.0.0.1' };
  for (let i = 0; i < 400; i++) {
    const before = calls.echo;
    const r = hit(who);
    if (r.status === 429) assert.equal(calls.echo, before, `handler ran for refused request ${i + 1}`);
  }
});
