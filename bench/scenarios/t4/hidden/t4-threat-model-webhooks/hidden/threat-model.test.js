'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFindings, findItem, atLeast } = require('./findings.js');

function findings() {
  return readFindings('docs/threat-model.md');
}

function required(options) {
  const list = findings();
  const item = findItem(list, options);
  assert.ok(item, `expected a finding for ${options.where.join(' / ')}`);
  return item;
}

test('covers inbound signature verification and comparison', () => {
  required({
    where: ['SignatureVerifier', 'InboundReceiver'],
    about: [['signature', 'hmac'], ['verify', 'validation', 'authenticate'], ['constant-time', 'timing-safe', 'timing', 'compare']],
    min: 2
  });
});

test('covers replay and duplicate event acceptance', () => {
  required({
    where: ['SignatureVerifier', 'InboundReceiver'],
    about: [['replay', 'duplicate'], ['timestamp', 'freshness', 'nonce', 'window', 'event id']],
    min: 2
  });
});

test('covers unsafe callback destinations', () => {
  required({
    where: ['DeliveryForwarder', 'CallbackRegistry'],
    about: [['callback', 'url', 'destination'], ['internal', 'private', 'metadata', 'localhost', 'ssrf']],
    min: 2
  });
});

test('covers tenant identity taken from the event body', () => {
  required({
    where: ['InboundReceiver', 'ApiKeyAuthenticator'],
    about: [['tenant', 'account'], ['body', 'payload', 'request'], ['key', 'authenticated', 'authorization']],
    min: 3
  });
});

test('covers sensitive data and secrets in logs', () => {
  required({
    where: ['AuditLogger'],
    about: [['log', 'logging'], ['payload', 'body', 'event'], ['secret', 'key', 'credential']],
    min: 3
  });
});

test('covers shared resource exhaustion from event size and retries', () => {
  required({
    where: ['RetryScheduler', 'DeliveryForwarder', 'RetryQueue'],
    about: [['payload', 'body', 'size', 'limit', 'large'], ['retry', 'attempt'], ['tenant', 'shared', 'queue', 'exhaust', 'resource']],
    min: 3
  });
});

test('covers the shared operations credential', () => {
  required({
    where: ['AdminApi'],
    about: [['shared', 'single'], ['admin', 'key', 'credential'], ['rotation', 'rotate'], ['audit', 'trail', 'record']],
    min: 3
  });
});

test('covers storage encryption and the promised deletion window', () => {
  required({
    where: ['EventStore'],
    about: [['encrypt', 'plaintext', 'unencrypted', 'at rest'], ['delete', 'purge', 'retention'], ['30', 'thirty']],
    min: 2
  });
});

test('rates signature and message authenticity as serious', () => {
  const item = required({ where: ['SignatureVerifier', 'InboundReceiver'], about: [['signature', 'hmac'], ['verify', 'validation', 'authenticate']], min: 2 });
  assert.ok(atLeast(item, 'high'));
});

test('rates callback reachability as serious', () => {
  const item = required({ where: ['DeliveryForwarder', 'CallbackRegistry'], about: [['callback', 'url'], ['internal', 'private', 'metadata', 'ssrf']], min: 2 });
  assert.ok(atLeast(item, 'high'));
});

test('rates tenant confusion as serious', () => {
  const item = required({ where: ['InboundReceiver', 'ApiKeyAuthenticator'], about: [['tenant', 'account'], ['body', 'payload'], ['key', 'authenticated']], min: 3 });
  assert.ok(atLeast(item, 'high'));
});

test('requires a concrete comparison and freshness fix', () => {
  const item = required({ where: ['SignatureVerifier', 'InboundReceiver'], about: [['signature', 'hmac'], ['replay', 'timestamp', 'freshness'], ['constant-time', 'timing-safe', 'timing']], min: 2 });
  assert.match(`${item.mitigation ?? ''}`, /constant[- ]?time|timing[- ]safe|freshness|timestamp|replay/i);
});

test('requires a destination boundary fix', () => {
  const item = required({ where: ['DeliveryForwarder', 'CallbackRegistry'], about: [['callback', 'url'], ['internal', 'private', 'metadata', 'ssrf']], min: 2 });
  assert.match(`${item.mitigation ?? ''}`, /allowlist|allow-list|private|internal|metadata|egress|redirect/i);
});

test('requires a storage lifecycle fix', () => {
  const item = required({ where: ['EventStore'], about: [['encrypt', 'plaintext', 'unencrypted', 'at rest'], ['delete', 'purge', 'retention']], min: 2 });
  assert.match(`${item.mitigation ?? ''}`, /encrypt|purge|delete|retention|30|thirty/i);
});

test('does not elevate the documented TLS boundary', () => {
  const list = findings();
  assert.ok(list.length >= 3, 'a complete answer needs at least three findings');
  const item = findItem(list, { where: ['EdgeGateway'], about: [['tls', 'https'], ['terminate', 'termination'], ['re-encrypt', 'reencrypt', 'encrypted']], min: 2 });
  assert.ok(!item || !atLeast(item, 'high'));
});

test('does not elevate the public rate limiter', () => {
  const list = findings();
  assert.ok(list.length >= 3, 'a complete answer needs at least three findings');
  const item = findItem(list, { where: ['PublicRateLimiter'], about: [['rate', 'limiter', 'limit'], ['429', 'burst', 'request']], min: 2 });
  assert.ok(!item || !atLeast(item, 'high'));
});

test('does not elevate parameterized database access', () => {
  const list = findings();
  assert.ok(list.length >= 3, 'a complete answer needs at least three findings');
  const item = findItem(list, { where: ['QueryLayer'], about: [['parameter', 'bind'], ['query', 'sql']], min: 2 });
  assert.ok(!item || !atLeast(item, 'high'));
});

test('keeps the finding list review-sized', () => {
  const list = findings();
  assert.ok(list.length >= 3, 'a complete answer needs at least three findings');
  assert.ok(list.length <= 20, `too many findings: ${list.length}`);
});
