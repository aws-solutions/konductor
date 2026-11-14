// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js trace`: an ordered timeline of one saved run, read from its stream.jsonl (and run-config, result.json,
// installed-agent.json beside it). It reads files only. A reader sees the prompt, each assistant turn, every tool call, skill
// discovery and loads, every delegation with its brief and what came back, files written, and credits and time per turn
// where the stream records them. `--instructions` adds a best-effort, inferred map from each skill load or delegation to the
// instruction text that mentions it.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseStream, toolNameOf, isV3Call, skillsCallOf, mcpInputOf, subagentTargets, SUBAGENT_TOOL } = require('./stream.js');
const { runtimeOf, descriptorOf, supporting, joinNames } = require('./harness/runtime.js');
const claude = require('./harness/claude-code-parse.js');
const skills = require('./skills.js');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const WRITE_TOOLS = new Set(['fs_write', 'str_replace', 'fs_append', 'Write', 'Edit', 'MultiEdit']);
const FIND_SKILLS = 'find_skills';

// ---- small helpers ----

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = oneLine(s); return n && t.length > n ? `${t.slice(0, n - 3)}...` : t; };
// The scratch workspace of a run is r-XXXX/work; paths inside it print relative.
const shortPath = (s) => String(s ?? '').replace(/[^\s"'`]*\/r-[A-Za-z0-9]+\/work\/?/g, './');

function textOfContent(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(textOfContent).join('');
  if (typeof c === 'object') return typeof c.text === 'string' ? c.text : typeof c.message === 'string' ? c.message : typeof c.output === 'string' ? c.output : textOfContent(c.content ?? c.items ?? c.Json ?? '');
  return String(c);
}

const outputText = (rawOutput) => {
  if (rawOutput == null) return '';
  if (typeof rawOutput === 'string') return rawOutput;
  if (typeof rawOutput.message === 'string') return rawOutput.message;
  if (typeof rawOutput.output === 'string') return rawOutput.output;
  return textOfContent(rawOutput.items ?? rawOutput);
};

function argsSummary(input) {
  if (!input || typeof input !== 'object') return '';
  const pick = ['path', 'file_path', 'command', 'pattern', 'query', 'name', 'skill', 'url'].find((k) => typeof input[k] === 'string');
  if (pick) return `${pick}=${shortPath(input[pick])}`;
  const first = Object.entries(input).find(([, v]) => typeof v === 'string' || typeof v === 'number');
  return first ? `${first[0]}=${shortPath(first[1])}` : '';
}

const writtenPath = (input) => (input && typeof input === 'object' ? input.path ?? input.file_path ?? null : null);

// ---- Kiro (engine v2 and v3) ----

function kiroTimeline(events) {
  const entries = [];
  const calls = new Map();
  const subtasks = new Map();
  const execAgent = new Map();
  const open = [];
  let rootExec = null;
  let msg = null;
  const push = (e) => { const entry = { n: entries.length + 1, ...e }; entries.push(entry); return entry; };
  const flush = () => { if (msg) { push({ kind: msg.kind, agent: msg.agent, text: msg.text }); msg = null; } };
  // Chunks carry an execution id. A sub-agent that runs under the parent's id is told apart by being the one open delegation.
  const agentOfExec = (id) => {
    if (!id) return 'root';
    if (!rootExec) rootExec = id;
    if (id === rootExec) {
      const running = open.filter((d) => !d.done);
      return running.length === 1 ? running[0].agent : 'root';
    }
    if (!execAgent.has(id)) {
      const next = open.find((d) => !d.exec && !d.done);
      if (next) { next.exec = id; execAgent.set(id, next.agent); } else execAgent.set(id, 'unknown');
    }
    return execAgent.get(id);
  };
  const agentOfCall = (u) => {
    const sub = u._meta?.kiro?.agentSubtaskId;
    return sub && subtasks.has(sub) ? subtasks.get(sub).agent : 'root';
  };
  for (const ev of events) {
    const d = ev.data || {};
    if (ev.type === 'runStarted') { push({ kind: 'start', agent: 'root', engine: d.engine ?? null }); continue; }
    if (ev.type === 'metadata') {
      flush();
      const credits = (d.meteringUsage || []).filter((m) => m.unit === 'credit').reduce((s, m) => s + (Number(m.value) || 0), 0);
      push({ kind: 'turn-end', agent: 'root', elapsedMs: d.turnDurationMs ?? null, credits });
      continue;
    }
    if (ev.type === 'runFinished') {
      flush();
      push({ kind: 'final', agent: 'root', status: d.status ?? null, stopReason: d.stopReason ?? null, text: d.finalText ?? '' });
      continue;
    }
    if (ev.type !== 'sessionUpdate') continue;
    const u = d.update || {};
    const meta = u._meta?.kiro || {};
    if (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk') {
      const kind = u.sessionUpdate === 'agent_message_chunk' ? 'assistant' : 'thought';
      const agent = agentOfExec(meta.executionId);
      const text = textOfContent(u.content);
      if (msg && msg.kind === kind && msg.agent === agent) msg.text += text;
      else { flush(); msg = { kind, agent, text }; }
      continue;
    }
    if (u.sessionUpdate === 'session_info_update') {
      if (meta.kind !== 'turn_completion') continue;
      flush();
      const credits = (meta.promptTurnSummaries || []).filter((m) => m.unit === 'credit').reduce((s, m) => s + (Number(m.usage) || 0), 0);
      push({ kind: 'turn-end', agent: agentOfExec(meta.executionId), elapsedMs: meta.elapsedTime ?? null, credits });
      continue;
    }
    if (u.sessionUpdate === 'tool_call') {
      flush();
      if (u.toolCallId && calls.has(u.toolCallId)) { Object.assign(calls.get(u.toolCallId).input ?? {}, u.rawInput ?? {}); continue; }
      const agent = agentOfCall(u);
      const input = u.rawInput && typeof u.rawInput === 'object' ? { ...u.rawInput } : {};
      const tool = toolNameOf(u);
      const sk = skillsCallOf(u);
      let entry;
      if (tool === SUBAGENT_TOOL) {
        const target = subagentTargets(input, { nameIsAgent: isV3Call(u) })[0];
        entry = push({ kind: 'delegate', agent, target, input, id: u.toolCallId, status: null });
        const d2 = { agent: target, entry, exec: null, done: false };
        entry.open = d2;
        if (meta.agentSubtaskId) subtasks.set(meta.agentSubtaskId, d2);
        open.push(d2);
      } else if (sk) {
        entry = push({ kind: sk.tool === FIND_SKILLS ? 'skill-find' : 'skill-load', agent, input: mcpInputOf(input) ?? {}, deferred: sk.deferred, id: u.toolCallId, status: null });
      } else {
        entry = push({ kind: 'tool', agent, tool: tool ?? u.title ?? 'unknown', title: u.title ?? null, input, id: u.toolCallId, status: null });
      }
      if (u.toolCallId) calls.set(u.toolCallId, entry);
      continue;
    }
    if (u.sessionUpdate === 'tool_call_update') {
      const entry = calls.get(u.toolCallId);
      if (!entry) continue;
      if (u.rawInput && typeof u.rawInput === 'object') Object.assign(entry.input, u.rawInput);
      if (entry.kind === 'skill-load' || entry.kind === 'skill-find') entry.input = { ...entry.input, ...mcpInputOf(u.rawInput ?? {}) };
      if (u.status) entry.status = u.status;
      if (u.status === 'completed' || u.status === 'failed') {
        entry.result = outputText(u.rawOutput);
        entry.failed = u.status === 'failed';
        if (entry.kind === 'delegate' && entry.open && !entry.open.done) {
          flush();
          entry.open.done = true;
          push({ kind: 'delegate-return', agent: entry.agent, target: entry.target, status: u.status, text: entry.result });
        }
      }
    }
  }
  flush();
  for (const e of entries) delete e.open;
  return entries;
}

// ---- Claude Code ----

function claudeTimeline(events) {
  const entries = [];
  const calls = new Map();
  const targetOf = new Map();
  const push = (e) => { const entry = { n: entries.length + 1, ...e }; entries.push(entry); return entry; };
  const agentFor = (ev) => (ev.parent_tool_use_id && targetOf.has(ev.parent_tool_use_id) ? targetOf.get(ev.parent_tool_use_id) : 'root');
  for (const ev of events) {
    if (ev.type === 'system' && ev.subtype === 'init') { push({ kind: 'start', agent: 'root', engine: 'claude-code', model: ev.model ?? null, slashCommands: ev.slash_commands ?? [] }); continue; }
    if (ev.type === 'assistant') {
      const agent = agentFor(ev);
      for (const b of ev.message?.content || []) {
        if (b.type === 'text' && b.text) push({ kind: 'assistant', agent, text: b.text });
        else if (b.type === 'thinking') { if (b.thinking) push({ kind: 'thought', agent, text: b.thinking }); } else if (b.type === 'tool_use') {
          let entry;
          if (claude.SUBAGENT_TOOLS.has(b.name)) {
            const target = b.input?.subagent_type ?? '(unnamed)';
            targetOf.set(b.id, target);
            entry = push({ kind: 'delegate', agent, target, input: b.input ?? {}, id: b.id, status: null });
          } else if (b.name === 'Skill') {
            entry = push({ kind: 'skill-load', agent, input: { name: b.input?.skill ?? b.input?.name ?? null }, id: b.id, status: null, deferred: false });
          } else if (b.name === 'Read' && /(?:^|\/)([^/]+)\/SKILL\.md$/.test(String(b.input?.file_path ?? ''))) {
            entry = push({ kind: 'skill-load', agent, input: { name: /(?:^|\/)([^/]+)\/SKILL\.md$/.exec(b.input.file_path)[1] }, via: 'read-skill-md', id: b.id, status: null, deferred: false });
          } else {
            entry = push({ kind: 'tool', agent, tool: b.name, input: b.input ?? {}, id: b.id, status: null });
          }
          calls.set(b.id, entry);
        }
      }
    } else if (ev.type === 'user') {
      for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        if (b.type !== 'tool_result') continue;
        const entry = calls.get(b.tool_use_id);
        if (!entry) continue;
        entry.status = b.is_error ? 'failed' : 'completed';
        entry.failed = Boolean(b.is_error);
        entry.result = textOfContent(b.content);
        if (entry.kind === 'delegate') push({ kind: 'delegate-return', agent: entry.agent, target: entry.target, status: entry.status, text: entry.summary ?? entry.result });
      }
    } else if (ev.type === 'system' && ev.subtype === 'task_notification' && ev.tool_use_id && calls.has(ev.tool_use_id)) {
      const entry = calls.get(ev.tool_use_id);
      entry.status = ev.status ?? entry.status;
      if (ev.summary) entry.summary = ev.summary;
    } else if (ev.type === 'result') {
      push({ kind: 'final', agent: 'root', status: ev.subtype ?? null, stopReason: ev.stop_reason ?? null, text: typeof ev.result === 'string' ? ev.result : '', costUsd: ev.total_cost_usd ?? null, elapsedMs: ev.duration_ms ?? null, turns: ev.num_turns ?? null });
    }
  }
  return entries;
}

// ---- header ----

function entryAgentOf(result, installed) {
  return result?.agent ?? installed?.name ?? (result ? 'konductor' : null);
}

function skillFilterOf(installed) {
  if (!installed || typeof installed !== 'object') return null;
  return skills.startupKiro({ mcpServers: installed.mcpServers }).skillFilter ?? null;
}

function sessionFilesOf(runDir) {
  const dir = path.join(runDir, 'session');
  if (!fs.existsSync(dir)) return [];
  try { return fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.jsonl?$/.test(f)).sort(); } catch { return []; }
}

