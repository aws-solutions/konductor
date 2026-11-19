const test = require('node:test');
const assert = require('node:assert/strict');
const { withServer, request } = require('./helpers');

test('booking list contains seeded rows', async () => {
  await withServer(async port => {
    const result = await request(port, 'GET', '/bookings');
    assert.equal(result.status, 200);
    assert.equal(result.body.bookings.length, 2);
  }, { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json' } });
});

test('booking can be created and fetched', async () => {
  await withServer(async port => {
    const created = await request(port, 'POST', '/bookings', { room: 'Elm', date: '2025-07-01', owner: 'Lee' });
    assert.equal(created.status, 201);
    const fetched = await request(port, 'GET', `/bookings/${created.body.id}`);
    assert.equal(fetched.body.owner, 'Lee');
  }, { config: { serviceName: 'booking-api', logLevel: 'silent', seedFile: 'data/seed.json' } });
});
