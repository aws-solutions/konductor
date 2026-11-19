'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const R = path.join(__dirname, '..');
const FIXTURE = path.join(R, 'fixture');
const DELIVERABLE = path.join(R, 'solution', 'docs', 'retention-figures.md');
const DAY_PATTERN = /(?<![\w.])(\d+(?:\.\d+)?)\s*(?:-\s*)?days?\b/gi;
const RETENTION_CONTEXT = /\b(retention|retained|archive older|superseded by .*requirement|legacy compliance manual references)\b/i;

function fixtureFiles(dir = FIXTURE) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? fixtureFiles(full) : [full];
  });
}

function fixtureRecords() {
  const records = [];
  for (const file of fixtureFiles()) {
    const relative = path.relative(FIXTURE, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!RETENTION_CONTEXT.test(line)) continue;
      for (const match of line.matchAll(DAY_PATTERN)) {
        const value = Number(match[1]);
        if (!records.some((record) => record.file === relative && record.value === value)) {
          records.push({ file: relative, value, });
        }
      }
    }
  }
  return records;
}

function outputText() {
  return fs.readFileSync(DELIVERABLE, 'utf8');
}

function outputRecords(text) {
  const sources = fixtureFiles()
    .map((file) => path.relative(FIXTURE, file).split(path.sep).join('/'));
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(DAY_PATTERN)) {
      const source = sources.find((file) => line.includes(file) || line.includes(`fixture/${file}`));
      records.push({ value: Number(match[1]), file: source || null, line });
    }
  }
  return records;
}

function withinOnePercent(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= Math.abs(expected) * 0.01;
}

const expected = fixtureRecords();

test('format: every figure that names a fixture source matches a fixture figure', () => {
  const records = outputRecords(outputText()).filter((r) => r.file);
  assert.ok(records.length > 0);
  for (const record of records) {
    assert.ok(expected.some((w) => w.file === record.file && withinOnePercent(record.value, w.value)), `invented: ${record.line}`);
  }
});

test('the deliverable exists at the requested path', () => {
  assert.equal(fs.existsSync(DELIVERABLE), true);
});

test('every 90-day record is marked superseded or legacy', () => {
  const lines = outputText().split(/\r?\n/).filter((l) => /(?<![\w.])90\s*(?:-\s*)?days?\b/i.test(l));
  assert.ok(lines.length > 0, 'no 90-day record');
  for (const l of lines) assert.match(l, /supersed|legacy|no longer|replaced|historic|old\b|obsolete/i, l);
});

test('every 400-day record is marked as the current requirement', () => {
  const lines = outputText().split(/\r?\n/).filter((l) => /(?<![\w.])400\s*(?:-\s*)?days?\b/i.test(l));
  assert.ok(lines.length > 0, 'no 400-day record');
  for (const l of lines) {
    assert.match(l, /current|active|required|in force|requirement|policy/i, l);
    assert.doesNotMatch(l, /supersed|legacy|no longer|obsolete/i, l);
  }
});

for (const wanted of expected) {
  test(`records ${wanted.value} days from ${wanted.file}`, () => {
    assert.ok(outputRecords(outputText()).some((r) => r.file === wanted.file && withinOnePercent(r.value, wanted.value)));
  });
}

const SUPERSEDED_WORDS = /supersed|legacy|no longer|replaced|historic|obsolete|old\b/i;
for (const wanted of expected.filter((r) => r.value === 90 || r.value === 400)) {
  test(`status of ${wanted.value} days from ${wanted.file}`, () => {
    const single = (r) => [...r.line.matchAll(DAY_PATTERN)].length === 1;
    const mine = outputRecords(outputText()).filter((r) => r.file === wanted.file && withinOnePercent(r.value, wanted.value) && single(r));
    assert.ok(mine.length > 0);
    for (const r of mine) assert.equal(SUPERSEDED_WORDS.test(r.line), wanted.value === 90, r.line);
  });
}
