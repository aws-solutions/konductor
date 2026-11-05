// SPDX-License-Identifier: Apache-2.0
'use strict';

// Scores the constraints probe runs from their stream.jsonl (primary) and session files (secondary), then tabulates
// cells with Wilson intervals and evaluates the decision table of bench/CONSTRAINTS-PROBE.md with thresholds fixed
// before any data. Reads files only: no model, no network, no writes except --out.

const fs = require('node:fs');
const path = require('node:path');
const { kiroTimeline } = require('../runner/lib/trace.js');
const { loadScoring, checksScore } = require('./scores.js');
const { wilson, fisherGreater, fmtInterval } = require('./probes-stats.js');

const BENCH = path.resolve(__dirname, '..');
const MANIFEST_FILE = path.join(BENCH, 'suites', 'constraints-probe.manifest.json');

// Pre-registered before any data. A change needs a new study, not a re-read of the old one.
const THRESHOLDS = Object.freeze({
  beatDiff: 0.4, // forced minus as-is applied-rate, pooled over positions and agents
  beatP: 0.10, // one-sided Fisher exact, forced greater than as-is
  minUsablePerSide: 8,
  equalDiff: 0.2, // |difference| below this is "approximately equal"
  canaryAnyMin: 1, // K-canary runs that show the token
  canaryForcedShare: 0.6, // share of K-canary-forced runs that show it (positive control)
  canaryControlMinRuns: 5, // added guard: fewer usable control runs than this cannot pass the control
  forcedTookMin: 0.5, // added guard: share of forced runs that loaded the skill, below which forced-vs-as-is is not interpretable
});

const PROBES = ['U1', 'U2', 'U3'];
const POSITIONS = ['entry', 'delegated', 'orchestrator-direct'];
const WRITE_TOOLS = new Set(['fs_write', 'str_replace', 'fs_append', 'Write', 'Edit', 'MultiEdit']);
const OVERHEAD_TOOLS = new Set(['subagent', 'summary']);

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const readJsonl = (f) => {
  const text = readText(f);
  if (text == null) return null;
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  return out;
};
const loadManifest = (file = MANIFEST_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

// ---- text helpers ----

const normText = (s) => String(s ?? '').replace(/\\[nrt]/g, ' ').replace(/\\u2192|\\u21d2/gi, '\u2192').replace(/\s+/g, ' ').replace(/->|\u2192|\u21d2/g, '\u2192').toLowerCase();

function stringsOf(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsOf(v, out));
  else if (typeof value === 'object') Object.values(value).forEach((v) => stringsOf(v, out));
  return out;
}

const ARROW = /->|\u2192|\u21d2|=>/g;

/** A root-cause chain: "root cause" and a run of at least two arrows (cause, intermediate effects, symptom) within 500 characters. */
function rootCauseChain(text) {
  const t = String(text ?? '');
  const hasRootCause = /root[- ]cause/i.test(t);
  let chain = false;
  const arrows = [...t.matchAll(ARROW)].map((m) => m.index);
  for (let i = 0; i + 1 < arrows.length && !chain; i++) if (arrows[i + 1] - arrows[i] <= 250) chain = arrows.slice(i).filter((a) => a - arrows[i] <= 500).length >= 2;
  const parts = {
    cause: /\bcause\b|\bbecause\b|\broot\b/i.test(t),
    effects: /intermediate|effect|\bthen\b|leads? to|results? in|so the|which (means|makes|causes)/i.test(t),
    symptom: /symptom|observed|failing|fails|failure|error|saw|sees/i.test(t),
  };
  return { chain: hasRootCause && chain, hasRootCause, arrows: arrows.length, parts };
}

