#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes answers/<id>/lazy/: a scripted shallow fake answer, scored by the dry run (gate: 40 or less). It is what a
// quick reader turns in: the right file, the right block shape, the reference's verdict words (go/no-go, red, true or
// false are easy to guess), but no real analysis:
//   - each list keeps only its first half (the obvious items; the buried ones are missed); a list of ticket ids also
//     gets the ids the key says must NOT be named (the decoys look risky, so a quick reader names them);
//   - each number is taken at face value from a rough count: the reference value times 0.7, rounded;
//   - each date assumes the plan holds: the reference date moved 21 days earlier.
// Strings and objects keep the reference's wording, so the fake hits every keyword the key might reward.
//   node lazy-answer.js <task-id>
// shortcut: one scripted shallow reading for every task, not each brief's own obvious reading; replace a task's
// answers/<id>/lazy/ with a hand-written one if its key needs a different shallow answer to be tested.

const fs = require('node:fs');
const path = require('node:path');
const { readBlock } = require('./lib/plan-grade.cjs');

const DIR = __dirname;
const ID = /^[A-Z][A-Z0-9]{0,9}-\d{1,5}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const shiftDate = (s, days) => new Date(Date.parse(`${s}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** The shallow fake of a parsed block (pure). `decoys` are the ids the key's absent/excludes assertions name. */
function shallow(value, decoys) {
  if (Array.isArray(value)) {
    if (value.length && value.every((v) => typeof v === 'string' && ID.test(v))) {
      const kept = value.slice(0, Math.ceil(value.length / 2));
      return [...kept, ...decoys.filter((d) => !kept.includes(d))];
    }
    // Any other list (paths, names, objects): only the obvious first half, each item shallow too.
    return value.slice(0, Math.ceil(value.length / 2)).map((v) => shallow(v, []));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shallow(v, decoys)]));
  if (typeof value === 'number') return Math.round(value * 0.7);
  if (typeof value === 'string' && DATE.test(value)) return shiftDate(value, -21);
  return value;
}

/** Ids the key says must not be named: the decoys. */
const decoysOf = (key) => [...new Set(key.assertions.filter((a) => a.op === 'absent' || a.op === 'excludes').flatMap((a) => a.ids || []).filter((x) => ID.test(x)))];

function main(id) {
  const key = JSON.parse(fs.readFileSync(path.join(DIR, 'hidden', id, 'hidden', 'key.json'), 'utf8'));
  const block = readBlock(fs.readFileSync(path.join(DIR, 'solutions', id, key.output), 'utf8'), key.block);
  if (!block) throw new Error(`${id}: the reference has no ${key.block} block`);
  const body = `# Update\n\nI went through the exports. The plan mostly holds; the main items are below.\n\n\`\`\`${key.block}\n${JSON.stringify(shallow(block, decoysOf(key)), null, 1)}\n\`\`\`\n`;
  const out = path.join(DIR, 'answers', id, 'lazy', key.output);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  return out;
}

if (require.main === module) console.log(main(process.argv[2]));

module.exports = { shallow, decoysOf };
