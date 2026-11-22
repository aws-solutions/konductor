'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SessionStore } = require('../src/session-store');

function setup() {
  let now = 1_000_000;
  const config = { now: () => now, idleSeconds: 30, absoluteSeconds: 300, maxSessionsPerAccount: 5 };
  return { store: new SessionStore(config, () => now), advance: (ms) => { now += ms; } };
}

test('finds a live session and touches its idle clock', () => {
  const { store, advance } = setup();
  const record = store.create('acct_1', 'session-a', 'refresh-a');
  advance(500);
  assert.equal(store.findBySessionToken('session-a').id, record.id);
  assert.equal(record.lastSeenAt, 1_000_500);
});

test('stores the remember choice with a session record', () => {
  const { store } = setup();
  const record = store.create('acct_1', 'session-a', 'refresh-a', true);
  assert.equal(record.rememberMe, true);
  assert.equal(record.refreshToken, 'refresh-a');
});

test('finds a refresh session before its absolute expiry', () => {
  const { store, advance } = setup();
  const record = store.create('acct_1', 'session-a', 'refresh-a');
  advance(500);
  assert.equal(store.findByRefreshToken('refresh-a').id, record.id);
});

test('replaces the session credentials when a refresh is accepted', () => {
  const { store } = setup();
  const original = store.create('acct_1', 'session-a', 'refresh-a');
  const replacement = store.rotateRefreshToken(original, 'session-b', 'refresh-b');
  assert.equal(replacement.refreshToken, 'refresh-b');
  assert.equal(replacement.refreshCount, 1);
});

test('revokes the oldest session over the account limit', () => {
  const { store, advance } = setup();
  const first = store.create('acct_1', 'one', 'refresh-one');
  advance(1);
  store.create('acct_1', 'two', 'refresh-two');
  advance(1);
  store.create('acct_1', 'three', 'refresh-three');
  advance(1);
  store.create('acct_1', 'four', 'refresh-four');
  advance(1);
  store.create('acct_1', 'five', 'refresh-five');
  advance(1);
  store.create('acct_1', 'six', 'refresh-six');
  assert.equal(store.findBySessionToken('one'), null);
  assert.equal(store.activeForAccount('acct_1').length, 5);
  assert.equal(first.revokedAt, 1_000_005);
});

test('does not return an idle or expired session', () => {
  const { store, advance } = setup();
  store.create('acct_1', 'stale', 'refresh-stale');
  advance(31_000);
  assert.equal(store.findBySessionToken('stale'), null);
});
