// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads what `claude -p --output-format stream-json --verbose` leaves behind. Every fact here was checked against
// recorded streams (bench/runner/test/fixtures/claude-code). The totals on a `result` line are cumulative for the
// session, and a session that resumes after a background task prints a second `result`, so the last one is used.

const { detectAskedUser } = require('../stream.js');

const SUBAGENT_TOOLS = new Set(['Agent', 'Task']);
const ASK_TOOLS = new Set(['AskUserQuestion']);
const SYNTHETIC_MODEL = '<synthetic>';
const CREDENTIAL_ERROR = /cloud_credential_error|could not load (aws )?credentials/i;

const zeroTokens = () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** `us.anthropic.claude-sonnet-5-5` and `claude-sonnet-5-5` both name the model `claude-sonnet-5-5`. */
function canonicalModelOf(id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  return id.trim().replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '');
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (typeof b === 'string' ? b : b?.type === 'text' || typeof b?.text === 'string' ? b.text ?? '' : '')).join('\n');
};

const blocks = (ev) => (Array.isArray(ev?.message?.content) ? ev.message.content : []);

// Claude Code emits one assistant event per content block, so one API message can appear several times; usage is
// read once per message id (the largest value seen for each field, since output tokens grow while a message streams).
function addUsage(byId, id, u = {}) {
  const cur = byId.get(id) ?? zeroTokens();
  cur.input = Math.max(cur.input, num(u.input_tokens));
  cur.output = Math.max(cur.output, num(u.output_tokens));
  cur.cacheRead = Math.max(cur.cacheRead, num(u.cache_read_input_tokens));
  cur.cacheWrite = Math.max(cur.cacheWrite, num(u.cache_creation_input_tokens));
  byId.set(id, cur);
}

const totalTokens = (t) => t.input + t.output + t.cacheRead + t.cacheWrite;

/** USD for a token count at per-million rates { input, output, cacheRead, cacheWrite }. */
function priceTokens(t, r) {
  return (t.input * r.input + t.output * r.output + t.cacheRead * r.cacheRead + t.cacheWrite * r.cacheWrite) / 1e6;
}

function tokensFromModelUsage(modelUsage) {
  const t = zeroTokens();
  for (const m of Object.values(modelUsage ?? {})) {
    t.input += num(m.inputTokens);
    t.output += num(m.outputTokens);
    t.cacheRead += num(m.cacheReadInputTokens);
    t.cacheWrite += num(m.cacheCreationInputTokens);
  }
  return t;
}

// ---- Skills ----

const SKILL_BODY = /^Base directory for this skill:/;
const SKILL_FILE = /(?:^|\/)([^/]+)\/SKILL\.md$/;

/**
 * Skill loads in stream order, in the shape the shared extractor reads: { tool: 'skill', input: { name }, text, status, via }.
 * A load is a `Skill` tool call (the skill text arrives as the user message after the tool result) or a Read of a SKILL.md file.
 */
function skillCalls(events) {
  const calls = new Map();
  const order = [];
  let open = null;
  for (const ev of events ?? []) {
    if (ev?.type === 'assistant') {
      for (const b of blocks(ev)) {
        if (b?.type !== 'tool_use' || !b.id || calls.has(b.id)) continue;
        let call = null;
        if (b.name === 'Skill') call = { tool: 'skill', input: { name: b.input?.skill ?? b.input?.name ?? null }, text: null, status: null, via: 'skill-tool', body: null };
        else if (b.name === 'Read') {
          const m = SKILL_FILE.exec(String(b.input?.file_path ?? ''));
          if (m) call = { tool: 'skill', input: { name: m[1] }, text: null, status: null, via: 'read-skill-md', body: null };
        }
        if (call) { calls.set(b.id, call); order.push(call); }
      }
    } else if (ev?.type === 'user') {
      for (const b of blocks(ev)) {
        if (b?.type === 'tool_result' && calls.has(b.tool_use_id)) {
          const call = calls.get(b.tool_use_id);
          call.status = b.is_error ? 'error' : 'ok';
          call.text = textOf(b.content);
          open = call.via === 'skill-tool' && !b.is_error ? call : null;
        } else if (open && b?.type === 'text' && SKILL_BODY.test(b.text ?? '')) {
          open.text = `${open.text}\n${b.text}`;
          open = null;
        }
      }
    }
  }
  return order.map(({ body, ...c }) => c);
}

