const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');
const { blockOf } = require('./doc-key.js');

const CSV_PATH = join(__dirname, '..', 'docs', 'release-notes.csv');

// Since this is a CSV conversion task, not a document analysis task,
// we'll read the CSV directly rather than looking for a JSON block
function parseCSV() {
  try {
    const content = readFileSync(CSV_PATH, 'utf8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return { headers: [], rows: [] };
    
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const fields = [];
      let currentField = '';
      let inQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          fields.push(currentField);
          currentField = '';
        } else {
          currentField += char;
        }
      }
      fields.push(currentField);
      
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = fields[idx] ? fields[idx].trim() : '';
      });
      rows.push(row);
    }
    
    return { headers, rows };
  } catch (error) {
    return { headers: [], rows: [] };
  }
}

test('CSV file exists and is not empty', () => {
  const content = readFileSync(CSV_PATH, 'utf8');
  assert.ok(content.length > 0, 'CSV file should exist and contain data');
  assert.ok(content.includes('version'), 'CSV should contain version column');
  assert.ok(content.includes('date'), 'CSV should contain date column');
  assert.ok(content.includes('type'), 'CSV should contain type column');
  assert.ok(content.includes('summary'), 'CSV should contain summary column');
});

test('CSV has correct structure with 4 columns', () => {
  const { headers } = parseCSV();
  assert.deepStrictEqual(
    headers,
    ['version', 'date', 'type', 'summary'],
    'CSV must have exactly columns: version, date, type, summary'
  );
});

test('Trap 1: Handles bullets with commas and quotes correctly', () => {
  const { rows } = parseCSV();
  // Look for the specific trap: account names with "quotes, commas, and other punctuation"
  const trapRow = rows.find(row => 
    row.summary && row.summary.includes('quotes, commas, and other punctuation')
  );
  assert.ok(trapRow, 'Should handle bullet with comma and quotes: "quotes, commas, and other punctuation"');
  
  // Check it's properly quoted in CSV - the field contains commas so must be quoted
  const csvContent = readFileSync(CSV_PATH, 'utf8');
  const lines = csvContent.split('\n');
  const trapLine = lines.find(line => line.includes('quotes, commas, and other punctuation'));
  assert.ok(trapLine, 'Should find the line with the trap');
  
  // Simple check: count commas in the line
  let commaCount = 0;
  let inQuotes = false;
  for (let i = 0; i < trapLine.length; i++) {
    if (trapLine[i] === '"') {
      // Handle escaped quotes (two quotes in a row)
      if (i + 1 < trapLine.length && trapLine[i + 1] === '"') {
        i++; // Skip the next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (trapLine[i] === ',' && !inQuotes) {
      commaCount++;
    }
  }
  // Should have exactly 3 commas (4 fields)
  assert.strictEqual(commaCount, 3, 'Line should be valid CSV with exactly 4 fields despite comma in text');
});

test('Trap 2: Normalizes date format consistently', () => {
  const { rows } = parseCSV();
  // Version 6.1.3 has date "Jan 28, 2024" in source - should be normalized
  const version613Rows = rows.filter(row => row.version === '6.1.3');
  assert.ok(version613Rows.length > 0, 'Should have rows for version 6.1.3');
  
  // All 6.1.3 rows should have ISO date
  const allISO = version613Rows.every(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
  assert.ok(allISO, 'Version 6.1.3 dates should be normalized to ISO format (was "Jan 28, 2024" in source)');
  assert.ok(version613Rows[0].date === '2024-01-28', 'Date should be 2024-01-28 for version 6.1.3');
});

test('Trap 3: Handles multi-line bullet points', () => {
  const { rows } = parseCSV();
  // In source markdown, some bullets continue on next line with 2-space indent
  // All summaries should be single-line (no newlines)
  const multiLineRows = rows.filter(row => row.summary.includes('\n'));
  assert.strictEqual(multiLineRows.length, 0, 'No summary should contain newlines (multi-line bullets should be concatenated)');
  
  // Check that we have the right content despite line wrapping
  const allSummaries = rows.map(row => row.summary.toLowerCase()).join(' ');
  assert.ok(allSummaries.includes('loading indicators'), 'Should include content from potentially multi-line bullets');
  assert.ok(allSummaries.includes('offline mode'), 'Should include content from potentially multi-line bullets');
});

test('Each version has correct number of entries', () => {
  const { rows } = parseCSV();
  const versionCounts = {};
  rows.forEach(row => {
    versionCounts[row.version] = (versionCounts[row.version] || 0) + 1;
  });
  
  // Based on the source markdown:
  assert.strictEqual(versionCounts['6.2.0'], 12, 'Version 6.2.0: 4 New Features + 4 Improvements + 4 Bug Fixes = 12');
  assert.strictEqual(versionCounts['6.1.3'], 6, 'Version 6.1.3: 3 Improvements + 3 Bug Fixes = 6');
  assert.strictEqual(versionCounts['6.1.2'], 3, 'Version 6.1.2: 3 Bug Fixes = 3');
  assert.strictEqual(versionCounts['6.1.1'], 5, 'Version 6.1.1: 3 Security Updates + 2 Bug Fixes = 5');
  assert.strictEqual(versionCounts['6.1.0'], 9, 'Version 6.1.0: 3 New Features + 3 Improvements + 3 Bug Fixes = 9');
});

test('Type categories are correctly assigned', () => {
  const { rows } = parseCSV();
  const validTypes = ['New Features', 'Improvements', 'Bug Fixes', 'Security Updates', 'Documentation'];
  
  // All rows should have valid types
  const invalidTypes = rows.filter(row => !validTypes.includes(row.type));
  assert.strictEqual(invalidTypes.length, 0, `All rows should have valid type. Invalid: ${invalidTypes.map(r => r.type).join(', ')}`);
  
  // Check specific type assignments
  const securityRows = rows.filter(row => row.type === 'Security Updates');
  assert.ok(securityRows.length >= 5, 'Should have security update rows (6.1.1, 6.0.4, 5.7.2)');
  
  const docRows = rows.filter(row => row.type === 'Documentation');
  assert.ok(docRows.length >= 2, 'Should have documentation rows (6.0.4)');
});

test('All bullets from source are included', () => {
  const { rows } = parseCSV();
  // Should have exactly 67 rows (total bullets in source)
  assert.strictEqual(rows.length, 67, 'Should have one row per bullet point from source (67 total)');
});

test('CSV is properly formatted (no parsing errors)', () => {
  const { headers, rows } = parseCSV();
  assert.strictEqual(headers.length, 4, 'Should have 4 headers');
  assert.strictEqual(rows.length, 67, 'Should have 67 data rows');
  
  // Check no row has wrong number of fields
  const csvContent = readFileSync(CSV_PATH, 'utf8');
  const lines = csvContent.trim().split('\n');
  const dataLines = lines.slice(1);
  
  const badLines = dataLines.filter(line => {
    // Count commas not inside quotes
    let commaCount = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inQuotes = !inQuotes;
      } else if (line[i] === ',' && !inQuotes) {
        commaCount++;
      }
    }
    return commaCount !== 3; // Need 3 commas for 4 fields
  });
  
  assert.strictEqual(badLines.length, 0, `All CSV rows should have exactly 4 fields. Problem lines: ${badLines.length}`);
});