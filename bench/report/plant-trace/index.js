// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench plant-trace`: one static HTML page for a plant trial, or two trials one below the other. Reads files only, calls no
// model and no network, and writes one file.

const fs = require('node:fs');
const path = require('node:path');
const { readTrial, PlantTraceError } = require('./load.js');
const { buildTrace } = require('./steps.js');
const { renderPage } = require('./page.js');
const { framesFor } = require('./frames.js');

const isText = (v) => typeof v === 'string' && v !== '';

/**
 * The page text for the trial dirs `dirs` (one or two): a trial dir holds result.json, stream.jsonl and plant/gateway.jsonl
 * and plant/world.jsonl. Two runs get the arm names as labels, with `(2)` added when both are the same arm. An arm trial
 * also gets still frames of its key moments (frames.js); `python` overrides the arm Python that draws them.
 */
function pageFor(dirs, { python } = {}) {
  const traces = dirs.map((d) => ({ ...buildTrace(readTrial(path.resolve(d))), frames: framesFor(path.resolve(d), python === undefined ? {} : { python }) }));
  if (traces.length === 2 && traces[0].label === traces[1].label) traces[1].label += ' (2)';
  return renderPage(traces);
}

/** `bench plant-trace --run TRIAL_DIR [--vs TRIAL_DIR] --out FILE.html`. Exit 2 with a message on bad input; 0 after writing. */
function cmdPlantTrace(opts) {
  try {
    if (!isText(opts.run)) throw new PlantTraceError('--run TRIAL_DIR is required');
    if (!isText(opts.out)) throw new PlantTraceError('--out FILE.html is required');
    if (opts.vs !== undefined && !isText(opts.vs)) throw new PlantTraceError('--vs needs a trial dir');
    const out = path.resolve(opts.out);
    if (fs.existsSync(out) && fs.statSync(out).isDirectory()) throw new PlantTraceError(`--out ${out} is a directory; give a file name`);
    const html = pageFor(opts.vs ? [opts.run, opts.vs] : [opts.run]);
    fs.writeFileSync(out, html);
    console.log(`plant-trace: wrote ${out}`);
  } catch (e) {
    if (!(e instanceof PlantTraceError)) throw e;
    console.error(`plant-trace: ${e.message}`);
    process.exitCode = 2;
  }
}

module.exports = { cmdPlantTrace, pageFor };
