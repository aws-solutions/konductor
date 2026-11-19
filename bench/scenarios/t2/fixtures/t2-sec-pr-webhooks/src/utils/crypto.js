/**
 * Cryptographic utilities
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Generate a random secret key
 * @param {number} length - Length in bytes (default: 32)
 * @returns {string} Hex-encoded secret
 */
export function generateSecret(length = 32) {
  return randomBytes(length).toString('hex');
}

/**
 * Create a signature for data
 * @param {string|Buffer} data - Data to sign
 * @param {string} secret - Secret key (hex encoded)
 * @param {string} algorithm - Hash algorithm (default: 'sha256')
 * @returns {string} Signature in hex format
 */
export function createSignature(data, secret, algorithm = 'sha256') {
  const hmac = createHmac(algorithm, Buffer.from(secret, 'hex'));
  hmac.update(data);
  return hmac.digest('hex');
}

/**
 * Verify a signature
 * @param {string|Buffer} data - Original data
 * @param {string} signature - Expected signature (hex)
 * @param {string} secret - Secret key (hex encoded)
 * @param {string} algorithm - Hash algorithm (default: 'sha256')
 * @returns {boolean} True if signature is valid
 */
export function verifySignature(data, signature, secret, algorithm = 'sha256') {
  const expected = createSignature(data, secret, algorithm);
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex')
  );
}

/**
 * Constant-time string comparison (for non-crypto use)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
export function safeCompare(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}