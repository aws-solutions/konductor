const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = __dirname;
const { exportTimesheet } = require(path.join(root, 'index.js'));
const cli = path.join(root, 'bin', 'timesheet.js');
const columns = 'id,startedAt,endedAt,minutes,project,description,billable,tags';

function entry(overrides = {}) {
  return {
    id: 'row-1',
    startedAt: '2025-06-10T09:30:00-04:00',
    endedAt: '2025-06-10T11:00:00-04:00',
    minutes: 90,
    project: 'North star',
    description: 'map the next step',
    billable: true,
    tags: ['client', 'planning'],
    ...overrides
  };
}

function csv(entries) {
  return exportTimesheet(entries, { format: 'csv' });
}

test('the package root exposes the existing export function', () => {
  assert.equal(typeof exportTimesheet, 'function');
});

test('the library JSON representation remains unchanged', () => {
  const rows = [entry({ description: 'keep this shape' })];
  assert.equal(exportTimesheet(rows, { format: 'json' }), JSON.stringify(rows, null, 2) + '\n');
});

test('the CLI JSON representation remains unchanged', () => {
  const expected = JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'data', 'entries.json'), 'utf8')), null, 2) + '\n';
  const actual = execFileSync(process.execPath, [cli, 'export', '--format', 'json'], { cwd: root, encoding: 'utf8' });
  assert.equal(actual, expected);
});

test('CSV begins with the complete stable header', () => {
  assert.equal(csv([entry()]).split('\n')[0], columns);
});

test('CSV keeps field order and values for ordinary entries', () => {
  const lines = csv([entry()]).trimEnd().split('\n');
  assert.deepEqual(lines, [
    columns,
    'row-1,2025-06-10T13:30:00.000Z,2025-06-10T15:00:00.000Z,90,North star,map the next step,true,client;planning'
  ]);
});

test('started timestamps are normalized to UTC ISO 8601', () => {
  assert.match(csv([entry({ startedAt: '2025-01-04T23:15:00+05:30' })]), /2025-01-04T17:45:00\.000Z/);
});

test('ended timestamps are normalized independently', () => {
  assert.match(csv([entry({ endedAt: '2025-01-05T00:15:00+05:30' })]), /2025-01-04T18:45:00\.000Z/);
});

test('UTC input is emitted in canonical ISO form', () => {
  assert.match(csv([entry({ startedAt: '2025-08-01T12:00:00Z', endedAt: '2025-08-01T12:01:00Z' })]), /2025-08-01T12:00:00\.000Z,2025-08-01T12:01:00\.000Z/);
});

test('commas, quotes, and embedded newlines use CSV quoting', () => {
  const value = entry({ project: 'One, two', description: 'She said "go"\nthen left' });
  assert.equal(csv([value]), columns + '\nrow-1,2025-06-10T13:30:00.000Z,2025-06-10T15:00:00.000Z,90,"One, two","She said ""go""\nthen left",true,client;planning\n');
});

test('formula-looking cells receive a leading apostrophe', () => {
  const value = entry({ project: '=SUM(A1:A2)', description: '+7 hours' });
  const output = csv([value]);
  assert.match(output, /,'=SUM\(A1:A2\),'\+7 hours,true/);
});

test('minus and at-sign cells are also neutralized', () => {
  const value = entry({ project: '-20', description: '@someone' });
  assert.match(csv([value]), /,90,'-20,'@someone,true/);
});

test('tags remain readable and scalar values keep their types', () => {
  const value = entry({ billable: false, tags: ['red', 'needs review'], minutes: 7 });
  assert.equal(csv([value]).trimEnd().split('\n')[1], 'row-1,2025-06-10T13:30:00.000Z,2025-06-10T15:00:00.000Z,7,North star,map the next step,false,red;needs review');
});

test('empty optional values become empty cells', () => {
  const value = entry({ description: null, tags: [], project: '' });
  assert.equal(csv([value]).trimEnd().split('\n')[1], 'row-1,2025-06-10T13:30:00.000Z,2025-06-10T15:00:00.000Z,90,,,true,');
});

test('the formatter handles several rows without hard-coded data', () => {
  const rows = [entry({ id: 'first', minutes: 1 }), entry({ id: 'second', minutes: 2, tags: [] })];
  const lines = csv(rows).trimEnd().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1].split(',').length, 8);
  assert.match(lines[1], /^first,/);
  assert.match(lines[2], /^second,/);
});

test('the CLI reads a selected ledger and produces the library CSV', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-mason-hidden-'));
  try {
    const file = path.join(dir, 'ledger.json');
    const rows = [entry({ id: 'from-cli', description: 'a, b' })];
    fs.writeFileSync(file, JSON.stringify(rows));
    const actual = execFileSync(process.execPath, [cli, 'export', '--format', 'csv', '--file', file], { cwd: root, encoding: 'utf8' });
    assert.match(actual, /^id,startedAt,endedAt,minutes,project,description,billable,tags\nfrom-cli,2025-06-10T13:30:00\.000Z,2025-06-10T15:00:00\.000Z,90,North star,"a, b",true,client;planning\n$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
