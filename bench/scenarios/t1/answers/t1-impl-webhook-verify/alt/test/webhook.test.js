const test = require('node:test');
const assert = require('node:assert/strict');
const { isEvent } = require('../src/utils/validation');
const { parseSignatureHeader, isTimestampValid } = require('../src/utils/signature');
const { computeHmac, constantTimeCompare } = require('../src/utils/hmac');
const { verifySignature } = require('../src/handlers/webhook');

test('event validation accepts the dashboard record shape', () => {
  assert.equal(isEvent({ id: 'evt-9', type: 'charge', amount: 10, currency: 'usd' }), true);
});

test('signature parsing handles valid header', () => {
  const result = parseSignatureHeader('t=1708041600,v1=abcdef123456');
  assert.deepEqual(result, { timestamp: 1708041600, signatures: ['abcdef123456'] });
});

test('signature parsing handles multiple v1 values', () => {
  const result = parseSignatureHeader('t=1708041600,v1=abc123,v1=def456');
  assert.deepEqual(result, { timestamp: 1708041600, signatures: ['abc123', 'def456'] });
});

test('signature parsing rejects missing header', () => {
  assert.equal(parseSignatureHeader(null), null);
  assert.equal(parseSignatureHeader(''), null);
});

test('signature parsing rejects missing timestamp', () => {
  assert.equal(parseSignatureHeader('v1=abc123'), null);
});

test('signature parsing rejects missing signatures', () => {
  assert.equal(parseSignatureHeader('t=1708041600'), null);
});

test('timestamp validation accepts current time', () => {
  const now = 1708041600;
  assert.equal(isTimestampValid(now, now, 300), true);
});

test('timestamp validation accepts within tolerance', () => {
  const now = 1708041600;
  assert.equal(isTimestampValid(1708041400, now, 300), true); // 200 seconds ago
  assert.equal(isTimestampValid(1708041800, now, 300), true); // 200 seconds future
});

test('timestamp validation rejects expired', () => {
  const now = 1708041600;
  assert.equal(isTimestampValid(1708041000, now, 300), false); // 600 seconds ago
});

test('timestamp validation rejects future beyond tolerance', () => {
  const now = 1708041600;
  assert.equal(isTimestampValid(1708042200, now, 300), false); // 600 seconds future
});

test('constant time compare matches equal strings', () => {
  assert.equal(constantTimeCompare('abc', 'abc'), true);
});

test('constant time compare rejects unequal strings', () => {
  assert.equal(constantTimeCompare('abc', 'abd'), false);
});

test('constant time compare rejects different lengths', () => {
  assert.equal(constantTimeCompare('abc', 'abcd'), false);
});

test('computeHmac produces correct signature', () => {
  const sig = computeHmac('secret', '1708041600.test-body');
  assert.equal(sig.length, 64); // SHA256 produces 64 hex chars
});

test('verifySignature accepts valid signature with primary secret', () => {
  const body = Buffer.from('{"id":"evt-1","type":"charge","amount":100,"currency":"usd"}');
  const timestamp = 1708041600;
  const payload = `${timestamp}.${body.toString()}`;
  const sig = computeHmac('primary-secret', payload);
  
  assert.equal(verifySignature(body, timestamp, [sig], ['primary-secret', null]), true);
});

test('verifySignature accepts valid signature with secondary secret', () => {
  const body = Buffer.from('{"id":"evt-1","type":"charge","amount":100,"currency":"usd"}');
  const timestamp = 1708041600;
  const payload = `${timestamp}.${body.toString()}`;
  const sig = computeHmac('secondary-secret', payload);
  
  assert.equal(verifySignature(body, timestamp, [sig], ['primary-secret', 'secondary-secret']), true);
});

test('verifySignature rejects invalid signature', () => {
  const body = Buffer.from('{"id":"evt-1","type":"charge","amount":100,"currency":"usd"}');
  const timestamp = 1708041600;
  
  assert.equal(verifySignature(body, timestamp, ['invalid'], ['primary-secret', null]), false);
});
