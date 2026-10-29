// SPDX-License-Identifier: Apache-2.0
'use strict';

// Passive skill-load tracking. Everything here reads data a run already produced (the event stream, the
// installed agent definition, the repo's skill and SOP listings). No hooks, no extra calls, no config changes.

const fs = require('node:fs');
const path = require('node:path');
const { SKILLS_SERVER } = require('./stream.js');

const SKILL_FIELDS = [
  'skillsLoaded', 'skillQueries', 'sopsLoaded', 'skillBytesLoaded', 'skillCallsFailed', 'findSkillsCalls', 'findSkillsEmpty',
  'startupResourceCount', 'targetLoaded', 'targetAttempted', 'targetReachable', 'sopNameSource', 'skillsScope',
];

const KIRO_TOOLS = new Set(['get_skill', 'find_skills']);
const lower = (s) => String(s).toLowerCase();

// Text blocks a skills-server tool returned: the bytes the model saw.
function textsOf(rawOutput) {
  const out = [];
  for (const item of rawOutput?.items ?? []) {
    if (typeof item?.Text === 'string') out.push(item.Text);
    else if (item?.Json) {
      const blocks = item.Json.content;
      if (Array.isArray(blocks)) for (const b of blocks) { if (typeof b?.text === 'string') out.push(b.text); }
      else out.push(JSON.stringify(item.Json));
    }
  }
  return out;
}

const bytesOfTexts = (texts) => texts.reduce((n, t) => n + Buffer.byteLength(t), 0);

function kiroErrored(call) {
  return call.status === 'failed' || (call.output?.items ?? []).some((i) => i?.Json?.isError === true);
}

// Skills-server calls in a kiro stream, keyed by tool call id. The stream carries every session, subagents included.
function kiroCalls(events) {
  const calls = new Map();
  let anon = 0;
  for (const ev of events ?? []) {
    const u = ev?.type === 'sessionUpdate' ? ev.data?.update : null;
    if (!u) continue;
    if (u.sessionUpdate === 'tool_call') {
      const meta = u._meta?.kiro;
      if (!KIRO_TOOLS.has(meta?.toolName) || meta?.mcpServerName !== SKILLS_SERVER) continue;
      const id = u.toolCallId ?? `anon-${anon++}`;
      const c = calls.get(id) ?? { tool: meta.toolName, input: {}, output: null, status: null };
      if (u.rawInput && typeof u.rawInput === 'object') c.input = { ...c.input, ...u.rawInput };
      calls.set(id, c);
    } else if (u.sessionUpdate === 'tool_call_update') {
      const c = calls.get(u.toolCallId);
      if (!c) continue;
      if (u.rawInput && typeof u.rawInput === 'object') c.input = { ...c.input, ...u.rawInput };
      if (u.rawOutput !== undefined) c.output = u.rawOutput;
      if (u.status) c.status = u.status;
    }
  }
  return [...calls.values()];
}

// opencode loads a skill through its `skill` tool; the stream emits one tool_use per finished call.
function opencodeCalls(events) {
  const seen = new Set();
  const calls = [];
  for (const ev of events ?? []) {
    const p = ev?.type === 'tool_use' ? ev.part : null;
    if (p?.tool !== 'skill') continue;
    if (p.callID) { if (seen.has(p.callID)) continue; seen.add(p.callID); }
    const st = p.state ?? {};
    const out = typeof st.output === 'string' ? st.output : null;
    calls.push({ tool: 'skill', input: st.input ?? {}, text: out, status: st.status ?? null });
  }
  return calls;
}

function queriesOf(input) {
  return Object.entries(input ?? {}).filter(([k, v]) => !k.startsWith('__') && typeof v === 'string' && v.trim()).map(([, v]) => v.trim());
}

/**
 * What a run loaded, from its event stream. `runtime` is 'kiro-cli' or 'opencode'.
 * A load counts only when the call returned text; errors, empty results and calls with no answer are failures.
 * An empty find_skills result is an answer, counted in findSkillsEmpty, not a failure.
 */
