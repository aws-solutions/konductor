const crypto = require('node:crypto');

/**
 * Compute HMAC-SHA256 for the given payload and secret.
 * @param {string} secret - The secret key
 * @param {string} payload - The payload to sign
 * @returns {string} Hex-encoded signature
 */
function computeHmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Compare two strings in constant time to prevent timing attacks.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

module.exports = { computeHmac, constantTimeCompare };
