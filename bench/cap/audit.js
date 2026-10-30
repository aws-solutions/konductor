// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap audit`: static checks on the capabilities of a base tree. No model, no credits, nothing written to the repo.

const fs = require('node:fs');
const path = require('node:path');
const { frontmatter, fmValue } = require('../runner/lib/frontmatter.js');
const { startupKiro } = require('../runner/lib/skills.js');
const { loadTasks } = require('../runner/lib/tasks.js');
const { resolveBase } = require('./source.js');
const { scanRepo, loadAgentSpecs } = require('./scan.js');
const { reachability, kiroReachers, split } = require('./reach.js');
const { loadRegistry, validateRegistry } = require('./registry.js');
const { descTokens, jaccard, shingles, overlapFraction, cueKeywords, CUE } = require('./text.js');
const { scoringOf } = require('./captasks.js');
const { findMarker } = require('./public.js');
const { lintSkills } = require('./lint.js');
const { readBaseline, applyBaseline, isRatchetRule } = require('./baseline.js');

const TOOL_VERSION = 'cap-audit/2';
const LEAK_K = 8;
const LEAK_MAX = 0.05;
const DESC_MAX = 1024;
const DESC_LONG = 600;
const DESC_SHORT = 60;
const TEXT_EXT = /\.(?:md|txt|js|mjs|cjs|ts|json|py|rs|go|java|sh|yml|yaml|toml|html|css|csv)$/i;
const estTokens = (bytes) => Math.round(bytes / 4);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A hyphenated name is specific enough to match as a word. A plain word ("verification") must be quoted or sit next
// to the word skill or SOP, otherwise every sentence that uses the word would count as a reference.
function refRegex(name) {
  const n = escapeRe(name);
  if (name.includes('-')) return new RegExp(`(?<![\\w-])${n}(?![\\w-])`, 'i');
  return new RegExp(`[\`"'/@]${n}[\`"']|\\b(?:skill|sop)\\s+${n}\\b|\\b${n}\\s+(?:skill|sop)\\b`, 'i');
}

function tagsOf(text) {
  const raw = fmValue(frontmatter(text), 'tags');
  const m = /^\[(.*)\]$/.exec(raw);
  return m ? m[1].split(',').map((t) => t.trim()).filter(Boolean) : [];
}

function describe(c) {
  const d = c.description;
  const text = d.text ?? '';
  const out = { present: d.present, length: text.length, style: d.style, text, useWhen: CUE.test(text), keywords: d.present ? cueKeywords(text) : [] };
  if (c.kind === 'skill') out.tags = tagsOf(c.text);
  return out;
}

function lintSkill(c, desc, add) {
  if (!desc.present) { add('error', c.id, 'description-missing', `${c.id} has no description, so the skills server cannot match it`); return; }
  if (desc.length > DESC_MAX) add('error', c.id, 'description-too-long', `${c.id} description is ${desc.length} chars, over the ${DESC_MAX} limit the repo lint enforces`);
  if (desc.style === 'folded' || desc.style === 'literal') add('warn', c.id, 'description-block-scalar', `${c.id} description is a YAML ${desc.style} block scalar; tools that read the line after "description:" see only the indicator`);
  if (!desc.useWhen) add('warn', c.id, 'description-no-cue', `${c.id} description has no "use when/for/after" cue`);
  if (desc.length < DESC_SHORT) add('warn', c.id, 'description-short', `${c.id} description is ${desc.length} chars, under ${DESC_SHORT}`);
  if (desc.length > DESC_LONG) add('warn', c.id, 'description-long', `${c.id} description is ${desc.length} chars, over ${DESC_LONG}`);
}

function neighboursOf(caps, records) {
  const tokens = new Map(caps.filter((c) => records.get(c.id).description.present).map((c) => [c.id, descTokens(records.get(c.id).description.text)]));
  const out = new Map();
  for (const c of caps) {
    const mine = tokens.get(c.id);
    if (!mine) { out.set(c.id, []); continue; }
    const scored = [];
    for (const [id, t] of tokens) if (id !== c.id && split(id)[0] === c.kind) scored.push({ id, score: Math.round(jaccard(mine, t) * 1000) / 1000 });
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    out.set(c.id, scored.slice(0, 3));
  }
  return out;
}

// Other skills, SOPs, context files and agent prompts that name the capability. Dependency lists are not references.
function inboundRefs(scan, specs) {
  const sources = [...scan.values()].map((c) => ({ id: c.id, kind: c.kind, text: c.kind === 'agent' ? (specs.find((s) => s.name === c.name)?.prompt ?? '') : c.text }));
  const out = new Map();
  for (const c of scan.values()) {
    const re = refRegex(c.name);
    out.set(c.id, sources.filter((s) => s.id !== c.id && re.test(s.text)).map((s) => ({ from: s.id, kind: s.kind })));
  }
  return out;
}

