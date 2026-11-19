const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const R = path.join(__dirname, '..');
const SCHEMA_FILE = path.join(R, 'solution', 'db', 'schema.sql');

test('schema file is valid SQL', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8');
  assert(schema.length > 0, 'Schema file should not be empty');
  
  // Basic SQL syntax checks
  assert(schema.includes('CREATE TABLE'), 'Schema should contain CREATE TABLE statement');
  assert(schema.includes('audit_log'), 'Schema should reference audit log table');
});

test('schema includes required indexes', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8').toLowerCase();
  
  // Check for time-based index
  assert(schema.includes('event_time') || schema.includes('timestamp'), 
    'Schema should include time-based column');
  
  // Check for index creation
  assert(schema.includes('create index') || schema.includes('index on'), 
    'Schema should create indexes');
});

test('schema supports retention cleanup without full scan', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8').toLowerCase();
  
  // Check for partitioning or bucket strategy
  const hasPartition = schema.includes('partition by') || schema.includes('partitioned by');
  const hasBucket = schema.includes('bucket') && schema.includes('month');
  
  assert(hasPartition || hasBucket, 
    'Schema should use partitioning or monthly buckets for efficient retention cleanup');
});

test('schema defines appropriate columns', () => {
  const schema = fs.readFileSync(SCHEMA_FILE, 'utf8').toLowerCase();
  
  // Should have common audit log columns
  const requiredColumns = ['event_time', 'user_id', 'action', 'resource'];
  const foundColumns = requiredColumns.filter(col => schema.includes(col));
  
  assert(foundColumns.length >= 2, 
    `Schema should include common audit columns (found: ${foundColumns.join(', ')})`);
});