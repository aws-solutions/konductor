const test = require('node:test');
const assert = require('node:assert/strict');
const { format } = require('../src/formatter');
test('formats labels consistently', () => { assert.equal(format([{ at: '00:00:01', text: 'Start', label: 'north-stage' }]), '00:00:01 Start | north-stage'); });
