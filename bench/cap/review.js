// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap review` writes a static page where a person rates the outputs of the calibration sample side by side, and
// `cap review-import` turns the downloaded ratings into the calibration sheet and key that `calibrate score` reads,
// then scores them. No model call, no network, no credits.
//
// Blinding: each task's outputs get the letters A, B, ... in a seeded random order per task. Which letter is which arm
// is kept only in review-key.json, which goes to its own directory (review-key/ next to review/ by default) so the page
// directory can be handed over whole. The page and the ratings file name no arm, task id or replicate.
//
// Nothing written for later use records the run's absolute path: review-key.json holds the run directory relative to
// itself and the pooled key.json relative to its own directory, so a run moved together with its key still imports, and
// `--run DIR` on import points at a run moved without it. Each item also records a hash of what the rater saw (seenHash),
// so a different run in the same layout, or an edited shown file, is refused instead of being scored against these ratings.
//
// Rater ids, item ids and criterion ids come from people and task files, so they are only used as Map keys or as keys of
// objects without a prototype; "__proto__" or "toString" is an ordinary id.

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { mulberry32 } = require('../../tests/scripts/stats.js');
const { ANSWER_KEY } = require('../runner/lib/sandbox.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { secretLiterals, scrubString } = require('../runner/lib/scrub.js');
const { loadRun, readJson } = require('../report/load.js');
const { runtimeOf } = require('../runner/lib/harness/runtime.js');
const { buildBundle } = require('../judge/bundle.js');
const { effectiveLimits } = require('../judge/config.js');
const { drawSample, scoreLabels, raterKappas } = require('../judge/calibrate.js');
const { makeQuoteMatcher } = require('../judge/quote.js');
const { VERDICTS, RATINGS_KIND, RATINGS_SCHEMA, renderViewer } = require('./review-viewer.js');

const KEY_FILE = 'review-key.json';
const KEY_SCHEMA = 2;
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
const dict = () => Object.create(null);
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

// JSON with object keys sorted at every level, so the same content always gives the same bytes.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * A hash of what the rater saw for one run: the stream.jsonl bytes (the final text comes from them), the checks the
 * bundle shows (checksOriginal ?? checks, which recheck leaves alone), the questions and turns, the harness that decides
 * how the stream is read, and the raw bytes of each workspace file the bundle was built from (`files`, from
 * buildBundle), plus whether each file it listed as deleted is still gone. result.json fields the page never shows, such
 * as a rechecked `checks`, do not change it.
 */
function seenHash(runDir, { files = [], deleted = [] } = {}) {
  const result = readJson(path.join(runDir, 'result.json'));
  const stream = path.join(runDir, 'stream.jsonl');
  const ws = (rel) => path.join(runDir, 'workspace', rel);
  return sha256(canonical({
    stream: fs.existsSync(stream) ? sha256(fs.readFileSync(stream)) : null,
    checks: result.checksOriginal ?? result.checks ?? [],
    questions: result.questions ?? null,
    turns: result.turns ?? null,
    runtime: runtimeOf(result),
    files: [...files].sort().map((rel) => [rel, fs.existsSync(ws(rel)) ? sha256(fs.readFileSync(ws(rel))) : null]),
    deleted: [...deleted].sort().map((rel) => [rel, fs.existsSync(ws(rel))]),
  }));
}

// What cap review and cap review-import write that names arms or holds ratings, by exact name: the key, the pooled
// sheet and key, the raters/ directory, staging directories, and writeJson's temporary files for those. A page directory
// holding any of them is never handed over. Anything else there, such as a downloaded ratings-*.json, is the rater's.
const KEY_ARTIFACTS = new Set([KEY_FILE, 'key.json', 'sheet.json', 'raters']);
const KEY_ARTIFACT_RE = /^(?:\.import-.+|(?:review-key|key|sheet)\.json\.tmp-\d+)$/;
const KEY_LIKE = (name) => KEY_ARTIFACTS.has(name) || KEY_ARTIFACT_RE.test(name);
const OLD_KEY = 'Regenerate it with `cap review --run DIR`; ratings made on the old page will not import';

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
 * Writes review.html (the page a rater opens) into outDir and review-key.json (letter to arm, kept away from the rater)
 * into keyOutDir, which must not be outDir or inside it. Defaults: <run>/calibration/review and <run>/calibration/review-key.
 * Bundles are built exactly as for the judges: the same arm-name redaction, then credential scrubbing.
 */
function writeReview({ runDir, benchDir, extraTasks = [], n, seed, sampleOnly = false, limits, explicitLimits = {}, redactions, outDir, keyOutDir, force = false, env = process.env }) {
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
      const seen = { files: built.changed, deleted: built.deleted };
      keyItems.push({ itemId, label, armId: r.armId, taskId: r.taskId, replicate: r.replicate, seen, seenHash: seenHash(r.dir, seen), bundle });
    });
    groups.push({ groupId, task: { prompt: scrubString(task.prompt, literals), rubric, answerKey }, outputs });
    keyGroups.push({ groupId, taskId: g.taskId, replicate: g.replicate, rubric, items: keyItems });
  });

  const mapping = keyGroups.map((g) => [g.groupId, g.items.map((i) => [i.itemId, i.armId, i.taskId, i.replicate, sha16(i.bundle)])]);
  const viewerId = sha16(JSON.stringify({ seed: params.seed, n: params.n, sampleOnly, mapping }));
  const dir = path.resolve(outDir || path.join(run.dir, 'calibration', 'review'));
  const keyDir = path.resolve(keyOutDir || path.join(path.dirname(dir), 'review-key'));
  const rel = path.relative(dir, keyDir);
  if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new ReviewError(`the key directory ${keyDir} is the page directory or inside it; pass a --key-out outside ${dir}`);
  const keyPath = path.join(keyDir, KEY_FILE);
  const leftovers = fs.existsSync(dir) ? fs.readdirSync(dir).filter(KEY_LIKE).sort() : [];
  if (leftovers.length) {
    throw new ReviewError(`${dir} holds ${leftovers.join(', ')} from an earlier review, which can name the arms; that directory must not be handed to a rater. Move or delete ${leftovers.length > 1 ? 'them' : 'it'}, then run cap review again (nothing was written)`);
  }
  if (!force && fs.existsSync(keyPath)) {
    let old = null;
    try { old = readJson(keyPath).viewerId; } catch { /* unreadable key: treat as different */ }
    if (old !== viewerId) throw new ReviewError(`${keyPath} is for viewer ${old ?? '(unreadable)'}, not ${viewerId}; ratings made on the old page would no longer import. Pass --force to replace it, or --key-out DIR`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(keyDir, { recursive: true });
  const key = { schemaVersion: KEY_SCHEMA, viewerId, run: path.relative(keyDir, run.dir) || '.', n: params.n, seed: params.seed, sampleOnly, groups: keyGroups };
  fs.writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
  const pagePath = path.join(dir, PAGE_FILE);
  fs.writeFileSync(pagePath, renderViewer({ viewerId, groups }));
  return { dir, keyDir, pagePath, keyPath, viewerId, groups: groups.length, outputs: keyGroups.reduce((s, g) => s + g.items.length, 0), params };
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
      items.push({ itemId: k.itemId, rater, rubric: g.rubric, labels: Object.fromEntries(g.rubric.map((c) => [c.id, own(r?.labels, c.id) ? r.labels[c.id] : null])), notes: typeof r?.notes === 'string' ? r.notes : '' });
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
        if (typeof q !== 'string' || !q.trim()) continue;
        quotes.checked++;
        if (matches(q)) quotes.found++; else quotes.notFound.push(`${k.itemId}:${cid}`);
      }
    }
  }
  return quotes;
}

