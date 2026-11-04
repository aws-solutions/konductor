// SPDX-License-Identifier: Apache-2.0
/**
 * Job planning tests: the judge jobs of a task set, the balanced order assignment and the
 * determinism a resumed run depends on. Pure; the one file read is the source pin.
 * Run: node --test bench/test/plan.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ordersFor, planJobs } = require('../lib/plan');
const { roster } = require('./support/roster');

const taskSet = (count, prefix = 'task') => ({
  tasks: Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i + 1}`, task: 'x', rubric: ['y'] })),
});
const ONE_ORDER = { judges: roster(3), ordersPerPair: 1 };
const BOTH_ORDERS = { judges: roster(3) };

const count = (list) => list.reduce((acc, x) => ({ ...acc, [x]: (acc[x] || 0) + 1 }), {});

test('every order when a seat judges a pair in all of them', () => {
  const { judge } = planJobs({ 'toy-skill': taskSet(4) }, BOTH_ORDERS);
  assert.equal(judge.length, 4 * 3 * 2, 'tasks x seats x orders');
  for (const task of taskSet(4).tasks) {
    for (const seat of roster(3)) {
      const orders = judge
        .filter((j) => j.task.id === task.id && j.judge.seat === seat.seat)
        .map((j) => j.order)
        .sort();
      assert.deepEqual(orders, ['with-first', 'without-first']);
    }
  }
});

test('one order per pair gives one judge job per task and seat', () => {
  const { judge } = planJobs({ 'toy-skill': taskSet(5) }, ONE_ORDER);
  assert.equal(judge.length, 5 * 3);
});

test('balance: for k jobs and n orders each order is used floor(k/n) or ceil(k/n) times', () => {
  for (const orderCount of [2, 3, 4]) {
    const orders = Array.from({ length: orderCount }, (_, i) => `order-${i}`);
    const config = { judgeOrders: orders, ordersPerPair: 1 };
    for (const seat of ['seat-1', 'seat-2', 'seat-9']) {
      for (const skill of ['toy-skill', 'other-skill']) {
        for (let k = 1; k <= 25; k += 1) {
          const used = Array.from({ length: k }, (_, position) => {
            const picked = ordersFor(config, { skill, seat, position });
            assert.equal(picked.length, 1);
            return picked[0];
          });
          const tally = count(used);
          for (const order of orders) {
            const got = tally[order] || 0;
            assert.ok(
              got === Math.floor(k / orderCount) || got === Math.ceil(k / orderCount),
              `${orderCount} orders, ${k} jobs, ${seat}/${skill}: ${order} used ${got} times`,
            );
          }
        }
      }
    }
  }
});

test('balance holds in a real plan: five tasks never land all in one order', () => {
  const { judge } = planJobs({ 'toy-skill': taskSet(5) }, ONE_ORDER);
  for (const seat of roster(3)) {
    const used = count(judge.filter((j) => j.judge.seat === seat.seat).map((j) => j.order));
    assert.deepEqual(Object.values(used).sort(), [2, 3], seat.seat);
  }
});

test('the seats do not all begin with the same order', () => {
  const seats = roster(8);
  const first = seats.map(
    (s) => ordersFor({ judgeOrders: ['with-first', 'without-first'], ordersPerPair: 1 }, { skill: 'toy-skill', seat: s.seat, position: 0 })[0],
  );
  assert.equal(new Set(first).size, 2, `first orders: ${first.join(', ')}`);
});

test('the plan is identical across two runs and does not depend on input object identity', () => {
  const a = planJobs({ 'toy-skill': taskSet(7), 'other-skill': taskSet(3, 'other') }, ONE_ORDER);
  const b = planJobs(
    JSON.parse(JSON.stringify({ 'toy-skill': taskSet(7), 'other-skill': taskSet(3, 'other') })),
    JSON.parse(JSON.stringify(ONE_ORDER)),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
  const again = planJobs({ 'toy-skill': taskSet(7), 'other-skill': taskSet(3, 'other') }, ONE_ORDER);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(again)));
});

test('the plan reads no clock and no random source', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'plan.js'), 'utf8');
  assert.doesNotMatch(source, /Math\.random|Date\.now|new Date|randomBytes|randomUUID|process\.hrtime/);
});

test('the position of a job counts within its skill and seat, so each skill is balanced alone', () => {
  const { judge } = planJobs({ 'toy-skill': taskSet(3), 'other-skill': taskSet(3, 'other') }, ONE_ORDER);
  for (const skill of ['toy-skill', 'other-skill']) {
    for (const seat of roster(3)) {
      const jobs = judge.filter((j) => j.skill === skill && j.judge.seat === seat.seat);
      const positions = jobs.map((j) => ordersFor(ONE_ORDER, { skill, seat: seat.seat, position: jobs.indexOf(j) })[0]);
      assert.deepEqual(jobs.map((j) => j.order), positions);
    }
  }
});

test('ordersFor needs a position only when it has to choose', () => {
  assert.deepEqual(ordersFor({ judgeOrders: ['with-first', 'without-first'] }, { seat: 'seat-1' }), [
    'with-first',
    'without-first',
  ]);
  assert.deepEqual(ordersFor({}, { seat: 'seat-1' }), ['with-first', 'without-first']);
  for (const position of [undefined, -1, 1.5, '1']) {
    assert.throws(
      () => ordersFor({ judgeOrders: ['with-first', 'without-first'], ordersPerPair: 1 }, { seat: 'seat-1', position }),
      /non-negative integer position/,
      String(position),
    );
  }
});

test('subject jobs: one per task and arm; no noise jobs of any kind', () => {
  const { subject, judge } = planJobs({ 'toy-skill': taskSet(4) }, BOTH_ORDERS);
  assert.equal(subject.length, 8);
  assert.deepEqual([...new Set(subject.map((j) => j.arm))].sort(), ['with', 'without']);
  assert.ok([...subject, ...judge].every((j) => !('kind' in j)), 'no pair-versus-noise kind');
  assert.ok(subject.every((j) => j.arm !== 'with2'));
});

test('judge jobs carry the seat from the user config and nothing else about the judge', () => {
  const config = { judges: roster(4) };
  const { judge } = planJobs({ 'toy-skill': taskSet(2) }, config);
  assert.deepEqual([...new Set(judge.map((j) => j.judge.seat))], ['seat-1', 'seat-2', 'seat-3', 'seat-4']);
  assert.equal(judge[0].judge.model, '<provider>/<model-1>');
  assert.equal(judge[0].skill, 'toy-skill');
  assert.equal(judge[0].task.id, 'task-1');
});

test('planJobs applies the panel rule and rejects a malformed task set', () => {
  assert.throws(() => planJobs({ 'toy-skill': taskSet(2) }, { judges: roster(2) }), /at least 3 seats/);
  const twin = roster(3).map((j) => ({ ...j, family: 'same' }));
  assert.throws(() => planJobs({ 'toy-skill': taskSet(2) }, { judges: twin }), /share the family/);
  assert.throws(() => planJobs({ 'toy-skill': {} }, BOTH_ORDERS), /no tasks array/);
  const dup = { tasks: [{ id: 'task-1' }, { id: 'task-1' }] };
  assert.throws(() => planJobs({ 'toy-skill': dup }, BOTH_ORDERS), /two tasks with the id task-1/);
});

test('planJobs does not change its inputs', () => {
  const sets = { 'toy-skill': taskSet(3) };
  const config = { judges: roster(3), ordersPerPair: 1 };
  const before = JSON.stringify([sets, config]);
  planJobs(sets, config);
  assert.equal(JSON.stringify([sets, config]), before);
});
