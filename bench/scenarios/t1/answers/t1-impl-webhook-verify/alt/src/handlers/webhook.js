const crypto = require('node:crypto');
const { sendJson, readJson } = require('../utils/json');
const { isEvent } = require('../utils/validation');
const { parseSignatureHeader, isTimestampValid } = require('../utils/signature');
const { computeHmac, constantTimeCompare } = require('../utils/hmac');

/**
 * Verify a webhook signature against one or more secrets.
 * @param {Buffer} body - Raw request body
 * @param {number} timestamp - Timestamp from signature header
 * @param {string[]} signatures - Signatures from header
 * @param {(string|null)[]} secrets - Array of secrets to try (primary, secondary)
 * @returns {boolean} True if any signature matches any secret
 */
function verifySignature(body, timestamp, signatures, secrets) {
  const payload = `${timestamp}.${body.toString()}`;
  
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = computeHmac(secret, payload);
    for (const sig of signatures) {
      if (constantTimeCompare(sig, expected)) return true;
    }
  }
  
  return false;
}

async function webhookHandler({ req, res, ledger, readBody, secrets, toleranceSeconds, clock }) {
  // Parse signature header
  const sigHeader = req.headers['payment-signature'];
  const parsed = parseSignatureHeader(sigHeader);
  
  if (!parsed) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  
  // Read raw body
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }
  
  // Check timestamp validity
  const now = clock();
  if (!isTimestampValid(parsed.timestamp, now, toleranceSeconds)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  
  // Verify signature
  const validSecrets = [secrets?.primary, secrets?.secondary];
  if (!verifySignature(body, parsed.timestamp, parsed.signatures, validSecrets)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  
  // Parse and validate event
  let event;
  try {
    event = readJson(body);
  } catch (_error) {
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }
  
  if (!isEvent(event)) {
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }
  
  // Apply event to ledger (idempotent)
  const result = ledger.apply(event);
  sendJson(res, 200, { ok: true, duplicate: result.duplicate });
}

module.exports = { webhookHandler, verifySignature };
