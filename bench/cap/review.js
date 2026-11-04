// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap review` writes a static page where a person rates the outputs of the calibration sample side by side, and
// `cap review-import` turns the downloaded ratings into the calibration sheet and key that `calibrate score` reads,
// then scores them. No model call, no network, no credits.
//
// Blinding: each task's outputs get the letters A, B, ... in a seeded random order per task. Which letter is which arm
// is kept only in review-key.json beside the page; the page and the ratings file name no arm, task id or replicate.

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { mulberry32 } = require('../../tests/scripts/stats.js');
const { ANSWER_KEY } = require('../runner/lib/sandbox.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { secretLiterals, scrubString } = require('../runner/lib/scrub.js');
const { loadRun, readJson } = require('../report/load.js');
const { buildBundle } = require('../judge/bundle.js');
const { effectiveLimits } = require('../judge/config.js');
const { drawSample, scoreLabels } = require('../judge/calibrate.js');
const { makeQuoteMatcher } = require('../judge/quote.js');
const { VERDICTS, RATINGS_KIND, RATINGS_SCHEMA, renderViewer } = require('./review-viewer.js');

const KEY_FILE = 'review-key.json';
const PAGE_FILE = 'review.html';
const DEFAULT_N = 25;
const DEFAULT_SEED = 1;
const MAX_NOTES = 4000;
const MAX_QUOTE = 2000;

class ReviewError extends Error {}

function shuffle(list, seed) {
  const rng = mulberry32(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `Z${i - 25}`);
const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * n and seed for the draw: flags first, then the calibration-sample.json the detailed profile wrote, then 25 and 1.
 * Returns where they came from so the command can say.
 */
function sampleParams(runDir, { n, seed }) {
  let file = null;
  try { file = readJson(path.join(runDir, 'calibration-sample.json')); } catch { /* no sample written for this run */ }
  return {
    n: n ?? (Number.isInteger(file?.n) && file.n > 0 ? file.n : DEFAULT_N),
    seed: seed ?? (Number.isInteger(file?.seed) ? file.seed : DEFAULT_SEED),
    from: n === undefined && file ? 'calibration-sample.json' : n === undefined ? 'defaults' : 'flags',
  };
}

/**
 * The groups a person rates: one per (task, replicate) in the drawn sample, in draw order. With peers (the default)
 * each group holds every arm's run of that task and replicate, so the outputs sit side by side; with sampleOnly only
 * the drawn runs. Budget-skipped runs are never shown.
 */
function groupSample(runs, picked, { sampleOnly = false } = {}) {
  const usable = runs.filter((r) => r.result.status !== 'budget_skipped');
  const groups = new Map();
  for (const p of picked) {
    const id = `${p.taskId}\u0000${p.replicate}`;
    if (!groups.has(id)) groups.set(id, { taskId: p.taskId, replicate: p.replicate, runs: [] });
    const g = groups.get(id);
    const add = sampleOnly ? [p] : usable.filter((r) => r.taskId === p.taskId && r.replicate === p.replicate);
    for (const r of add) if (!g.runs.includes(r)) g.runs.push(r);
  }
  return [...groups.values()];
}

/**
 * Writes review.html (the page a rater opens) and review-key.json (letter to arm, kept away from the rater) into outDir.
 * Bundles are built exactly as for the judges: the same arm-name redaction, then credential scrubbing.
 */
function writeReview({ runDir, benchDir, extraTasks = [], n, seed, sampleOnly = false, limits, explicitLimits = {}, redactions, outDir, force = false, env = process.env }) {
  const run = loadRun(runDir);
  const tasks = loadTasks(benchDir, { extraDirs: extraTasks });
  const params = sampleParams(run.dir, { n, seed });
  const picked = drawSample(run.runs, params.n, params.seed);
  if (!picked.length) throw new ReviewError(`no runs to review in ${run.dir} (every run was budget-skipped)`);
  const literals = secretLiterals(env);
  const groups = [];
  const keyGroups = [];
  groupSample(run.runs, picked, { sampleOnly }).forEach((g, gi) => {
    const task = tasks.get(g.taskId);
    if (!task) throw new ReviewError(`task "${g.taskId}" is not in ${benchDir}/tasks`);
    const groupId = `g${String(gi + 1).padStart(3, '0')}`;
    const answerKeyFile = path.join(task.fixtureDir, ANSWER_KEY);
    const answerKey = fs.existsSync(answerKeyFile) ? scrubString(fs.readFileSync(answerKeyFile, 'utf8'), literals) : null;
    const rubric = task.rubric.map(({ id, criterion, weight }) => ({ id, criterion, weight }));
    const order = shuffle(g.runs, (params.seed * 1000003 + gi + 1) >>> 0);
    const outputs = [];
    const keyItems = [];
    order.forEach((r, i) => {
      const label = letter(i);
      const itemId = `${groupId}-${label}`;
      const built = buildBundle({ runDir: r.dir, result: r.result, fixtureDir: task.fixtureDir, limits: effectiveLimits(task, limits, explicitLimits), redactions });
      const bundle = scrubString(built.text, literals);
      outputs.push({ itemId, label, bundle });
      keyItems.push({ itemId, label, armId: r.armId, taskId: r.taskId, replicate: r.replicate, bundle });
    });
    groups.push({ groupId, task: { prompt: scrubString(task.prompt, literals), rubric, answerKey }, outputs });
    keyGroups.push({ groupId, taskId: g.taskId, replicate: g.replicate, rubric, items: keyItems });
  });

  const mapping = keyGroups.map((g) => [g.groupId, g.items.map((i) => [i.itemId, i.armId, i.taskId, i.replicate, sha16(i.bundle)])]);
  const viewerId = sha16(JSON.stringify({ runDir: run.dir, seed: params.seed, n: params.n, sampleOnly, mapping }));
  const dir = path.resolve(outDir || path.join(run.dir, 'calibration', 'review'));
  const keyPath = path.join(dir, KEY_FILE);
  if (!force && fs.existsSync(keyPath)) {
    let old = null;
    try { old = readJson(keyPath).viewerId; } catch { /* unreadable key: treat as different */ }
    if (old !== viewerId) throw new ReviewError(`${keyPath} is for viewer ${old ?? '(unreadable)'}, not ${viewerId}; ratings made on the old page would no longer import. Pass --force to replace it, or --out DIR`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const key = { schemaVersion: 1, viewerId, runDir: run.dir, n: params.n, seed: params.seed, sampleOnly, groups: keyGroups };
  fs.writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
  const pagePath = path.join(dir, PAGE_FILE);
  fs.writeFileSync(pagePath, renderViewer({ viewerId, groups }));
  return { dir, pagePath, keyPath, viewerId, groups: groups.length, outputs: keyGroups.reduce((s, g) => s + g.items.length, 0), params };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Every problem with a ratings file against its key, as messages. Empty means it imports. */
function validateRatings(ratings, key) {
  const errs = [];
  if (!isObj(ratings)) return ['ratings file is not a JSON object'];
  if (ratings.kind !== RATINGS_KIND) errs.push(`kind must be "${RATINGS_KIND}"`);
  if (ratings.schemaVersion !== RATINGS_SCHEMA) errs.push(`schemaVersion must be ${RATINGS_SCHEMA} (got ${JSON.stringify(ratings.schemaVersion)})`);
  if (ratings.viewerId !== key.viewerId) errs.push(`viewerId ${JSON.stringify(ratings.viewerId)} does not match the key (${key.viewerId}); these ratings were made on another page`);
  if (ratings.rater !== undefined && typeof ratings.rater !== 'string') errs.push('rater must be a string');
  for (const k of Object.keys(ratings)) if (!['schemaVersion', 'kind', 'viewerId', 'rater', 'exportedAt', 'items'].includes(k)) errs.push(`unknown field "${k}"`);
  if (!Array.isArray(ratings.items)) { errs.push('items must be an array'); return errs; }
  const rubricOf = new Map(key.groups.flatMap((g) => g.items.map((i) => [i.itemId, g.rubric])));
  const seen = new Set();
  ratings.items.forEach((it, i) => {
    const at = `items[${i}]`;
    if (!isObj(it)) { errs.push(`${at} is not an object`); return; }
    for (const k of Object.keys(it)) if (!['itemId', 'labels', 'evidence', 'notes'].includes(k)) errs.push(`${at}: unknown field "${k}"`);
    const rubric = rubricOf.get(it.itemId);
    if (!rubric) { errs.push(`${at}: itemId ${JSON.stringify(it.itemId)} is not in the key`); return; }
    if (seen.has(it.itemId)) errs.push(`${at}: itemId ${it.itemId} appears twice`);
    seen.add(it.itemId);
    const ids = new Set(rubric.map((c) => c.id));
    if (!isObj(it.labels)) errs.push(`${at}: labels must be an object`);
    else {
      for (const [cid, v] of Object.entries(it.labels)) {
        if (!ids.has(cid)) errs.push(`${at}: criterion "${cid}" is not in the rubric for ${it.itemId}`);
        else if (v !== null && !VERDICTS.includes(v)) errs.push(`${at}: ${cid} is ${JSON.stringify(v)}; use ${VERDICTS.join(', ')} or null`);
      }
    }
    if (it.evidence !== undefined) {
      if (!isObj(it.evidence)) errs.push(`${at}: evidence must be an object`);
      else for (const [cid, q] of Object.entries(it.evidence)) {
        if (!ids.has(cid)) errs.push(`${at}: evidence for unknown criterion "${cid}"`);
        else if (typeof q !== 'string' || q.length > MAX_QUOTE) errs.push(`${at}: evidence for ${cid} must be a string of at most ${MAX_QUOTE} characters`);
      }
    }
    if (it.notes !== undefined && (typeof it.notes !== 'string' || it.notes.length > MAX_NOTES)) errs.push(`${at}: notes must be a string of at most ${MAX_NOTES} characters`);
  });
  return errs;
}

/**
 * Validates the ratings, joins each item to its arm, task and replicate through the key, writes sheet.json and key.json
 * in the format `calibrate score` reads, scores them, and saves the result where the report looks for it
 * (<run>/calibration/result.json unless `save` says otherwise). A result.json not written by an import of the same page
 * is kept unless `force`.
 */
function importRatings({ ratingsFile, keyFile, outDir, save, force = false, thresholds }) {
  let ratings;
  try { ratings = JSON.parse(fs.readFileSync(ratingsFile, 'utf8')); } catch (e) { throw new ReviewError(`cannot read ${ratingsFile}: ${e.code || e.message}`); }
  const kFile = keyFile || path.join(path.dirname(ratingsFile), KEY_FILE);
  let key;
  try { key = readJson(kFile); } catch (e) { throw new ReviewError(`cannot read the review key ${kFile}: ${e.code || e.message} (pass --key, the review-key.json written beside review.html)`); }
  const errs = validateRatings(ratings, key);
  if (errs.length) throw new ReviewError(`ratings not imported:\n  ${errs.join('\n  ')}`);

  const byId = new Map(ratings.items.map((it) => [it.itemId, it]));
  const items = [];
  const sheetKey = { runDir: key.runDir, seed: key.seed, source: { kind: 'review', viewerId: key.viewerId }, items: {} };
  const quotes = { checked: 0, found: 0, notFound: [] };
  for (const g of key.groups) {
    for (const k of g.items) {
      const r = byId.get(k.itemId);
      const labels = Object.fromEntries(g.rubric.map((c) => [c.id, r?.labels?.[c.id] ?? null]));
      items.push({ itemId: k.itemId, rubric: g.rubric, labels, notes: r?.notes ?? '' });
      sheetKey.items[k.itemId] = { armId: k.armId, taskId: k.taskId, replicate: k.replicate };
      const matches = makeQuoteMatcher(k.bundle);
      for (const [cid, q] of Object.entries(r?.evidence ?? {})) {
        if (!q.trim()) continue;
        quotes.checked++;
        if (matches(q)) quotes.found++; else quotes.notFound.push(`${k.itemId}:${cid}`);
      }
    }
  }
  const dir = path.resolve(outDir || path.dirname(kFile));
  fs.mkdirSync(dir, { recursive: true });
  const sheetPath = path.join(dir, 'sheet.json');
  const sheetKeyPath = path.join(dir, 'key.json');
  fs.writeFileSync(sheetPath, `${JSON.stringify({ schemaVersion: 1, items }, null, 2)}\n`);
  fs.writeFileSync(sheetKeyPath, `${JSON.stringify(sheetKey, null, 2)}\n`);

  const res = scoreLabels({ labelsFile: sheetPath, keyFile: sheetKeyPath, thresholds });
  res.source = { kind: 'review', viewerId: key.viewerId, rater: ratings.rater ?? '', ratingsFile: path.resolve(ratingsFile), quotes };
  const savePath = path.resolve(save || path.join(key.runDir, 'calibration', 'result.json'));
  if (!force && fs.existsSync(savePath)) {
    let prev = null;
    try { prev = readJson(savePath).source; } catch { /* unreadable: keep it */ }
    if (!(prev?.kind === 'review' && prev.viewerId === key.viewerId)) {
      throw new ReviewError(`${savePath} holds a calibration result from somewhere else; pass --force to replace it, or --save FILE. sheet.json and key.json were written to ${dir}`);
    }
  }
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, `${JSON.stringify(res, null, 2)}\n`);
  return { res, sheetPath, sheetKeyPath, savePath, quotes, rated: ratings.items.length };
}

module.exports = { writeReview, importRatings, validateRatings, groupSample, sampleParams, ReviewError, KEY_FILE, PAGE_FILE };
