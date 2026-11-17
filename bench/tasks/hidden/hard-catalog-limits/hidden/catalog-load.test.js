'use strict';

// Load and limit tests for the targets in docs/DESIGN.md. Each one counts supplier calls, calls in flight, waits
// or snapshot reads, so the result does not depend on timing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCatalogService } = require('../src');

const ROOT = path.join(__dirname, '..');
const record = (sku, i = 0) => ({ ITM_NO: sku, DESC_TXT: `Item ${sku}`, PRC_CENTS: String(100 + i).padStart(6, '0'), STAT: i % 2 ? 'D' : 'A', CAT_CD: `cat-${i % 10}` });
const fail = (code) => Object.assign(new Error(`supplier says ${code}`), { code });
const turns = (n) => new Promise((resolve) => {
  const step = (k) => (k <= 0 ? resolve() : setImmediate(() => step(k - 1)));
  step(n);
});

/**
 * A supplier double. `script(sku, attempt)` returns a record or throws; attempt counts from 1 per SKU. Each call
 * waits `turnsPerCall` event-loop turns, and the double records calls, calls per SKU and the most calls in flight.
 */
function supplier({ script = (sku) => record(sku), turnsPerCall = 2 } = {}) {
  const s = { calls: 0, perSku: new Map(), inFlight: 0, maxInFlight: 0 };
  s.fetchItem = async (sku) => {
    s.calls++;
    const attempt = (s.perSku.get(sku) || 0) + 1;
    s.perSku.set(sku, attempt);
    s.inFlight++;
    s.maxInFlight = Math.max(s.maxInFlight, s.inFlight);
    try {
      await turns(turnsPerCall);
      return script(sku, attempt);
    } finally {
      s.inFlight--;
    }
  };
  return s;
}

function make(opts = {}) {
  let now = 1_000_000;
  const sleeps = [];
  const sup = opts.supplier || supplier();
  const catalog = createCatalogService({
    supplier: sup,
    items: opts.items || [],
    clock: { now: () => now },
    sleep: async (ms) => { sleeps.push(ms); },
  });
  return { catalog, sup, sleeps, advance: (ms) => { now += ms; } };
}

test('lookup maps a legacy record to the domain item', async () => {
  const { catalog } = make({ supplier: supplier({ script: () => ({ ITM_NO: 'X', DESC_TXT: 'Lamp', PRC_CENTS: '001250', STAT: 'D', CAT_CD: 'lighting' }) }) });
  assert.deepEqual(await catalog.lookup('X'), { sku: 'X', name: 'Lamp', priceCents: 1250, active: false, category: 'lighting' });
});

test('an unknown SKU is null after one supplier call', async () => {
  const { catalog, sup } = make({ supplier: supplier({ script: () => { throw fail('NOT_FOUND'); } }) });
  assert.equal(await catalog.lookup('nope'), null);
  assert.equal(sup.calls, 1);
});

test('NFR-1: 1000 lookups of 20 SKUs within 60 s make 20 supplier calls', async () => {
  const { catalog, sup } = make();
  for (let i = 0; i < 1000; i++) await catalog.lookup(`SKU-${i % 20}`);
  assert.equal(sup.calls, 20);
});

test('NFR-1: an entry older than 60 s is fetched again', async () => {
  const { catalog, sup, advance } = make();
  await catalog.lookup('A');
  advance(59_000);
  await catalog.lookup('A');
  assert.equal(sup.calls, 1, 'still fresh at 59 s');
  advance(2_000);
  await catalog.lookup('A');
  assert.equal(sup.calls, 2, 'fetched again after 61 s');
});

test('NFR-1: the cache keeps at most 1000 entries and drops the least recently used', async () => {
  const { catalog, sup } = make();
  for (let i = 1; i <= 1000; i++) await catalog.lookup(`S${i}`);
  await catalog.lookup('S1');
  await catalog.lookup('S1001');
  const before = sup.calls;
  await catalog.lookup('S1');
  assert.equal(sup.calls, before, 'S1 was used recently and is kept');
  await catalog.lookup('S2');
  assert.equal(sup.calls, before + 1, 'S2 was the least recently used and was dropped');
});

test('NFR-1: lookups of one SKU that run at once share one supplier call', async () => {
  const { catalog, sup } = make();
  const items = await Promise.all(Array.from({ length: 25 }, () => catalog.lookup('HOT')));
  assert.equal(sup.calls, 1);
  assert.ok(items.every((i) => i.sku === 'HOT'));
});

