const crypto = require('node:crypto');
const { unixSeconds } = require('./utils/time');

function parseSignatureHeader(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  let timestamp;
  const signatures = [];
  for (const part of value.split(',')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;
    const name = part.slice(0, separator).trim();
    const item = part.slice(separator + 1).trim();
    if (name === 't') {
      if (timestamp !== undefined || !/^\d+$/.test(item)) return null;
      timestamp = Number(item);
    } else if (name === 'v1') {
      if (!/^[a-f0-9]+$/i.test(item) || item.length % 2 !== 0) return null;
      signatures.push(item);
    } else {
      return null;
    }
  }
  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function constantTimeMatch(expected, supplied) {
  let candidate;
  try {
    candidate = Buffer.from(supplied, 'hex');
  } catch (_error) {
    candidate = Buffer.alloc(0);
  }
  const sameLength = candidate.length === expected.length;
  const comparable = sameLength ? candidate : Buffer.alloc(expected.length);
  if (!sameLength) candidate.copy(comparable, 0, 0, Math.min(candidate.length, comparable.length));
  const equal = crypto.timingSafeEqual(expected, comparable);
  return sameLength && equal;
}

function verifySignature({ rawBody, header, secrets, now = unixSeconds(), toleranceSeconds = 300 }) {
  const parsed = parseSignatureHeader(header);
  if (!parsed || !Array.isArray(secrets) || secrets.length === 0) return false;
  const current = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(current) || Math.abs(current - parsed.timestamp) > toleranceSeconds) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const payload = Buffer.concat([Buffer.from(`${parsed.timestamp}.`), body]);
  let matched = false;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    for (const supplied of parsed.signatures) {
      if (constantTimeMatch(expected, supplied)) matched = true;
    }
  }
  return matched;
}

module.exports = { parseSignatureHeader, verifySignature };
