// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { mulberry32 } = require('../../tests/scripts/stats.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { ANSWER_KEY } = require('../runner/lib/sandbox.js');
const { loadRun, readJson } = require('../report/load.js');
const { buildBundle } = require('./bundle.js');
const { rubricScore } = require('./score.js');
const { effectiveLimits } = require('./config.js');
const { percentAgreement, cohenKappa, spearman } = require('./agreement.js');
const packLib = require('./pack/index.js');
const { readQuality } = require('./packrun.js');
const { notJudgedReason } = require('./run.js');

const VERDICTS = ['pass', 'partial', 'fail'];

function shuffle(list, seed) {
  const rng = mulberry32(seed);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The runs a calibration sheet is drawn from, shuffled by the seed, the first n. Runs the judges never see are left out
// too (budget-skipped, credentials possibly unscrubbed, output files replaced by the agent, no workspace): their text must
// not reach raters either.
function drawSample(runs, n, seed) {
  return shuffle(runs.filter((r) => r.result.status !== 'budget_skipped' && !notJudgedReason(r)), seed).slice(0, n);
}

function fence(text) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}\n${text}\n${f}`;
}

function packMarkdown(pk) {
  const rows = pk.criteria.map((c) => [`- **${c.id}** (${c.dimension}): ${c.question}`, `  - fail: ${c.levels.fail}`, `  - partial: ${c.levels.partial}`, `  - pass: ${c.levels.pass}`, `  - quote: ${c.quote}`].join('\n'));
  const lines = [`Quality pack ${pk.id} (revision ${pk.revision}). Rate each criterion pass, partial or fail using only its three descriptions, and fill in \`pack.labels\` in sheet.json. Count where a description gives a number.`, rows.join('\n') || '(no criterion needs a rating for this output)'];
  if (pk.computed.length) lines.push(`Scored by a program, not rated: ${pk.computed.join(', ')}.`);
  if (pk.absent.length) lines.push(`Scored fail because the task asked for the artifact and none was produced: ${pk.absent.join(', ')}.`);
  if (pk.na.length) lines.push(`Not applicable: ${pk.na.map((x) => `${x.id} (${x.reason})`).join('; ')}.`);
  if (pk.changes) lines.push(`Changes made by the agent:\n\n${fence(pk.changes)}`);
  return lines.join('\n\n');
}

function sheetMarkdown(items) {
  const head = '# Calibration sheet\n\nFill in labels in sheet.json: for each criterion set `pass`, `partial` or `fail`, judging only the output bundle against the rubric and answer key. Do not look at key.json until you are done.\n';
  const body = items.map((it) => [
    `## ${it.itemId}`,
    `Task given to the agent:\n\n> ${it.taskPrompt.replace(/\n/g, '\n> ')}`,
    `Rubric:\n\n${it.rubric.map((r) => `- **${r.id}** (weight ${r.weight}): ${r.criterion}`).join('\n')}`,
    `Answer key:\n\n${it.answerKey ? fence(it.answerKey) : '(none)'}`,
    `Output bundle:\n\n${fence(it.bundle)}`,
    `Labels to fill in: ${it.rubric.map((r) => `${r.id}: ____`).join(' | ')}`,
    ...(it.pack ? [packMarkdown(it.pack)] : []),
  ].join('\n\n'));
  return [head, ...body].join('\n\n---\n\n') + '\n';
}

