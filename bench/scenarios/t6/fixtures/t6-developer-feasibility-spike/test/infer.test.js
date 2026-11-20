'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, createInferrer, inferType } = require('../lib/infer');

test('classify single cells', () => {
  assert.equal(classify(''), 'empty');
  assert.equal(classify('   '), 'empty');
  assert.equal(classify('42'), 'integer');
  assert.equal(classify('-7'), 'integer');
  assert.equal(classify('0'), 'integer');
  assert.equal(classify('007'), 'text');
  assert.equal(classify('3.14'), 'decimal');
  assert.equal(classify('0.50'), 'decimal');
  assert.equal(classify('3.'), 'text');
  assert.equal(classify('.5'), 'text');
  assert.equal(classify('2025-02-28'), 'date');
  assert.equal(classify('2025-02-30'), 'text');
  assert.equal(classify('28/02/2025'), 'text');
});

test('column type from the cells seen so far', () => {
  assert.equal(inferType([]), 'text');
  assert.equal(inferType(['', ' ']), 'text');
  assert.equal(inferType(['1', '2', '']), 'integer');
  assert.equal(inferType(['1', '2.5']), 'decimal');
  assert.equal(inferType(['1.5', '2']), 'decimal');
  assert.equal(inferType(['2025-01-01', '2025-01-02']), 'date');
  assert.equal(inferType(['2025-01-01', '5']), 'text');
  assert.equal(inferType(['1', '2', 'n/a']), 'text');
  assert.equal(inferType(['1', '007']), 'text');
});

test('incremental inferrer matches inferType on every prefix', () => {
  const cells = ['1', '', '2.5', '3', 'x', '4'];
  const inf = createInferrer();
  cells.forEach((c, i) => {
    inf.add(c);
    assert.equal(inf.type(), inferType(cells.slice(0, i + 1)));
  });
  assert.equal(inf.count, 5);
});