// Written to a temporary name and renamed, so a file is either the old one or the whole new one.
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * The run a key belongs to: --run when given, else the key's recorded path relative to the key's own directory.
 * Checked against the key: every run it lists must be there and show what the rater saw (seenHash), so a wrong
 * directory, a re-run in the same layout or an edited workspace file is refused by name.
 */
function resolveRun(key, keyFile, runOpt) {
  const runDir = runOpt ? path.resolve(runOpt) : key.run !== undefined ? path.resolve(path.dirname(keyFile), key.run) : null;
  if (!runDir) throw new ReviewError(`${keyFile} records no run directory; pass --run DIR`);
  const items = key.groups.flatMap((g) => g.items);
  const missing = items.filter((i) => !fs.existsSync(path.join(runDir, i.armId, i.taskId, String(i.replicate), 'result.json')));
  if (missing.length) {
    throw new ReviewError(`${runDir} is not the run this key was made from (${missing.length} of its runs are missing there, first ${missing[0].armId}/${missing[0].taskId}/${missing[0].replicate}); ${runOpt ? 'check --run' : 'the run moved without its key: pass --run DIR'}`);
  }
  const changed = items.filter((i) => seenHash(path.join(runDir, i.armId, i.taskId, String(i.replicate)), i.seen) !== i.seenHash);
  if (changed.length) {
    const c = changed[0];
    throw new ReviewError(`${runDir} has different output for item ${c.itemId} (${c.armId}/${c.taskId}/${c.replicate}) than the page was made from${changed.length > 1 ? `, and ${changed.length - 1} more` : ''}: its stream, shown checks, questions or shown workspace files changed, so the ratings would be scored against outputs nobody rated. Nothing was written`);
  }
  return runDir;
}

