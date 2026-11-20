'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { blockOf, itemTexts, numbersIn } = require('./doc-key.js');

const DOC = 'docs/spike-plan.md';
// Facts from fixture/data/pdf-latency.csv (computed offline): 138 jobs with pages > 20 out of 3,004 rows,
// p95 of ms 12,432 (nearest rank) / 12,165 (interpolated). Overall mean 1,139 ms, overall p95 about 3,170, p95 of jobs up to 20 pages 1,793.
const P95_LOW = 11685;
const P95_HIGH = 12915;
const N_LARGE = 138;
const DECOYS = [1139, 1100, 3167, 1793];
const block = () => blockOf(DOC);
const text = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const whole = () => JSON.stringify(block());
/** A latency value as ms: a bare number under 200 is read as seconds. */
const asMs = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? (n < 200 ? n * 1000 : n) : NaN;
};
const days = (v) => (typeof v === 'number' ? v : Number(v));

/** Part tests only count for a plan that fills the free time: 7 or 8 engineer-days, 4 or 5 days, steps that add up to the budget. */
const fullPlan = () => {
  const b = block();
  const ed = days(b.engineer_days);
  const tb = days(b.timebox_days);
  assert.ok(ed >= 7 && ed <= 8, `engineer_days ${b.engineer_days} is not 7 or 8`);
  assert.ok(tb >= 4 && tb <= 5, `timebox_days ${b.timebox_days} is not 4 or 5`);
  const total = itemSteps().reduce((n, s) => n + (days(s.days) || 0), 0);
  assert.ok(Math.abs(total - ed) <= 1 + 1e-9, `steps add up to ${total}, not within a day of engineer_days ${ed}`);
};
const itemSteps = () => (Array.isArray(block().steps) ? block().steps.filter((s) => s && typeof s === 'object') : []);
const stepTexts = () => itemSteps().filter((s) => days(s.days) > 0).map((s) => itemTexts([s])[0] || '');
const allOf = (t, ...res) => res.every((re) => re.test(t));
const stepCovers = (...res) => {
  fullPlan();
  const ts = stepTexts();
  assert.ok(ts.some((t) => allOf(t, ...res)), `no step matches ${res.map(String).join(' and ')}: ${ts.join(' | ')}`);
};
const outCovers = (...res) => {
  fullPlan();
  const ts = itemTexts(block().scope_out);
  assert.ok(ts.some((t) => allOf(t, ...res)), `no scope_out item matches ${res.map(String).join(' and ')}: ${ts.join(' | ')}`);
};
const inCovers = (...res) => {
  fullPlan();
  const ts = itemTexts(block().scope_in);
  assert.ok(ts.some((t) => allOf(t, ...res)), `no scope_in item matches ${res.map(String).join(' and ')}: ${ts.join(' | ')}`);
};
const CEILING = /(?<![\d.,])5[0-6](?![\d,]|\.\d)/;

test('the JSON block is complete, with the 6 s pass line, a numeric kill line, a p95 metric on large invoices and a numeric decision rule', () => {
  const b = block();
  for (const k of ['question', 'hypothesis', 'metric', 'pass_threshold', 'kill_threshold', 'decision_rule']) {
    assert.ok(text(b[k]).trim().length > 5, `${k} missing or empty`);
  }
  assert.ok(b.baseline && typeof b.baseline === 'object', 'baseline missing');
  for (const k of ['value', 'sample', 'source']) assert.ok(text(b.baseline[k]).trim(), `baseline.${k} missing`);
  for (const k of ['timebox_days', 'engineer_days']) assert.ok(Number.isFinite(days(b[k])) && days(b[k]) > 0, `${k} not a positive number`);
  for (const k of ['steps', 'scope_in', 'scope_out']) assert.ok(Array.isArray(b[k]) && b[k].length > 0, `${k} not a non-empty list`);

  const m = text(b.metric);
  assert.match(m, /p\s*95|95\s*(th)?\s*percentile/i, 'metric is not a p95');
  assert.match(m, /(over|above|more than|greater than|>|beyond)\s*=?\s*20\b|\b21\b|\blarge\b|\blong\b|20\s*\+|\b2[1-9]\s*(-|to|–)/i, 'metric does not restrict to large invoices');

  const p = text(b.pass_threshold);
  assert.match(p, /\b6000\b|6,000|\b6(\.0)?\s*(s\b|sec|seconds)/i, `pass_threshold ${p} does not use the 6 s target`);
  assert.doesNotMatch(p, /\b8000\b|8,000|\b8(\.0)?\s*(s\b|sec|seconds)/i);
  assert.ok(!numbersIn(p).map(Number).some((n) => n > 6000 && n < 12000), 'pass threshold is looser than the target');

  const k = text(b.kill_threshold);
  const kn = numbersIn(k);
  assert.ok(kn.length > 0, 'kill_threshold has no number');
  assert.notEqual(k.trim().toLowerCase(), p.trim().toLowerCase());
  const pn = new Set(numbersIn(p));
  assert.ok(kn.some((n) => !pn.has(n)), 'kill_threshold uses only the numbers of the pass threshold');

  const d = text(b.decision_rule);
  assert.ok(numbersIn(d).length >= 2, 'decision_rule has fewer than 2 numbers');
  assert.match(d, /\b(go|proceed|adopt|build|pass|continue|ship)\b/i);
  assert.match(d, /\b(stop|kill|abandon|no[- ]go|drop|park|shelve|do not)\b/i);
});

