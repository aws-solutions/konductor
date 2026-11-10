// In-memory store used by the service layer; replaced by Postgres in production.
const users = new Map();
module.exports = {
  findUser: async (email) => users.get(email),
  saveUser: async (u) => users.set(u.email, u),
  createSession: async (id) => `sess-${id}`,
  createResetToken: async () => 'tok',
  findResetToken: async () => null,
  setPassword: async () => {},
  markResetTokenUsed: async () => {},
  saveOrder: async (o) => ({ id: 'ord-1', ...o }),
};