// Writes sheet.json (blinded, editable), sheet.md (readable copy) and key.json (item -> arm).
function exportSheet({ runDir, benchDir, n, seed, limits, explicitLimits = {}, redactions, outDir, criteriaPack = null }) {
  const run = loadRun(runDir);
  const tasks = loadTasks(benchDir);
  const picked = drawSample(run.runs, n, seed);
  const items = [];
  const key = { runDir: run.dir, seed, items: {} };
  picked.forEach((r, i) => {
    const task = tasks.get(r.taskId);
    if (!task) throw new Error(`task "${r.taskId}" is not in ${benchDir}/tasks`);
    const itemId = `item-${String(i + 1).padStart(3, '0')}`;
    const answerKeyFile = path.join(task.fixtureDir, ANSWER_KEY);
    const built = buildBundle({ runDir: r.dir, result: r.result, fixtureDir: task.fixtureDir, limits: effectiveLimits(task, limits, explicitLimits), redactions });
    items.push({
      itemId,
      taskPrompt: task.prompt,
      rubric: task.rubric.map(({ id, criterion, weight }) => ({ id, criterion, weight })),
      answerKey: fs.existsSync(answerKeyFile) ? fs.readFileSync(answerKeyFile, 'utf8') : null,
      bundle: built.text,
      labels: Object.fromEntries(task.rubric.map((c) => [c.id, null])),
      notes: '',
      ...(criteriaPack ? { pack: packItem(criteriaPack, task, built, redactions) } : {}),
    });
    key.items[itemId] = { armId: r.armId, taskId: r.taskId, replicate: r.replicate };
  });
  const dir = path.resolve(outDir || path.join(run.dir, 'calibration'));
  fs.mkdirSync(dir, { recursive: true });
  const sheetPath = path.join(dir, 'sheet.json');
  fs.writeFileSync(sheetPath, JSON.stringify({ schemaVersion: 1, items }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'sheet.md'), sheetMarkdown(items));
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 2) + '\n');
  return { dir, sheetPath, n: items.length };
}

// The pack part of a sheet item: the criteria a person rates (the ones a judge is asked), with labels left empty.
function packItem(thePack, task, built, redactions) {
  const app = packLib.applicability(thePack, task, built.files, { deleted: built.deleted });
  const asked = app.criteria.filter((c) => c.status === 'judged').map((c) => c.criterion);
  return {
    id: thePack.id, revision: thePack.revision,
    changes: packLib.redactedChanges(app.stats, redactions),
    criteria: asked.map((c) => ({ id: c.id, dimension: c.dimension, question: c.question, levels: c.levels, quote: c.evidence.quote })),
    computed: app.criteria.filter((c) => c.status === 'auto').map((c) => c.criterion.id),
    absent: app.criteria.filter((c) => c.status === 'absent').map((c) => c.criterion.id),
    na: app.criteria.filter((c) => c.status === 'na').map((c) => ({ id: c.criterion.id, reason: c.reason })),
    labels: Object.fromEntries(asked.map((c) => [c.id, null])),
  };
}

function assess({ agreement, kappa, spearman: rho }, t, n) {
  const reasons = [];
  if (!n) reasons.push('no overlapping items');
  else if (kappa === null) reasons.push('kappa undefined (no variance in labels)');
  else if (kappa < t.kappaMin) reasons.push(`kappa ${kappa.toFixed(2)} < ${t.kappaMin}`);
  if (n && agreement < t.agreementMin) reasons.push(`agreement ${agreement.toFixed(2)} < ${t.agreementMin}`);
  if (n && rho !== null && rho < t.spearmanMin) reasons.push(`spearman ${rho.toFixed(2)} < ${t.spearmanMin}`);
  if (n && n < 30) reasons.push(`only ${n} criterion pairs, treat as indicative`);
  const failed = reasons.filter((r) => !/only \d+ criterion/.test(r));
  return { status: failed.length ? 'WARN' : 'PASS', reasons };
}

function stats(critPairs, scorePairs, thresholds) {
  const s = {
    nCriteria: critPairs.length,
    nItems: scorePairs.length,
    agreement: percentAgreement(critPairs),
    kappa: cohenKappa(critPairs),
    spearman: spearman(scorePairs.map((p) => p[0]), scorePairs.map((p) => p[1])),
  };
  return { ...s, ...assess(s, thresholds, critPairs.length) };
}

