// SPDX-License-Identifier: Apache-2.0
'use strict';

// A blind calibration sheet for chosen quality pack criteria, built from the bench's own trees instead of a run: the
// reference solution and every partial solution of each task, each laid over its fixture. Free: no model call, no
// agent, no network. A person rates the items; key.json says which tree each item came from. Comparing judges with
// the labels needs a judge pass over the same trees, which spends credits and is a separate step.

const fs = require('node:fs');
const path = require('node:path');
const { loadTasks } = require('../runner/lib/tasks.js');
const { ANSWER_KEY } = require('../runner/lib/sandbox.js');
const { loadRedactions } = require('./redact.js');
const packLib = require('./pack/index.js');
const { shuffle, fence, criterionMarkdown } = require('./calibrate.js');

/** The files of the tree at `root` as a Map of relative path to text, without the answer key, node_modules or .git, so a fixture and an overlay compare cleanly. Empty when `root` does not exist. */
function filesOf(root) {
  const out = new Map();
  const visit = (rel) => {
    for (const ent of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const sub = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { if (ent.name !== 'node_modules' && ent.name !== '.git') visit(sub); }
      else if (ent.isFile() && ent.name !== ANSWER_KEY) out.set(sub, fs.readFileSync(path.join(root, sub), 'utf8'));
    }
  };
  if (fs.existsSync(root)) visit('');
  return out;
}

/** The files an overlay changes or adds against its fixture, in the shape the pack gate reads ({rel, orig, text, created}). */
function overlayChanges(fixtureDir, overlayDir) {
  const base = filesOf(fixtureDir);
  return [...filesOf(overlayDir)].filter(([rel, text]) => base.get(rel) !== text).sort(([a], [b]) => a.localeCompare(b))
    .map(([rel, text]) => ({ rel, orig: base.has(rel) ? base.get(rel) : null, text, created: !base.has(rel), binary: false }));
}

/** The trees of one task to rate: the reference solution and each partial, with a name that stays in key.json. */
function treesOf(benchDir, taskId) {
  const solution = path.join(benchDir, 'tasks', 'solutions', taskId);
  const partials = path.join(benchDir, 'tasks', 'partials', taskId);
  const named = fs.existsSync(partials) ? fs.readdirSync(partials).sort().map((n) => ({ tree: `partial:${n}`, dir: path.join(partials, n) })) : [];
  return [...(fs.existsSync(solution) ? [{ tree: 'reference', dir: solution }] : []), ...named];
}

/** The Markdown block of one sheet item `it`: the task, the answer key, the changes and the criteria to rate. */
function itemMarkdown(it) {
  const rows = it.criteria.map(criterionMarkdown);
  return [
    `## ${it.itemId}`,
    `Task given to the agent:\n\n> ${it.taskPrompt.replace(/\n/g, '\n> ')}`,
    `Answer key:\n\n${it.answerKey ? fence(it.answerKey) : '(none)'}`,
    `Changes:\n\n${fence(it.changes || '(no changes)')}`,
    `Rate each criterion pass, partial or fail from its three descriptions, and fill in \`labels\` in sheet.json:\n\n${rows.join('\n')}`,
  ].join('\n\n');
}

/**
 * Writes sheet.json (blinded, labels empty), sheet.md (a readable copy) and key.json (item to task and tree) to `outDir`.
 * `benchDir` is the bench directory; `taskIds` the tasks whose trees are rated; `criteriaIds` the pack criteria a person
 * rates (a criterion that does not apply to a tree is listed as n/a with the gate's reason); `seed` orders the items.
 * Returns the directory, the sheet path and the item count.
 */
function exportReferenceSheet({ benchDir, taskIds, criteriaIds, outDir, seed = 1, packName = 'quality' }) {
  const pack = packLib.loadPack(packName);
  const unknown = criteriaIds.filter((id) => !pack.criteria.some((c) => c.id === id));
  if (unknown.length) throw new Error(`not in pack ${pack.id}: ${unknown.join(', ')}`);
  const tasks = loadTasks(benchDir);
  const redactions = loadRedactions();
  const drawn = [];
  for (const taskId of taskIds) {
    const task = tasks.get(taskId);
    if (!task) throw new Error(`task "${taskId}" is not in ${benchDir}/tasks`);
    const trees = treesOf(benchDir, taskId);
    if (!trees.length) throw new Error(`task "${taskId}" has no reference or partial solution to rate`);
    for (const t of trees) drawn.push({ task, ...t });
  }
  const items = [];
  const key = { pack: { id: pack.id, revision: pack.revision }, seed, items: {} };
  shuffle(drawn, seed).forEach((d, i) => {
    const itemId = `item-${String(i + 1).padStart(3, '0')}`;
    const files = overlayChanges(d.task.fixtureDir, d.dir);
    const app = packLib.applicability(pack, d.task, files);
    const chosen = app.criteria.filter((c) => criteriaIds.includes(c.criterion.id));
    const rated = chosen.filter((c) => c.status === 'judged').map((c) => c.criterion);
    const answerKeyFile = path.join(d.task.fixtureDir, ANSWER_KEY);
    items.push({
      itemId,
      taskPrompt: d.task.prompt,
      answerKey: fs.existsSync(answerKeyFile) ? fs.readFileSync(answerKeyFile, 'utf8') : null,
      changes: packLib.redactedChanges(app.stats, redactions),
      criteria: rated.map((c) => ({ id: c.id, dimension: c.dimension, question: c.question, levels: c.levels, quote: c.evidence.quote })),
      na: chosen.filter((c) => c.status !== 'judged').map((c) => ({ id: c.criterion.id, reason: c.reason || c.status })),
      labels: Object.fromEntries(rated.map((c) => [c.id, null])),
      notes: '',
    });
    key.items[itemId] = { taskId: d.task.id, tree: d.tree };
  });
  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });
  const sheetPath = path.join(dir, 'sheet.json');
  fs.writeFileSync(sheetPath, JSON.stringify({ schemaVersion: 1, kind: 'reference-trees', pack: key.pack, items }, null, 2) + '\n');
  const head = `# Calibration sheet (reference trees)\n\nPack ${pack.id}, revision ${pack.revision}. Each item is one tree laid over its task's fixture. Rate the listed criteria only, from the changes, the task and the answer key. Do not open key.json until you are done.\n`;
  fs.writeFileSync(path.join(dir, 'sheet.md'), [head, ...items.map(itemMarkdown)].join('\n\n---\n\n') + '\n');
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 2) + '\n');
  return { dir, sheetPath, n: items.length };
}

module.exports = { exportReferenceSheet, overlayChanges, treesOf };
