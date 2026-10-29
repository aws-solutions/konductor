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

test('a user gets 100 requests in a minute and the 101st is refused with 429', () => {
  const { hit } = setup();
  const who = { user: 'ana', ip: '10.0.0.1' };
  for (let i = 0; i < 100; i++) assert.equal(hit(who).status, 200, `request ${i + 1}`);
  assert.equal(hit(who).status, 429);
});

test('the 429 body has an error message and retryAfterSec in whole seconds, rounded up', () => {
  const { hit, clock } = setup();
  const who = { user: 'ana', ip: '10.0.0.1' };
  burst(hit, 100, who);
  const r = hit(who);
  assert.equal(r.status, 429);
  assert.equal(typeof r.body.error, 'string');
  assert.ok(r.body.error.length > 0);
  assert.equal(r.body.retryAfterSec, 60);
  clock.advance(20500);
  assert.equal(hit(who).body.retryAfterSec, 40);
});

test('two users on the same address are limited separately', () => {
  const { hit } = setup();
  burst(hit, 100, { user: 'ana', ip: '10.0.0.1' });
  assert.equal(hit({ user: 'ana', ip: '10.0.0.1' }).status, 429);
  assert.equal(hit({ user: 'ben', ip: '10.0.0.1' }).status, 200);
});

test('a request with no user is limited per IP address', () => {
  const { hit } = setup();
  burst(hit, 100, { ip: '10.0.0.1' });
  assert.equal(hit({ ip: '10.0.0.1' }).status, 429);
  assert.equal(hit({ ip: '10.0.0.2' }).status, 200);
});

test('signed-in requests do not use up the anonymous quota of the same address', () => {
  const { hit } = setup();
  burst(hit, 100, { user: 'ana', ip: '10.0.0.1' });
  assert.equal(hit({ ip: '10.0.0.1' }).status, 200);
});

test('the limit holds for the whole minute and lifts after it', () => {
  const { hit, clock } = setup();
  const who = { user: 'ana', ip: '10.0.0.1' };
  burst(hit, 100, who);
  clock.advance(59999);
  assert.equal(hit(who).status, 429);
  clock.advance(2);
  assert.equal(hit(who).status, 200);
});

test('after the window lifts the user again gets 100 requests', () => {
  const { hit, clock } = setup();
  const who = { user: 'ana', ip: '10.0.0.1' };
  burst(hit, 100, who);
  clock.advance(60001);
  for (let i = 0; i < 100; i++) assert.equal(hit(who).status, 200, `request ${i + 1}`);
  assert.equal(hit(who).status, 429);
});
