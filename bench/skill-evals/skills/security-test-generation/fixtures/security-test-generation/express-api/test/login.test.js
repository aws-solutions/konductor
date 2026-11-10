const request = require('supertest');
jest.mock('../src/db', () => ({ findUserByEmail: async () => ({ id: '1', role: 'user', password: 'pw' }) }));
const app = require('../src/app');

test('valid login returns a token', async () => {
  const res = await request(app).post('/login').send({ email: 'a@example.com', password: 'pw' });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeDefined();
});
