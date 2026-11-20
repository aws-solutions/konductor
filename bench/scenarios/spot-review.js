// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios spot-review [DIR] [--seed N] [--out FILE]`: the owner's spot-review sample before lock (plan 8a):
// 10% of each batch, rounded up, at least one task per batch, drawn at random with a fixed seed so anyone can redraw it.
// Writes a markdown list of task ids with links to their files. Free: reads the task files only.

const fs = require('node:fs');
const path = require('node:path');
const { mulberry32 } = require('../../tests/scripts/stats.js');

const PACK_DIR = __dirname;
const SEED = 20261119;
const SHARE = 0.1;

/** { batch: [ids] } for the t* folders under `packDir`: per batch a seeded shuffle of the sorted ids, first ceil(10%). */
function spotSample(packDir = PACK_DIR, seed = SEED) {
  const rng = mulberry32(seed);
  const out = {};
  for (const batch of fs.readdirSync(packDir).filter((d) => /^t\d+$/.test(d)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const ids = fs.readdirSync(path.join(packDir, batch)).filter((f) => /^t\d+-.*\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    out[batch] = ids.slice(0, Math.max(1, Math.ceil(ids.length * SHARE))).sort();
  }
  return out;
}

function renderSpot(sample, seed = SEED, packDir = PACK_DIR) {
  const L = ['# Spot-review sample', '',
    `The owner reads these tasks before any task of their batch is locked (plan section 8a). Drawn by \`node bench/runner/bench.js scenarios spot-review --seed ${seed}\`:`,
    'per batch a seeded shuffle of the sorted task ids, then the first 10%, rounded up, and at least one. Redraw only when a batch gains or loses tasks, and say so in the commit.',
    '', '| batch | task | task file | fixture | hidden checks | reference |', '| --- | --- | --- | --- | --- | --- |'];
  for (const [b, ids] of Object.entries(sample)) {
    for (const id of ids) {
      const t = JSON.parse(fs.readFileSync(path.join(packDir, b, `${id}.json`), 'utf8'));
      const link = (label, sub, name) => (name ? `[${label}](${b}/${sub}/${name}/)` : '-');
      L.push(`| ${b} | ${id} | [${id}.json](${b}/${id}.json) | ${link('fixtures', 'fixtures', t.fixture)} | ${link('hidden', 'hidden', t.hidden)} | ${link('solution', 'solutions', id)} |`);
    }
  }
  const n = Object.values(sample).reduce((k, ids) => k + ids.length, 0);
  L.push('', `${n} task(s) in ${Object.keys(sample).length} batch(es). For each one, record in the task's \`review\` block: read on (date), and whether it leaks the method, hides the answer in the fixture, or is ambiguous.`);
  return `${L.join('\n')}\n`;
}

function cmdSpotReview(opts) {
  const dir = opts._[1] ? path.resolve(opts._[1]) : PACK_DIR;
  const seed = opts.seed !== undefined ? Number(opts.seed) : SEED;
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  const text = renderSpot(spotSample(dir, seed), seed, dir);
  if (typeof opts.out === 'string') { fs.writeFileSync(opts.out, text); console.log(`wrote ${opts.out}`); } else process.stdout.write(text);
}

module.exports = { spotSample, renderSpot, cmdSpotReview, SEED };
