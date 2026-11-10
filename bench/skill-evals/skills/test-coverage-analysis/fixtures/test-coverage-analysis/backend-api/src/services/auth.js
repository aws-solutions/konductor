const bcrypt = require('bcryptjs');
const mail = require('@sendgrid/mail');
const store = require('./store');

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

async function login(email, password) {
  const user = await store.findUser(email);
  if (!user) throw new Error('INVALID');
  if (user.lockedUntil && user.lockedUntil > Date.now()) throw new Error('LOCKED');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    user.failedAttempts = (user.failedAttempts || 0) + 1;
    if (user.failedAttempts >= MAX_ATTEMPTS) user.lockedUntil = Date.now() + LOCK_MS;
    await store.saveUser(user);
    throw new Error('INVALID');
  }
  user.failedAttempts = 0;
  await store.saveUser(user);
  return store.createSession(user.id);
}

async function requestReset(email) {
  const user = await store.findUser(email);
  if (!user) return; // do not reveal whether the email exists
  const token = await store.createResetToken(user.id);
  await mail.send({ to: email, from: 'no-reply@shop.example', subject: 'Reset your password', text: `/reset?token=${token}` });
}

async function resetPassword(token, newPassword) {
  const record = await store.findResetToken(token);
  if (!record || record.used) throw new Error('INVALID_TOKEN');
  if (Date.now() - record.createdAt > RESET_TTL_MS) throw new Error('EXPIRED_TOKEN');
  await store.setPassword(record.userId, await bcrypt.hash(newPassword, 10));
  await store.markResetTokenUsed(token);
}

module.exports = { login, requestReset, resetPassword };