const RANK = { CRITICAL: 0, IMPORTANT: 1, SUGGESTION: 2 };
const SEV_UPPER = /\b(CRITICAL|IMPORTANT|SUGGESTION)\b/g;
const SEV_POSITIONAL = [
  /^[\s>#*\-+|\d.)[(]*\**(critical|important|suggestions?)\b\**\s*[\]):.|\-]/gim,
  /\b(?:severity|priority|rating|level)\s*[:=]\s*[*[(]*(critical|important|suggestions?)\b/gi,
  /\|\s*\**(critical|important|suggestions?)\**\s*\|/gi,
];
const OTHER_SCALE = /\b(high|medium|low|major|minor|blocker|nit)\b\s*[\])|:.-]|severity\s*[:=]\s*\**(high|medium|low|major|minor|moderate)\b/gi;

/** Ordered severity labels from CRITICAL / IMPORTANT / SUGGESTION in a text: uppercase anywhere, any case in a label position. */
function severityLabels(text) {
  const t = String(text ?? '');
  const hits = new Map();
  for (const m of t.matchAll(SEV_UPPER)) hits.set(m.index, m[1]);
  for (const re of SEV_POSITIONAL) {
    for (const m of t.matchAll(re)) {
      const word = m[1].toUpperCase().replace(/^SUGGESTIONS$/, 'SUGGESTION');
      const at = m.index + m[0].toLowerCase().lastIndexOf(m[1].toLowerCase());
      if (![...hits.keys()].some((k) => Math.abs(k - at) < 3)) hits.set(at, word);
    }
  }
  const labels = [...hits.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);
  const ranks = labels.map((l) => RANK[l]);
  const ordered = ranks.every((r, i) => i === 0 || r >= ranks[i - 1]);
  const distinct = new Set(labels);
  return { labels, distinct: distinct.size, all3: distinct.size === 3, ordered, otherScale: (t.match(OTHER_SCALE) || []).length };
}

const SELF_REVIEW = /\b(self[- ]?review|checker pass|checker skill|checklist|quality (check|criteria|gate)|(review|check|verify|validate|re-?read)(ing|ed)? (the|my|this|it|that)\b[^.\n]{0,40}\b(draft|plan|report|brief|artifact|document|output|against)|let me (double[- ]?check|verify|re-?check|validate)|review(ing)? (it|this|the \w+) against|validat(e|ed|ing) against)\b/i;

// ---- skill lookups ----

const isSchemaLoad = (e) => e.kind === 'tool' && /^tool::konductor-skills::(get_skill|find_skills)$/.test(String(e.input?.id ?? ''));
const isLoadResource = (e) => e.kind === 'tool' && (e.tool === 'load_resource' || e.tool === 'Load Resource') && typeof e.input?.id === 'string';
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function lookupFailed(l) {
  if (l.failedRaw) return true;
  const r = String(l.result ?? '');
  const j = tryJson(r.trim());
  if (l.tool === 'load_resource') {
    if (j && Array.isArray(j.not_found) && j.not_found.length) return true;
    if (j && Array.isArray(j.loaded) && j.loaded.length === 0) return true;
    return /\b(not found|error|refused|cannot|invalid)\b/i.test(r.slice(0, 300)) && !(j && Array.isArray(j.loaded) && j.loaded.length);
  }
  if (l.tool === 'get_skill') return !/"content"|^---|\bname:/.test(r);
  if (l.tool === 'find_skills') return /\b(error|unknown tool|not available|invalid)\b/i.test(r.slice(0, 200)) && !/"(skills|results|matches)"/.test(r);
  return false;
}

/** Skill lookups in a timeline, in all three forms the stream shows: the skills server, load_resource(skill::*), and a read of SKILL.md. */
function skillLookups(entries) {
  const schemaSeen = new Set();
  const anySchema = entries.some(isSchemaLoad);
  const out = [];
  for (const e of entries) {
    if (isSchemaLoad(e)) { schemaSeen.add(e.agent); continue; }
    let l = null;
    if (e.kind === 'skill-load' || e.kind === 'skill-find') {
      const name = e.input?.name ?? e.input?.skill ?? null;
      l = { form: 'skills-server', tool: e.kind === 'skill-find' ? 'find_skills' : 'get_skill', name: typeof name === 'string' ? name : null, deferred: Boolean(e.deferred) };
    } else if (isLoadResource(e)) {
      const m = /^skill::([^:\s]+)$/.exec(e.input.id);
      if (m) l = { form: 'load_resource', tool: 'load_resource', name: m[1], deferred: false };
    } else if (e.kind === 'tool' && /^(read_file|Read)$/.test(String(e.tool)) && /(?:^|\/)([^/]+)\/SKILL\.md$/.test(String(e.input?.path ?? e.input?.file_path ?? ''))) {
      l = { form: 'read-skill-md', tool: 'read_file', name: /(?:^|\/)([^/]+)\/SKILL\.md$/.exec(e.input.path ?? e.input.file_path)[1], deferred: false };
    }
    if (!l) continue;
    l = { ...l, n: e.n, agent: e.agent, failedRaw: Boolean(e.failed), result: e.result ?? '', beforeSchema: anySchema && !schemaSeen.has(e.agent) };
    l.failed = lookupFailed(l);
    l.deferralFailure = l.failed && l.tool !== 'load_resource' && l.form === 'skills-server' && (l.deferred || l.beforeSchema);
    l.constraints = l.name?.toLowerCase() === 'constraints';
    l.returnsConstraints = l.tool === 'find_skills' && /\bconstraints\b/i.test(l.result);
    out.push(l);
  }
  return out;
}

// ---- sessions ----

function readSessions(runDir) {
  const root = path.join(runDir, 'session');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const d of fs.readdirSync(root).filter((n) => n.startsWith('sess_'))) {
    const msgs = readJsonl(path.join(root, d, 'messages.jsonl')) || [];
    const start = msgs.find((m) => m.payload?.type === 'session_start')?.payload;
    const results = msgs.filter((m) => m.payload?.type === 'tool_result').map((m) => stringsOf(m.payload.content).join('\n'));
    out.push({ id: d, agentType: start?.agentType ?? null, startContent: typeof start?.content === 'string' ? start.content : '', toolResults: results, toolCalls: msgs.filter((m) => m.payload?.type === 'tool_call').length });
  }
  return out;
}

// ---- errno ----

const ERRNO = /function not implemented|\berror 38\b|errno[ :=]*38\b|\bENOSYS\b/i;

function errnoHits({ runDir, events, result }) {
  const hits = [];
  const check = (source, text) => { const m = ERRNO.exec(String(text ?? '')); if (m) hits.push({ source, match: m[0] }); };
  check('stderr.txt', readText(path.join(runDir, 'stderr.txt')));
  check('result.error', result?.error);
  check('result.infraError', typeof result?.infraError === 'string' ? result.infraError : JSON.stringify(result?.infraError ?? ''));
  for (const ev of events) {
    const u = ev.data?.update;
    if (u && (u.sessionUpdate === 'tool_call_update' || u.sessionUpdate === 'tool_call')) check('tool result', stringsOf([u.rawOutput, u.content]).join('\n'));
  }
  return hits.slice(0, 5);
}

// ---- one run ----

function runDirsUnder(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 7) return;
    if (fs.existsSync(path.join(dir, 'result.json'))) { out.push(dir); return; }
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) if (e.isDirectory() && !['workspace', 'session', 'node_modules', '.git'].includes(e.name)) walk(path.join(dir, e.name), depth + 1);
  };
  walk(path.resolve(root), 0);
  return out.sort();
}

function groupConfigOf(runDir) {
  let dir = path.dirname(runDir);
  for (let i = 0; i < 5; i++) {
    const f = path.join(dir, 'run-config.json');
    if (fs.existsSync(f)) return readJson(f);
    dir = path.dirname(dir);
  }
  return null;
}

