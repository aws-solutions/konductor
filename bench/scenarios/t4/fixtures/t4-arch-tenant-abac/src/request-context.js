"use strict";

function createRequestContext(input) {
  if (!input || typeof input !== 'object') throw new TypeError('request is required');
  if (typeof input.tenantId !== 'string' || !/^[a-z0-9-]{3,64}$/.test(input.tenantId)) throw new Error('invalid tenant id');
  if (typeof input.requestId !== 'string' || input.requestId.length < 8) throw new Error('invalid request id');
  return Object.freeze({ requestId: input.requestId, tenantId: input.tenantId, tier: input.tier === 'premium' ? 'premium' : 'standard' });
}

module.exports = { createRequestContext };