function scoreLabels({ labelsFile, keyFile, thresholds }) {
  const sheet = readJson(labelsFile);
  const keyPath = keyFile || path.join(path.dirname(labelsFile), 'key.json');
  const key = readJson(keyPath);
  // A relative runDir is relative to the key file, so a key kept inside the run still works after the run moves.
  const run = loadRun(path.resolve(path.dirname(keyPath), key.runDir));
  const records = (run.judgments?.rubric || []).filter((r) => !r.judgeError);
  const judges = run.judgments?.judges || [];
  const recOf = (judge, k) => records.find((r) => r.judge === judge && r.armId === k.armId && r.taskId === k.taskId && r.replicate === k.replicate);

  const out = { thresholds, itemsTotal: sheet.items.length, itemsLabeled: 0, judges: {}, judgeVsJudge: {} };
  // Own keys only: a criterion or item id such as "constructor" must not read an inherited property.
  const ownGet = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const humanOf = (it) => it.rubric.map((r) => ({ id: r.id, verdict: ownGet(it.labels, r.id) })).filter((c) => VERDICTS.includes(c.verdict));
  const labeledItems = sheet.items.filter((it) => humanOf(it).length === it.rubric.length);
  out.itemsLabeled = labeledItems.length;

  for (const judge of judges) {
    const crit = [];
    const score = [];
    for (const it of sheet.items) {
      const k = ownGet(key.items, it.itemId);
      const rec = k && recOf(judge, k);
      if (!rec) continue;
      const human = humanOf(it);
      const jv = new Map(rec.criteria.map((c) => [c.id, c.verdict]));
      for (const h of human) if (jv.has(h.id)) crit.push([h.verdict, jv.get(h.id)]);
      if (human.length === it.rubric.length) score.push([rubricScore(it.rubric, human), rec.score]);
    }
    out.judges[judge] = stats(crit, score, thresholds);
  }

  for (let i = 0; i < judges.length; i++) {
    for (let j = i + 1; j < judges.length; j++) {
      const crit = [];
      const score = [];
      for (const a of records.filter((r) => r.judge === judges[i])) {
        const b = recOf(judges[j], a);
        if (!b) continue;
        const bv = new Map(b.criteria.map((c) => [c.id, c.verdict]));
        for (const c of a.criteria) if (bv.has(c.id)) crit.push([c.verdict, bv.get(c.id)]);
        score.push([a.score, b.score]);
      }
      out.judgeVsJudge[`${judges[i]}~${judges[j]}`] = stats(crit, score, thresholds);
    }
  }
  return out;
}

const f2 = (v) => (v === null ? 'n/a' : v.toFixed(2));

function formatCalibration(res) {
  const t = res.thresholds;
  const lines = [
    `Calibration: ${res.itemsLabeled}/${res.itemsTotal} items fully labeled. Targets: kappa >= ${t.kappaMin}, agreement >= ${t.agreementMin}, spearman >= ${t.spearmanMin}`,
    '', 'Judge vs human:',
  ];
  for (const [j, s] of Object.entries(res.judges)) {
    lines.push(`  ${j.padEnd(16)} ${s.status}  criteria=${s.nCriteria} agreement=${f2(s.agreement)} kappa=${f2(s.kappa)} spearman=${f2(s.spearman)}${s.reasons.length ? `  (${s.reasons.join('; ')})` : ''}`);
  }
  lines.push('', 'Judge vs judge:');
  for (const [j, s] of Object.entries(res.judgeVsJudge)) {
    lines.push(`  ${j.padEnd(32)} ${s.status}  criteria=${s.nCriteria} agreement=${f2(s.agreement)} kappa=${f2(s.kappa)} spearman=${f2(s.spearman)}${s.reasons.length ? `  (${s.reasons.join('; ')})` : ''}`);
  }
  if (!Object.keys(res.judgeVsJudge).length) lines.push('  (needs two or more judges)');
  return lines.join('\n');
}

function formatPackCalibration(res) {
  const lines = [`Quality pack ${res.pack.id} (revision ${res.pack.revision}): ${res.itemsLabeled}/${res.itemsWithPack} items with at least one rating. Judge vs human, per criterion:`];
  for (const [j, s] of Object.entries(res.judges)) {
    lines.push(`  ${j.padEnd(16)} ${s.status}  criteria=${s.nCriteria} agreement=${f2(s.agreement)} kappa=${f2(s.kappa)}${s.reasons.length ? `  (${s.reasons.join('; ')})` : ''}`);
    for (const [d, v] of Object.entries(s.byDimension)) lines.push(`    ${d.padEnd(20)} n=${v.n} agreement=${f2(v.agreement)} kappa=${f2(v.kappa)}`);
  }
  return lines.join('\n');
}

