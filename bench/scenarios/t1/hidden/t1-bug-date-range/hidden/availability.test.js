const test = require('node:test');
const assert = require('node:assert/strict');
const { isAvailable, availableDays } = require('../src/availability');

const overnight = [{ id: 'night', room: 'cedar-1', start: '2025-06-10T18:00:00', end: '2025-06-11T00:00:00', name: 'overnight' }];

test('a midnight end frees the next instant and next day but still holds its starting day', () => {
  assert.equal(isAvailable(overnight, '2025-06-11T00:00:00', '2025-06-11T08:00:00', 'cedar-1'), true);
  assert.deepEqual(availableDays(overnight, '2025-06-11', '2025-06-11', 'cedar-1'), ['2025-06-11']);
  assert.deepEqual(availableDays(overnight, '2025-06-10', '2025-06-10', 'cedar-1'), []);
});

test('a different room remains available at the same time', () => {
  assert.equal(isAvailable(overnight, '2025-06-10T18:00:00', '2025-06-11T00:00:00', 'maple-2'), true);
});
