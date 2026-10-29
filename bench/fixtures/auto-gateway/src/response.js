'use strict';

const ok = (body) => ({ status: 200, body });
const error = (status, message) => ({ status, body: { error: message } });

module.exports = { ok, error };
