const { readDecision, near } = require('./decision-lib.js');
const { test } = require('node:test');
const assert = require('node:assert');

const R = __dirname + '/..';
const DECISION_FILE = R + '/solution/docs/decision.md';

// Storage calculations based on fixture data
const ORDER_LINES = 900000000; // 900 million
const BASE_ROW_SIZE_BYTES = 2560; // 2.5 KB = 2560 bytes
const INDEX_ENTRY_SIZE_BYTES = 183; // From calculations
const STORAGE_LIMIT_TB = 2.5;
const STORAGE_LIMIT_BYTES = STORAGE_LIMIT_TB * 1024 * 1024 * 1024 * 1024;

function calculateStorage(indexCount) {
  const baseDataBytes = ORDER_LINES * BASE_ROW_SIZE_BYTES;
  const indexBytes = ORDER_LINES * INDEX_ENTRY_SIZE_BYTES * indexCount;
  const totalBytes = baseDataBytes + indexBytes;
  const totalTB = totalBytes / (1024 * 1024 * 1024 * 1024);
  return totalTB;
}

test('storage calculation for chosen option is reasonable', () => {
  const decision = readDecision(DECISION_FILE);
  const storageTB = decision.limits.storage_tb?.value;
  
  assert(storageTB, 'Storage value should be defined');
  assert(typeof storageTB === 'number', 'Storage should be a number');
  assert(storageTB > 0, 'Storage should be positive');
  
  // For composite-optimized (should have ~3 indexes)
  if (decision.chosen === 'composite-optimized') {
    const expectedStorage = calculateStorage(3); // 3 indexes
    assert(near(storageTB, expectedStorage, 0.1),
      `Storage for composite-optimized should be near ${expectedStorage.toFixed(2)} TB with 3 indexes`);
  }
  
  // two-table-normalized is projected at 2.61 TB (prototype-results.md), over the 2.5 TB limit
  assert(decision.chosen !== 'two-table-normalized',
    'two-table-normalized is projected at 2.61 TB, over the 2.5 TB limit');
});

test('storage does not exceed limit for chosen option', () => {
  const decision = readDecision(DECISION_FILE);
  const storageTB = decision.limits.storage_tb?.value;
  
  if (storageTB) {
    assert(storageTB <= STORAGE_LIMIT_TB,
      `Storage ${storageTB} TB exceeds limit ${STORAGE_LIMIT_TB} TB`);
    
    // If exactly at limit, that's acceptable
    if (storageTB === STORAGE_LIMIT_TB) {
      console.log('Note: Storage is exactly at limit (acceptable)');
    }
  }
});

test('tempting option would exceed storage limit', () => {
  // Calculate what tempting option (single-column-all) would use
  // 7+ indexes as mentioned in fixture
  const temptingStorageTB = calculateStorage(7);
  
  assert(temptingStorageTB > STORAGE_LIMIT_TB,
    `Tempting option should exceed limit: ${temptingStorageTB.toFixed(2)} TB > ${STORAGE_LIMIT_TB} TB`);
  
  // Verify it's around 3.1 TB as mentioned in brief
  assert(near(temptingStorageTB, 3.1, 0.05),
    `Tempting option should be ~3.1 TB, got ${temptingStorageTB.toFixed(2)} TB`);
});

test('storage value matches limit calculation', () => {
  const decision = readDecision(DECISION_FILE);
  
  if (decision.limits.storage_tb) {
    const { limit, value } = decision.limits.storage_tb;
    
    // Limit should be exactly 2.5
    assert.strictEqual(limit, STORAGE_LIMIT_TB,
      `storage_tb.limit should be exactly ${STORAGE_LIMIT_TB}`);
    
    // Value should be ≤ limit
    assert(value <= limit,
      `storage_tb.value ${value} should be ≤ limit ${limit}`);
    
    // For composite-optimized, value should be close to limit
    if (decision.chosen === 'composite-optimized') {
      const diff = limit - value;
      assert(diff >= 0, 'Value should not exceed limit');
      // Can be exactly at limit or slightly under
      if (diff > 0) {
        assert(diff < 0.5, 'Should be close to limit if not at limit');
      }
    }
  }
});