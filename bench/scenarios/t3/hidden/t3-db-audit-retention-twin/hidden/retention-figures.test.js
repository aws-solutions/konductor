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
          records.push({ file: relative, value });
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

test('the deliverable exists at the requested path', () => {
  assert.equal(fs.existsSync(DELIVERABLE), true);
});

test('the deliverable has readable content', () => {
  assert.ok(outputText().trim().length > 0);
});

test('fixture scanning finds retention figures without hard-coded answers', () => {
  assert.ok(expected.length > 0);
  assert.ok(expected.every((record) => record.value > 0));
});

test('each output figure is on its own line', () => {
  const records = outputRecords(outputText());
  assert.ok(records.length > 0);
  for (const line of outputText().split(/\r?\n/)) {
    assert.ok([...line.matchAll(DAY_PATTERN)].length <= 1);
  }
});

test('the output contains one record for each fixture figure and source pair', () => {
  assert.equal(outputRecords(outputText()).length, expected.length);
});

test('every output figure names a fixture source file', () => {
  for (const record of outputRecords(outputText())) {
    assert.ok(record.file, `missing source for: ${record.line}`);
  }
});

test('every expected figure appears with its source file within one percent', () => {
  const actual = outputRecords(outputText());
  for (const wanted of expected) {
    assert.ok(
      actual.some((record) => record.file === wanted.file && withinOnePercent(record.value, wanted.value)),
      `missing ${wanted.value} days from ${wanted.file}`,
    );
  }
});

test('output records do not add figures or source files absent from the fixture', () => {
  const actual = outputRecords(outputText());
  for (const record of actual) {
    assert.ok(expected.some((wanted) => wanted.file === record.file && withinOnePercent(record.value, wanted.value)));
  }
});

test('all expected source files are represented', () => {
  const actualFiles = new Set(outputRecords(outputText()).map((record) => record.file));
  for (const file of new Set(expected.map((record) => record.file))) {
    assert.equal(actualFiles.has(file), true, `missing source file ${file}`);
  }
});

test('all reported day values are finite and positive', () => {
  for (const record of outputRecords(outputText())) {
    assert.equal(Number.isFinite(record.value), true);
    assert.ok(record.value > 0);
  }
});
