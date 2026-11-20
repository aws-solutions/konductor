const crypto = require('node:crypto');

function sign(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function verify(body, signature, secret) {
  if (typeof signature !== 'string') return false;
  const expected = sign(body, secret);
  const actual = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
}

module.exports = { sign, verify };