// What the saved files cannot show, stated from what is actually in the run directory.
function missingOf({ result, runDir, desc }) {
  const missing = [];
  const files = sessionFilesOf(runDir);
  const partial = (result?.flags || []).includes('transcriptPartial') || result?.transcriptPartial === true;
  if (desc.trace.sessionFiles) {
    if (!files.length) missing.push('no session files were saved (no session/ directory), so the model prompts, the system prompt and the per-session message log are not available; this trace comes from stream.jsonl alone');
    else if (partial) missing.push(`session files were saved (${files.length}) but the transcript is flagged partial: a session's own messages.jsonl or .jsonl is missing`);
  }
  if (desc.trace.timeNote) missing.push(desc.trace.timeNote);
  return { partial, sessionFiles: files, missing };
}

function spawnTreeOf(entries) {
  const delegations = entries.filter((e) => e.kind === 'delegate');
  return delegations.map((d) => ({
    n: d.n, id: d.id, parent: d.agent, target: d.target, status: d.status,
    toolCalls: entries.filter((e) => e.agent === d.target && ['tool', 'skill-load', 'skill-find'].includes(e.kind)).length,
  }));
}

function filesWritten(entries) {
  const out = [];
  for (const e of entries) {
    if (e.kind !== 'tool' || !WRITE_TOOLS.has(e.tool)) continue;
    const p = writtenPath(e.input);
    if (p) out.push({ n: e.n, agent: e.agent, path: shortPath(p), tool: e.tool, failed: Boolean(e.failed) });
  }
  return out;
}

