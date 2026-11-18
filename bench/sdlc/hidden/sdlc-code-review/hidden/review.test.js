'use strict';

// The fixed key of the wallet pull request: six planted defects, two decoys that look wrong and are not. Each defect
// found is one test, severity is checked for the three that lose money or data, and false alarms are counted.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readDoc, parseItems, found, assign, rank } = require('./review-key');

const W = 'src/wallet.js';
const DEFECTS = [
  { id: 'D1', file: W, anchor: 'from.balance -= amountCents', span: 3, minSeverity: 'high', phrases: [/\brace\b|race condition|concurren|at the same time|interleav|lost update|\block\b|atomic|double.?spend/i] },
  { id: 'D2', file: W, anchor: 'path.join(EXPORT_DIR', span: 2, minSeverity: 'high', phrases: [/path traversal|traversal|\.\.\/|directory escape|outside (the )?export|sanitiz/i] },
  { id: 'D3', file: W, anchor: "if (from.balance < amountCents)", span: 2, minSeverity: 'high', phrases: [/negative|amount.{0,30}(positive|> ?0|zero|validat)|zero amount/i] },
  { id: 'D4', file: W, anchor: 'const start = page * pageSize', span: 2, minSeverity: 'medium', phrases: [/off.by.one|first page|page - ?1|1-based|skips?/i] },
  { id: 'D5', file: W, anchor: 'while (true)', span: 6, minSeverity: 'medium', phrases: [/unbounded|forever|infinite|backoff|back-off|MAX_RETRIES|retry limit|swallow/i] },
  { id: 'D6', file: 'test/wallet.test.js', anchor: 'assert.ok(result)', span: 3, minSeverity: 'low', phrases: [/assert\.ok\(result\)|asserts? nothing|weak assert|only checks|truthy/i] },
];
// Correct code that a hasty review flags: an intended `== null`, and an intended sequential await.
const DECOYS = [
  { id: 'X1', file: 'src/format.js', anchor: 'value == null', span: 1 },
  { id: 'X2', file: W, anchor: 'await audit(entry)', span: 2 },
];
const MAX_UNMATCHED = 3;

const doc = () => readDoc('review.md');
const findings = () => parseItems(doc());
const assigned = () => assign(findings(), [...DEFECTS, ...DECOYS]);

for (const d of DEFECTS) {
  test(`finds ${d.id}`, () => {
    assert.ok(assigned().get(d.id).length > 0, `${d.id} at ${d.file} near "${d.anchor}"`);
  });
}

test('rates every finding of D1, D2 and D3 high or critical, and finds at least one of them', () => {
  const a = assigned();
  const hits = DEFECTS.filter((x) => ['D1', 'D2', 'D3'].includes(x.id)).flatMap((d) => a.get(d.id).map((f) => [d, f]));
  assert.ok(hits.length > 0, 'none of D1, D2, D3 found');
  for (const [d, f] of hits) assert.ok(rank(f.severity) <= rank(d.minSeverity), `${d.id} rated ${f.severity}`);
});

test('flags neither decoy', () => {
  for (const x of DECOYS) assert.equal(found(findings(), x).length, 0, x.id);
});

test(`has at most ${MAX_UNMATCHED} findings that match no planted defect`, () => {
  const all = findings();
  assert.ok(all.length > 0, 'findings use the "- [severity] file:line" form');
  const unmatched = all.filter((f) => !DEFECTS.some((d) => found([f], d).length));
  assert.ok(unmatched.length <= MAX_UNMATCHED, `${unmatched.length} unmatched`);
});

test('ends with a verdict that asks for changes', () => {
  assert.match(doc(), /^[\s>*_#-]*verdict[\s*_]*:[\s*_`]*request changes/im);
});