function extractSkills(events, runtime) {
  const oc = runtime === 'opencode';
  const out = { runtime, skillsLoaded: [], skillQueries: [], skillBytesLoaded: 0, skillCallsFailed: 0, findSkillsCalls: 0, findSkillsEmpty: 0, requested: [] };
  const byName = new Map();
  const requested = new Set();
  const load = (rawName, via, bytes) => {
    const key = lower(rawName);
    const cur = byName.get(key);
    if (cur) cur.count++;
    else byName.set(key, { name: rawName, via, count: 1 });
    out.skillBytesLoaded += bytes;
  };
  for (const c of oc ? opencodeCalls(events) : kiroCalls(events)) {
    if (c.tool === 'find_skills') {
      out.findSkillsCalls++;
      out.skillQueries.push(...queriesOf(c.input));
      if (c.output == null || kiroErrored(c)) { out.skillCallsFailed++; continue; }
      const texts = textsOf(c.output);
      let parsed = null;
      try { parsed = JSON.parse(texts[0]); } catch { /* not JSON: any text counts as a result */ }
      if (!texts.length || (Array.isArray(parsed) && parsed.length === 0)) out.findSkillsEmpty++;
      continue;
    }
    const raw = c.input?.name ?? c.input?.skill_name;
    const name = typeof raw === 'string' && raw.trim() ? raw.trim() : null;
    if (name) requested.add(name);
    const texts = oc ? (c.text ? [c.text] : []) : textsOf(c.output);
    const bytes = bytesOfTexts(texts);
    const failed = !name || bytes === 0 || (oc ? c.status === 'error' : c.output == null || kiroErrored(c));
    if (failed) out.skillCallsFailed++;
    else load(name, oc ? 'skill-tool' : 'get_skill', bytes);
  }
  out.skillsLoaded = [...byName.values()];
  out.requested = [...requested];
  return out;
}

// `*` matches any run of characters; everything else is literal.
const has = (list, name) => (list ?? []).some((p) => (p.includes('*')
  ? new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i').test(name)
  : lower(p) === lower(name)));

function argList(agent, flag) {
  for (const server of Object.values(agent?.mcpServers ?? {})) {
    const args = Array.isArray(server?.args) ? server.args : [];
    const i = args.indexOf(flag);
    if (i >= 0 && typeof args[i + 1] === 'string') return args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
  }
  return null;
}

/**
 * Name sets used to classify loads and targets. SOP names come from, in order: a listing of the arm's
 * `agent-sops/`, the installed agent's `--agent-sop-filter`, else the `sop-`, `k-` and `kiro-` naming convention.
 */
function catalogFrom({ sops = null, skills = null, agents = null } = {}, agentJson = null) {
  const fromAgent = argList(agentJson, '--agent-sop-filter');
  const list = sops ?? fromAgent;
  return { sops: list, skills, agents, sopSource: sops ? 'listing' : fromAgent ? 'agent-filter' : 'convention' };
}
const catalogFromListing = (lists) => catalogFrom(lists);
const catalogFromAgentJson = (agent) => catalogFrom({}, agent);

function isSopName(name, cat) {
  if (cat?.skills && has(cat.skills, name)) return false;
  if (lower(name).startsWith('sop-')) return true;
  if (cat?.sops) return has(cat.sops, name);
  return /^(k|kiro)-/i.test(name);
}

// Lists the repo (or an arm's exported source tree): skills/<name>/, agent-sops/<name>.sop.md, agents/<name>.agent-spec.json.
function listCatalogDir(root) {
  const names = (dir, pick) => {
    try { return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).map(pick).filter(Boolean).sort(); } catch { return null; }
  };
  return {
    skills: root ? names('skills', (e) => (e.isDirectory() ? e.name : null)) : null,
    sops: root ? names('agent-sops', (e) => (/\.sop\.md$/.test(e.name) ? e.name.replace(/\.sop\.md$/, '') : null)) : null,
    agents: root ? names('agents', (e) => (/\.agent-spec\.json$/.test(e.name) ? e.name.replace(/\.agent-spec\.json$/, '') : null)) : null,
  };
}

function targetKind(target, cat, cls) {
  if (cat?.sops && has(cat.sops, target)) return 'sop';
  if (cat?.skills && has(cat.skills, target)) return 'skill';
  if (cat?.agents && has(cat.agents, target)) return 'agent';
  return cls === 'sop' ? 'sop' : null;
}

