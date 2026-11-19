const { sendJson, readJson } = require('../utils/json');
const { isEvent } = require('../utils/validation');
const { verifySignature } = require('../webhook-signature');

async function webhookHandler({ req, res, ledger, readBody, secrets, toleranceSeconds, clock }) {
  let body;
  try {
    body = await readBody(req);
  } catch (_error) {
    sendJson(res, 400, { error: 'invalid_request' });
    return;
  }
  const authorized = verifySignature({
    rawBody: body,
    header: req.headers['payment-signature'],
    secrets,
    now: clock,
    toleranceSeconds
  });
  if (!authorized) {
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

module.exports = { webhookHandler };
