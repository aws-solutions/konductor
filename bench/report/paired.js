// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pre-registered statistic over the cells of report-2x2 (behind --stats): per harness, konductor minus vanilla on
// quality, by the two-level bootstrap of scenarios/bootstrap.js. HELD-OUT tasks give the verdict; DEV tasks are shown
// apart and are never a verdict. Per-phase and per-role tables use the task's own `phase` and `role` (schema v3) with
// Holm's correction. Pure over the cells' run rows; nothing is read or written here.

const { compare, compareRows } = require('../scenarios/bootstrap.js');
const { splitOf } = require('../scenarios/split.js');
const { PHASE_LABEL, PHASES, ROLES } = require('../scenarios/coverage.js');
const { BOOTSTRAP, MARGIN } = require('../scenarios/protocol.js');
const D = require('./doc.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const HARNESSES = [{ id: 'kiro', head: 'kiroKonductor', base: 'kiroVanilla', name: 'Kiro CLI' }, { id: 'cc', head: 'ccKonductor', base: 'ccVanilla', name: 'Claude Code' }];

/** Per task, the scored run qualities of one cell: Map task -> [quality]. Excluded runs have no quality and are left out. */
function qualitiesByTask(cell) {
  const out = new Map();
  for (const r of cell.rows) {
    if (!fin(r.quality)) continue;
    if (!out.has(r.task)) out.set(r.task, []);
    out.get(r.task).push(r.quality);
  }
  return out;
}

/** The paired inputs { id, head, base } of the tasks in `ids`. */
function pairsOf(head, base, ids) {
  return ids.map((id) => ({ id, head: head.get(id) ?? [], base: base.get(id) ?? [] }));
}

/**
 * `cells` are the loaded cells (with rows), `tasks` the task definitions by id, `taskIds` the tasks the report covers.
 * Returns { margin, draws, seed, harnesses: [{ id, name, heldOut, dev, phases, roles, taskCounts }] }.
 */
function buildPaired({ cells, tasks, taskIds }) {
  const byId = Object.fromEntries(cells.map((c) => [c.spec.id, c]));
  const heldIds = taskIds.filter((t) => splitOf(t) === 'HELD-OUT');
  const devIds = taskIds.filter((t) => splitOf(t) === 'DEV');
  const harnesses = HARNESSES.map((h) => {
    const head = qualitiesByTask(byId[h.head]);
    const base = qualitiesByTask(byId[h.base]);
    const group = (field, order) => {
      const keys = order.filter((k) => heldIds.some((t) => tasks.get(t)?.[field] === k));
      return compareRows(keys.map((k) => ({ key: k, tasks: pairsOf(head, base, heldIds.filter((t) => tasks.get(t)?.[field] === k)) })));
    };
    return {
      id: h.id, name: h.name, taskCounts: { heldOut: heldIds.length, dev: devIds.length },
      heldOut: compare(pairsOf(head, base, heldIds)), dev: compare(pairsOf(head, base, devIds)),
      phases: group('phase', PHASES), roles: group('role', ROLES),
    };
  });
  return { margin: MARGIN, draws: BOOTSTRAP.draws, seed: BOOTSTRAP.seed, harnesses };
}

const num = (v) => (fin(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');
const ci = (r) => (fin(r.low) ? `[${num(r.low)}, ${num(r.high)}]${fin(r.level) && r.level !== BOOTSTRAP.confidence ? ` at ${(r.level * 100).toFixed(2)}%` : ''}` : 'n/a');

const rowText = (name, r) => [name, r.n, num(r.estimate), ci(r), r.verdict];

/** Document blocks for the section. */
function pairedBlocks(paired) {
  const blocks = [
    D.h(2, 'Pre-registered statistic: konductor minus vanilla, two-level bootstrap'),
    D.note(`Mean paired difference per task, averaged over tasks. Interval: ${paired.draws} bootstrap draws (tasks, then runs inside each task and arm), seed ${paired.seed}. Margin ${paired.margin} points. Verdict words, on the interval [L, U] in this order: beats by the margin (L over +${paired.margin}), beats (L over 0), loses by the margin (U under -${paired.margin}), loses (U under 0), ties (L over -${paired.margin} and U under +${paired.margin}), otherwise unsettled. Only HELD-OUT tasks give a verdict; DEV tasks are shown apart and are not a verdict.`),
  ];
  for (const h of paired.harnesses) {
    blocks.push(D.h(3, h.name));
    blocks.push(D.table(['tasks', 'n', 'difference', '95% interval', 'verdict'], [
      rowText(`HELD-OUT (${h.taskCounts.heldOut})`, h.heldOut),
      [`DEV (${h.taskCounts.dev}), not a verdict`, h.dev.n, num(h.dev.estimate), ci(h.dev), 'DEV, not a verdict'],
    ]));
    if (h.heldOut.note) blocks.push(D.note(h.heldOut.note));
    const label = (k) => PHASE_LABEL[k] ?? k;
    if (h.phases.length) blocks.push(D.p('By phase (HELD-OUT, Holm-corrected):'), D.table(['phase', 'n', 'difference', 'interval', 'verdict'], h.phases.map((r) => rowText(label(r.key), r))));
    if (h.roles.length) blocks.push(D.p('By role (HELD-OUT, Holm-corrected):'), D.table(['role', 'n', 'difference', 'interval', 'verdict'], h.roles.map((r) => rowText(r.key, r))));
  }
  return blocks;
}

module.exports = { buildPaired, pairedBlocks, qualitiesByTask, pairsOf };
