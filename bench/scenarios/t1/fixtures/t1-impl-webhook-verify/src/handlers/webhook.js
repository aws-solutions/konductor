const { sendJson, readJson } = require('../utils/json');
const { isEvent } = require('../utils/validation');

async function webhookHandler({ req, res, ledger, readBody }) {
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    sendJson(res, error.code === 'TOO_LARGE' ? 400 : 400, { error: 'invalid_request' });
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