test('the plan measures against the 128 MB memory limit', () => {
  const w = whole();
  assert.match(w, /128\s*(MB|MiB|megabytes)/i);
  const stepsAndRules = [text(block().kill_threshold), text(block().pass_threshold), ...itemTexts(block().steps), ...itemTexts(block().scope_in), text(block().decision_rule)].join(' ');
  assert.match(stepsAndRules, /memory|128/i);
});

test('baseline is the p95 of the roughly 138 invoices over 20 pages from the latency file, not the headline average', () => {
  const b = block().baseline || {};
  const v = asMs(b.value);
  assert.ok(v >= P95_LOW && v <= P95_HIGH, `baseline.value ${b.value} is not near the large-invoice p95 (about 12,300 ms)`);
  const nums = numbersIn(text(b.sample)).map(Number);
  assert.ok(nums.some((n) => Math.abs(n - N_LARGE) <= 8), `sample ${JSON.stringify(b.sample)} does not give the count of invoices over 20 pages (about ${N_LARGE})`);
  assert.match(text(b.source), /pdf[-_ ]?latency/i);
});

test('precision: no headline average or all-invoice percentile, not the 10 days the pitch assumed, short lists', () => {
  const b = block();
  assert.ok(text(b.metric).trim() && Number(b.baseline?.value) > 0, 'metric or baseline.value missing');
  assert.doesNotMatch(text(b.metric), /^\W*(the\s+)?(average|mean)\b/i);
  const v = asMs(b.baseline?.value);
  for (const d of DECOYS) assert.ok(Math.abs(v - d) / d > 0.15, `baseline.value ${v} is close to the decoy ${d}`);
  assert.doesNotMatch(text(b.baseline?.sample), /^\W*3,?00\d\s*(rows|jobs|invoices|requests)?\W*$/i);
  assert.ok(days(b.engineer_days) >= 7, `engineer_days ${b.engineer_days} leaves free time unused`);
  assert.notEqual(days(b.engineer_days), 10);
  assert.ok(Array.isArray(b.steps) && b.steps.length <= 9);
  assert.ok(itemTexts(b.scope_out).length <= 12);
});

test('the plan uses the free time: 7 or 8 engineer-days (two engineers, one on leave two days of five) in a 4 or 5 day timebox', () => {
  const b = block();
  assert.ok(days(b.engineer_days) >= 7 && days(b.engineer_days) <= 8, `engineer_days ${b.engineer_days} is not 7 or 8`);
  assert.ok(days(b.timebox_days) >= 4 && days(b.timebox_days) <= 5, `timebox_days ${b.timebox_days} is not 4 or 5`);
});

test('steps are named, 3 to 9 of them, and add up to engineer_days within one day (and to no more than 8)', () => {
  const b = block();
  const steps = Array.isArray(b.steps) ? b.steps : [];
  assert.ok(steps.length >= 3 && steps.length <= 9, `${steps.length} steps`);
  for (const s of steps) {
    assert.ok(s && text(s.name).trim(), 'a step has no name');
    assert.ok(days(s.days) > 0, `step ${s.name} has no days`);
  }
  const total = steps.reduce((n, s) => n + days(s.days), 0);
  assert.ok(total <= 8 + 1e-9, `steps add up to ${total} days`);
  assert.ok(Math.abs(total - days(b.engineer_days)) <= 1 + 1e-9, `steps add up to ${total}, not within a day of engineer_days ${b.engineer_days}`);
});

