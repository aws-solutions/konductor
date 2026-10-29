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
const { percentAgreement, cohenKappa, spearman } = require('./agreement.js');

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

function fence(text) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}\n${text}\n${f}`;
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
  ].join('\n\n'));
  return [head, ...body].join('\n\n---\n\n') + '\n';
}

// Writes sheet.json (blinded, editable), sheet.md (readable copy) and key.json (item -> arm).
function exportSheet({ runDir, benchDir, n, seed, limits, redactions, outDir }) {
  const run = loadRun(runDir);
  const tasks = loadTasks(benchDir);
  const eligible = run.runs.filter((r) => r.result.status !== 'budget_skipped');
  const picked = shuffle(eligible, seed).slice(0, n);
  const items = [];
  const key = { runDir: run.dir, seed, items: {} };
  picked.forEach((r, i) => {
    const task = tasks.get(r.taskId);
    if (!task) throw new Error(`task "${r.taskId}" is not in ${benchDir}/tasks`);
    const itemId = `item-${String(i + 1).padStart(3, '0')}`;
    const answerKeyFile = path.join(task.fixtureDir, ANSWER_KEY);
    items.push({
      itemId,
      taskPrompt: task.prompt,
      rubric: task.rubric.map(({ id, criterion, weight }) => ({ id, criterion, weight })),
      answerKey: fs.existsSync(answerKeyFile) ? fs.readFileSync(answerKeyFile, 'utf8') : null,
      bundle: buildBundle({ runDir: r.dir, result: r.result, fixtureDir: task.fixtureDir, limits, redactions }).text,
      labels: Object.fromEntries(task.rubric.map((c) => [c.id, null])),
      notes: '',
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
  const key = readJson(keyFile || path.join(path.dirname(labelsFile), 'key.json'));
  const run = loadRun(key.runDir);
  const records = (run.judgments?.rubric || []).filter((r) => !r.judgeError);
  const judges = run.judgments?.judges || [];
  const recOf = (judge, k) => records.find((r) => r.judge === judge && r.armId === k.armId && r.taskId === k.taskId && r.replicate === k.replicate);

  const out = { thresholds, itemsTotal: sheet.items.length, itemsLabeled: 0, judges: {}, judgeVsJudge: {} };
  const humanOf = (it) => it.rubric.map((r) => ({ id: r.id, verdict: it.labels[r.id] })).filter((c) => VERDICTS.includes(c.verdict));
  const labeledItems = sheet.items.filter((it) => humanOf(it).length === it.rubric.length);
  out.itemsLabeled = labeledItems.length;

  for (const judge of judges) {
    const crit = [];
    const score = [];
    for (const it of sheet.items) {
      const rec = recOf(judge, key.items[it.itemId]);
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

module.exports = { exportSheet, scoreLabels, formatCalibration };
