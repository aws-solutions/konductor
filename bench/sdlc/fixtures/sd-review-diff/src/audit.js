'use strict';

const entries = [];

/** Appends one audit entry; resolves when it is stored. */
async function audit(entry) {
  entries.push({ ...entry, at: entries.length + 1 });
}

module.exports = { audit, entries };