function reachable(kind, target, startup) {
  if (!startup) return null;
  if (startup.runtime === 'opencode') {
    if (!Array.isArray(startup.skillNames)) return null;
    return has(startup.skillNames, target) || (kind === 'sop' && has(startup.skillNames, `sop-${target}`));
  }
  // kiro serves SOPs as MCP prompts the user invokes; get_skill reads the skill index only.
  if (kind === 'sop') return false;
  return startup.skillFilter ? has(startup.skillFilter, target) : true;
}

/** Did the run load the skill or SOP its task targets? Null when the target is not a skill or SOP, or the arm is vanilla. */
function targetOutcome({ extraction, task, arm, catalog, startup = null }) {
  const none = { targetLoaded: null, targetAttempted: null, targetReachable: null };
  if (!task?.target || arm?.vanilla || !extraction) return none;
  const kind = targetKind(task.target, catalog ?? catalogFrom(), task.class);
  if (kind !== 'sop' && kind !== 'skill') return none;
  const t = lower(task.target);
  const match = (n) => lower(n) === t || lower(n) === `sop-${t}`;
  return {
    targetLoaded: extraction.skillsLoaded.some((s) => match(s.name)),
    targetAttempted: (extraction.requested ?? []).some(match),
    targetReachable: reachable(kind, task.target, startup),
  };
}

function normalizeUri(uri) {
  const m = /^file:\/\/(.*)$/.exec(uri);
  if (!m) return uri;
  const home = /^.*\/home\/(\.kiro\/.*)$/.exec(m[1]);
  return home ? `~/${home[1]}` : m[1];
}

const sizeOf = (file) => { try { return fs.statSync(file).size; } catch { return null; } };

function summarizeStartup(base, resources) {
  const known = resources.filter((r) => r.bytes != null);
  return {
    ...base, resources, count: resources.length, totalBytes: known.reduce((n, r) => n + r.bytes, 0), unknownSizes: resources.length - known.length,
    approxSizes: resources.filter((r) => r.sizeSource === 'context-dir').length,
  };
}

/**
 * What a kiro agent loads at spawn without a tool call, read from its installed agent JSON: the prompt and each
 * `resources` entry. A rule file missing at its recorded path is sized from `contextDirs` by file name
 * (`sizeSource: 'context-dir'`, exact only if that directory is the arm's own).
 * `skillFilter` and `sopPromptFilter` are the skills-server name filters (what get_skill can serve, and the SOPs
 * it offers as prompts).
 */
function startupKiro(agent, { contextDirs = [] } = {}) {
  const resources = [];
  if (typeof agent?.prompt === 'string') resources.push({ kind: 'prompt', uri: 'prompt', bytes: Buffer.byteLength(agent.prompt) });
  for (const r of agent?.resources ?? []) {
    if (typeof r !== 'string') continue;
    if (r.startsWith('skill://')) { resources.push({ kind: 'skill-glob', uri: r, bytes: null }); continue; }
    if (!r.startsWith('file://')) { resources.push({ kind: 'other', uri: r, bytes: null }); continue; }
    const p = r.slice('file://'.length);
    let bytes = null;
    let sizeSource = null;
    if (path.isAbsolute(p)) {
      bytes = sizeOf(p);
      if (bytes != null) sizeSource = 'file';
      for (const d of contextDirs) {
        if (bytes == null) { bytes = sizeOf(path.join(d, path.basename(p))); if (bytes != null) sizeSource = 'context-dir'; }
      }
    }
    resources.push({ kind: 'file', uri: normalizeUri(r), bytes, ...(sizeSource ? { sizeSource } : {}) });
  }
  return summarizeStartup({
    runtime: 'kiro-cli', builtin: false, source: 'installed agent JSON',
    skillFilter: argList(agent, '--skill-name-filter'), sopPromptFilter: argList(agent, '--agent-sop-filter'),
    note: 'AGENTS.md and skill globs resolve against the run cwd, so their size is not recorded',
  }, resources);
}

const frontmatter = (text) => /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
const fmValue = (fm, key) => new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(fm)?.[1].trim() ?? '';

/**
 * opencode loads the primary agent file and a skill index (name and description of every skill) at spawn.
 * `cfgDir` is the translated config directory (agents/ and skills/ inside).
 */