const isOrchestrator = (agent) => /^konductor/.test(String(agent ?? 'konductor'));
const clip = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
const pathOf = (input) => input?.path ?? input?.file_path ?? null;
const endsWithPath = (p, rel) => typeof p === 'string' && (p === rel || p.endsWith(`/${rel}`));

function resolveActor({ entries, owner, entryAgent }) {
  const delegates = entries.filter((e) => e.kind === 'delegate');
  const targets = delegates.map((d) => d.target);
  const orch = isOrchestrator(entryAgent);
  const work = {};
  for (const e of entries) if (e.kind === 'tool' && !OVERHEAD_TOOLS.has(e.tool)) work[e.agent] = (work[e.agent] || 0) + 1;
  const delegatedToOwner = owner ? targets.includes(owner) : targets.length > 0;
  let position = 'entry';
  let actor = 'root';
  if (orch) {
    position = delegatedToOwner ? 'delegated' : 'orchestrator-direct';
    if (owner && delegatedToOwner) actor = owner;
  }
  return { position, actor, delegated: orch && delegatedToOwner, delegations: targets, toolCallsByAgent: work, delegatedToOwner };
}

function textsOf(entries, actor, owner) {
  const mine = entries.filter((e) => e.agent === actor);
  const assistant = mine.filter((e) => e.kind === 'assistant');
  const returned = entries.filter((e) => e.kind === 'delegate-return' && (!owner || e.target === owner)).map((e) => e.text);
  const root = entries.filter((e) => e.kind === 'final').map((e) => e.text).pop() ?? '';
  const lastAssistant = assistant.length ? assistant[assistant.length - 1].text : '';
  return { mine, assistant, returned, root, final: actor === 'root' ? root : (returned.length ? returned[returned.length - 1] : lastAssistant), lastAssistantIdx: mine.lastIndexOf(assistant[assistant.length - 1]) };
}

