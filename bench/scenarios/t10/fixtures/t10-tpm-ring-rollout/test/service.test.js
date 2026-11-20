'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReceiptService } = require('../src/receipt-service');
const { createMemoryStore } = require('../src/store');
const { createDelivery } = require('../src/delivery');
const { handleError } = require('../src/http');
function service() { const store = createMemoryStore(); return createReceiptService({ store, delivery: createDelivery() }); }

test('service creates an id', () => assert.match(service().create({ accountId: 'a', amountCents: 12 }).id, /^rcpt-/));
test('service defaults currency', () => assert.equal(service().create({ accountId: 'a', amountCents: 12 }).currency, 'USD'));
test('service renders pdf text', () => { const s = service(); const r = s.create({ accountId: 'a', amountCents: 12, id: 'r' }); assert.match(s.pdf(r.id), /Receipt r/); });
test('unknown receipt has 404', () => { const s = service(); assert.throws(() => s.pdf('none'), { code: 'RECEIPT_NOT_FOUND', status: 404 }); });
test('error handler returns code and status', () => { const value = handleError({ code: 'X', message: 'bad', status: 409 }); assert.deepEqual(value, { status: 409, body: { code: 'X', message: 'bad' } }); });
