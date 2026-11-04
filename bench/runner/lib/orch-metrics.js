// SPDX-License-Identifier: Apache-2.0
'use strict';

// Orchestration metrics read from what a run already left on disk: the stream (spawns, depth, review rounds, reworks
// after a PASS) and the workspace snapshot (which phase documents exist). Pure functions plus two data files:
// profiles/orch-metrics.json (how review and rework are recognised) and profiles/phase-documents.json (the documents).

const fs = require('node:fs');
const path = require('node:path');
const { parseStream, subagentTargets, toolNameOf, isV3Call, SUBAGENT_TOOL } = require('./stream.js');

const PROFILES = path.join(__dirname, '..', '..', 'profiles');
const METRICS_FILE = path.join(PROFILES, 'orch-metrics.json');
const PHASES_FILE = path.join(PROFILES, 'phase-documents.json');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

function compile(list, name, file) {
  if (!Array.isArray(list)) throw new Error(`${file}: "${name}" must be a list of patterns`);
  return list.map((p) => {
    try { return new RegExp(p, 'im'); } catch { throw new Error(`${file}: "${p}" in "${name}" is not a valid pattern`); }
  });
}

/** The review and rework patterns, compiled. */
function loadMetricsSpec(file = METRICS_FILE) {
  const raw = readJson(file);
  return {
    headlineChars: Number.isInteger(raw.headlineChars) ? raw.headlineChars : 400,
    fix: compile(raw.fix, 'fix', file), review: compile(raw.review, 'review', file),
    fail: compile(raw.fail, 'fail', file), pass: compile(raw.pass, 'pass', file),
    verdictWords: { pass: raw.verdictWords?.pass ?? [], fail: raw.verdictWords?.fail ?? [] },
  };
}

/** The phase document list, validated. */
function loadPhaseDocs(file = PHASES_FILE) {
  const raw = readJson(file);
  if (!Array.isArray(raw.phases) || !raw.phases.length) throw new Error(`${file}: "phases" must be a non-empty list`);
  const ids = new Set();
  for (const p of raw.phases) {
    if (!p.id || ids.has(p.id)) throw new Error(`${file}: every phase needs a unique id`);
    ids.add(p.id);
    if (!Array.isArray(p.documents) || !p.documents.length) throw new Error(`${file}: phase "${p.id}" needs a non-empty "documents" list`);
  }
  return { roots: Array.isArray(raw.roots) && raw.roots.length ? raw.roots : ['.konductor'], phases: raw.phases };
}

// ---- spawns ----

// The string values of a tool result, joined, so a newline is a newline and not a backslash and an n.
function stringsOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsOf(x, out));
  return out;
}

const textOfUpdate = (u) => [...stringsOf(u.rawOutput), ...(u.content || []).map((c) => c?.content?.text).filter(Boolean)].join('\n');

/**
 * Every subagent call in stream order, with the session that made it and its depth (the root session's calls are
 * depth 1). A session first seen while a call is open belongs to the earliest open call that still has an unclaimed
 * stage, so parallel children and nested spawns keep their own depth.
 *
 * Engine v3 runs every agent in one session. A call's own events carry the child's `agentSubtaskId`, which stands in
 * for the child session. The call does not say who made it, so its caller is whoever produced the last event, unless
 * that child has already returned, in which case it is the root.
 */
