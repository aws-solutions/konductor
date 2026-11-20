'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ROOT, readDoc, blockOf, itemTexts } = require('./doc-key.js');
const { SAMPLES, runMeasure } = require('./expected.js');

const DOC = 'docs/feasibility.md';
const block = () => blockOf(DOC);
const evidence = () => (Array.isArray(block().evidence) ? block().evidence : []);
const entryFor = (name) => evidence().find((e) => e && typeof e.file === 'string' && e.file.includes(name));
const asText = (v) => (Array.isArray(v) ? itemTexts(v).join(' ') : String(v ?? ''));

test('verdict rejects the premise in general or makes it conditional, and does not confirm it', () => {
  const v = String(block().verdict ?? '').toLowerCase().trim();
  assert.ok(v.length > 0, 'no verdict');
  assert.ok(!/^(holds|hold|supported|confirmed|true|accepted|valid|yes)$/.test(v), `verdict says the premise stands: ${v}`);
  assert.match(v, /reject|conditional|only if|only when|only under|partial|not (supported|hold)|refut|false|fail/);
});

test('premise restates the 500-row claim', () => {
  const p = String(block().premise ?? '');
  assert.match(p, /\b500\b/);
  assert.match(p, /type|stable/i);
});

test('evidence has one entry for each sample file with the right row count', () => {
  for (const [name, s] of Object.entries(SAMPLES)) {
    const e = entryFor(name);
    assert.ok(e, `no evidence entry for ${name}`);
    assert.equal(Number(String(e.rows).replace(/,/g, '')), s.rows, `${name} rows`);
  }
});

test('evidence for sample-c gives the first drift row of each drifting column', () => {
  const e = entryFor('sample-c');
  assert.ok(e && e.first_drift_rows && typeof e.first_drift_rows === 'object', 'no sample-c first_drift_rows');
  const want = SAMPLES['sample-c'].drift;
  for (const col of ['weight_kg', 'bay', 'delivered_on']) {
    assert.equal(Number(e.first_drift_rows[col]), want[col], col);
  }
});

test('evidence shows no drift in any other sample-c column and none in sample-a or sample-b', () => {
  const none = (o) => Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined);
  assert.ok(entryFor('sample-a') && entryFor('sample-b') && entryFor('sample-c'), 'missing entries');
  assert.deepEqual(none(entryFor('sample-a').first_drift_rows), []);
  assert.deepEqual(none(entryFor('sample-b').first_drift_rows), []);
  const c = none(entryFor('sample-c').first_drift_rows).map(([k]) => k).sort();
  assert.deepEqual(c, ['bay', 'delivered_on', 'weight_kg']);
});

test('evidence agrees with what the script prints on each sample', () => {
  for (const name of Object.keys(SAMPLES)) {
    const r = runMeasure(path.join(ROOT, 'data', `${name}.csv`));
    assert.ok(r.out, `script gave no JSON for ${name}`);
    const e = entryFor(name);
    assert.ok(e && e.first_drift_rows, `no evidence for ${name}`);
    assert.equal(Number(e.rows), r.out.rows);
    for (const [col, v] of Object.entries(r.out.first_drift_rows)) {
      const got = e.first_drift_rows[col];
      assert.equal(got === undefined ? null : got === null ? null : Number(got), v, `${name}.${col}`);
    }
  }
});

test('conditions say the premise holds only when no column changes after row 500, and that the first rows cannot show it', () => {
  const c = itemTexts(block().conditions);
  assert.ok(c.length >= 1, 'no conditions');
  const all = c.join(' | ');
  assert.match(all, /no (column|type)|not change|does not change|do not change|doesn't change|don't change|stay|remain|unchanged|stable|same type|no drift/i);
  assert.match(all, /whole file|entire file|full file|full pass|full scan|all rows|every row|rest of the file|remaining rows|later rows|after (row )?500|beyond|cannot be known|can't be known|not known|unknown|provisional|tentative|not final|background/i);
});

test('recommendation keeps the preview honest about later rows instead of only raising the window', () => {
  const rec = asText(block().recommendation);
  assert.ok(rec.length >= 20, 'recommendation too short');
  assert.match(rec, /whole file|entire file|full file|full pass|full scan|all rows|every row|rest of the file|remaining rows|later rows|background|provisional|tentative|warn|flag|re-?check|verify|validate|scan/i);
});

test('the document ends with its JSON block', () => {
  const text = readDoc(DOC);
  assert.ok(text.length > 0, 'document missing');
  const m = [...text.matchAll(/```json[^\n]*\n[\s\S]*?\n\s*```/gi)];
  assert.ok(m.length >= 1, 'no json block');
  const last = m[m.length - 1];
  assert.equal(text.slice(last.index + last[0].length).trim(), '', 'text after the JSON block');
  for (const k of ['premise', 'verdict', 'evidence', 'recommendation', 'conditions']) assert.ok(k in block(), `missing ${k}`);
});

test('precision: three evidence entries at most and no more than six conditions', () => {
  assert.ok(evidence().length >= 1, 'no evidence');
  const files = new Set(evidence().map((e) => String(e && e.file)));
  assert.ok(evidence().length <= 3 && files.size <= 3, `${evidence().length} evidence entries`);
  const c = itemTexts(block().conditions);
  assert.ok(c.length <= 6, `${c.length} conditions`);
});
