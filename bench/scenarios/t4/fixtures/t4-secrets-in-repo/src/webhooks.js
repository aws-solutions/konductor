const crypto = require('node:crypto');

function verifySignature(payload, signature, secret) {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const actual = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actual);
}

module.exports = { verifySignature };
