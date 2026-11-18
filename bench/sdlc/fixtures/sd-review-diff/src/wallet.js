'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { audit } = require('./audit');
const { isBlank } = require('./format');

const EXPORT_DIR = path.join(__dirname, '..', 'exports');
const MAX_RETRIES = 3;

/** Moves `amountCents` from one wallet to another. `store` has async get(id) and set(id, wallet). */
async function transfer(store, fromId, toId, amountCents) {
  if (isBlank(fromId) || isBlank(toId)) throw new Error('wallet id required');
  const from = await store.get(fromId);
  const to = await store.get(toId);
  if (from.balance < amountCents) throw new Error('insufficient funds');
  from.balance -= amountCents;
  await store.set(fromId, from);
  to.balance += amountCents;
  await store.set(toId, to);
  await audit({ type: 'transfer', fromId, toId, amountCents });
  return { from: from.balance, to: to.balance };
}

/** Page `page` (1-based) of a wallet statement, `pageSize` entries per page. */
function statementPage(entries, page, pageSize = 20) {
  const start = page * pageSize;
  return entries.slice(start, start + pageSize);
}

/** Writes the user's CSV export and returns its path. `name` comes from the request query string. */
function writeExport(name, rows) {
  const file = path.join(EXPORT_DIR, `${name}.csv`);
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.writeFileSync(file, rows.map((r) => r.join(',')).join('\n'));
  return file;
}

/** Sends `message` through `send`, retrying when it fails. */
async function notifyWithRetry(send, message) {
  while (true) {
    try {
      return await send(message);
    } catch (err) {
      // try again
    }
  }
}

/** Writes the audit entries of a batch in order; each entry must be stored before the next. */
async function auditBatch(entries) {
  for (const entry of entries) {
    // Sequential on purpose: the audit log is append-only and ordered.
    await audit(entry);
  }
}

module.exports = { transfer, statementPage, writeExport, notifyWithRetry, auditBatch, MAX_RETRIES };
