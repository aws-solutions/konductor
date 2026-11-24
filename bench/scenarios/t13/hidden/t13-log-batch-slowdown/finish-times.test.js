'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readBlock } = require('./block-kit/block-key.js');

function expectedFinishes(root) {
  const dir = path.join(root, 'logs');
  return fs.readdirSync(dir)
    .filter((name) => /^night-2026-04-\d{2}\.log$/.test(name))
    .sort()
    .map((name) => {
      const text = fs.readFileSync(path.join(dir, name), 'utf8');
      const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}Z .*night=(\d{4}-\d{2}-\d{2}) event=finish/m);
      assert.ok(match, `finish record missing from ${name}`);
      return { night: match[3], finishUtc: match[2] };
    });
}

function minuteOfDay(value) {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

test('finishTimes tracks at least twelve of the fourteen fixture finishes', () => {
  const root = process.cwd();
  const block = readBlock(fs.readFileSync(path.join(root, 'analysis/nightly-report-slowdown.md'), 'utf8'));
  assert.ok(block, 'missing JSON block');
  const expected = expectedFinishes(root);
  assert.equal(expected.length, 14, 'fixture must contain fourteen nights');
  assert.ok(Array.isArray(block.finishTimes), 'finishTimes must be a list');
  let matched = 0;
  for (const item of expected) {
    const actual = block.finishTimes.find((candidate) => candidate && candidate.night === item.night);
    if (actual && /^\d{2}:\d{2}$/.test(String(actual.finishUtc)) && Math.abs(minuteOfDay(actual.finishUtc) - minuteOfDay(item.finishUtc)) <= 2) {
      matched += 1;
    }
  }
  assert.ok(matched >= 12, `only ${matched} fixture finish times matched`);
});
