'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toEnvelope, formatLine } = require('../src/receipt-format');
const { toLegacyReceipt } = require('../src/legacy');
const receipt = { id: 'r1', accountId: 'a1', amountCents: 220, currency: 'EUR', issuedAt: '2025-01-01T00:00:00.000Z' };

test('current envelope carries version', () => assert.equal(toEnvelope(receipt).version, 2));
test('current envelope carries account', () => assert.equal(toEnvelope(receipt).receipt.accountId, 'a1'));
test('current line includes amount', () => assert.match(formatLine(toEnvelope(receipt)), /220/));
test('legacy shape keeps cents', () => assert.equal(toLegacyReceipt(receipt).cents, 220));
test('legacy shape uses receiptId', () => assert.equal(toLegacyReceipt(receipt).receiptId, 'r1'));