test('a step builds a replay set of invoices with a timing harness', () => {
  stepCovers(/replay|re-?play|corpus|harness|(test|sample|invoice|job|benchmark|fixture)\s*(set|mix|corpus)|page mix|representative|capture/i);
});

test('a step bundles or ports the renderer to the edge runtime', () => {
  stepCovers(/bundl|\bport(ed|ing)?\b|packag|compil|wasm|adapt|deploy|stand up|get\b.*\brunning|build the (renderer|function)/i, /render|leafpress|pdf|layout|engine|function|library|edge/i);
});

test('a step runs latency at several page counts', () => {
  fullPlan();
  const ts = stepTexts().filter((t) => /latenc|timing|benchmark|render time|p\s*95|load|measure|\bruns?\b/i.test(t));
  const several = (t) => /several|multiple|varying|different|range of|bands?|buckets?|page (counts|sizes|classes)|small,? (medium|mid)/i.test(t)
    || new Set((t.match(/(?<![\d.,])(2\d|3\d|4\d|5\d|6\d|[7-9]\d|1[0-3]\d)(?![\d,]|\.\d)/g) || [])).size >= 2;
  assert.ok(ts.some(several), `no latency step names several page counts: ${stepTexts().join(' | ')}`);
});

test('a step probes the memory and CPU limits', () => {
  stepCovers(/memor|rss|heap|128\s*mb/i, /cpu|10\s*s\b|cpu[- ]time|compute|wall/i);
});

test('a step re-runs the same invoices on today\'s workers in the same hours as a control', () => {
  stepCovers(/current|today|existing|legacy|baseline|control|production|prod\b|old\b/i, /same|identical|matched|paired|side[- ]by[- ]side|control|alongside|concurrent|parallel/i);
});

test('a step writes up the result with the decision', () => {
  stepCovers(/write|report|document|summar|memo|readout|recommend|result|decid|decision/i, /decid|decision|go\b|no-go|recommend|verdict|call\b/i);
});

test('scope_out leaves out invoices above the page count the free-tier memory limit allows (about 54 pages)', () => {
  outCovers(CEILING, /page/i);
});

test('scope_out leaves out invoices of 20 pages or fewer, which already meet the target', () => {
  outCovers(/page|invoice/i, /\b(20|twenty|21)\b.*(fewer|less|under|below|or smaller|and smaller)|(up to|under|below|at most|≤|<=?|not over|no more than|within)\s*20\b|\b(short|small|ordinary|normal|already meet|already (are )?(within|under|fine))/i);
});

test('scope_out leaves out the paid tier and any new vendor spend', () => {
  outCovers(/paid|purchase|spend|licen[cs]|contract|subscription|enterprise|upgrad|pricing|\bpay/i);
});

test('scope_out leaves out queue wiring, rollout and production traffic', () => {
  outCovers(/queue|roll-?out|production|prod\b|storage|wiring|integrat|migrat|cut-?over|traffic|deploy/i);
});

test('scope_out leaves out the cost comparison', () => {
  outCovers(/cost|saving|TCO|financ|price comparison|business case|ROI|unit economics/i);
});

test('scope_in covers the large invoices up to the ceiling', () => {
  inCovers(/page/i, /\b21\b|(over|above|more than|beyond|>)\s*=?\s*20\b|\b2[1-9]\b|large|long|big/i);
});

test('scope_in covers an edge function on the free-tier trial account or a branch', () => {
  inCovers(/edge|function|prototype|spike/i, /free[- ]tier|trial|branch|sandbox|non-?prod|test account/i);
});

test('scope_in covers measuring p95 latency and memory against the targets', () => {
  inCovers(/p\s*95|latenc|render time|\b6\s*s\b|6,?000/i, /memor|128|rss/i);
});

test('scope_in covers probing the limit behaviour around the page ceiling', () => {
  inCovers(/probe|stress|boundary|limit behaviou?r|ceiling|just (above|over)|failure mode|at the limit/i, /memor|limit|cpu|page/i);
});
