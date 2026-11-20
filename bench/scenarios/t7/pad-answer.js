#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes answers/<id>/pad/: a padding probe (not the gated lazy answer, which a person or author writes). It keeps
// the reference's numbers, dates and words (a worst case for the key) but fills every list with every ticket id the
// fixture mentions, so it names the decoys and pads every list. A key that scores it low does not reward
// listing everything. A list of objects gets one object per id, each with the reference's first item as a template.
//   node pad-answer.js <task-id>
// The dry run does not gate on it; its score shows how much a key rewards padding. Ids are matched as LETTERS-DIGITS,
// so a key over ids like F-014 or over file paths is left as the reference.

const fs = require('node:fs');
const path = require('node:path');
const { readBlock } = require('../lib/hidden/plan-grade.cjs');

const DIR = __dirname;
const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d{2,5}\b/g;

function fixtureIds(dir) {
  const ids = new Set();
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    for (const m of fs.readFileSync(path.join(e.parentPath ?? e.path, e.name), 'utf8').matchAll(TICKET)) ids.add(m[0]);
  }
  return [...ids].sort();
}

const holdsIds = (list) => list.some((v) => typeof v === 'string' && new RegExp(TICKET.source).test(v));

/** Shotgun variant of a parsed block (pure). */
function shotgun(value, ids) {
  if (Array.isArray(value)) {
    if (value.length && value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      return ids.map((id) => Object.fromEntries(Object.entries(value[0]).map(([k, v]) => [k, Array.isArray(v) && holdsIds(v) ? [id] : typeof v === 'string' && holdsIds([v]) ? id : v])));
    }
    return holdsIds(value) || value.length === 0 ? [...ids] : value;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shotgun(v, ids)]));
  return value;
}

function main(id) {
  const task = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(DIR, 'hidden', id, 'hidden', 'key.json'), 'utf8'));
  const block = readBlock(fs.readFileSync(path.join(DIR, 'solutions', id, key.output), 'utf8'), key.block);
  const ids = fixtureIds(path.join(DIR, 'fixtures', task.fixture || task.id));
  const body = `# Answer\n\nEverything that looked relevant in the exports is listed below.\n\n\`\`\`${key.block}\n${JSON.stringify(shotgun(block, ids), null, 1)}\n\`\`\`\n`;
  const out = path.join(DIR, 'answers', id, 'pad', key.output);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  return out;
}

if (require.main === module) console.log(main(process.argv[2]));

module.exports = { shotgun };
