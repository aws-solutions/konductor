const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { checkJsonFiles } = require('../scripts/lint.js');

describe('lint', () => {
  let tempDir;
  
  beforeEach(() => {
    // Create temp directory for tests
    tempDir = fs.mkdtempSync(path.join(__dirname, 'temp-'));
  });
  
  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  
  it('should pass with valid JSON files', () => {
    // Create valid JSON file
    const validFile = path.join(tempDir, 'valid.json');
    fs.writeFileSync(validFile, JSON.stringify({ test: true }));
    
    const hasErrors = checkJsonFiles(tempDir);
    assert.strictEqual(hasErrors, false);
  });
  
  it('should fail with invalid JSON files', () => {
    // Create invalid JSON file
    const invalidFile = path.join(tempDir, 'invalid.json');
    fs.writeFileSync(invalidFile, '{ invalid json');
    
    const hasErrors = checkJsonFiles(tempDir);
    assert.strictEqual(hasErrors, true);
  });
  
  it('should ignore non-JSON files', () => {
    // Create non-JSON file
    const textFile = path.join(tempDir, 'text.txt');
    fs.writeFileSync(textFile, 'not json');
    
    const hasErrors = checkJsonFiles(tempDir);
    assert.strictEqual(hasErrors, false);
  });
  
  it('should handle empty directory', () => {
    const hasErrors = checkJsonFiles(tempDir);
    assert.strictEqual(hasErrors, false);
  });
});