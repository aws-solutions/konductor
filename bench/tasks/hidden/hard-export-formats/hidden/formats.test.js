'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const lib = require('../src');
const { run } = require('../src/cli');

const ROWS = [{ region: 'north', total: 120, note: 'a,b' }, { region: 'south', total: null }];
const SALES = path.join(__dirname, '..', 'examples', 'sales.json');

function capture() {
  const out = { stdout: '', stderr: '' };
  return { out, io: { stdout: { write: (t) => { out.stdout += t; } }, stderr: { write: (t) => { out.stderr += t; } } } };
}

test('csv output is unchanged', () => {
  assert.equal(lib.exportReport(ROWS, { format: 'csv' }), 'region,total,note\nnorth,120,"a,b"\nsouth,,\n');
});

test('json output is unchanged', () => {
  assert.equal(lib.exportReport(ROWS, { format: 'json', columns: ['region', 'note'] }), '[\n  {\n    "region": "north",\n    "note": "a,b"\n  },\n  {\n    "region": "south",\n    "note": null\n  }\n]\n');
});

test('tsv has a header line and one tab between fields', () => {
  assert.equal(lib.exportReport([{ a: 1, b: 'x y' }, { a: 2, b: 'z' }], { format: 'tsv' }), 'a\tb\n1\tx y\n2\tz\n');
});

test('tsv escapes backslash, tab, newline and carriage return and quotes nothing', () => {
  const text = lib.exportReport([{ v: 'a\tb', w: 'c\nd', x: 'e\rf', y: 'g\\h', z: '"q",' }], { format: 'tsv' });
  assert.equal(text, 'v\tw\tx\ty\tz\na\\tb\tc\\nd\te\\rf\tg\\\\h\t"q",\n');
});

test('tsv writes a missing, null or undefined value as an empty field', () => {
  assert.equal(lib.exportReport([{ a: null, b: undefined, c: 0 }, { c: 1 }], { format: 'tsv', columns: ['a', 'b', 'c'] }), 'a\tb\tc\n\t\t0\n\t\t1\n');
});

test('tsv follows the columns option', () => {
  assert.equal(lib.exportReport(ROWS, { format: 'tsv', columns: ['total', 'region'] }), 'total\tregion\n120\tnorth\n\tsouth\n');
});

test('tsv has its content type', () => {
  assert.equal(lib.contentTypeFor('tsv'), 'text/tab-separated-values; charset=utf-8');
});

test('tsv has its file extension', () => {
  assert.equal(lib.fileNameFor('sales', 'tsv'), 'sales.tsv');
});

test('listFormats names csv, json and tsv', () => {
  assert.equal(typeof lib.listFormats, 'function', 'listFormats is exported');
  assert.deepEqual([...lib.listFormats()].sort(), ['csv', 'json', 'tsv']);
});

test('an unknown format error names every format that exists', () => {
  assert.throws(() => lib.exportReport(ROWS, { format: 'xml' }), (err) => err.code === 'UNKNOWN_FORMAT' && ['csv', 'json', 'tsv'].every((f) => err.message.includes(f)));
});

test('the command line writes tsv', () => {
  const { out, io } = capture();
  assert.equal(run(['--format', 'tsv', '--input', SALES, '--columns', 'region,total'], io), 0);
  assert.equal(out.stdout, 'region\ttotal\nnorth\t120\nsouth\t80\neast\t95\n');
});

test('the command line names every format when the format is unknown', () => {
  const { out, io } = capture();
  assert.equal(run(['--format', 'xml', '--input', SALES], io), 2);
  for (const f of ['csv', 'json', 'tsv']) assert.ok(out.stderr.includes(f), `stderr names ${f}`);
});
