'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRingRollout } = require('../src/ring-rollout');
const { evaluate } = require('../src/go-no-go');
const rings = require('../ops/rings.json').rings;

test('rollout state preserves ring metadata', () => { const r = createRingRollout({ rings }); assert.equal(r.state().rings[2].name, 'regional'); });
test('completion unlocks next ring', async () => { const r = createRingRollout({ rings }); await r.promote('staff', 100); assert.equal((await r.promote('pilot', 10)).percentage, 10); });
test('explicit rollback records status', async () => { const r = createRingRollout({ rings, initialState: { rings: { staff: { percentage: 50 } } } }); assert.equal((await r.rollback('staff', 25)).status, 'rollback'); });
test('freeze query is available', () => { const r = createRingRollout({ rings, freezeCalendar: [{ ring: 'staff', start: '2025-01-01T00:00:00Z', end: '2025-01-02T00:00:00Z' }], now: () => new Date('2025-01-01T12:00:00Z') }); assert.equal(r.isFrozen('staff'), true); });
test('healthy snapshot exposes metric and unit', () => { const csv = 'minute,receipt_error_rate_percent\n2025-01-01T00:00:00Z,0.2\n2025-01-01T00:01:00Z,0.2\n2025-01-01T00:02:00Z,0.2\n2025-01-01T00:03:00Z,0.2\n2025-01-01T00:04:00Z,0.2\n2025-01-01T00:05:00Z,0.2\n2025-01-01T00:06:00Z,0.2\n2025-01-01T00:07:00Z,0.2\n2025-01-01T00:08:00Z,0.2\n2025-01-01T00:09:00Z,0.2'; const result = evaluate({ ring: 'staff', snapshot: csv, now: '2025-01-01T00:10:00Z' }); assert.equal(result.unit, 'percent'); });
test('empty snapshots hold', () => assert.equal(evaluate({ ring: 'staff', snapshot: '', now: '2025-01-01T00:00:00Z' }).decision, 'HOLD'));
test('unknown ring holds safely', () => assert.equal(evaluate({ ring: 'nope', snapshot: '' }).reason, 'UNKNOWN_RING'));
test('rollback threshold wins over promotion threshold', () => { const rows = Array.from({ length: 10 }, (_, i) => `${new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString()},3.5`); const result = evaluate({ ring: 'staff', snapshot: `minute,receipt_error_rate\n${rows.join('\n')}`, now: '2025-01-01T00:10:00Z' }); assert.equal(result.decision, 'ROLLBACK'); });
