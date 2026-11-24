// SPDX-License-Identifier: Apache-2.0
'use strict';

// The coverage matrix (plan section 2), built from the task files. Two views:
//   1. phase x role: task counts of real tasks against the target counts, with the phase and role minimums;
//   2. one row per konductor unit (skill, SOP, agent): its targeted tasks (DEV and HELD-OUT), its twins and controls,
//      its effect tasks, and a status: covered, hole, or selection-only (an owner-approved reason).
// Pure over task objects and a scan of the konductor tree; the CLI reads the files and writes coverage.json and coverage.md.

const { splitOf } = require('./split.js');
const { targetsOf } = require('../runner/lib/task-v3.js');
const { kiroReachers } = require('../cap/reach.js');

// The plan's 15 phases (plan section 2). The LITE rule and the pre-registered levels read these only.
const CORE_PHASES = ['ideation', 'requirements', 'architecture', 'decisions', 'nfr', 'security', 'implementation', 'bugfix', 'refactor', 'testing', 'code-review', 'design-review', 'planning', 'release-ops', 'multi-phase'];
// Added 2026-11-24 (batch T13, reports/new-task-briefs-2026-11-24.md): the three types of work the pack had no task for.
// They are outside the plan's matrix, so a level rule that was locked before they existed must not pick from them.
const ADDED_PHASES = ['documentation', 'triage', 'log-analysis'];
const PHASES = [...CORE_PHASES, ...ADDED_PHASES];
const ROLES = ['pm', 'tpm', 'architect', 'developer', 'frontend', 'qa', 'security', 'sre', 'reviewer'];
const PHASE_LABEL = {
  ideation: 'Ideation and framing', requirements: 'Requirements (scripted user)', architecture: 'Architecture, API/DB design', decisions: 'Decisions (ADR, trade-off, cost)',
  nfr: 'NFR and performance', security: 'Security and IAM', implementation: 'Implementation', bugfix: 'Bug fix', refactor: 'Refactor, migration, upgrade', testing: 'Testing and QA',
  'code-review': 'Code and PR review', 'design-review': 'Design review', planning: 'Planning, status, estimation', 'release-ops': 'Release, ops, incident', 'multi-phase': 'Long multi-phase (idea to ship)',
  documentation: 'Technical documentation', triage: 'Issue and crash triage', 'log-analysis': 'Log analysis',
};
const ROLE_LABEL = { pm: 'PM', tpm: 'TPM', architect: 'Arch', developer: 'Dev', frontend: 'FE', qa: 'QA', security: 'Sec', sre: 'SRE', reviewer: 'Rev' };

// Target counts per cell, from the plan's matrix (rows are phases, columns follow ROLES). A target, not a quota: an empty cell stays empty.
const TARGET_ROWS = {
  ideation: [4, 1, 2, 1, 0, 0, 0, 0, 0], requirements: [6, 1, 1, 0, 1, 1, 0, 0, 0], architecture: [1, 0, 7, 1, 0, 0, 0, 0, 0],
  decisions: [0, 1, 6, 1, 0, 0, 0, 1, 0], nfr: [0, 0, 2, 5, 0, 0, 0, 1, 0], security: [0, 0, 1, 2, 0, 0, 6, 0, 0],
  implementation: [0, 0, 0, 8, 3, 0, 0, 0, 0], bugfix: [0, 0, 0, 6, 1, 0, 0, 1, 0], refactor: [0, 0, 1, 7, 1, 0, 0, 0, 0],
  testing: [0, 0, 0, 1, 1, 7, 0, 0, 0], 'code-review': [0, 0, 0, 0, 1, 0, 1, 0, 8], 'design-review': [0, 0, 3, 0, 0, 0, 1, 0, 4],
  planning: [1, 7, 0, 1, 0, 0, 0, 0, 0], 'release-ops': [0, 1, 0, 0, 0, 0, 0, 7, 0], 'multi-phase': [1, 1, 1, 3, 0, 0, 0, 0, 0],
  // The added phases start at two tasks each (the T13 briefs); a target, so the matrix names them as short until they grow.
  documentation: [0, 0, 0, 2, 0, 0, 0, 0, 0], triage: [0, 0, 0, 2, 0, 0, 0, 0, 0], 'log-analysis': [0, 0, 0, 0, 0, 0, 1, 1, 0],
};
const TARGET = Object.fromEntries(PHASES.map((p) => [p, Object.fromEntries(ROLES.map((r, i) => [r, TARGET_ROWS[p][i]]))]));

