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

/** A file-safe rater id: from --rater, else the rater name in the ratings file. Null when neither gives one. */
function raterIdOf(name) {
  const id = String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(0, 40);
  return id || null;
}

const labeledCount = (it) => Object.values(it.labels || {}).filter((v) => v !== null).length;

// One sheet item per output of the key, labeled from one rater's ratings (null where the rater left a criterion open).
function sheetItems(key, ratings, rater) {
  const byId = new Map(ratings.items.map((it) => [it.itemId, it]));
  const items = [];
  for (const g of key.groups) {
    for (const k of g.items) {
      const r = byId.get(k.itemId);
      items.push({ itemId: k.itemId, rater, rubric: g.rubric, labels: Object.fromEntries(g.rubric.map((c) => [c.id, r?.labels?.[c.id] ?? null])), notes: r?.notes ?? '' });
    }
  }
  return items;
}

function quoteCheck(key, ratings) {
  const byId = new Map(ratings.items.map((it) => [it.itemId, it]));
  const quotes = { checked: 0, found: 0, notFound: [] };
  for (const g of key.groups) {
    for (const k of g.items) {
      const matches = makeQuoteMatcher(k.bundle);
      for (const [cid, q] of Object.entries(byId.get(k.itemId)?.evidence ?? {})) {
        if (!q.trim()) continue;
        quotes.checked++;
        if (matches(q)) quotes.found++; else quotes.notFound.push(`${k.itemId}:${cid}`);
      }
    }
  }
  return quotes;
}

const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };

/**
 * Validates one rater's ratings, keeps them under raters/<rater>/ next to the key, and rescores every rater on file.
 *
 * Each rater gets ratings.json (the file as given), sheet.json and result.json (that rater alone against the judges).
 * The combined sheet.json and key.json beside the key pool all raters: every output appears once per rater, so
 * `calibrate score` and scoreLabels count each rater's labels as their own criterion pairs against each judge. The
 * combined result goes to <run>/calibration/result.json, which the report reads, with each rater's own figures under
 * `byRater`.
 *
 * Nothing is written when the file is invalid, rates nothing, would replace a rater already on file, or when the result
 * path holds a result that this page did not write. --force (`force`) allows the last two.
 */
function importRatings({ ratingsFile, keyFile, rater: raterOpt, outDir, save, force = false, thresholds }) {
  let ratings;
  try { ratings = JSON.parse(fs.readFileSync(ratingsFile, 'utf8')); } catch (e) { throw new ReviewError(`cannot read ${ratingsFile}: ${e.code || e.message}`); }
  const kFile = keyFile || path.join(path.dirname(ratingsFile), KEY_FILE);
  let key;
  try { key = readJson(kFile); } catch (e) { throw new ReviewError(`cannot read the review key ${kFile}: ${e.code || e.message} (pass --key, the review-key.json written beside review.html)`); }
  const errs = validateRatings(ratings, key);
  if (errs.length) throw new ReviewError(`ratings not imported:\n  ${errs.join('\n  ')}`);
  if (!ratings.items.some((it) => labeledCount(it) > 0)) throw new ReviewError(`ratings not imported: ${ratingsFile} rates no criterion of any output; nothing was written`);
  const raterId = raterIdOf(raterOpt ?? ratings.rater);
  if (!raterId) throw new ReviewError('ratings not imported: no rater id. Fill in Rater on the page before downloading, or pass --rater ID');

  const dir = path.resolve(outDir || path.dirname(kFile));
  const raterDir = path.join(dir, 'raters', raterId);
  const raterFile = path.join(raterDir, 'ratings.json');
  if (!force && fs.existsSync(raterFile)) {
    throw new ReviewError(`${raterFile} already holds ratings from rater "${raterId}"; pass --force to replace them, or --rater ID for a different rater. Nothing was written`);
  }
  const savePath = path.resolve(save || path.join(key.runDir, 'calibration', 'result.json'));
  if (!force && fs.existsSync(savePath)) {
    let prev = null;
    try { prev = readJson(savePath).source; } catch { /* unreadable: keep it */ }
    if (!(prev?.kind === 'review' && prev.viewerId === key.viewerId)) {
      throw new ReviewError(`${savePath} holds a calibration result that this review page did not write; pass --force to replace it, or --save FILE. Nothing was written`);
    }
  }

  const ratersRoot = path.join(dir, 'raters');
  const others = fs.existsSync(ratersRoot) ? fs.readdirSync(ratersRoot).filter((d) => d !== raterId && fs.existsSync(path.join(ratersRoot, d, 'ratings.json'))) : [];
  for (const id of others) {
    let r = null;
    try { r = readJson(path.join(ratersRoot, id, 'ratings.json')); } catch { /* reported below */ }
    const bad = r ? validateRatings(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'raterId')), key) : ['unreadable'];
    if (bad.length) throw new ReviewError(`rater "${id}" on file in ${ratersRoot} does not fit this page (${bad[0]}); move that directory aside before importing. Nothing was written`);
  }

  writeJson(raterFile, { ...ratings, raterId });
  const sheetKey = { runDir: key.runDir, seed: key.seed, source: { kind: 'review', viewerId: key.viewerId }, items: {} };
  for (const g of key.groups) for (const k of g.items) sheetKey.items[k.itemId] = { armId: k.armId, taskId: k.taskId, replicate: k.replicate };
  const sheetKeyPath = path.join(dir, 'key.json');
  writeJson(sheetKeyPath, sheetKey);

  // Every rater on file, this one included, scored alone and then pooled.
  const raterIds = fs.readdirSync(ratersRoot).filter((d) => fs.existsSync(path.join(ratersRoot, d, 'ratings.json'))).sort();
  const pooled = [];
  const byRater = {};
  let quotes = null;
  for (const id of raterIds) {
    const r = readJson(path.join(ratersRoot, id, 'ratings.json'));
    const items = sheetItems(key, r, id);
    pooled.push(...items);
    const sheetPath = path.join(ratersRoot, id, 'sheet.json');
    writeJson(sheetPath, { schemaVersion: 1, items });
    const q = quoteCheck(key, r);
    if (id === raterId) quotes = q;
    const res = scoreLabels({ labelsFile: sheetPath, keyFile: sheetKeyPath, thresholds });
    res.source = { kind: 'review', viewerId: key.viewerId, rater: id, quotes: q };
    writeJson(path.join(ratersRoot, id, 'result.json'), res);
    byRater[id] = { itemsLabeled: res.itemsLabeled, judges: res.judges };
  }
  const sheetPath = path.join(dir, 'sheet.json');
  writeJson(sheetPath, { schemaVersion: 1, items: pooled });
  const res = scoreLabels({ labelsFile: sheetPath, keyFile: sheetKeyPath, thresholds });
  res.source = { kind: 'review', viewerId: key.viewerId, pooled: true, raters: raterIds };
  res.byRater = byRater;
  writeJson(savePath, res);
  return { res, raterId, raters: raterIds, raterFile, sheetPath, sheetKeyPath, savePath, quotes, rated: ratings.items.filter((it) => labeledCount(it) > 0).length };
}

module.exports = { writeReview, importRatings, validateRatings, raterIdOf, groupSample, sampleParams, ReviewError, KEY_FILE, PAGE_FILE };
