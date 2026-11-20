/**
 * Parse the payment-signature header.
 * Format: t=<unix seconds>,v1=<hex signature> with repeated v1 values allowed.
 * @param {string|undefined} header - The payment-signature header value
 * @returns {{timestamp: number, signatures: string[]}|null} Parsed result or null if malformed
 */
function parseSignatureHeader(header) {
  if (!header || typeof header !== 'string') return null;
  
  const parts = header.split(',');
  let timestamp = null;
  const signatures = [];
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith('t=')) {
      const value = trimmed.slice(2);
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0) return null;
      timestamp = parsed;
    } else if (trimmed.startsWith('v1=')) {
      const value = trimmed.slice(3);
      if (!/^[a-fA-F0-9]+$/.test(value)) return null;
      signatures.push(value.toLowerCase());
    }
  }
  
  if (timestamp === null || signatures.length === 0) return null;
  
  return { timestamp, signatures };
}

/**
 * Check if a timestamp is within the tolerance window.
 * @param {number} timestamp - Unix timestamp to check
 * @param {number} now - Current unix timestamp
 * @param {number} toleranceSeconds - Tolerance window in seconds
 * @returns {boolean} True if timestamp is valid
 */
function isTimestampValid(timestamp, now, toleranceSeconds) {
  const diff = Math.abs(timestamp - now);
  return diff <= toleranceSeconds;
}

module.exports = { parseSignatureHeader, isTimestampValid };
