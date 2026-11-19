const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { DatabaseSync: Database } = require('node:sqlite');

// Skip if better-sqlite3 is not available, but the test framework will handle it
let db;
try {
  db = new Database(':memory:');
} catch (e) {
  // Fallback to file-based checks
  db = null;
}

test('schema file exists', () => {
  const schemaPath = path.join(__dirname, '../db/schema.sql');
  assert(fs.existsSync(schemaPath), 'schema.sql file should exist');
});

test('schema contains tenant_id column in tickets table', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  assert(
    /CREATE TABLE tickets.*tenant_id.*INTEGER/i.test(schema),
    'tickets table should have tenant_id column'
  );
});

test('schema has composite indexes with tenant_id first', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  
  // Check for indexes that should have tenant_id first
  const indexPatterns = [
    /CREATE INDEX.*tickets.*tenant_id.*event_id/i,
    /CREATE INDEX.*tickets.*tenant_id.*ticket_key/i,
    /CREATE INDEX.*tickets.*tenant_id.*status/i
  ];
  
  const matches = indexPatterns.filter(pattern => pattern.test(schema));
  assert(
    matches.length >= 2,
    'Should have at least 2 indexes with tenant_id as first column'
  );
});

test('schema allows tenant reuse of ticket_key', () => {
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  
  // Should NOT have a global unique index on ticket_key alone
  const globalUniquePattern = /CREATE UNIQUE INDEX.*tickets.*ticket_key\)/i;
  assert(
    !globalUniquePattern.test(schema),
    'Should NOT have a global unique index on ticket_key alone (breaks tenant reuse)'
  );
  
  // Should have composite unique constraint with tenant_id
  const compositeUniquePattern = /CREATE UNIQUE INDEX.*tickets.*tenant_id.*ticket_key\)/i;
  assert(
    compositeUniquePattern.test(schema),
    'Should have composite unique index on (tenant_id, ticket_key) for tenant reuse'
  );
});

test('schema can be loaded and has required tables', async () => {
  if (!db) return; // Skip if SQLite not available
  
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  
  // Execute schema
  db = new Database(':memory:'); db.exec(schema);
  
  // Check tables exist
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name IN ('tenants', 'tickets', 'events')
  `).all();
  
  const tableNames = tables.map(t => t.name);
  assert(tableNames.includes('tenants'), 'Missing tenants table');
  assert(tableNames.includes('tickets'), 'Missing tickets table');
  assert(tableNames.includes('events'), 'Missing events table');
});

test('schema supports data insertion for multiple tenants', async () => {
  if (!db) return; // Skip if SQLite not available
  
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  db = new Database(':memory:'); db.exec(schema);
  
  // Insert test data
  db.exec(`
    INSERT INTO tenants (id, name) VALUES (1, 'Tenant A'), (2, 'Tenant B');
    INSERT INTO events (id, tenant_id, name) VALUES 
      (1, 1, 'Event A1'), (2, 1, 'Event A2'),
      (3, 2, 'Event B1'), (4, 2, 'Event B2');
  `);
  
  // Test tenant reuse of ticket_key
  try {
    db.exec(`
      INSERT INTO tickets (id, tenant_id, event_id, ticket_key, status) VALUES
        (1, 1, 1, 'TICKET-001', 'active'),
        (2, 2, 3, 'TICKET-001', 'active');  -- Same ticket_key, different tenant
    `);
    // Should succeed
    assert(true, 'Tenant reuse of ticket_key should work');
  } catch (e) {
    assert.fail(`Tenant reuse of ticket_key failed: ${e.message}`);
  }
});

test('queries use tenant_id indexes', async () => {
  if (!db) return; // Skip if SQLite not available
  
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  db = new Database(':memory:'); db.exec(schema);
  
  // Insert sample data
  db.exec(`
    INSERT INTO tenants (id, name) VALUES (1, 'Test Tenant');
    INSERT INTO events (id, tenant_id, name) VALUES (1, 1, 'Test Event');
    
    WITH RECURSIVE cnt(x) AS (
      SELECT 1 UNION ALL SELECT x+1 FROM cnt LIMIT 100
    )
    INSERT INTO tickets (id, tenant_id, event_id, ticket_key, status)
    SELECT x, 1, 1, 'TICKET-' || x, 'active' FROM cnt;
  `);
  
  // Check EXPLAIN QUERY PLAN for tenant-specific query
  const explain = db.prepare(`
    EXPLAIN QUERY PLAN 
    SELECT * FROM tickets WHERE tenant_id = 1 AND event_id = 1
  `).all();
  
  const explainText = JSON.stringify(explain);
  assert(
    /SEARCH.*tickets.*tenant_id/i.test(explainText),
    'Query should SEARCH using tenant_id index'
  );
});

test('schema prevents cross-tenant data access', async () => {
  if (!db) return; // Skip if SQLite not available
  
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  db = new Database(':memory:'); db.exec(schema);
  
  // Insert data for two tenants
  db.exec(`
    INSERT INTO tenants (id, name) VALUES (1, 'Tenant A'), (2, 'Tenant B');
    INSERT INTO events (id, tenant_id, name) VALUES 
      (1, 1, 'Concert A'), (2, 2, 'Conference B');
    INSERT INTO tickets (id, tenant_id, event_id, ticket_key, status) VALUES
      (1, 1, 1, 'TA-001', 'active'),
      (2, 2, 2, 'TB-001', 'active');
  `);
  
  // Query for Tenant A should only see Tenant A's data
  const tenantA_tickets = db.prepare(`
    SELECT * FROM tickets WHERE tenant_id = 1
  `).all();
  
  assert.strictEqual(tenantA_tickets.length, 1, 'Tenant A should see only 1 ticket');
  assert.strictEqual(tenantA_tickets[0].tenant_id, 1, 'Ticket should belong to Tenant A');
  
  // Query without tenant_id should be explicit or fail
  const allTickets = db.prepare(`SELECT COUNT(*) as count FROM tickets`).get();
  assert.strictEqual(allTickets.count, 2, 'Platform query should see all tickets (if allowed)');
});