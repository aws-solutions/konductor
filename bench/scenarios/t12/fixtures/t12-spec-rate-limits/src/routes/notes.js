'use strict';

const store = require('../store');

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function route(req, res, caller, send) {
  if (req.method === 'GET') return send(res, 200, { notes: store.list(caller.owner) });
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.text !== 'string' || !body.text.trim()) return send(res, 400, { error: 'text_required' });
    return send(res, 201, store.add(caller.owner, body.text.trim()));
  }
  return send(res, 405, { error: 'method_not_allowed' });
}

module.exports = { route };
