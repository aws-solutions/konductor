'use strict';

// Public shape. fullName is a deprecated alias of displayName. Always a copy of the stored contact.
function toJson(contact) {
  return {
    id: contact.id,
    displayName: contact.displayName,
    fullName: contact.displayName,
    email: contact.email,
    phone: contact.phone ?? null,
    locale: contact.locale,
  };
}

const field = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// version 1 (default) keeps the legacy header; version 2 has displayName and locale.
function toCsv(contacts, { version = 1 } = {}) {
  const name = (c) => c.displayName ?? c.fullName;
  const head = version === 2 ? 'id,displayName,email,phone,locale' : 'id,fullName,email,phone';
  const rows = contacts.map((c) => {
    const cells = [c.id, name(c), c.email, c.phone ?? ''];
    if (version === 2) cells.push(c.locale ?? 'en');
    return cells.map(field).join(',');
  });
  return `${[head, ...rows].join('\n')}\n`;
}

module.exports = { toJson, toCsv };
