const bcrypt = require('bcryptjs');
jest.mock('../../src/services/store');
const store = require('../../src/services/store');
const { login } = require('../../src/services/auth');

describe('login', () => {
  test('returns a session for valid credentials', async () => {
    store.findUser.mockResolvedValue({ id: 'u1', email: 'a@x.io', passwordHash: await bcrypt.hash('pw', 4) });
    store.createSession.mockResolvedValue('sess-u1');
    await expect(login('a@x.io', 'pw')).resolves.toBe('sess-u1');
  });

  test('locks the account after 5 failed attempts', async () => {
    const user = { id: 'u1', email: 'a@x.io', passwordHash: await bcrypt.hash('pw', 4), failedAttempts: 4 };
    store.findUser.mockResolvedValue(user);
    await expect(login('a@x.io', 'wrong')).rejects.toThrow('INVALID');
    expect(user.lockedUntil).toBeGreaterThan(Date.now());
  });
});