function startupPerAgent(specs, baseDir) {
  return specs.map((s) => {
    const agent = {
      prompt: s.prompt,
      resources: [...s.contextFiles.map((f) => `file://${path.join(baseDir, 'context', f)}`), ...s.resources],
    };
    const st = startupKiro(agent);
    const contextBytes = st.resources.filter((r) => r.kind === 'file' && r.bytes != null).reduce((n, r) => n + r.bytes, 0);
    const promptBytes = st.resources.find((r) => r.kind === 'prompt')?.bytes ?? 0;
    return {
      agent: s.name, promptBytes, contextBytes, totalBytes: promptBytes + contextBytes, estTokens: estTokens(promptBytes + contextBytes),
      contextFiles: s.contextFiles.length, unsizedResources: st.resources.filter((r) => r.kind !== 'prompt' && r.bytes == null).length,
      skillCount: s.skills.length, sopCount: s.sops.length,
    };
  });
}

function textFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && TEXT_EXT.test(e.name)) out.push(p);
    }
  };
  if (dir && fs.existsSync(dir)) walk(dir);
  return out;
}

const readAll = (dir) => textFiles(dir).map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// Share of each kind of task material (prompt, fixture files, hidden tests) that is also in the capability text.
function leakageFor(capText, task) {
  const src = shingles(capText, LEAK_K);
  const prompt = overlapFraction(shingles(task.prompt, LEAK_K), src);
  const fixtures = overlapFraction(shingles(task.fixtureDir ? readAll(task.fixtureDir) : '', LEAK_K), src);
  const hidden = overlapFraction(shingles(task.hiddenDir ? readAll(task.hiddenDir) : '', LEAK_K), src);
  return { task: task.id, prompt, fixtures, hidden, max: Math.max(prompt, fixtures, hidden) };
}

function publicFindings(benchDir, tasks, registryDir) {
  const hits = [];
  const check = (where, text) => { const m = findMarker(text); if (m) hits.push({ where, ...m }); };
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.json')) check(path.relative(benchDir, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8'));
    }
  };
  walk(registryDir);
  for (const t of tasks.values()) check(t.extraDir ? `${path.basename(t.extraDir)}/${t.id}.json` : `tasks/${t.id}.json`, t.prompt);
  for (const doc of ['README.md', 'README-tasks.md']) {
    const f = path.join(benchDir, doc);
    if (fs.existsSync(f)) check(doc, fs.readFileSync(f, 'utf8'));
  }
  return hits;
}

function summarize({ caps, records, specs, findings, harness }) {
  const skills = caps.filter((c) => c.kind === 'skill');
  const kiro = harness === 'opencode' ? null : (() => {
    const skillsByAgent = Object.fromEntries(specs.map((s) => [s.name, skills.filter((c) => s.skills.length && kiroReachers(c.id, [s]).length).map((c) => c.name)]));
    return {
      skillsByAgent,
      skillsPerAgent: Object.fromEntries(Object.entries(skillsByAgent).map(([a, l]) => [a, l.length])),
      unreachableSkills: skills.filter((c) => !records.get(c.id).reach.kiro.agents.length).map((c) => c.name),
      singleAgentSkills: skills.filter((c) => records.get(c.id).reach.kiro.agents.length === 1).map((c) => c.name),
      unreachableSops: caps.filter((c) => c.kind === 'sop' && !records.get(c.id).reach.kiro.agents.length).map((c) => c.name),
    };
  })();
  const lint = {};
  for (const f of findings) if (f.rule.startsWith('description-') || f.rule.startsWith('lint-')) lint[f.rule] = (lint[f.rule] ?? 0) + 1;
  const pairs = new Map();
  for (const c of caps) for (const n of records.get(c.id).neighbours) { const key = [c.id, n.id].sort().join(' | '); if (!pairs.has(key)) pairs.set(key, { a: key.split(' | ')[0], b: key.split(' | ')[1], score: n.score }); }
  const withTask = caps.filter((c) => { const t = records.get(c.id).tasks; return t.linked.length || t.byTarget.length; });
  return {
    counts: Object.fromEntries(['skill', 'agent', 'sop', 'context'].map((k) => [k, caps.filter((c) => c.kind === k).length])),
    registered: caps.filter((c) => records.get(c.id).registered).length,
    kiro,
    foldedDescriptions: caps.filter((c) => ['folded', 'literal'].includes(records.get(c.id).description.style)).map((c) => c.id),
    top10Bytes: [...skills].sort((a, b) => b.bytes - a.bytes || (a.id < b.id ? -1 : 1)).slice(0, 10).map((c) => ({ id: c.id, bytes: c.bytes, estTokens: estTokens(c.bytes) })),
    totalSkillBytes: skills.reduce((n, c) => n + c.bytes, 0),
    descriptionBytes: skills.reduce((n, c) => n + Buffer.byteLength(records.get(c.id).description.text), 0),
    lint,
    nearDuplicatePairs: [...pairs.values()].sort((a, b) => b.score - a.score).slice(0, 10),
    coverage: { withTask: withTask.length, total: caps.length, linkedInRegistry: caps.filter((c) => records.get(c.id).tasks.linked.length).length },
  };
}