// Minimums (plan section 2). A phase needs 8 tasks and 5 held-out to carry an interval; a role needs 8 real tasks.
const MIN = { phase: 8, phaseHeldOut: 5, role: 8 };
// A unit needs 3 targeted tasks, 2 of them HELD-OUT, and 1 twin or control where it is not useful.
const UNIT_MIN = { targeted: 3, heldOut: 2, controls: 1, effect: 3 };

const kindOf = (task) => task.controlKind ?? 'none';
const unitId = (kind, name) => `${kind}:${name}`;

function targetIds(task, catalog) {
  const t = targetsOf(task, catalog);
  return [...t.targetSkills.map((n) => unitId('skill', n)), ...(t.targetSop ? [unitId('sop', t.targetSop)] : []), ...(t.targetAgent ? [unitId('agent', t.targetAgent)] : [])];
}

const cleanName = (n) => String(n).replace(/^(skill|sop|agent):/, '');

/**
 * The coverage record. `tasks` are task objects; `scan` is cap/scan.js scanRepo of the konductor tree; `specs` its agent specs;
 * `selectionOnly` maps a unit id to the owner-approved reason it has no fair scenario.
 */
function buildCoverage({ tasks, scan, specs = [], selectionOnly = {}, base = null }) {
  const catalog = { skills: [], sops: [], agents: [] };
  for (const c of scan.values()) {
    if (c.kind === 'skill') catalog.skills.push(c.name);
    else if (c.kind === 'sop') catalog.sops.push(c.name);
    else if (c.kind === 'agent') catalog.agents.push(c.name);
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const info = tasks.map((t) => ({ task: t, id: t.id, kind: kindOf(t), split: splitOf(t.id), targets: targetIds(t, catalog) }));
  const real = info.filter((x) => x.kind === 'none');
  const placed = real.filter((x) => PHASES.includes(x.task.phase) && ROLES.includes(x.task.role));

  const cells = Object.fromEntries(PHASES.map((p) => [p, Object.fromEntries(ROLES.map((r) => [r, { count: placed.filter((x) => x.task.phase === p && x.task.role === r).length, target: TARGET[p][r] }]))]));
  const phases = Object.fromEntries(PHASES.map((p) => {
    const mine = placed.filter((x) => x.task.phase === p);
    return [p, { count: mine.length, heldOut: mine.filter((x) => x.split === 'HELD-OUT').length, target: ROLES.reduce((n, r) => n + TARGET[p][r], 0) }];
  }));
  const roles = Object.fromEntries(ROLES.map((r) => [r, { count: placed.filter((x) => x.task.role === r).length, target: PHASES.reduce((n, p) => n + TARGET[p][r], 0) }]));

  const shortfalls = [];
  for (const p of PHASES) {
    if (phases[p].count < MIN.phase) shortfalls.push(`phase ${p} has ${phases[p].count} tasks, needs ${MIN.phase}`);
    if (phases[p].heldOut < MIN.phaseHeldOut) shortfalls.push(`phase ${p} has ${phases[p].heldOut} held-out tasks, needs ${MIN.phaseHeldOut}`);
  }
  for (const r of ROLES) if (roles[r].count < MIN.role) shortfalls.push(`role ${r} has ${roles[r].count} real tasks, needs ${MIN.role}`);

  const controls = info.filter((x) => x.kind !== 'none');
  const unitRows = [...scan.values()].filter((c) => c.kind !== 'context').map((c) => {
    const id = c.id;
    const targeted = real.filter((x) => x.targets.includes(id));
    const mine = controls.filter((x) => {
      const t = x.task;
      const notLoad = (t.loadCheck?.mustNotLoad ?? []).map(cleanName).includes(c.name);
      const twinOfMine = x.kind === 'twin' && byId.has(t.twinOf) && targetIds(byId.get(t.twinOf), catalog).includes(id);
      return notLoad || twinOfMine;
    });
    const effect = targeted.filter((x) => x.task.effectSubset === true);
    const row = {
      id, kind: c.kind, name: c.name, owners: kiroReachers(id, specs),
      targeted: { dev: targeted.filter((x) => x.split === 'DEV').map((x) => x.id), heldOut: targeted.filter((x) => x.split === 'HELD-OUT').map((x) => x.id) },
      controls: mine.map((x) => x.id), effect: effect.map((x) => x.id),
    };
    const missing = [];
    if (targeted.length < UNIT_MIN.targeted) missing.push(`${targeted.length} of ${UNIT_MIN.targeted} targeted tasks`);
    if (row.targeted.heldOut.length < UNIT_MIN.heldOut) missing.push(`${row.targeted.heldOut.length} of ${UNIT_MIN.heldOut} held-out tasks`);
    if (row.controls.length < UNIT_MIN.controls) missing.push('no twin or control');
    row.missing = missing;
    if (!missing.length) row.status = 'covered';
    else if (selectionOnly[id]) { row.status = 'selection-only'; row.reason = selectionOnly[id]; } else row.status = 'hole';
    return row;
  }).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const notes = [];
  for (const id of Object.keys(selectionOnly)) if (!scan.has(id)) notes.push(`selection-only entry ${id} names no unit of the tree`);
  const holes = unitRows.filter((u) => u.status === 'hole').map((u) => u.id);
  const unplaced = real.filter((x) => !placed.includes(x)).map((x) => x.id);
  if (unplaced.length) notes.push(`${unplaced.length} real task(s) have no phase or role and are not counted in the matrix: ${unplaced.join(', ')}`);
  const count = (s) => unitRows.filter((u) => u.status === s).length;
  return {
    schemaVersion: 1, base,
    tasks: { total: tasks.length, real: real.length, twins: controls.filter((x) => x.kind === 'twin').length, negatives: controls.filter((x) => x.kind === 'negative').length },
    matrix: { phases: PHASES, roles: ROLES, cells, phaseTotals: phases, roleTotals: roles, minimums: MIN },
    unitMinimums: UNIT_MIN, units: unitRows,
    summary: { units: unitRows.length, covered: count('covered'), selectionOnly: count('selection-only'), holes: holes.length },
    holes, shortfalls, notes,
  };
}

const cellText = (c) => (c.count === 0 && c.target === 0 ? '' : `${c.count}/${c.target}`);
const esc = (s) => String(s).replace(/\|/g, '\\|');
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)];

