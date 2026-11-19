'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const R = path.join(__dirname, '..');
const schemaFile = path.join(R, 'solution', 'db', 'schema.sql');

function openDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(schemaFile, 'utf8'));
  db.exec("PRAGMA automatic_index = OFF");
  return db;
}

function seed(db) {
  const insert = db.prepare(`
    INSERT INTO tickets
      (ticket_id, tenant_id, ticket_key, title, status, priority, created_at, updated_at, assignee)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(1, 101, 'CASE-7', 'First tenant case', 'open', 2, '2025-01-01T09:00:00Z', '2025-01-01T09:20:00Z', 'a');
  insert.run(2, 202, 'CASE-7', 'Second tenant case', 'open', 2, '2025-01-01T10:00:00Z', '2025-01-01T10:20:00Z', 'b');
  insert.run(3, 303, 'CASE-8', 'Third tenant case', 'pending', 3, '2025-01-02T10:00:00Z', '2025-01-02T11:20:00Z', 'c');
  insert.run(4, 101, 'CASE-9', 'Older open case', 'open', 4, '2025-01-01T08:00:00Z', '2025-01-03T11:20:00Z', 'd');
}

function ticketIndexes(db) {
  return db.prepare("PRAGMA index_list('tickets')").all().map(row => {
    const columns = db.prepare(`PRAGMA index_info('${row.name.replaceAll("'", "''")}')`).all();
    return { name: row.name, unique: Boolean(row.unique), columns: columns.map(c => c.name) };
  });
}

function planDetails(db, sql, ...params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map(row => row.detail);
}

function hasTenantFirstSearch(db, sql, ...params) {
  const indexes = ticketIndexes(db);
  const tenantFirstNames = new Set(indexes.filter(i => i.columns[0] === 'tenant_id').map(i => i.name));
  return planDetails(db, sql, ...params).some(detail => {
    if (!detail.startsWith('SEARCH tickets USING INDEX ')) return false;
    const name = detail.slice('SEARCH tickets USING INDEX '.length).split(' ')[0];
    return tenantFirstNames.has(name);
  });
}

test('schema creates a tickets table with tenant_id and ticket_key', () => {
  const db = openDb();
  const columns = db.prepare("PRAGMA table_info('tickets')").all();
  assert.ok(columns.some(c => c.name === 'tenant_id'));
  assert.ok(columns.some(c => c.name === 'ticket_key'));
});

test('same human-readable key is allowed in two tenants', () => {
  const db = openDb();
  seed(db);
  const rows = db.prepare("SELECT tenant_id FROM tickets WHERE ticket_key = 'CASE-7' ORDER BY tenant_id").all();
  assert.deepEqual(rows.map(r => r.tenant_id), [101, 202]);
});

test('same key remains unique within one tenant', () => {
  const db = openDb();
  seed(db);
  assert.throws(() => db.prepare(`
    INSERT INTO tickets (ticket_id, tenant_id, ticket_key, title, status, priority, created_at, updated_at)
    VALUES (5, 101, 'CASE-7', 'duplicate', 'open', 3, '2025-01-03T00:00:00Z', '2025-01-03T00:00:00Z')
  `).run());
});

test('every tickets index has tenant_id as its first indexed column', () => {
  const db = openDb();
  const indexes = ticketIndexes(db);
  assert.ok(indexes.length >= 3);
  for (const index of indexes) assert.equal(index.columns[0], 'tenant_id', index.name);
});

test('the human-key uniqueness index is tenant-first', () => {
  const db = openDb();
  const unique = ticketIndexes(db).filter(i => i.unique);
  assert.ok(unique.some(i => i.columns.slice(0, 2).join(',') === 'tenant_id,ticket_key'));
});

test('ticket-key lookup searches through a tenant-first index', () => {
  const db = openDb();
  seed(db);
  assert.equal(hasTenantFirstSearch(db, `
    SELECT ticket_id, title FROM tickets
    WHERE tenant_id = ? AND ticket_key = ?
  `, 101, 'CASE-7'), true);
});

test('tenant status queue searches through a tenant-first index', () => {
  const db = openDb();
  seed(db);
  assert.equal(hasTenantFirstSearch(db, `
    SELECT ticket_id, title FROM tickets
    WHERE tenant_id = ? AND status = ?
    ORDER BY created_at DESC LIMIT 20
  `, 101, 'open'), true);
});

test('tenant recent-ticket view searches through a tenant-first index', () => {
  const db = openDb();
  seed(db);
  assert.equal(hasTenantFirstSearch(db, `
    SELECT ticket_id, ticket_key FROM tickets
    WHERE tenant_id = ?
    ORDER BY updated_at DESC LIMIT 20
  `, 202), true);
});