function startupOpencode(cfgDir) {
  const resources = [];
  const agentsDir = path.join(cfgDir, 'agents');
  let primary = null;
  try {
    const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
    primary = files.find((f) => /^mode:\s*primary\s*$/m.test(frontmatter(fs.readFileSync(path.join(agentsDir, f), 'utf8')))) ?? files.find((f) => f === 'konductor.md') ?? null;
  } catch { /* no agents */ }
  if (primary) resources.push({ kind: 'agent-prompt', uri: `agents/${primary}`, bytes: sizeOf(path.join(agentsDir, primary)) });
  const skillNames = [];
  let indexBytes = 0;
  try {
    for (const d of fs.readdirSync(path.join(cfgDir, 'skills'), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const fm = frontmatter(fs.readFileSync(path.join(cfgDir, 'skills', d.name, 'SKILL.md'), 'utf8'));
      const name = fmValue(fm, 'name') || d.name;
      skillNames.push(name);
      indexBytes += Buffer.byteLength(name) + Buffer.byteLength(fmValue(fm, 'description'));
    }
  } catch { /* no skills */ }
  if (skillNames.length) resources.push({ kind: 'skill-index', uri: 'skills/*/SKILL.md (name and description only)', bytes: indexBytes, count: skillNames.length });
  return summarizeStartup({ runtime: 'opencode', builtin: false, source: 'translated opencode config', skillNames: skillNames.sort() }, resources);
}

function builtinStartup(runtime) {
  return {
    runtime, builtin: true, source: 'built-in agent', resources: [], count: null, totalBytes: null, unknownSizes: null,
    note: 'best effort: the built-in agent prompt and tools are not visible in the run artifacts, so no sizes are recorded',
  };
}

const safe = (fn) => { try { return fn(); } catch { return null; } };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// Per-arm facts read once from a trial install: where the agent definition is, and what the arm's source tree lists.
function kiroSkillInfo(home, exportDir) {
  return safe(() => {
    const agent = readJson(path.join(home, '.kiro/agents/konductor.json'));
    return {
      catalog: catalogFrom(listCatalogDir(exportDir), agent),
      startup: startupKiro(agent, { contextDirs: [path.join(home, '.kiro/context'), ...(exportDir ? [path.join(exportDir, 'context')] : [])] }),
    };
  });
}

function opencodeSkillInfo(cfgDir, exportDir) {
  return safe(() => ({ catalog: catalogFrom(listCatalogDir(exportDir)), startup: startupOpencode(cfgDir) }));
}

/** Called by a harness after the stream is parsed. Never throws: tracking must not affect a run. */
function captureSkills({ runtime, events, arm, ctx }) {
  return safe(() => ({ extraction: extractSkills(events, runtime), info: arm?.vanilla ? null : ctx?.skillInfo?.get(arm?.id) ?? null }));
}

/** The result.json fields. All null when nothing was captured. */
function resultFields({ extraction, info, task, arm }) {
  if (!extraction) return Object.fromEntries(SKILL_FIELDS.map((k) => [k, null]));
  const catalog = info?.catalog ?? catalogFrom();
  const startup = arm?.vanilla ? null : info?.startup ?? null;
  return {
    skillsLoaded: extraction.skillsLoaded.map((s) => ({ ...s })),
    skillQueries: [...extraction.skillQueries],
    sopsLoaded: extraction.skillsLoaded.filter((s) => isSopName(s.name, catalog)).map((s) => ({ ...s })),
    skillBytesLoaded: extraction.skillBytesLoaded,
    skillCallsFailed: extraction.skillCallsFailed,
    findSkillsCalls: extraction.findSkillsCalls,
    findSkillsEmpty: extraction.findSkillsEmpty,
    startupResourceCount: startup?.count ?? null,
    ...targetOutcome({ extraction, task, arm, catalog, startup }),
    sopNameSource: catalog.sopSource,
    skillsScope: extraction.runtime === 'opencode' ? 'parent-session' : 'all-sessions',
  };
}

module.exports = {
  SKILL_FIELDS, extractSkills, catalogFrom, catalogFromListing, catalogFromAgentJson, isSopName, listCatalogDir, targetOutcome,
  startupKiro, startupOpencode, builtinStartup, kiroSkillInfo, opencodeSkillInfo, captureSkills, resultFields, normalizeUri, has,
};