/**
 * One kappa per rater from a review import's byRater: the lowest finite judge-vs-human kappa, the same reduction the
 * report applies to the pooled result. Sorted by rater id; `lowest` marks the minimum and `below` a kappa under kappaMin,
 * the threshold already used for the pooled value. A rater with no finite kappa has kappa null and is neither.
 */
function raterKappas(byRater, kappaMin) {
  const rows = Object.entries(byRater || {}).sort(([a], [b]) => a.localeCompare(b)).map(([rater, r]) => {
    const ks = Object.values(r.judges || {}).map((s) => s.kappa).filter((k) => typeof k === 'number' && Number.isFinite(k));
    const kappa = ks.length ? Math.min(...ks) : null;
    return { rater, kappa, below: kappa !== null && kappa < kappaMin, lowest: false };
  });
  const finiteRows = rows.filter((r) => r.kappa !== null);
  if (finiteRows.length) {
    const min = Math.min(...finiteRows.map((r) => r.kappa));
    for (const r of finiteRows) if (r.kappa === min) r.lowest = true;
  }
  return rows;
}

/** "alice 1.00, **bob 0.25 (lowest, below 0.6)**": the lowest in bold, any rater under kappaMin marked. */
function formatRaterKappas(rows, kappaMin) {
  return rows.map((r) => {
    if (r.kappa === null) return `${r.rater} n/a`;
    const tags = [r.lowest && rows.length > 1 ? 'lowest' : null, r.below ? `below ${kappaMin}` : null].filter(Boolean);
    const text = `${r.rater} ${r.kappa.toFixed(2)}${tags.length ? ` (${tags.join(', ')})` : ''}`;
    return r.lowest && rows.length > 1 ? `**${text}**` : text;
  }).join(', ');
}

/**
 * Judge versus human on the pack criteria of a labeled sheet. Reads sheet.json (items[].pack.labels), key.json and the run's
 * judgments-quality.json. Only criteria a judge was asked and a person rated are paired; nothing is imputed.
 */
function scorePackLabels({ labelsFile, keyFile, thresholds }) {
  const sheet = readJson(labelsFile);
  const keyPath = keyFile || path.join(path.dirname(labelsFile), 'key.json');
  const key = readJson(keyPath);
  const runDir = path.resolve(path.dirname(keyPath), key.runDir);
  const q = readQuality(runDir);
  if (!q) throw new Error(`no judgments-quality.json in ${runDir}; run judge --criteria-pack first`);
  const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const out = { pack: q.pack, itemsTotal: sheet.items.length, itemsWithPack: sheet.items.filter((it) => it.pack).length, itemsLabeled: 0, judges: {} };
  for (const judge of q.judges) {
    const pairs = [];
    const byDim = {};
    for (const it of sheet.items) {
      if (!it.pack || it.pack.revision !== q.pack.revision) continue;
      const k = own(key.items, it.itemId);
      const rec = k && q.records.find((r) => r.judge === judge && r.armId === k.armId && r.taskId === k.taskId && r.replicate === k.replicate && !r.judgeError);
      if (!rec) continue;
      const verdicts = new Map(rec.criteria.filter((c) => c.status === 'judged').map((c) => [c.id, c]));
      for (const c of it.pack.criteria) {
        const human = own(it.pack.labels, c.id);
        if (!VERDICTS.includes(human) || !verdicts.has(c.id)) continue;
        pairs.push([human, verdicts.get(c.id).verdict]);
        (byDim[c.dimension] ||= []).push([human, verdicts.get(c.id).verdict]);
      }
    }
    out.judges[judge] = { ...stats(pairs, [], thresholds), byDimension: Object.fromEntries(Object.entries(byDim).map(([d, ps]) => [d, { n: ps.length, agreement: percentAgreement(ps), kappa: cohenKappa(ps) }])) };
  }
  out.itemsLabeled = sheet.items.filter((it) => it.pack && Object.values(it.pack.labels).some((v) => v !== null)).length;
  return out;
}

module.exports = { exportSheet, scoreLabels, scorePackLabels, formatCalibration, formatPackCalibration, drawSample, raterKappas, formatRaterKappas };
