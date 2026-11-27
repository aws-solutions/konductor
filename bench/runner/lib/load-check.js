// SPDX-License-Identifier: Apache-2.0
'use strict';

// The load check of one run (B2, plan section 6): which konductor units (skills, SOPs, agents) the run loaded, at which
// point of its stream, and whether each unit the task needs loaded before the first file write. Read from the event
// stream only. Whether a skill or SOP load succeeded comes from the shared extractor (skills.js extractSkills); this
// file adds the order, the agents and the first write.

// The run's harness reads its own events (`streams.loadOrderEvent`); loaded at call time through harness/streams.js.
// shortcut: a file written by a shell command (`cat > f`, `sed -i`) is not seen as a write, so firstWriteAt can be
// late on a run that writes only through the shell; upgrade when such runs show up in the load-check table.
const { streamsOf } = require('./harness/streams.js');
const { fairMustLoad } = require('./load-fairness.js');

const lower = (s) => String(s).toLowerCase();
/** The name a unit is matched by: lower case, without a kind prefix (`skill:`) or the `sop-` wrapper prefix. */
const unitKey = (name) => lower(name).replace(/^(skill|sop|agent)::?/, '').replace(/^sop-/, '');

/**
 * Units the stream asked for, in stream order: { name, kind: 'skill'|'agent', at, failed }, `at` being the index of the
 * event that made the call. A skill-kind entry may be an SOP; the caller decides with its catalog. Also firstWriteAt,
 * the index of the first file-writing tool call, or null. Each harness's `streams.loadOrderEvent(ev, at, {add, fail,
 * write, calls})` reads one event: `add(id, name, kind, at)` records a call, `fail(id)` marks it failed, `write(at)` a
 * file write; `calls` maps a call id to its entries.
 */
function loadOrderOf(events, runtime) {
  const calls = new Map();
  const order = [];
  let firstWriteAt = null;
  const add = (id, name, kind, at) => {
    if (!name) return;
    const c = { name: String(name), kind, at, failed: false };
    order.push(c);
    if (id) calls.set(id, [...(calls.get(id) ?? []), c]);
  };
  const fail = (id) => { for (const c of calls.get(id) ?? []) c.failed = true; };
  const write = (at) => { if (firstWriteAt === null) firstWriteAt = at; };
  // A harness with no reader (Strands) has no capability calls to order.
  const read = streamsOf({ runtime }).loadOrderEvent;
  if (read) (events ?? []).forEach((ev, at) => read(ev, at, { add, fail, write, calls }));
  return { order: order.filter((c) => c.name !== '(get_skill)'), firstWriteAt };
}

/**
 * The result.json `loadCheck` block. `order` is loadOrderOf's answer, `extraction` the shared extractor's (its
 * skillsLoaded decides whether a skill or SOP call loaded), `task` the loaded task (its loadCheck, else its v3 targets),
 * `isSop(name)` the catalog's SOP test. Null for a vanilla arm or when nothing was captured.
 */
function loadCheckOf({ order, extraction, task, arm, isSop = () => false }) {
  if (!order || !extraction || arm?.vanilla) return null;
  const okSkills = new Set((extraction.skillsLoaded ?? []).map((s) => unitKey(s.name)));
  const units = new Map();
  for (const c of order.order) {
    const key = unitKey(c.name);
    const loaded = c.kind === 'agent' ? !c.failed : okSkills.has(key);
    if (!loaded || units.has(key)) continue;
    const kind = c.kind === 'agent' ? 'agent' : c.kind === 'sop' || isSop(c.name) || lower(c.name).startsWith('sop-') ? 'sop' : 'skill';
    units.set(key, { unit: key, kind, firstAt: c.at });
  }
  const before = (u) => order.firstWriteAt === null || u.firstAt < order.firstWriteAt;
  const t = task?.targets ?? {};
  const fromTask = Array.isArray(task?.loadCheck?.mustLoad);
  const mustLoad = fairMustLoad(task?.id, (fromTask ? task.loadCheck.mustLoad : [...(t.targetSkills ?? []), t.targetSop].filter(Boolean)).map(unitKey));
  const mustNotLoad = (task?.loadCheck?.mustNotLoad ?? []).map(unitKey);
  const loaded = [...units.values()].map((u) => ({ ...u, beforeFirstWrite: before(u) }));
  const must = mustLoad.map((unit) => { const u = units.get(unit); return { unit, loaded: Boolean(u), beforeFirstWrite: u ? before(u) : false }; });
  return {
    source: fromTask ? 'loadCheck' : 'targets',
    firstWriteAt: order.firstWriteAt,
    loaded,
    mustLoad: must,
    mustLoadBeforeWrite: must.length ? must.every((m) => m.beforeFirstWrite) : null,
    mustNotLoaded: mustNotLoad.filter((u) => units.has(u)),
  };
}

module.exports = { loadOrderOf, loadCheckOf, unitKey };