// ---- Spawn tree ----

/**
 * The shape orch-metrics.js reads (see spawnTree there): one call per Agent tool call in stream order. A call's depth is one
 * more than the depth of the call whose sub-agent made it; `parent_tool_use_id` on an event names that call. The output a
 * review verdict is read from is the sub-agent's notification summary, else the tool result.
 */
function spawnTree(events) {
  const calls = new Map();
  const order = [];
  const results = new Map();
  const notes = new Map();
  const agents = new Set();
  for (const ev of events ?? []) {
    if (ev?.agent_id) agents.add(ev.agent_id);
    if (ev?.type === 'assistant') {
      for (const b of blocks(ev)) {
        if (b?.type !== 'tool_use' || !SUBAGENT_TOOLS.has(b.name) || !b.id || calls.has(b.id)) continue;
        const input = b.input && typeof b.input === 'object' ? { ...b.input } : {};
        if (input.subagent_type !== undefined && input.agent === undefined) input.agent = input.subagent_type;
        const call = { id: b.id, caller: ev.parent_tool_use_id ?? null, input, targets: [input.subagent_type ?? '(unnamed)'], claimed: 0, closed: false, status: null, output: '' };
        calls.set(b.id, call);
        order.push(call);
      }
    } else if (ev?.type === 'user') {
      for (const b of blocks(ev)) if (b?.type === 'tool_result' && b.tool_use_id) results.set(b.tool_use_id, { text: textOf(b.content), error: b.is_error === true });
    } else if (ev?.type === 'system' && ev.subtype === 'task_notification' && ev.tool_use_id) {
      notes.set(ev.tool_use_id, { status: ev.status ?? null, summary: ev.summary ?? '' });
    }
  }
  const depthOf = (call, seen = new Set()) => {
    if (!call.caller || !calls.has(call.caller) || seen.has(call.id)) return 1;
    seen.add(call.id);
    return depthOf(calls.get(call.caller), seen) + 1;
  };
  for (const c of order) {
    const note = notes.get(c.id);
    const res = results.get(c.id);
    if (note) { c.closed = true; c.status = note.status; c.output = note.summary || res?.text || ''; }
    else if (res) { c.closed = true; c.status = res.error ? 'failed' : 'completed'; c.output = res.text; }
    c.depth = depthOf(c);
  }
  return {
    calls: order,
    spawnCalls: order.length,
    spawns: order.length,
    maxSpawnDepth: order.reduce((m, c) => Math.max(m, c.depth), 0),
    childSessions: agents.size || order.length,
  };
}

// ---- Aggregate ----

const bump = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };

/**
 * One aggregate over a whole stream.
 * expectedModel: the canonical model the run must use. rates: optional per-million USD rates by canonical model
 * ({ input, output, cacheRead, cacheWrite }) to price a run that died before its `result` line.
 */
