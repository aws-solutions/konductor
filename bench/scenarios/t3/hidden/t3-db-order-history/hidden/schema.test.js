const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = __dirname + '/..';
const SCHEMA_FILE = R + '/solution/db/schema.sql';

test('schema file exists', () => {
  assert(fs.existsSync(SCHEMA_FILE), 'schema.sql should exist');
});

test('schema contains CREATE TABLE statement', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert(schema.includes('CREATE TABLE'), 'Schema should contain CREATE TABLE');
});

test('schema defines primary key', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert(schema.includes('PRIMARY KEY'), 'Schema should define a primary key');
});

test('schema has UNIQUE constraint on order_number', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  // Look for UNIQUE constraint on order_number
  const hasUniqueOrderNumber = /UNIQUE.*order_number|order_number.*UNIQUE|CREATE UNIQUE INDEX.*order_number/i.test(schema);
  assert(hasUniqueOrderNumber, 'Schema should have UNIQUE constraint on order_number');
});

test('schema has NOT NULL constraints on critical columns', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const requiredNotNull = ['order_number', 'customer_id', 'order_date', 'warehouse_id', 'status'];
  
  for (const column of requiredNotNull) {
    const pattern = new RegExp(`${column}\\s+[^,)]+\\s+NOT NULL`, 'i');
    assert(pattern.test(schema), `Column ${column} should have NOT NULL constraint`);
  }
});

test('schema has CHECK constraint on status', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert(/CHECK.*status.*IN.*pending.*processing.*shipped.*delivered.*cancelled/i.test(schema) ||
         /status.*CHECK.*IN.*pending.*processing.*shipped.*delivered.*cancelled/i.test(schema),
         'Schema should have CHECK constraint on status values');
});

test('schema has appropriate indexes', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const indexStatements = schema.match(/CREATE (UNIQUE )?INDEX/g) || [];
  
  // Should have at least 2 indexes but not too many
  assert(indexStatements.length >= 2, 'Should have at least 2 indexes');
  assert(indexStatements.length <= 5, 'Should not have more than 5 indexes (storage limit)');
});

test('schema has composite indexes', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  
  // Check for composite index patterns
  const compositeIndexPatterns = [
    /CREATE INDEX.*customer_id.*order_date/i,
    /CREATE INDEX.*warehouse_id.*status.*order_date/i
  ];
  
  let compositeCount = 0;
  for (const pattern of compositeIndexPatterns) {
    if (pattern.test(schema)) compositeCount++;
  }
  
  assert(compositeCount >= 1, 'Should have at least one composite index');
});

test('schema is valid SQLite syntax', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  // Basic syntax checks
  assert(!schema.includes('SERIAL'), 'SQLite uses INTEGER PRIMARY KEY, not SERIAL');
  assert(!schema.includes('BIGSERIAL'), 'SQLite uses INTEGER PRIMARY KEY, not BIGSERIAL');
  assert(!schema.includes('JSONB'), 'SQLite uses TEXT for JSON, not JSONB');
});