function scoreU3({ mine, spec, texts, runDir }) {
  const testCmd = /\b(node\s+--test|npm\s+(run\s+)?test|npx\s+\S*test|yarn test|pnpm test|pytest|mocha|jest)\b/;
  const shellWrite = /(sed\s+-i|perl\s+-p?i|\btee\b|>>?\s*(?!\/dev\/null|&)[^\s&|]+|writeFileSync|cat\s*<<)/;
  const isSource = (p) => typeof p === 'string' && !/(^|\/)(test|tests|__tests__)\//.test(p) && !/\.(md|txt)$/i.test(p);
  let sinceRun = 0;
  let failedAttempts = 0;
  let second = null;
  const edits = [];
  const runs = [];
  mine.forEach((e, i) => {
    if (e.kind !== 'tool') return;
    if (WRITE_TOOLS.has(e.tool) && isSource(pathOf(e.input))) { edits.push({ i, kind: 'tool', path: pathOf(e.input) }); sinceRun++; return; }
    if (e.tool === 'execute_bash') {
      const cmd = String(e.input?.command ?? '');
      if (testCmd.test(cmd)) {
        const m = [...String(e.result ?? '').matchAll(/Exit Code:\s*(\d+)/g)].pop();
        const code = m ? Number(m[1]) : (e.failed ? 1 : null);
        const failing = code !== null && code !== 0;
        runs.push({ i, code });
        if (failing && sinceRun > 0) { failedAttempts++; if (failedAttempts === 2) second = i; }
        sinceRun = 0;
      } else if (shellWrite.test(cmd) && /(^|[\s"'/])src\//.test(cmd)) { edits.push({ i, kind: 'shell', path: null }); sinceRun++; }
    }
  });
  const after = second === null ? [] : edits.filter((x) => x.i > second);
  const targetAfter = after.filter((x) => endsWithPath(x.path, spec.targetFile));
  const notes = readText(path.join(runDir, 'workspace', spec.artifact));
  const finalChain = rootCauseChain(texts.final);
  const rootChain = rootCauseChain(texts.root);
  const noteChain = rootCauseChain(notes);
  const chainWhere = finalChain.chain ? 'final' : rootChain.chain ? 'root-final' : noteChain.chain ? spec.artifact : null;
  let lenient = false;
  if (second !== null) {
    const nextEdit = after.length ? after[0].i : Infinity;
    lenient = mine.some((e, i) => e.kind === 'assistant' && i > second && i < nextEdit && rootCauseChain(e.text).chain);
  }
  const reached2 = second !== null;
  const stopped = reached2 && after.length === 0;
  return {
    triggered: reached2, usable: reached2, failedAttempts, editsTotal: edits.length, editsAfter2: after.length, targetEditsAfter2: targetAfter.length,
    shellEditsAfter2: after.filter((x) => x.kind === 'shell').length, stoppedBeforeThird: stopped, chain: Boolean(chainWhere), chainWhere,
    chainBeforeNextEdit: lenient, testRuns: runs.length, finalTestsPassed: runs.length ? runs[runs.length - 1].code === 0 : null,
    applied: reached2 && stopped && Boolean(chainWhere), appliedLenient: reached2 && lenient,
  };
}

function scoreU2({ spec, texts, runDir }) {
  const artifact = readText(path.join(runDir, 'workspace', spec.artifact));
  const sources = [['artifact', artifact], ['final', texts.final], ['root-final', texts.root]];
  let chosen = { source: null, labels: [], distinct: 0, all3: false, ordered: false, otherScale: 0 };
  for (const [source, text] of sources) {
    if (!text) continue;
    const s = severityLabels(text);
    if (s.labels.length) { chosen = { source, ...s }; break; }
    if (!chosen.source) chosen = { source, ...s };
  }
  const present = chosen.distinct >= 2;
  return { usable: true, labelSource: chosen.source, labelCount: chosen.labels.length, distinctLabels: chosen.distinct, all3: chosen.all3, ordered: chosen.ordered, otherScale: chosen.otherScale, applied: present && chosen.ordered };
}

function scoreU1({ mine, spec, texts, lookups, actor }) {
  const artifactTool = (e) => e.kind === 'tool' && WRITE_TOOLS.has(e.tool) && endsWithPath(pathOf(e.input), spec.artifact);
  const artifactShell = (e) => e.kind === 'tool' && e.tool === 'execute_bash' && String(e.input?.command ?? '').includes(spec.artifact) && />|tee/.test(String(e.input?.command ?? ''));
  const draftAt = mine.findIndex((e) => artifactTool(e) || artifactShell(e));
  const lastText = texts.lastAssistantIdx;
  const names = new Set([spec.pairing.primary, ...spec.pairing.alternatives]);
  const mineN = new Set(mine.map((e) => e.n));
  const mineLookups = lookups.filter((l) => mineN.has(l.n) && !l.failed && names.has(String(l.name)));
  const indexOfN = (n) => mine.findIndex((e) => e.n === n);
  const after = mineLookups.filter((l) => draftAt < 0 || indexOfN(l.n) > draftAt);
  const before = mineLookups.filter((l) => draftAt >= 0 && indexOfN(l.n) < draftAt);
  const strong = after.some((l) => l.name === spec.pairing.primary);
  const strongAlt = !strong && after.length > 0;
  const textual = mine.some((e, i) => e.kind === 'assistant' && (draftAt < 0 || i > draftAt) && i < Math.max(lastText, 0) && SELF_REVIEW.test(e.text));
  const level = strong || strongAlt ? 'skill' : textual ? 'text' : 'none';
  return {
    usable: draftAt >= 0 || texts.final.length > 0, draftWritten: draftAt >= 0, level, strongPrimary: strong, strongAlternative: strongAlt, makerOnly: level === 'none' && before.length > 0,
    inferredOnly: level === 'text', applied: level !== 'none', appliedSkillOnly: level === 'skill', actor,
  };
}

function scoreCanary({ entries, texts, sessions, token }) {
  const shaped = /kd-canary-[0-9a-f]{8}/g;
  const finalText = texts.root;
  const assistantAll = entries.filter((e) => e.kind === 'assistant').map((e) => e.text).join('\n');
  const toolText = entries.filter((e) => e.kind === 'tool' || e.kind === 'skill-load' || e.kind === 'skill-find').map((e) => e.result ?? '').join('\n');
  const promptText = sessions.map((s) => s.startContent).join('\n');
  const found = (text) => (token ? text.includes(token) : shaped.test(text));
  const wrong = token ? [...assistantAll.matchAll(shaped)].some((m) => m[0] !== token) : false;
  return {
    usable: true, tokenKnown: Boolean(token), inFinal: found(finalText), inAssistant: found(assistantAll), inToolResult: found(toolText), inPrompt: found(promptText), wrongToken: wrong,
    applied: found(finalText),
  };
}

/** Everything the report needs from one run directory. Never throws on a thin or partial run: it records what is missing. */
function scoreRun(runDir, ctx) {
  const { manifest, token = null, weights = null } = ctx;
  const result = readJson(path.join(runDir, 'result.json')) || {};
  const events = readJsonl(path.join(runDir, 'stream.jsonl'));
  const config = groupConfigOf(runDir);
  const armId = result.armId ?? path.basename(path.dirname(path.dirname(runDir)));
  const taskId = result.taskId ?? path.basename(path.dirname(runDir));
  const spec = manifest.tasks[taskId];
  const entryAgent = result.agent ?? config?.armAgent?.[armId] ?? 'konductor';
  const sessions = readSessions(runDir);
  const row = {
    dir: runDir, arm: armId, task: taskId, rep: result.replicate ?? Number(path.basename(runDir)), entryAgent, probe: spec?.probe ?? null, owner: spec?.owner ?? null,
    status: result.status ?? null, credits: result.creditsCharged ?? result.credits ?? null, creditsCensored: Boolean(result.creditsCensored), wallMs: result.wallClockMs ?? null,
    flags: result.flags ?? [], checksQuality: weights ? (() => { const s = checksScore(result.checks, weights); return s == null ? null : s * 100; })() : null,
    streamMissing: events == null, sessions: sessions.length, problems: [],
  };
  if (!spec) { row.problems.push('task is not in the manifest'); row.usable = false; return row; }
  if (events == null) { row.problems.push('no stream.jsonl'); row.usable = false; return row; }

  const entries = kiroTimeline(events);
  const hits = errnoHits({ runDir, events, result });
  row.sandboxErrno = hits.length > 0;
  row.errnoHits = hits;
  const pos = resolveActor({ entries, owner: spec.owner, entryAgent });
  Object.assign(row, { position: pos.position, delegated: pos.delegated, delegations: pos.delegations, actor: pos.actor === 'root' ? entryAgent : pos.actor });
  const ownerSession = spec.owner ? sessions.some((s) => s.agentType === spec.owner) : null;
  if (isOrchestrator(entryAgent) && spec.owner && sessions.length && ownerSession !== pos.delegatedToOwner) row.problems.push(`attribution mismatch: stream says delegated=${pos.delegatedToOwner}, sessions say an ${spec.owner} session ${ownerSession ? 'exists' : 'does not exist'}`);
  const texts = textsOf(entries, pos.actor, spec.owner);
  const lookups = skillLookups(entries);

  const fingerprints = {};
  const assistantNorm = normText(entries.filter((e) => e.kind === 'assistant').map((e) => e.text).join('\n'));
  const promptNorm = normText(sessions.map((s) => s.startContent).join('\n'));
  const toolNorm = normText(events.filter((ev) => ev.data?.update?.sessionUpdate === 'tool_call_update').map((ev) => stringsOf([ev.data.update.rawOutput, ev.data.update.content]).join(' ')).join('\n'));
  for (const r of manifest.rules) {
    const f = normText(r.fingerprint);
    fingerprints[r.id] = { prompt: promptNorm.includes(f), toolResult: toolNorm.includes(f), assistant: assistantNorm.includes(f) };
  }
  const constraintsLoaded = lookups.some((l) => l.constraints && !l.failed && l.tool !== 'find_skills');
  row.skills = {
    lookups: lookups.length, getSkill: lookups.filter((l) => l.tool === 'get_skill').length, findSkills: lookups.filter((l) => l.tool === 'find_skills').length,
    loadResourceSkill: lookups.filter((l) => l.tool === 'load_resource').length, readSkillMd: lookups.filter((l) => l.form === 'read-skill-md').length,
    constraintsNamed: lookups.filter((l) => l.constraints).length, constraintsLoaded, constraintsListed: lookups.some((l) => l.returnsConstraints),
    failed: lookups.filter((l) => l.failed).length, deferralFailures: lookups.filter((l) => l.deferralFailure).length,
    resourceSkillFailed: lookups.filter((l) => l.tool === 'load_resource' && l.failed).length, names: [...new Set(lookups.map((l) => l.name).filter(Boolean))],
  };
  row.fingerprints = fingerprints;

  let probeScore = {};
  const mineEntries = texts.mine;
  if (spec.probe === 'U3') probeScore = scoreU3({ mine: mineEntries, spec, texts, runDir });
  else if (spec.probe === 'U2') probeScore = scoreU2({ spec, texts, runDir });
  else if (spec.probe === 'U1') probeScore = scoreU1({ mine: mineEntries, spec, texts, lookups, actor: pos.actor });
  else if (spec.probe === 'canary') probeScore = scoreCanary({ entries, texts, sessions, token });
  row.score = probeScore;
  row.applied = Boolean(probeScore.applied);
  const finished = result.status === 'success' || texts.root.length > 0;
  row.usable = Boolean(probeScore.usable) && finished && !row.sandboxErrno;
  if (!finished) row.problems.push('run did not finish');
  row.excludedReason = row.sandboxErrno ? 'sandboxErrno' : !finished ? 'unfinished' : spec.probe === 'U3' && !probeScore.triggered ? 'not-triggered' : !probeScore.usable ? 'unscorable' : null;
  return row;
}

// ---- aggregation ----

function loadRows(runRoots, ctx) {
  const rows = [];
  for (const root of runRoots) for (const dir of runDirsUnder(root)) rows.push(scoreRun(dir, ctx));
  return rows;
}

const count = (rows) => ({ applied: rows.filter((r) => r.applied).length, total: rows.length });

/** Cells of arm x position x probe over usable runs. */
function cells(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.probe || r.probe === 'canary') continue;
    const key = `${r.probe}\u0000${r.arm}\u0000${r.position}`;
    if (!map.has(key)) map.set(key, { probe: r.probe, arm: r.arm, position: r.position, usable: [], excluded: [] });
    (r.usable ? map.get(key).usable : map.get(key).excluded).push(r);
  }
  return [...map.values()].map((c) => ({ probe: c.probe, arm: c.arm, position: c.position, ...count(c.usable), excluded: c.excluded.length })).sort((a, b) => a.probe.localeCompare(b.probe) || a.arm.localeCompare(b.arm) || POSITIONS.indexOf(a.position) - POSITIONS.indexOf(b.position));
}

const pool = (rows, probe, role) => {
  const use = rows.filter((r) => r.probe === probe && r.arm === role && r.usable);
  return count(use);
};

const verdictAnd = (...vs) => (vs.includes('not supported') ? 'not supported' : vs.includes('inconclusive') ? 'inconclusive' : 'supported');

/** Compare two arms on one probe: forced beats as-is, and approximate equality. */
function compareArms(rows, probe, base, other, T = THRESHOLDS) {
  const a = pool(rows, probe, base);
  const b = pool(rows, probe, other);
  const enough = a.total >= T.minUsablePerSide && b.total >= T.minUsablePerSide;
  const ra = a.total ? a.applied / a.total : null;
  const rb = b.total ? b.applied / b.total : null;
  const diff = ra !== null && rb !== null ? rb - ra : null;
  const p = a.total && b.total ? fisherGreater(b.applied, b.total, a.applied, a.total) : null;
  const beats = !enough ? 'inconclusive' : diff >= T.beatDiff && p < T.beatP ? 'supported' : 'not supported';
  const equal = !enough ? 'inconclusive' : Math.abs(diff) < T.equalDiff ? 'supported' : 'not supported';
  return { probe, base: { arm: base, ...a }, other: { arm: other, ...b }, diff, p, beats, equal, enough };
}

function canaryEvidence(rows, T = THRESHOLDS) {
  const as = rows.filter((r) => r.probe === 'canary' && r.arm === 'k-canary' && r.usable);
  const fo = rows.filter((r) => r.probe === 'canary' && r.arm === 'k-canary-forced' && r.usable);
  const asShown = as.filter((r) => r.applied).length;
  const foShown = fo.filter((r) => r.applied).length;
  const controlEnough = fo.length >= T.canaryControlMinRuns;
  const controlPasses = controlEnough && foShown / fo.length >= T.canaryForcedShare;
  const tokenKnown = [...as, ...fo].every((r) => r.score?.tokenKnown !== false);
  const delivered = as.filter((r) => r.score?.inToolResult || r.score?.inPrompt).length;
  let shows = 'inconclusive';
  let never = 'inconclusive';
  if (controlPasses && as.length) { shows = asShown >= T.canaryAnyMin ? 'supported' : 'not supported'; never = asShown === 0 ? 'supported' : 'not supported'; }
  return { asIs: { shown: asShown, total: as.length, delivered }, forced: { shown: foShown, total: fo.length }, controlPasses, controlEnough, shows, never, tokenKnown };
}

function forcedTook(rows, T = THRESHOLDS) {
  const use = rows.filter((r) => r.arm === 'k-main-forced' && r.usable && r.probe && r.probe !== 'canary');
  const loaded = use.filter((r) => r.skills?.constraintsLoaded).length;
  return { loaded, total: use.length, took: use.length > 0 && loaded / use.length >= T.forcedTookMin };
}

const rateText = (c) => `${c.applied}/${c.total}`;

/** The four rows of the decision table, each with a verdict and the counts behind it. */
function decide(rows, T = THRESHOLDS) {
  const byProbe = Object.fromEntries(PROBES.map((p) => [p, compareArms(rows, p, 'k-main', 'k-main-forced', T)]));
  const noneProbe = Object.fromEntries(PROBES.map((p) => [p, compareArms(rows, p, 'k-main', 'k-none', T)]));
  const canary = canaryEvidence(rows, T);
  const took = forcedTook(rows, T);
  const gate = (v) => (took.took ? v : 'inconclusive');
  const line = (c) => `${c.probe}: as-is ${rateText(c.base)}, forced ${rateText(c.other)}, difference ${c.diff === null ? 'n/a' : (c.diff * 100).toFixed(0) + ' points'}, Fisher one-sided p ${c.p === null ? 'n/a' : c.p.toFixed(3)}`;
  const canaryLine = `K-canary showed the token in ${canary.asIs.shown}/${canary.asIs.total} usable runs; K-canary-forced in ${canary.forced.shown}/${canary.forced.total} (control ${canary.controlPasses ? 'passes' : canary.controlEnough ? 'fails' : 'has too few runs'}; needs ${Math.round(T.canaryForcedShare * 100)}% and at least ${T.canaryControlMinRuns} runs)`;
  const tookLine = `forced runs that loaded constraints: ${took.loaded}/${took.total} (needs ${Math.round(T.forcedTookMin * 100)}%)`;

  const rowA = {
    id: 'A', condition: 'K-canary never shows the token, and K-main is approximately equal to the no-skills arm (k-none) on U1 to U3',
    meaning: 'Not delivered, and the model does not apply the rules on its own', action: 'Fix delivery (preload through resources, or move the unique rules into always-loaded context), then re-run as level 6',
    verdict: verdictAnd(canary.never, ...PROBES.map((p) => noneProbe[p].equal)),
    counts: [canaryLine, ...PROBES.map((p) => `${noneProbe[p].probe}, k-main vs k-none: ${rateText(noneProbe[p].base)} vs ${rateText(noneProbe[p].other)}, difference ${noneProbe[p].diff === null ? 'n/a' : (noneProbe[p].diff * 100).toFixed(0) + ' points'}`)],
  };
  const rowB = {
    id: 'B', condition: 'K-main-forced clearly beats K-main on a probe', meaning: 'The rule matters when delivered', action: 'Fix delivery for that rule',
    perProbe: Object.fromEntries(PROBES.map((p) => [p, gate(byProbe[p].beats)])),
    verdict: PROBES.some((p) => gate(byProbe[p].beats) === 'supported') ? 'supported' : PROBES.every((p) => gate(byProbe[p].beats) === 'not supported') ? 'not supported' : 'inconclusive',
    counts: [...PROBES.map((p) => line(byProbe[p])), tookLine],
  };
  const rowC = {
    id: 'C', condition: 'K-main-forced is approximately equal to K-main on a probe', meaning: 'The rule has no measurable effect, or the model does it anyway', action: 'Consider trimming the rule rather than moving it',
    perProbe: Object.fromEntries(PROBES.map((p) => [p, gate(byProbe[p].equal)])),
    verdict: PROBES.some((p) => gate(byProbe[p].equal) === 'supported') ? 'supported' : PROBES.every((p) => gate(byProbe[p].equal) === 'not supported') ? 'not supported' : 'inconclusive',
    counts: [...PROBES.map((p) => line(byProbe[p])), tookLine],
  };
  const rowD = {
    id: 'D', condition: 'K-main is approximately equal to K-main-forced on all probes, and K-canary shows the token', meaning: 'Delivered and applied', action: 'No change',
    verdict: verdictAnd(canary.shows, ...PROBES.map((p) => gate(byProbe[p].equal))),
    counts: [...PROBES.map((p) => line(byProbe[p])), canaryLine, tookLine],
  };
  return { thresholds: T, rows: [rowA, rowB, rowC, rowD], byProbe, noneProbe, canary, took };
}

// ---- report ----

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(0)}%`);
const cellText = (c) => fmtInterval(c.applied, c.total);

function renderMarkdown({ rows, decision, args }) {
  const L = [];
  const used = rows.filter((r) => r.usable);
  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  L.push('# Constraints probe report', '');
  L.push(`Runs read: ${rows.length}. Usable: ${used.length}. Arms: ${arms.join(', ') || 'none'}. Canary token: ${args.token ? 'given, exact match' : 'not given, token-shaped match only'}.`);
  L.push(`Scoring is from stream.jsonl with session files as a secondary source. Rates are applied/usable with Wilson 95% intervals. Checks quality is ${args.weights ? `the checks component only, ${args.weights.checksMode === 'fraction' ? 'passed / total' : 'all-or-nothing'}` : 'not computed (no --scoring)'}.`, '');

  L.push('## Cells: arm x position x probe', '');
  for (const probe of PROBES) {
    const cs = cells(rows).filter((c) => c.probe === probe);
    L.push(`### ${probe}`, '', '| arm | position | applied / usable (Wilson 95%) | excluded |', '| --- | --- | --- | --- |');
    for (const c of cs) L.push(`| ${c.arm} | ${c.position} | ${cellText(c)} | ${c.excluded} |`);
    if (!cs.length) L.push('| (no runs) | | | |');
    L.push('');
  }

  L.push('### Per agent that did the work', '', '| probe | arm | agent | position | applied / usable | checks quality |', '| --- | --- | --- | --- | --- | --- |');
  const byAgent = new Map();
  for (const r of rows.filter((x) => x.probe && x.probe !== 'canary')) {
    const k = [r.probe, r.arm, r.actor ?? r.entryAgent, r.position].join('|');
    if (!byAgent.has(k)) byAgent.set(k, []);
    byAgent.get(k).push(r);
  }
  for (const [k, rs] of [...byAgent.entries()].sort()) {
    const u = rs.filter((r) => r.usable);
    const q = u.map((r) => r.checksQuality).filter((v) => v != null);
    L.push(`| ${k.split('|').join(' | ')} | ${cellText(count(u))} | ${q.length ? (q.reduce((a, b) => a + b, 0) / q.length).toFixed(0) : 'n/a'} |`);
  }
  L.push('');

  L.push('### U3 detail', '', '| arm | position | runs | reached the second failed fix | stopped before a third edit | chain written | fixed with no second failure |', '| --- | --- | --- | --- | --- | --- | --- |');
  const u3 = new Map();
  for (const r of rows.filter((x) => x.probe === 'U3' && !x.sandboxErrno)) { const k = `${r.arm}|${r.position}`; if (!u3.has(k)) u3.set(k, []); u3.get(k).push(r); }
  for (const [k, rs] of [...u3.entries()].sort()) {
    const trig = rs.filter((r) => r.score?.triggered);
    L.push(`| ${k.split('|').join(' | ')} | ${rs.length} | ${trig.length} | ${trig.filter((r) => r.score.stoppedBeforeThird).length}/${trig.length} | ${trig.filter((r) => r.score.chain).length}/${trig.length} | ${rs.length - trig.length} |`);
  }
  L.push('');

  L.push('### U1 detail', '', '| arm | position | usable | checker skill after the draft | labelled self-review only (inferred) | skill used only before the draft | none |', '| --- | --- | --- | --- | --- | --- | --- |');
  const u1 = new Map();
  for (const r of rows.filter((x) => x.probe === 'U1' && x.usable)) { const k = `${r.arm}|${r.position}`; if (!u1.has(k)) u1.set(k, []); u1.get(k).push(r); }
  for (const [k, rs] of [...u1.entries()].sort()) L.push(`| ${k.split('|').join(' | ')} | ${rs.length} | ${rs.filter((r) => r.score.level === 'skill').length} | ${rs.filter((r) => r.score.level === 'text').length} | ${rs.filter((r) => r.score.makerOnly).length} | ${rs.filter((r) => r.score.level === 'none' && !r.score.makerOnly).length} |`);
  L.push('');

  L.push('## Canary', '', '| arm | usable | token in final text | token in any assistant text | token in a tool result | token in the assembled prompt | wrong token |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const arm of [...new Set(rows.filter((r) => r.probe === 'canary').map((r) => r.arm))].sort()) {
    const rs = rows.filter((r) => r.probe === 'canary' && r.arm === arm && r.usable);
    L.push(`| ${arm} | ${rs.length} | ${rs.filter((r) => r.score.inFinal).length} | ${rs.filter((r) => r.score.inAssistant).length} | ${rs.filter((r) => r.score.inToolResult).length} | ${rs.filter((r) => r.score.inPrompt).length} | ${rs.filter((r) => r.score.wrongToken).length} |`);
  }
  L.push('');

  L.push('## Skill lookups, deferral failures and fingerprints (levels 3 and 4)', '', '| arm | runs | runs naming constraints | runs that loaded it | runs where find_skills listed it | lookups | failed lookups | deferral failures | failed load_resource(skill::*) |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const arm of arms) {
    const rs = rows.filter((r) => r.arm === arm && r.skills);
    const sum = (f) => rs.reduce((n, r) => n + f(r.skills), 0);
    L.push(`| ${arm} | ${rs.length} | ${rs.filter((r) => r.skills.constraintsNamed).length} | ${rs.filter((r) => r.skills.constraintsLoaded).length} | ${rs.filter((r) => r.skills.constraintsListed).length} | ${sum((s) => s.lookups)} | ${sum((s) => s.failed)} | ${sum((s) => s.deferralFailures)} | ${sum((s) => s.resourceSkillFailed)} |`);
  }
  L.push('', 'Deferral failures are failed skills-server calls made before the tool schema loaded, or as a bare tool name. They are counted apart and never enter a rule rate.', '');
  L.push('| arm | rule | in the assembled prompt | in a tool result | in assistant text |', '| --- | --- | --- | --- | --- |');
  for (const arm of arms) {
    const rs = rows.filter((r) => r.arm === arm && r.fingerprints);
    for (const rule of Object.keys(rs[0]?.fingerprints ?? {})) L.push(`| ${arm} | ${rule} | ${rs.filter((r) => r.fingerprints[rule].prompt).length}/${rs.length} | ${rs.filter((r) => r.fingerprints[rule].toolResult).length}/${rs.length} | ${rs.filter((r) => r.fingerprints[rule].assistant).length}/${rs.length} |`);
  }
  L.push('');

  const errno = rows.filter((r) => r.sandboxErrno);
  L.push('## Sandbox errno 38 runs (excluded from every rate)', '');
  if (!errno.length) L.push('None found.'); else for (const r of errno) L.push(`- ${r.arm} / ${r.task} / #${r.rep} (${r.entryAgent}): ${r.errnoHits.map((h) => `${h.source}: ${h.match}`).join('; ')}`);
  L.push('');
  const other = rows.filter((r) => !r.usable && !r.sandboxErrno);
  L.push('## Other excluded runs', '');
  if (!other.length) L.push('None.'); else for (const r of other) L.push(`- ${r.arm} / ${r.task} / #${r.rep}: ${r.excludedReason ?? r.problems.join('; ') ?? 'unscorable'}${r.problems.length && r.excludedReason ? ` (${r.problems.join('; ')})` : ''}`);
  L.push('');
  const mism = rows.filter((r) => (r.problems || []).some((p) => p.startsWith('attribution')));
  if (mism.length) { L.push('## Attribution mismatches', ''); for (const r of mism) L.push(`- ${r.arm} / ${r.task} / #${r.rep}: ${(r.problems || []).join('; ')}`); L.push(''); }
  const ambiguous = rows.filter((r) => r.probe === 'U1' && r.usable && r.score.inferredOnly);
  L.push('## U1 runs that rest on a labelled self-review only (INFERRED, weaker)', '', ambiguous.length ? ambiguous.map((r) => `- ${r.arm} / ${r.task} / #${r.rep}`).join('\n') : 'None.', '');

  L.push('## DECISION', '', `Thresholds, fixed before any data: clearly beats = forced minus as-is applied-rate >= ${THRESHOLDS.beatDiff} with one-sided Fisher exact p < ${THRESHOLDS.beatP} and at least ${THRESHOLDS.minUsablePerSide} usable runs on each side, pooled over positions and agents; approximately equal = |difference| < ${THRESHOLDS.equalDiff}; canary shows = token in at least ${THRESHOLDS.canaryAnyMin} K-canary run and in at least ${Math.round(THRESHOLDS.canaryForcedShare * 100)}% of K-canary-forced runs, else the canary verdict is inconclusive.`, '');
  for (const r of decision.rows) {
    L.push(`### Row ${r.id}: ${r.condition}`, '', `Verdict: **${r.verdict}**.`, '', 'Counts:', ...r.counts.map((c) => `- ${c}`), '');
    if (r.perProbe) L.push(`Per probe: ${Object.entries(r.perProbe).map(([p, v]) => `${p} ${v}`).join(', ')}.`, '');
    L.push(r.verdict === 'supported' ? `Reading: ${r.meaning}. Action: ${r.action} (on the counts above).` : `No action from this row: it is ${r.verdict}.`, '');
  }
  return L.join('\n');
}

