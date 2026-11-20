#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes answers/<id>/alt/: a second correct answer made from the reference by changing what a correct answer may
// change: list order (except lists whose order is the answer), the agent's own item ids, free-text wording, key
// order, and the prose around the block. A key that still scores it 80 or more does not depend on the reference's
// wording or structure. Used when no reviewer-written alternative fits the final fixture.
//   node alt-answer.js <task-id>
// shortcut: a mechanical variant, not an independent solution; upgrade to a reviewer-written one when budget allows.

const fs = require('node:fs');
const path = require('node:path');
const { readBlock } = require('./lib/plan-grade.cjs');

const DIR = __dirname;
const ORDERED = /path|order|chain|sequence|milestones/i; // lists whose order carries meaning keep it
const FREE_TEXT = /^(summary|why|mitigation|text|about|problem|title|reason|note)$/i;
const OWN_ID = /^(id)$/i;

/** Variant of a parsed block (pure). `ids` collects renamed own ids so lists that refer to them follow. */
function vary(value, key = '', ids = new Map()) {
  if (Array.isArray(value)) {
    const items = value.map((v) => vary(v, key, ids));
    return ORDERED.test(key) ? items : items.reverse();
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).reverse();
    const out = {};
    for (const [k, v] of entries) {
      if (OWN_ID.test(k) && typeof v === 'string' && !/^[A-Z]+-\d+$/.test(v)) {
        if (!ids.has(v)) ids.set(v, `item-${ids.size + 1}`);
        out[k] = ids.get(v);
      } else if (FREE_TEXT.test(k) && typeof v === 'string') {
        out[k] = `In short: ${v}`;
      } else {
        out[k] = vary(v, k, ids);
      }
    }
    return out;
  }
  return value;
}

/** Lists that hold own ids (for example top_three) follow the renaming. */
function follow(value, ids) {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'string' && ids.has(v) ? ids.get(v) : follow(v, ids)));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, follow(v, ids)]));
  return value;
}

function main(id) {
  const key = JSON.parse(fs.readFileSync(path.join(DIR, 'hidden', id, 'hidden', 'key.json'), 'utf8'));
  const ref = fs.readFileSync(path.join(DIR, 'solutions', id, key.output), 'utf8');
  const block = readBlock(ref, key.block);
  if (!block) throw new Error(`${id}: the reference has no ${key.block} block`);
  const ids = new Map();
  const alt = follow(vary(block, '', ids), ids);
  const prose = ref.replace(/^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm, '').split('\n').filter((l) => l.trim() && !/^#/.test(l));
  const body = [
    '# Answer',
    '',
    'The figures below come from the files in this folder; the reasoning follows the data block.',
    '',
    '```' + key.block,
    JSON.stringify(alt, null, 1),
    '```',
    '',
    '## Reasoning',
    '',
    ...prose.reverse(),
    '',
  ].join('\n');
  const out = path.join(DIR, 'answers', id, 'alt', key.output);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  return out;
}

if (require.main === module) console.log(main(process.argv[2]));

module.exports = { vary, follow };
