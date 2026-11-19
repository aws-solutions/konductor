'use strict';

const entries = [];

function recordAudit(event, details = {}) {
  entries.push({ event, details: { ...details }, at: new Date().toISOString() });
}

function listAudit() {
  return entries.map((entry) => ({ ...entry, details: { ...entry.details } }));
}

function clearAudit() {
  entries.length = 0;
}

module.exports = { recordAudit, listAudit, clearAudit };
