const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const command = path.join(root, 'bin', 'report.js');
const input = path.join(root, 'data', 'monthly-sales.json');

function runWithReport(report) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-hidden-'));
  const file = path.join(dir, 'input.json');
  fs.writeFileSync(file, JSON.stringify(report));
  try {
    return execFileSync(process.execPath, [command, file, '--format', 'csv'], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('CSV output has the v2 final newline', () => {
  const output = execFileSync(process.execPath, [command, input, '--format', 'csv'], { encoding: 'utf8' });
  assert.equal(output, 'Region,Orders,Revenue\nNorth,12,1234.5\nSouth,7,987\nWest,19,4200\n');
});

test('CSV quotes commas, quotes, and line breaks', () => {
  const output = runWithReport({
    title: 'Escaping',
    columns: [{ key: 'note', label: 'Note' }],
    rows: [{ note: 'North, Coast' }, { note: 'say "hi"' }, { note: 'two\nlines' }]
  });
  assert.equal(output, 'Note\n"North, Coast"\n"say ""hi"""\n"two\nlines"\n');
});

test('equals syntax selects the same CSV interface', () => {
  const output = execFileSync(process.execPath, [command, input, '--format=csv'], { encoding: 'utf8' });
  assert.ok(output.endsWith('\n'));
  assert.match(output, /^Region,Orders,Revenue\n/);
});

test('CSV preserves empty cells while terminating the record', () => {
  const output = runWithReport({
    title: 'Empty',
    columns: [{ key: 'region', label: 'Region' }, { key: 'orders', label: 'Orders' }],
    rows: [{ region: 'East' }]
  });
  assert.equal(output, 'Region,Orders\nEast,\n');
});