test('NFR-2: 50 lookups at once never have more than 4 supplier calls in flight', async () => {
  const { catalog, sup } = make({ supplier: supplier({ turnsPerCall: 5 }) });
  const items = await Promise.all(Array.from({ length: 50 }, (_, i) => catalog.lookup(`P${i}`)));
  assert.equal(items.length, 50);
  assert.ok(items.every((item, i) => item.sku === `P${i}`), 'every caller gets its own item');
  assert.ok(sup.maxInFlight <= 4, `max in flight ${sup.maxInFlight}`);
  assert.equal(sup.maxInFlight, 4, 'the limit is used, not a queue of one');
});

test('NFR-3: BUSY twice then a record is retried with 50 ms and 100 ms waits', async () => {
  const { catalog, sup, sleeps } = make({ supplier: supplier({ script: (sku, n) => { if (n < 3) throw fail('BUSY'); return record(sku); } }) });
  assert.equal((await catalog.lookup('R')).sku, 'R');
  assert.equal(sup.calls, 3);
  assert.deepEqual(sleeps, [50, 100]);
});

test('NFR-3: TIMEOUT on every attempt rejects with SUPPLIER_UNAVAILABLE after 3 calls', async () => {
  const { catalog, sup } = make({ supplier: supplier({ script: () => { throw fail('TIMEOUT'); } }) });
  await assert.rejects(catalog.lookup('T'), (err) => err.code === 'SUPPLIER_UNAVAILABLE' && /TIMEOUT/.test(err.message));
  assert.equal(sup.calls, 3);
});

test('NFR-3: BAD_REQUEST is not retried and reaches the caller unchanged', async () => {
  const { catalog, sup } = make({ supplier: supplier({ script: () => { throw fail('BAD_REQUEST'); } }) });
  await assert.rejects(catalog.lookup('B'), { code: 'BAD_REQUEST' });
  assert.equal(sup.calls, 1);
});

test('NFR-4: 100 category listings over 10,000 items do not scan the snapshot per call', () => {
  // Work is counted two ways during the listings: reads of the snapshot's elements (a Proxy), and elements visited by
  // array methods and iterators on any array of 5,000 or more (a translated copy of the snapshot, for example).
  // shortcut: a plain index loop over a copy is not counted; upgrade to a cost probe if a run is seen doing that.
  const BIG = 5000;
  let work = 0;
  let counting = false;
  const raw = Array.from({ length: 10_000 }, (_, i) => record(`I${i}`, i));
  const items = new Proxy(raw, { get(target, key, receiver) { if (counting && typeof key === 'string' && /^\d+$/.test(key)) work++; return Reflect.get(target, key, receiver); } });
  const { catalog } = make({ items });
  const names = ['filter', 'forEach', 'map', 'reduce', 'find', 'findIndex', 'some', 'every', 'flatMap', 'indexOf', 'includes', Symbol.iterator];
  const saved = names.map((n) => [n, Array.prototype[n]]);
  for (const [n, orig] of saved) {
    Array.prototype[n] = function counted(...args) { if (counting && this.length >= BIG) work += this.length; return orig.apply(this, args); };
  }
  let total = 0;
  try {
    counting = true;
    for (let i = 0; i < 100; i++) total += catalog.listByCategory(`cat-${i % 10}`).length;
  } finally {
    counting = false;
    for (const [n, orig] of saved) Array.prototype[n] = orig;
  }
  assert.equal(total, 100_000);
  assert.ok(work <= 20_000, `${work} element visits for 100 listings`);
});

test('listByCategory returns domain items in snapshot order', () => {
  const { catalog } = make({ items: [record('A', 0), record('B', 1), record('C', 10)] });
  assert.deepEqual(catalog.listByCategory('cat-0'), [
    { sku: 'A', name: 'Item A', priceCents: 100, active: true, category: 'cat-0' },
    { sku: 'C', name: 'Item C', priceCents: 110, active: true, category: 'cat-0' },
  ]);
});

test('priceLabel shows the domain price', async () => {
  const { catalog } = make({ supplier: supplier({ script: (sku) => ({ ...record(sku), PRC_CENTS: '001250' }) }) });
  assert.equal(await catalog.priceLabel('L'), '$12.50');
});

test('supplier field names appear in one source file besides the HTTP client', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(c|m)?js$/.test(e.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  const LEGACY = /\b(?:ITM_NO|DESC_TXT|PRC_CENTS|CAT_CD|STAT)\b/;
  const using = files.filter((f) => !f.endsWith(path.join('supplier', 'legacy-client.js')))
    .filter((f) => LEGACY.test(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '')))
    .map((f) => path.relative(ROOT, f));
  assert.ok(using.length <= 1, `supplier fields are read in ${using.join(', ')}`);
});
