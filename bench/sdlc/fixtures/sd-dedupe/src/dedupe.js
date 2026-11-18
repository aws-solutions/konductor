'use strict';

/** The key two contacts share when they are the same person: the email without surrounding spaces, in lower case. */
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

/** The contacts with duplicates removed: the first contact of each email is kept, in input order. */
function dedupe(records) {
  const out = [];
  for (const r of records) {
    const key = normalizeEmail(r.email);
    if (!out.some((o) => normalizeEmail(o.email) === key)) out.push(r);
  }
  return out;
}

module.exports = { dedupe, normalizeEmail };
