// SPDX-License-Identifier: Apache-2.0
'use strict';

// The load check of one run (B2, plan section 6): which konductor units (skills, SOPs, agents) the run loaded, at which
// point of its stream, and whether each unit the task needs loaded before the first file write. Read from the event
// stream only. Whether a skill or SOP load succeeded comes from the shared extractor (skills.js extractSkills); this
// file adds the order, the agents and the first write.

const { toolNameOf, isV3Call, skillsCallOf, skillResourceCallOf, skillActivationOf, skillFileReadOf, mcpInputOf, subagentTargets, SUBAGENT_TOOL } = require('./stream.js');
const { SUBAGENT_TOOLS } = require('../../plugins/claude-code/parse.js');

// shortcut: a file written by a shell command (`cat > f`, `sed -i`) is not seen as a write, so firstWriteAt can be
// late on a run that writes only through the shell; upgrade when such runs show up in the load-check table.
const WRITE_TOOLS = {
  'kiro-cli': new Set(['fs_write', 'str_replace', 'fs_append', 'write']),
  'claude-code': new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']),
  opencode: new Set(['write', 'edit', 'patch']),
};
const CC_SKILL_FILE = /(?:^|\/)([^/]+)\/SKILL\.md$/;

const lower = (s) => String(s).toLowerCase();
/** The name a unit is matched by: lower case, without a kind prefix (`skill:`) or the `sop-` wrapper prefix. */
const unitKey = (name) => lower(name).replace(/^(skill|sop|agent)::?/, '').replace(/^sop-/, '');

/**
 * Units the stream asked for, in stream order: { name, kind: 'skill'|'agent', at, failed }, `at` being the index of the
 * event that made the call. A skill-kind entry may be an SOP; the caller decides with its catalog. Also firstWriteAt,
 * the index of the first file-writing tool call, or null.
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
  (events ?? []).forEach((ev, at) => {
    if (runtime === 'claude-code') {
      const blocks = Array.isArray(ev?.message?.content) ? ev.message.content : [];
      for (const b of blocks) {
        if (ev.type === 'assistant' && b?.type === 'tool_use') {
          if (b.name === 'Skill') add(b.id, b.input?.skill ?? b.input?.name, 'skill', at);
          else if (b.name === 'Read' && CC_SKILL_FILE.test(String(b.input?.file_path ?? ''))) add(b.id, CC_SKILL_FILE.exec(b.input.file_path)[1], 'skill', at);
          else if (SUBAGENT_TOOLS.has(b.name)) add(b.id, b.input?.subagent_type, 'agent', at);
          else if (WRITE_TOOLS['claude-code'].has(b.name)) write(at);
        } else if (ev.type === 'user' && b?.type === 'tool_result' && b.is_error) fail(b.tool_use_id);
      }
      return;
    }
    if (runtime === 'opencode') {
      const p = ev?.type === 'tool_use' ? ev.part : null;
      if (!p) return;
      if (p.tool === 'skill') add(p.callID, p.state?.input?.name ?? p.state?.input?.skill_name, 'skill', at);
      else if (p.tool === 'task') add(p.callID, p.state?.input?.subagent_type, 'agent', at);
      else if (WRITE_TOOLS.opencode.has(p.tool)) write(at);
      if (p.state?.status === 'error') fail(p.callID);
      return;
    }
    const u = ev?.type === 'sessionUpdate' ? ev.data?.update : null;
    if (!u) return;
    if (u.sessionUpdate === 'tool_call_update') {
      if (u.status === 'failed') fail(u.toolCallId);
      // v2 may name a get_skill target only in an update.
      const pending = (calls.get(u.toolCallId) ?? []).find((c) => c.name === '(get_skill)');
      const n = mcpInputOf(u.rawInput ?? {})?.name;
      if (pending && typeof n === 'string' && n.trim()) pending.name = n.trim();
      return;
    }
    if (u.sessionUpdate !== 'tool_call' || (u.toolCallId && calls.has(u.toolCallId))) return;
    const tool = toolNameOf(u);
    const named = skillFileReadOf(u) ?? skillResourceCallOf(u) ?? skillActivationOf(u);
    if (named) { add(u.toolCallId, named.name, /sop-md$/.test(named.via ?? '') ? 'sop' : 'skill', at); return; }
    const sc = skillsCallOf(u);
    if (sc?.tool === 'get_skill') { const n = mcpInputOf(u.rawInput ?? {})?.name; add(u.toolCallId, typeof n === 'string' && n.trim() ? n.trim() : '(get_skill)', 'skill', at); return; }
    if (tool === SUBAGENT_TOOL) { for (const t of subagentTargets(u.rawInput ?? {}, { nameIsAgent: isV3Call(u) })) if (t !== '(unnamed)') add(u.toolCallId, t, 'agent', at); return; }
    if (WRITE_TOOLS['kiro-cli'].has(tool)) write(at);
  });
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
  const mustLoad = (fromTask ? task.loadCheck.mustLoad : [...(t.targetSkills ?? []), t.targetSop].filter(Boolean)).map(unitKey);
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

module.exports = { loadOrderOf, loadCheckOf, unitKey, WRITE_TOOLS };