function spawnTree(events) {
  const depth = new Map();
  const calls = [];
  const byId = new Map();
  let root = null;
  let lastActor = null;
  const returned = new Set();
  for (const ev of events) {
    const d = ev.data || {};
    const sid = d.sessionId ?? null;
    if (sid && !depth.has(sid)) {
      if (root === null) { root = sid; depth.set(sid, 0); } else {
        const open = calls.filter((c) => !c.closed && c.caller !== sid);
        const parent = open.find((c) => c.claimed < c.targets.length) ?? open.at(-1) ?? null;
        if (parent) parent.claimed++;
        depth.set(sid, parent ? depth.get(parent.caller) + 1 : 1);
      }
    }
    if (ev.type !== 'sessionUpdate') continue;
    const u = d.update || {};
    const kiro = u._meta?.kiro;
    const subtask = kiro?.kind === 'agent-subtask';
    if (!subtask) lastActor = kiro?.agentSubtaskId ?? sid;
    else if (u.sessionUpdate === 'tool_call_update' && (u.status === 'completed' || u.status === 'failed') && kiro.agentSubtaskId) returned.add(kiro.agentSubtaskId);
    if (u.sessionUpdate === 'tool_call' && toolNameOf(u) === SUBAGENT_TOOL) {
      const id = u.toolCallId ?? `anon-${calls.length}`;
      if (byId.has(id)) { if (u.rawInput && typeof u.rawInput === 'object') Object.assign(byId.get(id).input, u.rawInput); continue; }
      const input = u.rawInput && typeof u.rawInput === 'object' ? { ...u.rawInput } : {};
      const v3 = isV3Call(u);
      const caller = v3 && subtask ? (lastActor && !returned.has(lastActor) ? lastActor : root) : sid ?? root;
      const call = { id, caller, input, targets: subagentTargets(input, { nameIsAgent: v3 }), claimed: 0, closed: false, status: null, output: '' };
      if (v3 && subtask && kiro.agentSubtaskId && !depth.has(kiro.agentSubtaskId)) depth.set(kiro.agentSubtaskId, (depth.get(caller) ?? 0) + 1);
      byId.set(id, call);
      calls.push(call);
    } else if (u.sessionUpdate === 'tool_call_update' && byId.has(u.toolCallId)) {
      const call = byId.get(u.toolCallId);
      if (u.rawInput && typeof u.rawInput === 'object') Object.assign(call.input, u.rawInput);
      if (u.status === 'completed' || u.status === 'failed') {
        call.closed = true;
        call.status = u.status;
        call.output = textOfUpdate(u);
      }
    }
  }
  for (const c of calls) c.depth = (depth.get(c.caller) ?? 0) + 1;
  return {
    calls,
    spawnCalls: calls.length,
    spawns: calls.reduce((n, c) => n + c.targets.length, 0),
    maxSpawnDepth: calls.reduce((m, c) => Math.max(m, c.depth), 0),
    childSessions: Math.max(0, depth.size - 1),
  };
}

// ---- review and rework ----

const matches = (res, text) => res.some((re) => re.test(text));

function headlineOf(call, limit) {
  const parts = [call.input.task, call.input.__tool_use_purpose].filter((v) => typeof v === 'string');
  const stages = Array.isArray(call.input.stages) && call.input.stages.length ? call.input.stages : [call.input];
  for (const st of stages) {
    const brief = [st.prompt_template, st.prompt, st.description].find((v) => typeof v === 'string') ?? '';
    const task = /^\s*(?:\d+[.)]\s*)?\**TASK\**:\s*(.+)$/im.exec(brief);
    parts.push(st.role ?? st.agent ?? '', st.name ?? '', task ? task[1] : brief.slice(0, limit));
  }
  return parts.join('\n').slice(0, limit * 3);
}

/** 'fix', 'review' or 'other'. A fix brief mentions the review it answers, so fix is tested first. */
function kindOf(call, spec) {
  const head = headlineOf(call, spec.headlineChars);
  if (matches(spec.fix, head)) return 'fix';
  return matches(spec.review, head) ? 'review' : 'other';
}

const VERDICT_RE = /\bverdict\b\W{0,6}([A-Za-z][A-Za-z _-]{1,24})/gi;

/**
 * 'fail', 'pass' or 'unknown'. Every explicit "Verdict: WORD" counts. A verdict that names both a pass and a fail word ("PASS or FAIL")
 * or is followed by | or / is a template, not a verdict, and is skipped. Real verdicts that disagree read as a fail. With no real
 * verdict, text that reads as both is a fail; no text is unknown.
 */
function verdictOf(call, spec) {
  const text = call.output;
  if (!text) return 'unknown';
  const listed = (word, list) => list.some((w) => word === w || word.startsWith(`${w}_`));
  const said = new Set();
  for (const m of text.matchAll(VERDICT_RE)) {
    const word = m[1].trim().toLowerCase().replace(/[\s-]+/g, '_');
    const tokens = word.split('_');
    const hasPass = tokens.some((t) => listed(t, spec.verdictWords.pass));
    const hasFail = tokens.some((t) => listed(t, spec.verdictWords.fail));
    if (hasPass && hasFail) continue;
    if (/^\s*[|/]/.test(text.slice(m.index + m[0].length))) continue;
    if (listed(word, spec.verdictWords.fail)) said.add('fail');
    else if (listed(word, spec.verdictWords.pass)) said.add('pass');
  }
  if (said.has('fail')) return 'fail';
  if (said.has('pass')) return 'pass';
  if (matches(spec.fail, text)) return 'fail';
  return matches(spec.pass, text) ? 'pass' : 'unknown';
}

/**
 * reviewRounds: review spawns. reworksAfterPass: fix spawns issued while the latest review before them had passed.
 * An unreadable verdict is never read as a pass.
 */
