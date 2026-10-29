'use strict';

function toJson(contact) {
  const out = contact;
  if (out.phone === undefined) out.phone = null;
  return out;
}

function toCsv(contacts) {
  const rows = contacts.map((c) => [c.id, c.fullName, c.email, c.phone ?? ''].join(','));
  return `${['id,fullName,email,phone', ...rows].join('\n')}\n`;
}

module.exports = { toJson, toCsv };
