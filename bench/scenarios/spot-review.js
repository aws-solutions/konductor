// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios spot-review [DIR] [--seed N] [--out FILE]`: the owner's spot-review sample before lock (plan 8a):
// 10% of each batch, rounded up, at least one task per batch, drawn at random with a fixed seed so anyone can redraw it.
// Writes a markdown list of task ids with links to their files. Free: reads the task files only.
//
// Each batch draws with its own seed (the base seed plus the batch number), so a batch's sample changes only when that
// batch gains or loses tasks. A task whose pilot.decision is "drop" is left out of the draw. `spot-review.json` in the
// pack dir (optional) holds the owner's plan per batch:
//   { "seed": N, "batches": { "tN": { "status": "pinned", "sample": [ids] } | { "status": "pending" } | { "status": "draw" } } }
//   pinned   the sample the owner already read, kept as it is (every id must still be a task of the batch);
//   pending  the batch is not final yet, so nothing is drawn;
//   draw     (also any batch the plan does not list) a seeded draw.

const fs = require('node:fs');
const path = require('node:path');
const { mulberry32 } = require('../../tests/scripts/stats.js');

const PACK_DIR = __dirname;
const SEED = 20261119;
const SHARE = 0.1;
const PLAN_FILE = 'spot-review.json';

const batchesOf = (packDir) => fs.readdirSync(packDir).filter((d) => /^t\d+$/.test(d)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
const batchSeed = (seed, batch) => seed + Number(batch.slice(1));

/** The plan in `packDir/spot-review.json`, or an empty plan (every batch drawn). */
function readPlan(packDir) {
  const f = path.join(packDir, PLAN_FILE);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { batches: {} };
}

/** Sorted task ids of a batch, without dropped tasks. */
function batchIds(packDir, batch) {
  const dir = path.join(packDir, batch);
  return fs.readdirSync(dir).filter((f) => /^t\d+-.*\.json$/.test(f)).filter((f) => {
    let task = null;
    try { task = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { /* an unreadable file still counts as a task */ }
    return task?.pilot?.decision !== 'drop';
  }).map((f) => f.slice(0, -5)).sort();
}

/** A seeded shuffle of `ids`, then the first 10%, rounded up, at least one; sorted. */
function drawBatch(ids, seed) {
  const rng = mulberry32(seed);
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, Math.max(1, Math.ceil(out.length * SHARE))).sort();
}

/** { batch: { status: 'drawn' | 'pinned' | 'pending', ids } } for the t* folders under `packDir`. */
function spotSample(packDir = PACK_DIR, seed = SEED, plan = readPlan(packDir)) {
  const out = {};
  for (const batch of batchesOf(packDir)) {
    const entry = plan.batches?.[batch] || { status: 'draw' };
    const ids = batchIds(packDir, batch);
    if (entry.status === 'pending') out[batch] = { status: 'pending', ids: [] };
    else if (entry.status === 'pinned') {
      const gone = entry.sample.filter((id) => !ids.includes(id));
      if (gone.length) throw new Error(`${batch}: the pinned sample names ${gone.join(', ')}, which is no longer a task of the batch; set the batch to draw`);
      out[batch] = { status: 'pinned', ids: [...entry.sample].sort() };
    } else if (entry.status === 'draw') out[batch] = { status: 'drawn', ids: drawBatch(ids, batchSeed(seed, batch)) };
    else throw new Error(`${batch}: unknown status ${entry.status} in ${PLAN_FILE}`);
  }
  return out;
}

function renderSpot(sample, seed = SEED, packDir = PACK_DIR) {
  const L = ['# Spot-review sample', '',
    `The owner reads these tasks before any task of their batch is locked (plan section 8a). Drawn by \`node bench/runner/bench.js scenarios spot-review --seed ${seed}\`:`,
    'per batch a shuffle with its own seed (the base seed plus the batch number) of the sorted task ids, dropped tasks left out, then the first 10%, rounded up, and at least one.',
    `\`${PLAN_FILE}\` pins the samples the owner has already read and marks the batches that are not final yet. Redraw a batch only when it gains or loses tasks, and say so in the commit.`,
    '', '| batch | task | task file | fixture | hidden checks | reference |', '| --- | --- | --- | --- | --- | --- |'];
  for (const [b, { status, ids }] of Object.entries(sample)) {
    if (status === 'pending') { L.push(`| ${b} | pending final batch | - | - | - | - |`); continue; }
    for (const id of ids) {
      const t = JSON.parse(fs.readFileSync(path.join(packDir, b, `${id}.json`), 'utf8'));
      const link = (label, sub, name) => (name ? `[${label}](${b}/${sub}/${name}/)` : '-');
      L.push(`| ${b} | ${id}${status === 'pinned' ? ' (pinned)' : ''} | [${id}.json](${b}/${id}.json) | ${link('fixtures', 'fixtures', t.fixture)} | ${link('hidden', 'hidden', t.hidden)} | ${link('solution', 'solutions', id)} |`);
    }
  }
  const drawn = Object.values(sample).filter((s) => s.status !== 'pending');
  const n = drawn.reduce((k, s) => k + s.ids.length, 0);
  const pending = Object.values(sample).length - drawn.length;
  L.push('', `${n} task(s) in ${drawn.length} batch(es), ${pending} batch(es) pending. For each one, record in the task's \`review\` block: read on (date), and whether it leaks the method, hides the answer in the fixture, or is ambiguous.`);
  return `${L.join('\n')}\n`;
}

function cmdSpotReview(opts) {
  const dir = opts._[1] ? path.resolve(opts._[1]) : PACK_DIR;
  const plan = readPlan(dir);
  const seed = opts.seed !== undefined ? Number(opts.seed) : (plan.seed ?? SEED);
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  const text = renderSpot(spotSample(dir, seed, plan), seed, dir);
  if (typeof opts.out === 'string') { fs.writeFileSync(opts.out, text); console.log(`wrote ${opts.out}`); } else process.stdout.write(text);
}

module.exports = { spotSample, renderSpot, cmdSpotReview, drawBatch, batchSeed, SEED };
