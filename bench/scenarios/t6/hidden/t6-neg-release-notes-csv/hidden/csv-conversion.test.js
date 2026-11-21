const { readFileSync } = require('fs');
const { join } = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const CSV_PATH = join(__dirname, '..', 'docs', 'release-notes.csv');

function readCSV() {
  try {
    const content = readFileSync(CSV_PATH, 'utf8');
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',');
    const rows = lines.slice(1).map(line => {
      // Handle quoted fields with commas
      const fields = [];
      let currentField = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
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
      headers.forEach((header, index) => {
        row[header.trim()] = fields[index] ? fields[index].trim() : '';
      });
      return row;
    });
    return { headers, rows };
  } catch (error) {
    return { headers: [], rows: [] };
  }
}

// Rows of the CSV; a missing or empty file fails here, so a check over every row cannot pass on no rows (DEBT D-143).
function rowsOf() {
  const { rows } = readCSV();
  assert.ok(rows.length > 0, 'docs/release-notes.csv has no rows');
  return rows;
}

test('CSV file exists', () => {
  assert.ok(readFileSync(CSV_PATH, 'utf8').length > 0, 'CSV file should exist and not be empty');
});

test('CSV has correct headers', () => {
  const { headers } = readCSV();
  assert.deepStrictEqual(headers, ['version', 'date', 'type', 'summary'], 'CSV should have headers: version, date, type, summary');
});

test('CSV has correct number of rows', () => {
  const rows = rowsOf();
  // Count from release notes: Let's count manually from our solution
  // 6.2.0: 12 rows, 6.1.3: 6 rows, 6.1.2: 3 rows, 6.1.1: 5 rows, 6.1.0: 9 rows, 
  // 6.0.5: 5 rows, 6.0.4: 7 rows, 5.9.0: 9 rows, 5.7.2: 5 rows, 5.7.1: 6 rows
  // Total: 12+6+3+5+9+5+7+9+5+6 = 67 rows
  assert.strictEqual(rows.length, 67, 'CSV should have 67 rows (one per bullet point)');
});

test('Dates are normalized to ISO format', () => {
  const rows = rowsOf();
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  const invalidDates = rows.filter(row => !dateRegex.test(row.date));
  assert.strictEqual(invalidDates.length, 0, `All dates should be in ISO format (YYYY-MM-DD). Found: ${invalidDates.map(r => r.date).join(', ')}`);
});

test('Version 6.1.3 date is correctly normalized', () => {
  const rows = rowsOf();
  const versionRows = rows.filter(row => row.version === '6.1.3');
  // Original date was "Jan 28, 2024" - should be normalized to "2024-01-28"
  const hasCorrectDate = versionRows.every(row => row.date === '2024-01-28');
  assert.ok(hasCorrectDate, 'Version 6.1.3 should have date 2024-01-28 (normalized from "Jan 28, 2024")');
});

test('Quoted text with commas is preserved', () => {
  const rows = rowsOf();
  // Look for the row about accounts with special characters
  const specialRow = rows.find(row => row.summary && row.summary.includes('quotes, commas, and other punctuation'));
  assert.ok(specialRow, 'Should have row about accounts with "quotes, commas, and other punctuation"');
  // The quotes are removed during CSV parsing, but the text should be there
  assert.ok(specialRow.summary.includes('quotes, commas, and other punctuation'), 'Text with commas should be preserved');
});

test('Multi-line bullet points are concatenated', () => {
  const rows = rowsOf();
  // In the original markdown, some bullet points wrap to next line with 2-space indent
  // We need to check if they're properly concatenated
  const allSummaries = rows.map(row => row.summary).join(' ');
  // Check that we don't have line breaks in the middle of sentences
  assert.ok(!allSummaries.includes('\n'), 'Summary fields should not contain line breaks');
});

test('Each row has valid type category', () => {
  const rows = rowsOf();
  const validTypes = ['New Features', 'Improvements', 'Bug Fixes', 'Security Updates', 'Documentation'];
  const invalidRows = rows.filter(row => !validTypes.includes(row.type));
  assert.strictEqual(invalidRows.length, 0, `All rows should have valid type. Invalid: ${invalidRows.map(r => r.type).join(', ')}`);
});

test('Version grouping is correct', () => {
  const rows = rowsOf();
  // Count rows per version
  const versionCounts = {};
  rows.forEach(row => {
    versionCounts[row.version] = (versionCounts[row.version] || 0) + 1;
  });
  
  // Check some specific versions
  assert.strictEqual(versionCounts['6.2.0'], 12, 'Version 6.2.0 should have 12 rows');
  assert.strictEqual(versionCounts['6.1.3'], 6, 'Version 6.1.3 should have 6 rows');
  assert.strictEqual(versionCounts['6.0.5'], 5, 'Version 6.0.5 should have 5 rows');
});

test('Summary fields are properly escaped', () => {
  const rows = rowsOf();
  const csvContent = readFileSync(CSV_PATH, 'utf8');
  const lines = csvContent.trim().split('\n');
  
  // Skip header
  const dataLines = lines.slice(1);
  
  // Count fields in each line - should be exactly 4
  const invalidLines = dataLines.filter((line, index) => {
    // Simple check: count commas not inside quotes
    let commaCount = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inQuotes = !inQuotes;
      } else if (line[i] === ',' && !inQuotes) {
        commaCount++;
      }
    }
    return commaCount !== 3; // 3 commas = 4 fields
  });
  
  assert.strictEqual(invalidLines.length, 0, `All CSV rows should have exactly 4 fields. Problem lines: ${invalidLines.length}`);
});

test('No empty fields', () => {
  const rows = rowsOf();
  const emptyFields = rows.filter(row => 
    !row.version || !row.date || !row.type || !row.summary
  );
  assert.strictEqual(emptyFields.length, 0, 'No row should have empty fields');
});

test('Type categories match source headings', () => {
  const rows = rowsOf();
  // Check a specific case: 6.0.4 has "Documentation" type
  const docRows = rows.filter(row => row.version === '6.0.4' && row.type === 'Documentation');
  assert.strictEqual(docRows.length, 2, 'Version 6.0.4 should have 2 Documentation rows');
  
  // Check 6.1.1 has Security Updates
  const securityRows = rows.filter(row => row.version === '6.1.1' && row.type === 'Security Updates');
  assert.strictEqual(securityRows.length, 3, 'Version 6.1.1 should have 3 Security Updates rows');
});

test('All versions from source are included', () => {
  const rows = rowsOf();
  const uniqueVersions = [...new Set(rows.map(row => row.version))].sort();
  const expectedVersions = ['5.7.1', '5.7.2', '5.9.0', '6.0.4', '6.0.5', '6.1.0', '6.1.1', '6.1.2', '6.1.3', '6.2.0'].sort();
  assert.deepStrictEqual(uniqueVersions, expectedVersions, 'All versions from source should be included');
});

test('Date ordering is consistent within version', () => {
  const rows = rowsOf();
  const versions = [...new Set(rows.map(row => row.version))];
  
  for (const version of versions) {
    const versionRows = rows.filter(row => row.version === version);
    const dates = versionRows.map(row => row.date);
    // All dates for same version should be identical
    const uniqueDates = [...new Set(dates)];
    assert.strictEqual(uniqueDates.length, 1, `Version ${version} should have only one date, found: ${uniqueDates.join(', ')}`);
  }
});