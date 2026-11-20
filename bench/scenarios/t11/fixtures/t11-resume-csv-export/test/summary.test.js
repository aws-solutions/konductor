const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../src/summary');

test('summary groups minutes by project', () => {
  assert.deepEqual(summarize([{ project: 'A', minutes: 4 }, { project: 'A', minutes: 6 }, { project: 'B', minutes: 2 }]), [{ project: 'A', minutes: 10 }, { project: 'B', minutes: 2 }]);
});
