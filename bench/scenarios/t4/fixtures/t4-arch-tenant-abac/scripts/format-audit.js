#!/usr/bin/env node
'use strict';

function formatAudit(event) {
  return JSON.stringify({
    requestId: event.requestId || 'unknown',
    operation: event.operation || 'unknown',
    tenantId: event.tenantId || null,
    outcome: event.outcome || 'unrecorded'
  });
}

module.exports = { formatAudit };
