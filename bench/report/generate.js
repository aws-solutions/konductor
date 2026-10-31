// SPDX-License-Identifier: Apache-2.0
'use strict';

// report and contrast entry points: build the data, assemble blocks at a detail level, write md, html, json and charts/*.svg.

const fs = require('node:fs');
const path = require('node:path');
const { buildReport, defaultBaseline } = require('./aggregate.js');
const { buildRows, skippedCount } = require('./rows.js');
const { computeScores, loadScoring } = require('./scores.js');
const { collectFacts, scorecard } = require('./diligence.js');
const { buildRunDocument } = require('./build.js');
const { toMarkdown, toHtml } = require('./doc.js');
const { readJson } = require('./load.js');

const DETAILS = ['quick', 'full'];
const FORMATS = ['md', 'html', 'both'];

function checkChoice(name, value, allowed, fallback) {
  const v = value === undefined ? fallback : String(value);
  if (!allowed.includes(v)) throw new Error(`--${name} takes ${allowed.join(', ')} (got ${JSON.stringify(v)})`);
  return v;
}
const detailOf = (v) => checkChoice('detail', v, DETAILS, 'full');
const formatOf = (v) => checkChoice('format', v, FORMATS, 'both');

/** First calibration result beside the run: <run>/calibration/result.json written by `calibrate score --save`. */
function readCalibration(run) {
  const dirs = run.dirs || [run.dir];
  const kappas = [];
  for (const d of dirs) {
    try {
      const res = readJson(path.join(d, 'calibration', 'result.json'));
      for (const s of Object.values(res.judges || {})) if (typeof s.kappa === 'number' && Number.isFinite(s.kappa)) kappas.push(s.kappa);
    } catch { /* no calibration recorded */ }
  }
  return kappas.length ? { kappa: Math.min(...kappas) } : null;
}

function readSpend(run) {
  for (const d of run.dirs || [run.dir]) {
    try {
      const s = readJson(path.join(d, 'spend.json'));
      return Object.fromEntries(['draft', 'trigger'].filter((k) => typeof s[k] === 'number' && s[k] >= 0).map((k) => [k, s[k]]));
    } catch { /* none */ }
  }
  return {};
}

/** Everything a run report needs, without writing a file. */
function analyze({ run, tasks, baseline, scoringFile }) {
  const base = baseline ?? defaultBaseline(run);
  const built = buildReport({ run, tasks, baseline: base });
  const weights = loadScoring(scoringFile);
  const rows = buildRows(run, tasks, built.ctx);
  const scores = computeScores({ rows, baseline: base, weights, unit: built.report.costUnit === 'usd' ? 'USD' : 'credits' });
  const skipped = skippedCount(run);
  const facts = collectFacts({ run, tasks, rows, ctx: built.ctx, report: built.report, skipped, baseline: scores.baseline, weights, calibration: readCalibration(run) });
  const card = scorecard(facts);
  run.spend = readSpend(run);
  return { ...built, base: scores.baseline, rows, scores, facts, card, weights };
}

function outPaths(out, defaultDir) {
  const given = out && out !== true ? path.resolve(out) : null;
  if (!given) return { dir: defaultDir, name: 'report' };
  if (/\.(md|html|json)$/.test(given)) return { dir: path.dirname(given), name: path.basename(given).replace(/\.(md|html|json)$/, '') };
  return { dir: given, name: 'report' };
}

/** Writes the files for a document. Returns the list of paths written. */
function writeOutputs({ dir, name, blocks, charts, title, format, json }) {
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  const put = (file, text) => { fs.writeFileSync(file, text); written.push(file); };
  if (format === 'md' || format === 'both') {
    put(path.join(dir, `${name}.md`), toMarkdown(blocks));
    fs.mkdirSync(path.join(dir, 'charts'), { recursive: true });
    for (const [chartName, svg] of charts) put(path.join(dir, 'charts', `${chartName}.svg`), `${svg}\n`);
  }
  if (format === 'html' || format === 'both') put(path.join(dir, `${name}.html`), toHtml(blocks, { title }));
  put(path.join(dir, `${name}.json`), `${JSON.stringify(json, null, 2)}\n`);
  return written;
}

function generateRunReport({ run, tasks, baseline, out, detail, format, scoringFile, defaultDir }) {
  const a = analyze({ run, tasks, baseline, scoringFile });
  const d = detailOf(detail);
  const doc = buildRunDocument({ run, tasks, report: a.report, rows: a.rows, scores: a.scores, card: a.card, facts: a.facts, ctx: a.ctx, weights: a.weights, detail: d });
  const json = { ...a.report, detail: d, scores: a.scores, diligence: { rating: a.card.rating, counts: a.card.counts, blockers: a.card.blockers, criteria: a.card.criteria, thresholds: a.card.thresholds } };
  const { dir, name } = outPaths(out, defaultDir);
  const { renderMarkdown } = require('./render.js');
  const written = writeOutputs({ dir, name, blocks: doc.blocks, charts: doc.charts, title: doc.title, format: formatOf(format), json });
  return { written, card: a.card, scores: a.scores, json, legacyMarkdown: renderMarkdown(a.report) };
}

function generateContrast({ run, tasks, c, out, detail, format, scoringFile, defaultDir }) {
  const { buildContrastDocument } = require('./contrastdoc.js');
  const a = analyze({ run, tasks, baseline: c.base, scoringFile });
  const d = detailOf(detail);
  const doc = buildContrastDocument({ c, run, rows: a.rows, scores: a.scores, card: a.card, facts: a.facts, weights: a.weights, detail: d });
  const json = { ...c, detail: d, scores: a.scores, diligence: { rating: a.card.rating, counts: a.card.counts, blockers: a.card.blockers, criteria: a.card.criteria, thresholds: a.card.thresholds } };
  const { dir } = outPaths(out, defaultDir);
  const written = writeOutputs({ dir, name: 'contrast', blocks: doc.blocks, charts: doc.charts, title: doc.title, format: formatOf(format), json });
  return { written, card: a.card, markdown: require('fs').existsSync(path.join(dir, 'contrast.md')) ? fs.readFileSync(path.join(dir, 'contrast.md'), 'utf8') : '' };
}

module.exports = { generateRunReport, generateContrast, analyze, writeOutputs, outPaths, detailOf, formatOf, DETAILS, FORMATS };