function aggregateEvents(events, { expectedModel = null, rates = null } = {}) {
  const out = {
    sessionId: null, sessionIds: [], init: null, initCount: 0, resultCount: 0,
    runFinishedStatus: null, stopReason: null, terminalReason: null, errorKind: null, errors: [], retries: {},
    finalText: null, lastText: null, askedUser: null,
    tokens: zeroTokens(), costUsd: null, costBasis: null, costCensored: false, modelCalls: 0,
    modelUsageKeys: [], modelIdentity: { expected: expectedModel, canonicalModels: [], messageModels: [], offending: [], ok: null },
    toolCalls: 0, workToolCalls: 0, subagentCalls: 0, toolNames: {}, delegatedTo: {},
    spawn: { spawned: 0, failed: 0, completed: 0, maxDepth: 0, byType: {} }, tasks: [],
    hooks: [], permissionDenials: [], permissionDeniedEvents: 0,
    turnDurationMs: null, apiDurationMs: null, numTurns: null,
  };
  const usageById = new Map();
  const toolIds = new Set();
  const messageModels = new Set();
  const sessionIds = new Set();
  const results = [];
  let asked = false;
  let lastMainText = null;

  for (const ev of events ?? []) {
    if (!ev || typeof ev !== 'object') continue;
    if (typeof ev.session_id === 'string') sessionIds.add(ev.session_id);
    if (ev.type === 'system') {
      if (ev.subtype === 'init') {
        out.initCount++;
        out.init = out.init ?? {
          model: ev.model ?? null, permissionMode: ev.permissionMode ?? null, version: ev.claude_code_version ?? null, apiKeySource: ev.apiKeySource ?? null,
          tools: ev.tools ?? [], agents: ev.agents ?? [], skills: ev.skills ?? [], plugins: (ev.plugins ?? []).map((p) => p?.name ?? p), mcpServers: ev.mcp_servers ?? [],
        };
      } else if (ev.subtype === 'hook_started' || ev.subtype === 'hook_response') {
        out.hooks.push({ subtype: ev.subtype, event: ev.hook_event ?? null, name: ev.hook_name ?? null, outcome: ev.outcome ?? null, exitCode: ev.exit_code ?? null });
      } else if (ev.subtype === 'permission_denied') {
        out.permissionDeniedEvents++;
      } else if (ev.subtype === 'api_retry') {
        bump(out.retries, String(ev.error ?? 'unknown'));
      } else if (ev.subtype === 'task_started') {
        out.tasks.push({ id: ev.task_id ?? null, toolUseId: ev.tool_use_id ?? null, type: ev.subagent_type ?? null, depth: ev.spawn_depth ?? null, status: null, summary: null });
      } else if (ev.subtype === 'task_notification') {
        const t = out.tasks.find((x) => x.id === ev.task_id) ?? out.tasks.find((x) => x.toolUseId === ev.tool_use_id);
        if (t) { t.status = ev.status ?? null; t.summary = ev.summary ?? null; }
      }
    } else if (ev.type === 'assistant') {
      const msg = ev.message ?? {};
      if (msg.id) addUsage(usageById, msg.id, msg.usage);
      if (msg.model && msg.model !== SYNTHETIC_MODEL) messageModels.add(msg.model);
      for (const b of blocks(ev)) {
        if (b?.type === 'text' && typeof b.text === 'string' && !ev.parent_tool_use_id) lastMainText = b.text;
        if (b?.type !== 'tool_use') continue;
        if (b.id) { if (toolIds.has(b.id)) continue; toolIds.add(b.id); }
        out.toolCalls++;
        bump(out.toolNames, b.name ?? 'unknown');
        if (SUBAGENT_TOOLS.has(b.name)) {
          out.subagentCalls++;
          bump(out.delegatedTo, b.input?.subagent_type ?? '(unnamed)');
        }
        if (ASK_TOOLS.has(b.name)) asked = true;
      }
    } else if (ev.type === 'result') {
      results.push(ev);
    }
  }

  out.sessionIds = [...sessionIds];
  out.sessionId = out.sessionIds[0] ?? null;
  out.modelCalls = usageById.size;
  out.workToolCalls = out.toolCalls - out.subagentCalls;
  out.lastText = lastMainText;
  out.resultCount = results.length;
  out.tasks.forEach((t) => { if (t.status === 'completed') out.spawn.completed++; });

  const last = results.at(-1) ?? null;
  const assistantTokens = zeroTokens();
  for (const u of usageById.values()) for (const k of Object.keys(assistantTokens)) assistantTokens[k] += u[k] ?? 0;

  const canonical = new Set();
  if (last) {
    out.modelUsageKeys = Object.keys(last.modelUsage ?? {});
    for (const [key, m] of Object.entries(last.modelUsage ?? {})) {
      const c = canonicalModelOf(m?.canonicalModel) ?? canonicalModelOf(key);
      if (c) canonical.add(c);
    }
    out.tokens = tokensFromModelUsage(last.modelUsage);
    // Totals are cumulative; the larger of the result lines guards against a later line that restarts from zero.
    out.costUsd = Math.max(...results.map((r) => num(r.total_cost_usd)));
    out.costBasis = Object.values(last.modelUsage ?? {}).map((m) => m?.costBasis).find(Boolean) ?? null;
    out.terminalReason = last.terminal_reason ?? null;
    out.stopReason = last.subtype && last.subtype !== 'success' ? last.subtype : last.stop_reason ?? null;
    out.finalText = typeof last.result === 'string' ? last.result : '';
    out.numTurns = results.reduce((n, r) => n + num(r.num_turns), 0);
    out.turnDurationMs = results.reduce((n, r) => n + num(r.duration_ms), 0);
    out.apiDurationMs = results.reduce((n, r) => Math.max(n, num(r.duration_api_ms)), 0);
    out.permissionDenials = (last.permission_denials ?? []).map((d) => ({ tool: d?.tool_name ?? null, toolUseId: d?.tool_use_id ?? null }));
    const s = last.subagent_stats;
    if (s) {
      out.spawn = { spawned: num(s.spawned), failed: num(s.failed), completed: num(s.completed), maxDepth: num(s.max_depth), byType: s.by_type ?? {} };
    } else {
      out.spawn.spawned = out.subagentCalls;
      out.spawn.failed = out.tasks.filter((t) => t.status === 'failed').length;
      out.spawn.maxDepth = out.tasks.reduce((m, t) => Math.max(m, t.depth ?? 0), 0);
    }
    const failed = last.is_error === true || (last.subtype && last.subtype !== 'success');
    out.runFinishedStatus = failed ? 'error' : 'success';
    if (failed) {
      out.errors.push(String(last.result ?? last.subtype ?? 'error'));
      const credential = (out.retries.cloud_credential_error ?? 0) > 0 || CREDENTIAL_ERROR.test(String(last.result ?? ''));
      out.errorKind = credential ? 'credentials' : last.terminal_reason === 'api_error' || last.api_error_status != null ? 'api' : 'other';
    }
  } else {
    out.tokens = assistantTokens;
    out.costCensored = out.sessionIds.length > 0 || usageById.size > 0;
    const rate = rates?.[expectedModel] ?? (messageModels.size === 1 ? rates?.[canonicalModelOf([...messageModels][0])] : null);
    out.costUsd = rate && usageById.size ? priceTokens(out.tokens, rate) : null;
    out.spawn.spawned = out.subagentCalls;
    for (const m of messageModels) canonical.add(canonicalModelOf(m));
  }
  out.tokens.total = totalTokens(out.tokens);

  out.modelIdentity.canonicalModels = [...canonical].sort();
  out.modelIdentity.messageModels = [...messageModels].map(canonicalModelOf).filter(Boolean).filter((m, i, a) => a.indexOf(m) === i).sort();
  if (expectedModel) {
    const seen = new Set([...out.modelIdentity.canonicalModels, ...out.modelIdentity.messageModels]);
    out.modelIdentity.offending = [...seen].filter((m) => m !== expectedModel).sort();
    out.modelIdentity.ok = seen.size > 0 && out.modelIdentity.offending.length === 0;
  }

  out.askedUser = out.runFinishedStatus !== 'success' ? null : asked ? true : detectAskedUser(out);
  return out;
}

module.exports = {
  aggregateEvents, spawnTree, skillCalls, canonicalModelOf, priceTokens, tokensFromModelUsage, totalTokens, zeroTokens,
  SUBAGENT_TOOLS, ASK_TOOLS, SYNTHETIC_MODEL, CREDENTIAL_ERROR,
};
