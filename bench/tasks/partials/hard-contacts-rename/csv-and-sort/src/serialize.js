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

function toCsv(contacts) {
  const rows = contacts.map((c) => [c.id, c.displayName ?? c.fullName, c.email, c.phone ?? ''].join(','));
  return `${['id,fullName,email,phone', ...rows].join('\n')}\n`;
}

module.exports = { toJson, toCsv };
