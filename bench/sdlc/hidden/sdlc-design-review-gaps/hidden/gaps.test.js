'use strict';

// The fixed key of the reservations design: seven planted gaps and three things the design does cover. Each gap
// found is one test; a finding that calls a covered topic missing is a false alarm; findings must name a section.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readDoc, parseItems, assign, rank } = require('./review-key');

const GAPS = [
  { id: 'G1', phrases: [/latency|throughput|p9\d|response time|per second|\bslo\b|performance target|no (number|target)|"?fast"? (has|with) no/i] },
  { id: 'G2', phrases: [/clock|skew|time sync|\bntp\b|timer.{0,40}(restart|lost|crash)/i] },
  { id: 'G3', minSeverity: 'high', phrases: [/payment.{0,40}(tim(e|es|ed) ?out|fail|down|unavailable|outage|error)|provider.{0,30}(tim(e|es|ed) ?out|fail|down|unavailable)/i] },
  { id: 'G4', minSeverity: 'high', phrases: [/admin.{0,60}(auth|role|permission|access control)|authori[sz]|authenticat|anyone can/i] },
  { id: 'G5', phrases: [/migrat|backfill|roll ?back|rollout|roll out|feature flag|deploy order|existing orders/i] },
  { id: 'G6', phrases: [/diagram.{0,80}(inconsisten|mismatch|contradict|does not match|differs|disagree|directly)|(inconsisten|contradict|mismatch).{0,80}diagram|StockSvc|InventoryDB/i] },
  { id: 'G7', phrases: [/retention|\bpii\b|personal data|gdpr|delet.{0,30}(email|address|data)|(email|address).{0,40}(stored|kept|retain)/i] },
];
// Topics the design covers; a finding about one of them that says it is missing is a false alarm.
const COVERED = [/idempoten/i, /rate.?limit|throttl/i, /alarm|monitor|dashboard/i];
const CLAIMS_MISSING = /\bmissing\b|\bno\b|\bnot\b|\black|absent|without|does not|doesn't|undefined|unspecified/i;

const findings = () => parseItems(readDoc('docs/design-review.md'));
const assigned = () => assign(findings(), GAPS);

for (const g of GAPS) {
  test(`finds ${g.id}`, () => {
    assert.ok(assigned().get(g.id).length > 0, g.id);
  });
}

test('rates the payment failure and admin access gaps high or critical when found, and finds one of them', () => {
  const a = assigned();
  const hits = GAPS.filter((g) => g.minSeverity).flatMap((g) => a.get(g.id).map((f) => [g, f]));
  assert.ok(hits.length > 0, 'neither G3 nor G4 found');
  for (const [g, f] of hits) assert.ok(rank(f.severity) <= rank(g.minSeverity), `${g.id} rated ${f.severity}`);
});

test('raises at most one false alarm about a topic the design covers', () => {
  const all = findings();
  assert.ok(all.length > 0, 'findings use the "- [severity] §N ..." form');
  const gapIds = assigned();
  const isGap = (f) => GAPS.some((g) => gapIds.get(g.id).includes(f));
  const alarms = all.filter((f) => !isGap(f) && COVERED.some((re) => re.test(f.text)) && CLAIMS_MISSING.test(f.text));
  assert.ok(alarms.length <= 1, `${alarms.length} false alarm(s)`);
});

test('names the section of the design in at least 80% of findings', () => {
  const all = findings();
  assert.ok(all.length > 0);
  const cited = all.filter((f) => /§\s*\d|section \d|\b(problem|goals|architecture|reservations|api|limits|operations|data model)\b/i.test(f.text));
  assert.ok(cited.length / all.length >= 0.8, `${cited.length} of ${all.length}`);
});
