"use strict";

function summarize(item) {
  if (!item || typeof item !== 'object') return null;
  return { tenantId: item.tenantId || null, documentCount: Number(item.documentCount || 0), updatedAt: item.updatedAt || null };
}

module.exports = { summarize };
