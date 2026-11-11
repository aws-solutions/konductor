// SPDX-License-Identifier: Apache-2.0
// Tests for the bounded worker pool (lib/pool.js). Work yields to the event loop with setImmediate, so no test sleeps.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPools, pool } = require('../../../scripts/bench/lib/pool');

const tick = () => new Promise((resolve) => setImmediate(resolve));
/** A work function that records how many of its calls are running at once, per seat. */
function createMeter() {
  const meter = { active: {}, peak: {}, started: [] };
  meter.work = (seat) => async (item) => {
    meter.started.push([seat, item]);
    meter.active[seat] = (meter.active[seat] || 0) + 1;
    meter.peak[seat] = Math.max(meter.peak[seat] || 0, meter.active[seat]);
    await tick();
    await tick();
    meter.active[seat] -= 1;
    return item * 2;
  };
  return meter;
}

test('at most `width` calls run at once, all of them run, and results come back in item order', async () => {
  for (const [width, itemCount] of [
    [1, 5],
    [3, 10],
    [4, 2],
    [8, 8],
  ]) {
    const meter = createMeter();
    const results = await pool(
      Array.from({ length: itemCount }, (_entry, i) => i),
      width,
      meter.work('x'),
    );
    assert.deepEqual(
      results,
      Array.from({ length: itemCount }, (_entry, i) => ({ value: i * 2 })),
    );
    assert.equal(
      meter.peak.x,
      Math.min(width, itemCount),
      `width ${width}, ${itemCount} items`,
    );
  }
  assert.deepEqual(await pool([], 3, async () => 1), []);
});

test('each seat has its own width, seats run side by side, and an unlisted seat gets the default', async () => {
  const meter = createMeter();
  const pools = createPools({ widths: { a: 2, b: 1 }, defaultWidth: 3 });
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  await Promise.all(
    ['a', 'b', 'c'].map((seat) => pools.run(seat, items, meter.work(seat))),
  );
  assert.deepEqual(meter.peak, { a: 2, b: 1, c: 3 });
  assert.deepEqual(
    [pools.width('a'), pools.width('zzz'), pools.width('toString')],
    [2, 3, 3],
  );
  assert.equal(meter.started.length, 24);
});

test('a failed item is reported in its place and the others still run', async () => {
  const results = await pool([1, 2, 3], 2, async (item) => {
    if (item === 2) throw new Error('bad item');
    return item;
  });
  assert.deepEqual(
    results.map((result) => result.value ?? result.error.message),
    [1, 'bad item', 3],
  );
});

test('a fatal error stops every seat from starting more items, lets running calls finish, and rejects with it', async () => {
  const meter = createMeter();
  const boom = Object.assign(new Error('credentials expired'), { fatal: true });
  const pools = createPools({ widths: { a: 1, b: 1 } });
  const seatARun = pools.run('a', [0, 1, 2, 3], async (item) => {
    await meter.work('a')(item);
    if (item === 1) throw boom;
  });
  await assert.rejects(seatARun, (error) => error === boom);
  assert.deepEqual(
    meter.started,
    [
      ['a', 0],
      ['a', 1],
    ],
    'items 2 and 3 never started',
  );
  await assert.rejects(
    pools.run('b', [0, 1], meter.work('b')),
    (error) => error === boom,
  );
  assert.equal(
    meter.started.length,
    2,
    'the other seat started nothing after the stop',
  );
});

test('when two calls fail fatally, every seat rejects with the first one', async () => {
  const first = Object.assign(new Error('first'), { fatal: true });
  const second = Object.assign(new Error('second'), { fatal: true });
  const pools = createPools({ widths: { a: 2 } });
  await assert.rejects(
    pools.run('a', [first, second], async (error) => {
      if (error === second) await tick();
      throw error;
    }),
    (error) => error === first,
  );
  await assert.rejects(
    pools.run('b', [1], async () => 1),
    (error) => error === first,
  );
});

test('widths must be whole numbers of 1 or more', () => {
  for (const invalidWidth of [0, 1.5, '2', -1, NaN]) {
    assert.throws(
      () => createPools({ defaultWidth: invalidWidth }),
      TypeError,
      String(invalidWidth),
    );
    assert.throws(
      () => createPools({ widths: { a: invalidWidth } }),
      TypeError,
      String(invalidWidth),
    );
  }
});
