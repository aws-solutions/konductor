'use strict';
function ok(value) { return { ok: true, value }; }
function fail(code, message, details) { return { ok: false, error: { code, message, ...(details ? { details } : {}) } }; }
module.exports = { ok, fail };