// ---- command ----

function loadToken(opts) {
  const armsFile = opts['arms-file'] && opts['arms-file'] !== true ? readJson(path.resolve(opts['arms-file'])) : null;
  if (armsFile?.canary?.token) return armsFile.canary.token;
  const f = opts['canary-token-file'] && opts['canary-token-file'] !== true ? readText(path.resolve(opts['canary-token-file'])) : null;
  if (!f) return null;
  const j = tryJson(f.trim());
  return (j?.token ?? j?.canary?.token ?? f.trim()) || null;
}

function runRootsFrom(opts, argv = process.argv.slice(2)) {
  const vals = [];
  if (opts.run && opts.run !== true) vals.push(...String(opts.run).split(','));
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--run' && argv[i + 1] && !argv[i + 1].startsWith('--')) vals.push(...argv[i + 1].split(','));
  return [...new Set(vals.filter(Boolean).map((d) => path.resolve(d)))];
}

async function cmdProbeReport(opts) {
  const roots = runRootsFrom(opts);
  if (!roots.length) throw new Error('probe-report needs --run DIR (repeat the flag or separate several with commas)');
  for (const r of roots) if (!fs.existsSync(r)) throw new Error(`--run directory not found: ${r}`);
  if (!opts.out || opts.out === true) throw new Error('probe-report needs --out DIR');
  const weights = opts.scoring && opts.scoring !== true ? loadScoring(path.resolve(opts.scoring)) : null;
  const token = loadToken(opts);
  const manifest = loadManifest();
  const rows = loadRows(roots, { manifest, token, weights });
  if (!rows.length) throw new Error(`no run directories (result.json) under ${roots.join(', ')}`);
  const decision = decide(rows);
  const out = path.resolve(opts.out);
  fs.mkdirSync(out, { recursive: true });
  const md = renderMarkdown({ rows, decision, args: { token, weights } });
  fs.writeFileSync(path.join(out, 'probe-report.md'), md + '\n');
  const slim = rows.map((r) => ({ ...r, dir: undefined, runDir: r.dir }));
  fs.writeFileSync(path.join(out, 'probe-report.json'), JSON.stringify({ thresholds: THRESHOLDS, cells: cells(rows), decision, runs: slim.length }, null, 2) + '\n');
  fs.writeFileSync(path.join(out, 'probe-runs.jsonl'), slim.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const queue = rows.filter((r) => r.probe === 'U1' && r.usable && r.score.inferredOnly).map((r) => ({ arm: r.arm, task: r.task, rep: r.rep, runDir: r.dir, artifact: manifest.tasks[r.task].artifact }));
  fs.writeFileSync(path.join(out, 'judge-queue.json'), JSON.stringify(queue, null, 2) + '\n');
  console.log(md);
  console.log(`\nWrote probe-report.md, probe-report.json, probe-runs.jsonl and judge-queue.json to ${out}`);
}

module.exports = {
  THRESHOLDS, PROBES, POSITIONS, loadManifest, rootCauseChain, severityLabels, skillLookups, lookupFailed, resolveActor, scoreRun, scoreU1, scoreU2, scoreU3, scoreCanary,
  loadRows, runDirsUnder, cells, compareArms, canaryEvidence, forcedTook, decide, renderMarkdown, cmdProbeReport, runRootsFrom, readSessions, errnoHits, normText, ERRNO, SELF_REVIEW,
};
