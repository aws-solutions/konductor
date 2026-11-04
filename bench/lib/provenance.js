// SPDX-License-Identifier: Apache-2.0
/**
 * Content-addressed digests for benchmark records.
 *
 * `sha256` hashes a string or Buffer by its bytes, and any other value by its JSON form with
 * object keys sorted at every depth, so two equal values hash the same whatever order their keys
 * were written in. Array order matters. It is pure and dependency-free apart from node:crypto.
 */
const crypto = require('node:crypto');

/** Returns a copy of `value` with the keys of every nested object in sorted order. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

/** Hex SHA-256 of a string, a Buffer, or the stable JSON form of any other value. */
function sha256(value) {
  const input =
    typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(stable(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = { stable, sha256 };
