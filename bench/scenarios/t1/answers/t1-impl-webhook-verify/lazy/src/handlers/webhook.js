const crypto = require('node:crypto');
const { sendJson, readJson } = require('../utils/json');
const { isEvent } = require('../utils/validation');

function parseSignature(header) {
  if (!header) return null;
  const parts = header.split(',');
  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    else if (part.startsWith('v1=')) signatures.push(part.slice(3));
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp: Number(timestamp), signatures };
}

function parseSignature(header) {
  if (!header) return null;
  const parts = header.split(',');
  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    if (part.startsWith('t=')) timestamp = part.slice(2);
    else if (part.startsWith('v1=')) signatures.push(part.slice(3));
  }
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp: Number(timestamp), signatures };
}

async function webhookHandler({ req, res, ledger, readBody }) {
  const sigHeader = req.headers['payment-signature'];
  const parsed = parseSignature(sigHeader);
  if (!parsed) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }
  
  const secret = process.env.WEBHOOK_SECRET_PRIMARY || 'default-secret';
  const payload = `${parsed.timestamp}.${body.toString()}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  
  let valid = false;
  for (const sig of parsed.signatures) {
    if (sig === expected) valid = true;
  }
  if (!valid) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  
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
  const result = ledger.apply(event);
  sendJson(res, 200, { ok: true, duplicate: result.duplicate });
}

module.exports = { webhookHandler, parseSignature };