/**
 * Validates one rater's ratings, keeps them under raters/<rater>/ next to the key, and rescores every rater on file.
 *
 * Each rater gets ratings.json (the file as given), sheet.json and result.json (that rater alone against the judges).
 * The combined sheet.json and key.json beside the key pool all raters: every output appears once per rater, so
 * `calibrate score` and scoreLabels count each rater's labels as their own criterion pairs against each judge. The
 * combined result goes to <run>/calibration/result.json, which the report reads, with each rater's own figures under
 * `byRater` and each rater's kappa under `raterKappa`. The pooled result it replaces is copied to result.prev.json first.
 *
 * Nothing is written when the file is invalid, rates nothing, would replace a rater already on file, when the result
 * path holds a result that this page did not write, when the run cannot be found, or when scoring fails. --force
 * (`force`) allows the second and third.
 */
function importRatings({ ratingsFile, keyFile, run: runOpt, rater: raterOpt, outDir, save, force = false, thresholds, onStaged = null }) {
  let ratings;
  try { ratings = JSON.parse(fs.readFileSync(ratingsFile, 'utf8')); } catch (e) { throw new ReviewError(`cannot read ${ratingsFile}: ${e.code || e.message}`); }
  if (!keyFile) throw new ReviewError('--key FILE is required: the review-key.json that cap review wrote to its own directory (review-key/ by default). It is never looked for next to the page or the ratings');
  const kFile = path.resolve(keyFile);
  let key;
  try { key = readJson(kFile); } catch (e) { throw new ReviewError(`cannot read the review key ${kFile}: ${e.code || e.message}`); }
  if (key.schemaVersion !== KEY_SCHEMA || !Array.isArray(key.groups)) {
    throw new ReviewError(`${kFile} is a review key from an older or unknown version (schemaVersion ${key.schemaVersion === undefined ? 'missing' : JSON.stringify(key.schemaVersion)}; this version reads ${KEY_SCHEMA}). ${OLD_KEY}`);
  }
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
  const runDir = resolveRun(key, kFile, runOpt);
  const savePath = path.resolve(save || path.join(runDir, 'calibration', 'result.json'));
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

  // Every rater on file plus this one, scored in a staging directory first; files are put in place only after all
  // scoring succeeded, the backup first and this rater's ratings.json last, so a failure at any point leaves this rater
  // off file and the import can simply be retried.
  const ratingsOf = new Map(others.map((id) => [id, readJson(path.join(ratersRoot, id, 'ratings.json'))]));
  ratingsOf.set(raterId, { ...ratings, raterId });
  const raterIds = [...ratingsOf.keys()].sort();
  const items = dict();
  for (const g of key.groups) for (const k of g.items) items[k.itemId] = { armId: k.armId, taskId: k.taskId, replicate: k.replicate };
  const sheetKeyPath = path.join(dir, 'key.json');
  // calibrate score resolves a relative runDir against the key file's directory, so this key follows a moved run too.
  const sheetKey = { runDir: path.relative(dir, runDir) || '.', seed: key.seed, source: { kind: 'review', viewerId: key.viewerId }, items };

  fs.mkdirSync(dir, { recursive: true });
  // The staging directory is removed when the import ends, by success or error. A run killed partway leaves it, so a
  // stale one is cleared here; none of them is ever read.
  for (const old of fs.readdirSync(dir).filter((n) => n.startsWith('.import-'))) fs.rmSync(path.join(dir, old), { recursive: true, force: true });
  const stage = fs.mkdtempSync(path.join(dir, '.import-'));
  const files = [];
  let res;
  let quotes = null;
  try {
    // Optional test hook, never set by the CLI: lets a test act while the staging directory exists.
    if (onStaged) onStaged(stage);
    const stagedKey = path.join(stage, 'key.json');
    writeJson(stagedKey, { ...sheetKey, runDir });
    const pooled = [];
    const byRater = dict();
    raterIds.forEach((id, n) => {
      const r = ratingsOf.get(id);
      const sheet = sheetItems(key, r, id);
      pooled.push(...sheet);
      const stagedSheet = path.join(stage, `sheet-${n}.json`);
      writeJson(stagedSheet, { schemaVersion: 1, items: sheet });
      const q = quoteCheck(key, r);
      if (id === raterId) quotes = q;
      const one = scoreLabels({ labelsFile: stagedSheet, keyFile: stagedKey, thresholds });
      one.source = { kind: 'review', viewerId: key.viewerId, rater: id, quotes: q };
      byRater[id] = { itemsLabeled: one.itemsLabeled, judges: one.judges };
      files.push([path.join(ratersRoot, id, 'sheet.json'), { schemaVersion: 1, items: sheet }], [path.join(ratersRoot, id, 'result.json'), one]);
    });
    const stagedPooled = path.join(stage, 'sheet.json');
    writeJson(stagedPooled, { schemaVersion: 1, items: pooled });
    res = scoreLabels({ labelsFile: stagedPooled, keyFile: stagedKey, thresholds });
    res.source = { kind: 'review', viewerId: key.viewerId, pooled: true, raters: raterIds };
    res.byRater = byRater;
    res.raterKappa = { kappaMin: thresholds.kappaMin, raters: raterKappas(byRater, thresholds.kappaMin) };
    files.push([path.join(dir, 'sheet.json'), { schemaVersion: 1, items: pooled }], [sheetKeyPath, sheetKey]);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  // One level of backup: the pooled result this import replaces is kept as result.prev.json (any older .prev is replaced).
  let backupPath = null;
  if (fs.existsSync(savePath)) {
    backupPath = savePath.replace(/(\.json)?$/, '.prev.json');
    fs.copyFileSync(savePath, backupPath);
  }
  for (const [file, value] of files) writeJson(file, value);
  writeJson(savePath, res);
  writeJson(raterFile, ratingsOf.get(raterId));
  return {
    res, runDir, raterId, raters: raterIds, raterFile, sheetPath: path.join(dir, 'sheet.json'), sheetKeyPath,
    savePath, backupPath, quotes, rated: ratings.items.filter((it) => labeledCount(it) > 0).length,
  };
}

module.exports = { writeReview, importRatings, validateRatings, raterIdOf, groupSample, sampleParams, seenHash, ReviewError, KEY_FILE, PAGE_FILE };
