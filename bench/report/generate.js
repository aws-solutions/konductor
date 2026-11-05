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
const { readLenientJudgments } = require('../judge/rescore.js');
const { enrichOrch, summarize: summarizeOrch } = require('./orch.js');
const { profileCheck } = require('../runner/lib/profiles.js');

const DETAILS = ['quick', 'full'];
const FORMATS = ['md', 'html', 'both'];

function checkChoice(name, value, allowed, fallback) {
  const v = value === undefined ? fallback : String(value);
  if (!allowed.includes(v)) throw new Error(`--${name} takes ${allowed.join(', ')} (got ${JSON.stringify(v)})`);
  return v;
}
const detailOf = (v) => checkChoice('detail', v, DETAILS, 'full');
const formatOf = (v) => checkChoice('format', v, FORMATS, 'both');

/**
 * The calibration result beside the run: <run>/calibration/result.json written by `calibrate score --save` or
 * `cap review-import`. kappa is the lowest judge kappa over every directory; raters lists, for a review import, each
 * rater's lowest judge kappa (prefixed by the directory name when several directories are pooled).
 */
function readCalibration(run) {
  const dirs = run.dirs || [run.dir];
  const kappas = [];
  const raters = [];
  for (const d of dirs) {
    try {
      const res = readJson(path.join(d, 'calibration', 'result.json'));
      for (const s of Object.values(res.judges || {})) if (typeof s.kappa === 'number' && Number.isFinite(s.kappa)) kappas.push(s.kappa);
      for (const [rater, r] of Object.entries(res.byRater || {})) raters.push([dirs.length > 1 ? `${path.basename(d)}/${rater}` : rater, r]);
    } catch { /* no calibration recorded */ }
  }
  return kappas.length ? { kappa: Math.min(...kappas), byRater: raters.length ? Object.fromEntries(raters) : null } : null;
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
function analyze({ run, tasks, baseline, scoringFile, qualityPack = null }) {
  const base = baseline ?? defaultBaseline(run);
  const weights = loadScoring(scoringFile, { allowPack: Boolean(qualityPack), allowQuotes: true });
  // A scoring file with "quotes": "lenient" swaps in the rescored judgments before anything reads them.
  if (weights.quoteMode === 'lenient') {
    if ((run.dirs || [run.dir]).length > 1) throw new Error('"quotes": "lenient" needs one run directory; rescore and report each directory on its own');
    run.judgments = readLenientJudgments(run.dir);
  }
  const built = buildReport({ run, tasks, baseline: base });
  // Only a scoring file that weights the pack reads the pack judgments; otherwise rows and scores are exactly as before.
  const ctx = { ...built.ctx, scoring: weights, ...(weights.pack > 0 ? { packScoreOf: require('./packscore.js').packScores({ run, tasks, pack: qualityPack }).scoreOf } : {}) };
  const rows = buildRows(run, tasks, ctx);
  const scores = computeScores({ rows, baseline: base, weights, unit: built.report.costUnit === 'usd' ? 'USD' : 'credits', harness: run.harness ?? null });
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

function generateRunReport({ run, tasks, baseline, out, detail, format, scoringFile, defaultDir, profile = null, phases = null, qualityPack = null }) {
  enrichOrch(run);
  const a = analyze({ run, tasks, baseline, scoringFile, qualityPack });
  const d = detailOf(detail);
  const check = profile ? profileCheck(profile, { facts: a.facts, judgments: run.judgments }) : null;
  const doc = buildRunDocument({ run, tasks, report: a.report, rows: a.rows, scores: a.scores, card: a.card, facts: a.facts, ctx: a.ctx, weights: a.weights, detail: d, profile: profile ? { profile, check } : null, docPhases: phases });
  let quality = null;
  if (qualityPack) {
    // Opt-in: without --criteria-pack nothing below runs and the outputs are unchanged.
    const { summarizeQuality, qualityBlocks } = require('./quality.js');
    const armIds = [...new Set(run.runs.filter((r) => r.result.status !== 'budget_skipped').map((r) => r.armId))].sort((x, y) => (x === a.base ? -1 : y === a.base ? 1 : x < y ? -1 : 1));
    quality = summarizeQuality({ groups: armIds.map((id) => ({ id, label: id, run, arm: id })), tasks, pack: qualityPack, scoredWeight: a.weights.pack ?? null });
    doc.blocks.push(...qualityBlocks(quality));
  }
  const json = { ...a.report, detail: d, ...(profile ? { profile: { name: profile.name, met: check.met, items: check.items } } : {}), ...(quality ? { qualityDimensions: quality } : {}), scores: a.scores, orchestration: summarizeOrch(run, { phases }), diligence: { rating: a.card.rating, counts: a.card.counts, blockers: a.card.blockers, criteria: a.card.criteria, thresholds: a.card.thresholds } };
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

module.exports = { generateRunReport, generateContrast, analyze, writeOutputs, outPaths, detailOf, formatOf, DETAILS, FORMATS, readCalibration };
