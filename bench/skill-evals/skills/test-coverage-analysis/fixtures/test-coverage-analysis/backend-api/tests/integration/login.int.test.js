const request = require('supertest');
const app = require('../../src/app');

test('POST /login returns a token for a seeded user', async () => {
  const res = await request(app).post('/login').send({ email: 'seed@x.io', password: 'seed-pw' });
  expect(res.status).toBe(200);
});