function reviewFlow(events, spec = loadMetricsSpec(), tree = spawnTree(events)) {
  const verdicts = [];
  const sequence = [];
  let last = null;
  let fixSpawns = 0;
  let reworksAfterPass = 0;
  for (const call of tree.calls) {
    const kind = kindOf(call, spec);
    sequence.push(kind);
    if (kind === 'review') { last = verdictOf(call, spec); verdicts.push(last); }
    if (kind === 'fix') { fixSpawns++; if (last === 'pass') reworksAfterPass++; }
  }
  return { reviewRounds: verdicts.length, verdicts, fixSpawns, reworksAfterPass, sequence };
}

// ---- phase documents ----

const nonEmpty = (file) => { try { return fs.statSync(file).isFile() && fs.statSync(file).size > 0; } catch { return false; } };
const exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };

// Every concrete path a pattern can name under base, with the directory names its * stood for.
function expand(base, pattern) {
  let out = [{ rel: '', stars: [] }];
  for (const seg of pattern.split('/')) {
    const next = [];
    for (const o of out) {
      if (seg !== '*') { next.push({ rel: o.rel ? `${o.rel}/${seg}` : seg, stars: o.stars }); continue; }
      for (const d of subdirs(path.join(base, o.rel))) next.push({ rel: o.rel ? `${o.rel}/${d}` : d, stars: [...o.stars, d] });
    }
    out = next;
  }
  return out;
}

function phaseResult(base, phase) {
  const features = new Set();
  for (const doc of phase.documents) {
    if (!doc.includes('*')) continue;
    for (const e of expand(base, doc)) if (exists(path.join(base, e.rel))) features.add(e.stars.join('/'));
  }
  const missing = [];
  let present = 0;
  let total = 0;
  for (const doc of phase.documents) {
    const paths = !doc.includes('*') ? [doc] : features.size ? [...features].map((f) => f.split('/').reduce((p, v) => p.replace('*', v), doc)) : [];
    if (!paths.length) { total++; missing.push(doc); continue; }
    for (const p of paths) { total++; if (nonEmpty(path.join(base, p))) present++; else missing.push(p); }
  }
  return { present, total, missing, complete: missing.length === 0 };
}

/**
 * Which documents of which phases exist in a run's workspace. Null when there is no workspace to look in.
 * opts.phases limits the count to those phase ids.
 */
function phaseDocuments(workspaceDir, docs = loadPhaseDocs(), { phases = null } = {}) {
  if (!fs.existsSync(workspaceDir)) return null;
  const wanted = phases ? phases.map(String) : null;
  if (wanted) for (const id of wanted) if (!docs.phases.some((p) => p.id === id)) throw new Error(`unknown phase "${id}" (known: ${docs.phases.map((p) => p.id).join(', ')})`);
  const out = {};
  for (const phase of docs.phases) {
    if (wanted && !wanted.includes(phase.id)) continue;
    const roots = phase.atWorkspaceRoot ? [''] : docs.roots;
    const tries = roots.map((r) => phaseResult(path.join(workspaceDir, r), phase));
    out[phase.id] = { name: phase.name ?? phase.id, ...(tries.find((t) => t.present > 0) ?? tries[0]) };
  }
  const all = Object.entries(out);
  return {
    phases: out,
    presentCount: all.reduce((n, [, p]) => n + p.present, 0),
    totalCount: all.reduce((n, [, p]) => n + p.total, 0),
    complete: all.every(([, p]) => p.complete),
    missing: all.flatMap(([id, p]) => p.missing.map((m) => `${id}: ${m}`)),
  };
}

/** The orch record of one run: spawns, depth, review flow and phase documents. */
function orchMetrics({ events, workspaceDir = null, spec = loadMetricsSpec(), docs = loadPhaseDocs(), phases = null, tree = spawnTree(events) }) {
  const flow = reviewFlow(events, spec, tree);
  return {
    spawns: tree.spawns, spawnCalls: tree.spawnCalls, maxSpawnDepth: tree.maxSpawnDepth, childSessions: tree.childSessions,
    reviewRounds: flow.reviewRounds, reviewVerdicts: flow.verdicts, fixSpawns: flow.fixSpawns, reworksAfterPass: flow.reworksAfterPass,
    phaseDocs: workspaceDir ? phaseDocuments(workspaceDir, docs, { phases }) : null,
  };
}

/** Reads <runDir>/stream.jsonl and <runDir>/workspace. Null when the run has no stream. */
function orchMetricsOfRunDir(runDir, opts = {}) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return null;
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  return orchMetrics({ events, workspaceDir: path.join(runDir, 'workspace'), ...opts });
}

module.exports = { loadMetricsSpec, loadPhaseDocs, spawnTree, reviewFlow, phaseDocuments, orchMetrics, orchMetricsOfRunDir, kindOf, verdictOf, METRICS_FILE, PHASES_FILE };