const textBytes = (s) => Buffer.byteLength(String(s ?? ''));

// ---- instructions ----

function gitShow(repoRoot, sha, file) {
  const r = spawnSync('git', ['-C', repoRoot, 'show', `${sha}:${file}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/**
 * The instruction texts an entry agent was installed with, as [{ label, lines: [..] }]. The installed agent file saved in
 * the run is searched first; when the arm's commit is known and exists in repoRoot, so are the agent spec, the contexts it
 * lists and the delegation skill at that commit. Line numbers are within the decoded text, not within a JSON file.
 */
function instructionSources({ runDir, result, installed, entry, repoRoot }) {
  const sources = [];
  const add = (label, text) => { if (typeof text === 'string' && text) sources.push({ label, lines: text.split('\n') }); };
  if (installed?.prompt) add('installed-agent.json prompt', installed.prompt);
  const sha = result?.commitSha;
  if (sha && repoRoot && entry) {
    const specText = gitShow(repoRoot, sha, `agents/${entry}.agent-spec.json`);
    const spec = specText ? (() => { try { return JSON.parse(specText); } catch { return null; } })() : null;
    if (spec) {
      add(`agents/${entry}.agent-spec.json systemPrompt @${sha.slice(0, 7)}`, spec.config?.systemPrompt ?? spec.systemPrompt);
      for (const name of spec.dependencies?.context?.contextNames ?? []) add(`context/${name} @${sha.slice(0, 7)}`, gitShow(repoRoot, sha, `context/${name}`));
      const listed = spec.dependencies?.skills?.skillNames ?? [];
      if (listed.includes('delegation-protocol')) add(`skills/delegation-protocol/SKILL.md @${sha.slice(0, 7)}`, gitShow(repoRoot, sha, 'skills/delegation-protocol/SKILL.md'));
      sources.listedSkills = listed;
    }
  }
  return sources;
}

function mentionsOf(sources, name, { limit = 4 } = {}) {
  if (!name) return { total: 0, hits: [], listed: [] };
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, 'i');
  const hits = [];
  for (const s of sources) {
    s.lines.forEach((line, i) => { if (re.test(line)) hits.push({ source: s.label, line: i + 1, text: clip(line, 200) }); });
  }
  const listed = (sources.listedSkills || []).includes(name) ? [{ source: 'dependencies.skills.skillNames of the entry agent spec', line: null, text: `lists "${name}"` }] : [];
  return { total: hits.length, hits: hits.slice(0, limit), listed };
}

// ---- assembly ----

// The split of failed skill calls by tool, as the runner saved it; null when the run has none or predates the field.
function failedSkillSplit(result) {
  const split = result?.skillCallsFailedByTool;
  return split && Object.values(split).some((n) => n > 0) ? split : null;
}

// The timeline reader for each stream format. A format with none is read as kiro-cli updates, as before the descriptors.
const TIMELINES = { 'claude-stream-json': claudeTimeline };

/**
 * The trace of one run directory (the one holding result.json and stream.jsonl).
 * opts.instructions adds inferred pointers to instruction text; opts.repoRoot says where the arm's commit can be read.
 */
function buildTrace(runDir, { instructions = false, repoRoot = null } = {}) {
  const result = readJson(path.join(runDir, 'result.json'));
  const installed = readJson(path.join(runDir, 'installed-agent.json'));
  const streamText = readText(path.join(runDir, 'stream.jsonl'));
  if (streamText === null) throw new Error(`${runDir} has no stream.jsonl`);
  const harness = runtimeOf(result);
  const desc = descriptorOf(harness);
  if (!desc.supports.trace) throw new Error(`trace reads ${joinNames(supporting('trace').map((d) => d.proseName))} streams; this run is ${/^[aeiou]/i.test(desc.proseName) ? 'an' : 'a'} ${desc.proseName} run`);
  const { events } = parseStream(streamText);
  const entries = (TIMELINES[desc.streamFormat] ?? kiroTimeline)(events);
  const command = readText(path.join(runDir, 'command.txt'));
  // The prompt is the longest quoted argument of the saved command line.
  const promptArg = command ? [...command.split('\n')[0].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => { try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; } }).sort((a, b) => b.length - a.length)[0] ?? null : null;
  const entry = entryAgentOf(result, installed);
  const loaded = entries.filter((e) => e.kind === 'skill-load' && !e.deferred && !e.failed && e.status !== 'failed' && (e.result == null || e.result.length > 0)).map((e) => e.input.name).filter(Boolean);
  const filter = desc.trace.skillsListing === 'agent-filter' ? skillFilterOf(installed) : null;
  const listedNote = desc.trace.skillsListing === 'slash-commands'
    ? `${(entries.find((e) => e.kind === 'start')?.slashCommands || []).length} slash commands in the session init (skills are offered by name)`
    : filter ? `${filter.length} skills in the installed agent's filter` : 'unknown (no installed-agent.json in the run directory)';
  const sources = instructions ? instructionSources({ runDir, result, installed, entry, repoRoot }) : null;
  if (instructions) {
    for (const e of entries) {
      if (e.kind === 'skill-load') e.instructions = mentionsOf(sources, e.input.name);
      else if (e.kind === 'delegate') e.instructions = mentionsOf(sources, e.target);
    }
  }
  const trace = {
    run: { dir: runDir, arm: result?.armId ?? null, task: result?.taskId ?? null, replicate: result?.replicate ?? null, harness, model: result?.model ?? null },
    prompt: promptArg,
    header: {
      entryAgent: entry,
      skillsListed: { summary: listedNote, names: filter },
      skillsLoaded: [...new Set(loaded)],
      skillFindCalls: entries.filter((e) => e.kind === 'skill-find').length,
      ...(failedSkillSplit(result) ? { skillCallsFailedByTool: failedSkillSplit(result) } : {}),
      spawnTree: spawnTreeOf(entries),
      wallClockMs: result?.wallClockMs ?? null,
      credits: result?.credits ?? null,
      costUsd: result?.costUsd ?? entries.find((e) => e.kind === 'final')?.costUsd ?? null,
      status: result?.status ?? null,
      flags: result?.flags ?? [],
      transcript: missingOf({ result, runDir, desc }),
      filesWritten: filesWritten(entries),
      instructionSources: sources ? sources.map((s) => s.label) : null,
    },
    entries,
  };
  return trace;
}

// ---- rendering ----

function renderMarkdown(trace, { full = false } = {}) {
  const h = trace.header;
  const n = full ? 0 : 160;
  const L = [];
  const r = trace.run;
  L.push(`# Trace: ${r.arm ?? '?'} / ${r.task ?? '?'} / rep ${r.replicate ?? '?'} (${r.harness}${r.model ? `, ${r.model}` : ''})`);
  L.push('');
  L.push(`- entry agent: ${h.entryAgent ?? 'unknown'}`);
  L.push(`- status: ${h.status ?? 'n/a'}; wall time: ${h.wallClockMs != null ? `${(h.wallClockMs / 1000).toFixed(1)} s` : 'n/a'}; ${h.costUsd != null && h.credits == null ? `cost: $${Number(h.costUsd).toFixed(4)}` : `credits: ${h.credits != null ? Number(h.credits).toFixed(3) : 'n/a'}`}`);
  L.push(`- skills listed to the entry agent: ${h.skillsListed.summary}`);
  L.push(`- skills loaded: ${h.skillsLoaded.length ? h.skillsLoaded.join(', ') : 'none'}; find_skills calls: ${h.skillFindCalls}`);
  if (h.skillCallsFailedByTool) L.push(`- failed skill calls: ${Object.entries(h.skillCallsFailedByTool).filter(([, n]) => n > 0).map(([tool, n]) => `${tool} ${n}`).join(', ')}`);
  L.push(`- spawn tree: ${h.spawnTree.length ? h.spawnTree.map((s) => `${s.parent} -> ${s.target} (${s.toolCalls} tool calls)`).join('; ') : 'no delegation'}`);
  L.push(`- files written: ${h.filesWritten.length ? [...new Set(h.filesWritten.map((f) => f.path))].join(', ') : 'none seen'}`);
  L.push(`- flags: ${h.flags.length ? h.flags.join(', ') : 'none'}`);
  L.push(`- transcriptPartial: ${h.transcript.partial ? 'yes' : 'no'}${h.transcript.sessionFiles.length ? `; ${h.transcript.sessionFiles.length} session file(s) saved` : ''}`);
  for (const m of h.transcript.missing) L.push(`  - missing: ${m}`);
  L.push('');
  if (trace.prompt) { L.push('## Prompt'); L.push(''); L.push(full ? trace.prompt : clip(trace.prompt, 600)); L.push(''); }
  L.push('## Timeline');
  L.push('');
  let lastTurn = 0;
  for (const e of trace.entries) {
    if (e.kind === 'thought' && !full) { lastTurn++; continue; }
    const who = e.agent === 'root' ? 'root' : e.agent;
    const idx = String(e.n).padStart(4);
    switch (e.kind) {
      case 'start': L.push(`${idx}  ${who}  start${e.engine ? ` (engine ${e.engine})` : ''}`); break;
      case 'assistant': L.push(`${idx}  ${who}  SAYS  ${clip(e.text, n || 0)}`); break;
      case 'thought': L.push(`${idx}  ${who}  thought  ${clip(e.text, 0)}`); break;
      case 'tool': L.push(`${idx}  ${who}  tool  ${e.tool}${e.title && e.title !== e.tool ? ` (${e.title})` : ''}  ${clip(argsSummary(e.input), n || 0)}${e.failed ? '  FAILED' : ''}`); break;
      case 'skill-find': L.push(`${idx}  ${who}  find_skills  ${clip(shortPath(JSON.stringify(e.input)), n || 0)}${e.deferred ? '  (refused: tool not loaded yet)' : ''}${e.failed ? '  FAILED' : ''}`); break;
      case 'skill-load': L.push(`${idx}  ${who}  LOAD SKILL  ${e.input.name ?? '(no name)'}${e.deferred ? '  (refused: tool not loaded yet)' : ''}${e.failed ? '  FAILED' : e.result != null ? `  (${textBytes(e.result)} bytes)` : ''}`); break;
      case 'delegate': {
        const brief = e.input.prompt ?? e.input.task ?? e.input.description ?? '';
        L.push(`${idx}  ${who}  DELEGATE -> ${e.target}  brief ${textBytes(brief)} bytes: ${clip(brief, n || 0)}`);
        break;
      }
      case 'delegate-return': L.push(`${idx}  ${e.target}  RETURNED to ${who} (${e.status ?? 'n/a'}, ${textBytes(e.text)} bytes): ${clip(e.text, n || 0)}`); break;
      case 'turn-end': L.push(`${idx}  ${who}  turn end${e.elapsedMs != null ? `  ${(e.elapsedMs / 1000).toFixed(1)} s` : ''}${e.credits ? `  ${Number(e.credits).toFixed(3)} credits` : ''}`); break;
      case 'final': L.push(`${idx}  ${who}  FINAL (${e.status ?? 'n/a'}${e.stopReason ? `, ${e.stopReason}` : ''}${e.costUsd != null ? `, $${Number(e.costUsd).toFixed(4)}` : ''}${e.elapsedMs != null ? `, ${(e.elapsedMs / 1000).toFixed(1)} s` : ''})  ${clip(e.text, n || 0)}`); break;
      default: L.push(`${idx}  ${who}  ${e.kind}`);
    }
    if (e.instructions) {
      const subject = e.kind === 'delegate' ? e.target : e.input?.name;
      const { total = 0, hits = [], listed = [] } = e.instructions;
      if (!subject) {
        L.push('      INFERRED, the call recorded no name (a refused call), so no instruction text can be matched');
      } else if (total || listed.length) {
        L.push(`      INFERRED, instruction text that mentions "${subject}" (${total} line(s)):`);
        for (const l of listed) L.push(`        - ${l.source}: ${l.text}`);
        for (const hit of hits) L.push(`        - ${hit.source}:${hit.line}  ${hit.text}`);
      } else {
        L.push(`      INFERRED, no installed instruction text mentions "${subject}"`);
      }
    }
  }
  if (!full && lastTurn) { L.push(''); L.push(`(${lastTurn} thought block(s) hidden; --full shows them)`); }
  if (trace.header.instructionSources) { L.push(''); L.push(`Instruction sources searched (INFERRED, not proof of cause): ${trace.header.instructionSources.length ? trace.header.instructionSources.join('; ') : 'none found'}`); }
  return `${L.join('\n')}\n`;
}

/** The directory of one run under `dir`: <dir>/<arm>/<task>/<rep>, or the same under a 2x2 cell. */
function locateRun(dir, { arm, task, rep }) {
  const root = path.resolve(dir);
  const isRun = (d) => fs.existsSync(path.join(d, 'result.json'));
  const direct = path.join(root, arm ?? '', task ?? '', String(rep ?? ''));
  if (arm && task && rep !== undefined && isRun(direct)) return direct;
  const cells = path.join(root, 'cells');
  if (fs.existsSync(cells) && arm && task && rep !== undefined) {
    const cell = path.join(cells, arm, task);
    if (fs.existsSync(cell)) {
      const armIds = fs.readdirSync(cell).filter((n) => fs.existsSync(path.join(cell, n, task, String(rep), 'result.json')));
      if (armIds.length === 1) return path.join(cell, armIds[0], task, String(rep));
    }
  }
  const have = [];
  try {
    for (const a of fs.readdirSync(root)) {
      for (const t of fs.readdirSync(path.join(root, a))) {
        for (const x of fs.readdirSync(path.join(root, a, t))) if (isRun(path.join(root, a, t, x))) have.push(`${a}/${t}/${x}`);
      }
    }
  } catch { /* the listing below says none */ }
  throw new Error(`no run ${arm ?? '?'}/${task ?? '?'}/${rep ?? '?'} in ${dir}${have.length ? `; runs present: ${have.slice(0, 12).join(', ')}${have.length > 12 ? ', ...' : ''}` : ''}`);
}

module.exports = { buildTrace, renderMarkdown, locateRun, kiroTimeline, claudeTimeline, instructionSources, mentionsOf };