/**
 * Runs the audit. `base` is a ref, `dir:<path>` or an arm spec; `harness` is kiro-cli, opencode or both.
 * Returns { report, exitCode }: exit code 1 when any finding is an error, 0 otherwise.
 */
function runAudit({ repo, base, harness = 'both', benchDir, extraTasks = [], pub = false, now = new Date() }) {
  if (!['kiro-cli', 'opencode', 'both'].includes(harness)) throw new Error('--harness takes kiro-cli, opencode or both');
  const b = resolveBase(base, repo);
  try {
    const scan = scanRepo(b.dir);
    const specs = loadAgentSpecs(b.dir);
    const reach = reachability(scan, specs);
    const tasks = loadTasks(benchDir, { extraDirs: extraTasks });
    const registry = loadRegistry(benchDir);
    const regFindings = validateRegistry(registry, { scan, specs, tasks, baseDir: b.dir });
    const byId = new Map(registry.entries.filter((e) => e.data?.id).map((e) => [e.data.id, e.data]));
    const kiroOn = harness !== 'opencode';
    const caps = [...scan.values()].sort((a, b2) => (a.id < b2.id ? -1 : 1));
    let findings = [];
    const add = (level, id, rule, msg, where) => findings.push({ level, id, rule, msg, ...(where ? { where } : {}) });
    for (const f of regFindings) add(f.level, null, 'registry', `${f.where}: ${f.msg}`, f.where);

    const records = new Map();
    const inbound = inboundRefs(scan, specs);
    for (const c of caps) {
      const reg = byId.get(c.id) ?? null;
      const desc = describe(c);
      const linked = reg ? [...new Set([...reg.tasks.lift, ...reg.tasks.trigger, ...Object.keys(reg.tasks.headroom ?? {})])].sort() : [];
      const byTarget = [...tasks.values()].filter((t) => t.target && t.target.toLowerCase() === c.name.toLowerCase() && !linked.includes(t.id)).map((t) => t.id).sort();
      records.set(c.id, {
        id: c.id, kind: c.kind, name: c.name, path: c.path, registered: Boolean(reg), owner: reg?.owner ?? null, class: reg?.class ?? 'uplift',
        bytes: c.bytes, estTokens: estTokens(c.bytes), description: desc, neighbours: [],
        reach: { kiro: kiroOn ? { agents: kiroReachers(c.id, specs) } : null, opencode: harness === 'kiro-cli' ? null : reach.opencode[c.id] },
        inbound: inbound.get(c.id), leakage: [],
        tasks: { linked, byTarget, gap: linked.length ? null : byTarget.length ? 'target only: no registry link' : 'no task' },
        triggerQueries: reg ? reg.trigger.queries.length : 0,
      });
      if (c.kind === 'skill') lintSkill(c, desc, (l, id, rule, msg) => add(l, id, rule, msg));
      if (kiroOn && c.kind !== 'agent' && !records.get(c.id).reach.kiro.agents.length) add('warn', c.id, 'unreachable-kiro', `${c.id} is listed by no agent spec, so no kiro agent can reach it`);
    }
    const near = neighboursOf(caps, records);
    for (const c of caps) records.get(c.id).neighbours = near.get(c.id);

    if (kiroOn) for (const d of reach.dangling) add('warn', null, 'dangling-listing', `agent ${d.agent} lists ${d.kind} "${d.name}", which has no file at the base ref`);

    for (const c of caps) {
      const r = records.get(c.id);
      const reg = byId.get(c.id);
      for (const t of tasks.values()) {
        if (t.target && t.target.toLowerCase() === c.name.toLowerCase() && reg && !r.tasks.linked.includes(t.id)) add('warn', c.id, 'target-not-linked', `task ${t.id} has target "${t.target}" but ${c.id} does not list it in the registry`);
      }
      if (reg?.class === 'preference' && reg.tasks.lift.length) add('warn', c.id, 'preference-lift-task', `${c.id} is a preference capability, tested for fidelity, not lift, but lists lift tasks (${reg.tasks.lift.join(', ')})`);
      for (const id of r.tasks.linked) {
        const t = tasks.get(id);
        if (!t) continue;
        if (refRegex(c.name).test(t.prompt)) add('warn', c.id, 'prompt-names-capability', `task ${id} prompt names "${c.name}"; prompts must not name the capability under test`);
        if (reg.tasks.lift.includes(id) && scoringOf(t) === 'regex-only') add('warn', c.id, 'lift-task-regex-only', `lift task ${id} is scored by checks alone (no hidden tests, no rubric)`);
        const leak = leakageFor(c.text, t);
        r.leakage.push(leak);
        if (leak.max > LEAK_MAX) add('error', c.id, 'leakage', `task ${id} shares ${(leak.max * 100).toFixed(1)}% of its ${LEAK_K}-word shingles with ${c.id} (prompt ${(leak.prompt * 100).toFixed(1)}%, fixtures ${(leak.fixtures * 100).toFixed(1)}%, hidden ${(leak.hidden * 100).toFixed(1)}%); the limit is ${LEAK_MAX * 100}%`);
      }
    }

    findings.push(...lintSkills({ baseDir: b.dir }));
    for (const f of findings) if (!f.fid && isRatchetRule(f.rule)) f.fid = `${f.rule}|${f.id}`;
    const ratchet = applyBaseline(findings, readBaseline(benchDir));
    findings = ratchet.findings;

    if (pub) for (const h of publicFindings(benchDir, tasks, registry.dir)) add('error', null, 'public-marker', `${h.where}: ${h.marker} ("${h.sample}")`, h.where);

    const startup = {
      kiro: kiroOn ? startupPerAgent(specs, b.dir) : null,
      opencode: harness === 'kiro-cli' ? null : (() => {
        const skills = caps.filter((c) => c.kind === 'skill');
        const bytes = skills.reduce((n, c) => n + Buffer.byteLength(c.name) + Buffer.byteLength(records.get(c.id).description.text), 0);
        return { skillCount: skills.length, skillIndexBytes: bytes, estTokens: estTokens(bytes), note: 'name and description of every skill; the primary agent prompt is produced by the translation and is not sized here' };
      })(),
    };

    const report = {
      schemaVersion: 1, toolVersion: TOOL_VERSION, createdAt: now.toISOString(), harness,
      base: { spec: b.spec, kind: b.kind, ref: b.ref, commitSha: b.commitSha, tree: b.tree, label: b.label },
      notes: ['estTokens is bytes / 4, an estimate, not a tokenizer count', 'bytes is the size of the defining file (SKILL.md for a skill), not the whole skill directory'],
      capabilities: caps.map((c) => records.get(c.id)),
      agents: specs.map((s) => ({ name: s.name, skills: s.skills.length, sops: s.sops.length, contexts: s.contexts.length, subagents: s.subagents })),
      matrix: { agents: reach.agents, kiro: kiroOn ? reach.kiro : null, opencode: harness === 'kiro-cli' ? null : reach.opencode },
      dangling: kiroOn ? reach.dangling : [],
      startup, registry: { entries: registry.entries.length, findings: regFindings },
      summary: { ...summarize({ caps, records, specs, findings, harness }), ratchet: ratchet.summary },
      findings,
    };
    return { report, exitCode: findings.some((f) => f.level === 'error') ? 1 : 0 };
  } finally {
    b.cleanup();
  }
}