/** coverage.md: the two views as tables, plus the gaps. */
function renderCoverageMd(cov) {
  const m = cov.matrix;
  const L = ['# Scenario coverage', ''];
  L.push(`Base: ${cov.base ? `${cov.base.label}${cov.base.commitSha ? ` (${cov.base.commitSha.slice(0, 8)})` : ''}` : 'not recorded'}. Tasks: ${cov.tasks.total} (${cov.tasks.real} real, ${cov.tasks.twins} twins, ${cov.tasks.negatives} negative controls).`, '');
  L.push('## Phase by role (real tasks / target)', '');
  L.push(...table(['phase', ...m.roles.map((r) => ROLE_LABEL[r]), 'total', 'held-out'], m.phases.map((p) => [
    PHASE_LABEL[p], ...m.roles.map((r) => cellText(m.cells[p][r])), `${m.phaseTotals[p].count}/${m.phaseTotals[p].target}`, `${m.phaseTotals[p].heldOut}/${m.minimums.phaseHeldOut}`,
  ])));
  L.push('', `A phase needs ${m.minimums.phase} tasks and ${m.minimums.phaseHeldOut} held-out; a role needs ${m.minimums.role} real tasks. Role totals: ${m.roles.map((r) => `${ROLE_LABEL[r]} ${m.roleTotals[r].count}/${m.roleTotals[r].target}`).join(', ')}.`);
  if (cov.shortfalls.length) L.push('', '**Below the minimums:**', '', ...cov.shortfalls.map((s) => `- ${s}`));
  const s = cov.summary;
  L.push('', '## Units', '', `${s.units} units: ${s.covered} covered, ${s.selectionOnly} selection-only, ${s.holes} holes. A unit is covered with at least ${cov.unitMinimums.targeted} targeted tasks (${cov.unitMinimums.heldOut} held-out) and ${cov.unitMinimums.controls} twin or control; its effect check uses ${cov.unitMinimums.effect} effect tasks.`, '');
  L.push(...table(['unit', 'owner agent', 'targeted DEV', 'targeted HELD-OUT', 'twins and controls', 'effect tasks', 'status'], cov.units.map((u) => [
    u.id, u.owners.join(', ') || '-', u.targeted.dev.join(', ') || '-', u.targeted.heldOut.join(', ') || '-', u.controls.join(', ') || '-', u.effect.length,
    u.status === 'hole' ? `hole: ${u.missing.join('; ')}` : u.status === 'selection-only' ? `selection-only: ${u.reason}` : 'covered',
  ])));
  if (cov.notes.length) L.push('', '## Notes', '', ...cov.notes.map((n) => `- ${n}`));
  return `${L.join('\n')}\n`;
}

module.exports = { buildCoverage, renderCoverageMd, PHASES, CORE_PHASES, ADDED_PHASES, ROLES, TARGET, MIN, UNIT_MIN, PHASE_LABEL };
