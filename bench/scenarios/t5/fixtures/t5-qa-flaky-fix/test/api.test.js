const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src');
const { Outbox } = require('../src/outbox');
const { RateLimiter } = require('../src/rate-limiter');
const { createApi } = require('../src/api');
const { tempDirectory, removeDirectory } = require('./helpers');

test('creates and removes jobs through the API', async () => {
  const directory = tempDirectory();
  try {
    const api = createApi({
      add: input => ({ id: input.id, title: input.title }),
      remove: id => id === 'known',
      list: () => [{ id: 'known' }],
      run: async () => []
    });
    assert.deepEqual(api.create({ id: 'known', title: 'Call' }), { id: 'known', title: 'Call' });
    assert.deepEqual(api.jobs(), [{ id: 'known' }]);
    assert.deepEqual(api.remove('known'), { removed: 'known' });
    await removeDirectory(directory);
  } finally {
    await removeDirectory(directory);
  }
});

test('runs due jobs and reports missing jobs', async () => {
  const directory = tempDirectory();
  const application = createApplication({ outbox: new Outbox(directory), limiter: new RateLimiter(2, 1000), config: { timeZone: 'UTC' } });
  try {
    const api = application.api;
    api.create({ id: 'job-a', title: 'Call', rule: { weekday: 'Monday', hour: 9, minute: 0 } });
    const sent = await api.run(new Date('2026-04-06T09:00:00.000Z'));
    assert.equal(sent.length, 1);
    assert.throws(() => api.remove('missing'), error => error.code === 'NOT_FOUND');
  } finally {
    await removeDirectory(directory);
  }
});
