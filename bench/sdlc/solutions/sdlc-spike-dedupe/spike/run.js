'use strict';

// Throwaway spike: is a keyed dedupe fast enough for 50,000 contacts? Not for production; delete after the decision.
// Prints one JSON line per measurement: approach, n, ms, sameOutput.

const { dedupe, normalizeEmail } = require('../src/dedupe');
const { makeContacts } = require('../src/contacts');

/** The keyed version under test: one pass, a Set of normalized emails, first contact kept. */
function dedupeKeyed(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const key = normalizeEmail(r.email);
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  }
  return out;
}

/** Milliseconds of the best of `runs` calls, so one garbage collection does not decide the number. */
function timeBest(fn, input, runs) {
  let best = Infinity;
  let result;
  for (let i = 0; i < runs; i++) {
    const start = process.hrtime.bigint();
    result = fn(input);
    best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
  }
  return { ms: Math.round(best * 10) / 10, result };
}

const ids = (rows) => rows.map((r) => r.id).join(',');

const small = makeContacts(5000, 1);
const current = timeBest(dedupe, small, 1);
const keyedSmall = timeBest(dedupeKeyed, small, 5);
console.log(JSON.stringify({ approach: 'current', n: 5000, ms: current.ms, sameOutput: true }));
console.log(JSON.stringify({ approach: 'keyed', n: 5000, ms: keyedSmall.ms, sameOutput: ids(keyedSmall.result) === ids(current.result) }));

// At 50,000 the current version takes minutes, so the keyed output is checked against the rule itself:
// every kept contact is the first with its normalized email, and every dropped one repeats a kept email.
const big = makeContacts(50000, 1);
const keyedBig = timeBest(dedupeKeyed, big, 5);
const firstIndex = new Map();
big.forEach((r, i) => { const k = normalizeEmail(r.email); if (!firstIndex.has(k)) firstIndex.set(k, i); });
const expected = big.filter((r, i) => firstIndex.get(normalizeEmail(r.email)) === i);
console.log(JSON.stringify({ approach: 'keyed', n: 50000, ms: keyedBig.ms, sameOutput: ids(keyedBig.result) === ids(expected) }));
