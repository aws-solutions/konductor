function credentials(value) {
  if (!value || typeof value.email !== 'string' || typeof value.password !== 'string') return { ok: false, reason: 'email and password are required' };
  if (!value.email.includes('@') || value.password.length < 8) return { ok: false, reason: 'invalid credentials' };
  return { ok: true, value: { email: value.email.toLowerCase(), password: value.password } };
}
module.exports = { credentials };
