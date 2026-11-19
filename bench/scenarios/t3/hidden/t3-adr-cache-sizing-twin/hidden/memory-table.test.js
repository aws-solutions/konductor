'use strict';
// Twin task: the deliverable is a table of usable memory and price per usable GB for each node type.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const priceSheet = JSON.parse(read('fixture', 'price-sheet.json'));
const reservation = Number((read('fixture', 'operating-model.md').match(/Engine memory reservation\s*\|\s*(\d+)\s*\|/) || [])[1]);
assert.ok(reservation > 0, 'fixture: engine reservation not found');

const expected = priceSheet.nodes.map((n) => {
  const usable = n.memory_gb * (1 - reservation / 100);
  return { id: n.id, advertised: n.memory_gb, usable, price: n.monthly_price_usd, perGb: n.monthly_price_usd / usable };
});

const close = (a, b) => Math.abs(a - b) <= Math.abs(b) * 0.01;
const text = () => read('solution', 'docs', 'memory-table.md');
const rows = () => text().split('\n').filter((l) => l.includes('|') && !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
const numbers = (line) => line.split('|').map((c) => (c.match(/(\d+(?:,\d{3})*(?:\.\d+)?)/) || [])[1]).filter(Boolean).map((n) => Number(n.replace(/,/g, '')));
const rowFor = (id, pred) => rows().find((l) => l.includes(id) && pred(numbers(l)));
const has = (nums, v) => nums.some((n) => close(n, v));

describe('memory table', () => {
  it('has a table with a header naming memory and price, and a row per node with its advertised memory and price', () => {
    assert.ok(rows().find((l) => /memory/i.test(l) && /(price|cost|usd|\$)/i.test(l)), 'no header row naming memory and price');
    for (const e of expected) {
      assert.ok(rowFor(e.id, (n) => has(n, e.advertised) && has(n, e.price)), `${e.id}: advertised ${e.advertised} GB and price ${e.price} not in one row`);
    }
  });

  for (const e of expected) {
    it(`${e.id}: usable memory applies the engine reservation from the operating model`, () => {
      assert.ok(rowFor(e.id, (n) => has(n, e.usable)), `usable memory ~${e.usable.toFixed(1)} GB not found`);
    });
    it(`${e.id}: price per usable GB`, () => {
      assert.ok(rowFor(e.id, (n) => has(n, e.perGb)), `price per usable GB ~${e.perGb.toFixed(2)} not found`);
    });
  }

  it('does not base the price per GB on the advertised memory', () => {
    for (const e of expected) {
      const wrong = e.price / e.advertised;
      assert.ok(!rowFor(e.id, (n) => has(n, wrong) && !has(n, e.perGb)), `${e.id}: price per advertised GB used`);
    }
  });

  it('makes no recommendation', () => {
    assert.ok(!/\b(recommend\w*|should (?:pick|choose|select|use)|pick (?:the|it)|choose the|best value|best choice|go with)\b/i.test(text()));
  });
});