// ---- markdown ----

const row = (cells) => `| ${cells.join(' | ')} |`;
const table = (head, rows) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const pct = (v) => `${(v * 100).toFixed(1)}%`;

function renderAudit(r) {
  const L = [];
  const s = r.summary;
  L.push('# Capability audit', '');
  L.push(`Base: ${r.base.label}${r.base.commitSha ? ` (${r.base.commitSha})` : ''}; harness: ${r.harness}; created ${r.createdAt}; ${r.toolVersion}.`);
  for (const n of r.notes) L.push(`Note: ${n}.`);
  L.push('', '## Summary', '');
  L.push(`Capabilities: ${Object.entries(s.counts).map(([k, v]) => `${v} ${k}`).join(', ')}; ${s.registered} registered; ${s.coverage.withTask} have a task (${s.coverage.linkedInRegistry} linked in the registry).`);
  L.push(`Skill bytes: ${s.totalSkillBytes} (SKILL.md only); description bytes: ${s.descriptionBytes}.`);
  if (s.kiro) {
    L.push(`Skills listed by no agent (unreachable on kiro): ${s.kiro.unreachableSkills.length ? s.kiro.unreachableSkills.join(', ') : 'none'}.`);
    L.push(`Skills reachable from one agent only: ${s.kiro.singleAgentSkills.length}.`);
    L.push(`Skills per agent: ${Object.entries(s.kiro.skillsPerAgent).map(([a, n]) => `${a} ${n}`).join(', ')}.`);
    if (s.kiro.unreachableSops.length) L.push(`SOPs listed by no agent: ${s.kiro.unreachableSops.join(', ')}.`);
  }
  L.push(`Block-scalar descriptions: ${s.foldedDescriptions.length ? s.foldedDescriptions.join(', ') : 'none'}.`);
  L.push(`Lint counts: ${Object.keys(s.lint).length ? Object.entries(s.lint).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}.`);
  L.push(s.ratchet ? `Baseline: ${s.ratchet.waived} waived, ${s.ratchet.new} new, ${s.ratchet.stale} stale.` : 'Baseline: none (audit-baseline.json is absent, so lint findings are warnings).');
  L.push('', '10 largest skills (SKILL.md):', '', table(['skill', 'bytes', 'est. tokens'], s.top10Bytes.map((t) => [t.id, t.bytes, t.estTokens])));

  L.push('', '## Descriptions', '');
  L.push(table(['capability', 'present', 'chars', 'style', 'use-when cue', 'bytes', 'est. tokens', 'finder keywords'],
    r.capabilities.filter((c) => c.kind === 'skill').map((c) => [c.id, c.description.present ? 'yes' : 'NO', c.description.length, c.description.style, c.description.useWhen ? 'yes' : 'no', c.bytes, c.estTokens, c.description.keywords.join(' ')])));

  L.push('', '## Reachability', '');
  if (r.matrix.kiro) {
    const agents = r.matrix.agents;
    L.push('kiro-cli: capability by acting agent (x = the agent spec lists it; a SOP is served as an MCP prompt, not by get_skill).', '');
    L.push(table(['capability', ...agents], r.capabilities.map((c) => [c.id, ...agents.map((a) => (r.matrix.kiro[c.id][a] ? 'x' : ''))])));
  }
  if (r.matrix.opencode) L.push('', `opencode: every skill (${r.startup.opencode.skillCount}) and SOP (as sop-<name>) is in the translated config; contexts and agents have no skill route.`);
  if (r.dangling.length) L.push('', 'Listed but missing at the base ref:', '', ...r.dangling.map((d) => `- ${d.agent} lists ${d.kind} "${d.name}"`));

  L.push('', '## Startup bytes', '');
  if (r.startup.kiro) {
    L.push('kiro-cli: system prompt plus the context files the spec lists (AGENTS.md and skill globs resolve against the run cwd and are not sized).', '');
    L.push(table(['agent', 'prompt bytes', 'context bytes', 'total bytes', 'est. tokens', 'unsized resources'], r.startup.kiro.map((a) => [a.agent, a.promptBytes, a.contextBytes, a.totalBytes, a.estTokens, a.unsizedResources])));
  }
  if (r.startup.opencode) L.push('', `opencode skill index: ${r.startup.opencode.skillCount} skills, ${r.startup.opencode.skillIndexBytes} bytes (est. ${r.startup.opencode.estTokens} tokens). ${r.startup.opencode.note}.`);

  L.push('', '## Near duplicates', '', 'Jaccard on description tokens; a high score predicts false triggers between the two.', '');
  L.push(table(['a', 'b', 'score'], s.nearDuplicatePairs.map((p) => [p.a, p.b, p.score])));

  L.push('', '## Tasks and leakage', '');
  L.push(table(['capability', 'linked tasks', 'target-only tasks', 'gap', 'max shingle overlap'],
    r.capabilities.filter((c) => c.registered || c.tasks.byTarget.length).map((c) => [c.id, c.tasks.linked.join(', ') || '-', c.tasks.byTarget.join(', ') || '-', c.tasks.gap ?? '-', c.leakage.length ? pct(Math.max(...c.leakage.map((l) => l.max))) : '-'])));

  L.push('', '## Findings', '');
  const order = { error: 0, warn: 1, info: 2 };
  const fs2 = [...r.findings].sort((a, b) => order[a.level] - order[b.level]);
  L.push(fs2.length ? fs2.map((f) => `- ${f.level.toUpperCase()} ${f.rule}: ${f.msg}`).join('\n') : 'none');
  return `${L.join('\n')}\n`;
}

module.exports = { runAudit, renderAudit, inboundRefs, TOOL_VERSION, refRegex, LEAK_MAX };
