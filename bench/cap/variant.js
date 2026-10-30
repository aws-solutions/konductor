// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap variant`: a copy of a base ref with one capability dropped, replaced or added, or an orchestrator preset applied.
// The copy is a `dir:` arm for the existing runner. It is built from `git archive` of the ref, never from the working tree.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sandbox = require('../runner/lib/sandbox.js');
const armSource = require('../runner/lib/arm-source.js');
const { resolveMain, parseArmSpec } = require('../runner/lib/arms.js');
const { realHomes } = require('../runner/lib/isolate.js');
const { startupKiro } = require('../runner/lib/skills.js');
const { frontmatter, fmValue } = require('../runner/lib/frontmatter.js');
const { scanRepo, loadAgentSpecs, PATH_OF } = require('./scan.js');
const { kiroReachers, split } = require('./reach.js');
const { inboundRefs } = require('./audit.js');

const TOOL_VERSION = 'cap-variant/1';
const PRESETS = ['skills-only', 'bare'];
const BARE_PROMPT = 'You are a general software engineering assistant. Do the work you are asked to do.';
const ORCHESTRATOR = 'konductor';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readSha = (file) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null);
const toList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : String(v).split(',').filter(Boolean));
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);

function realOrResolve(p) { try { return fs.realpathSync(p); } catch { return path.resolve(p); } }

function checkScratch(scratch, repo) {
  fs.mkdirSync(scratch, { recursive: true });
  const real = realOrResolve(scratch);
  if (inside(real, realOrResolve(repo))) throw new Error(`--scratch ${scratch} is inside the repository; variants live outside it`);
  if (realHomes().some((h) => inside(real, h))) throw new Error(`--scratch ${scratch} is under the real HOME; use a directory under TMPDIR`);
  return real;
}

function resolveRefOnly(repo, spec) {
  if (spec.startsWith('dir:')) throw new Error('--base takes a git ref: a variant is built from git archive, never from a working tree');
  let ref = spec;
  if (spec.includes('=')) {
    const p = parseArmSpec(spec);
    if (p.kind === 'dir') throw new Error('--base takes a git ref: a variant is built from git archive, never from a working tree');
    ref = p.ref;
  } else if (spec === 'main') ref = resolveMain(repo).ref;
  const { sha } = armSource.resolveRef(repo, ref);
  return { ref, sha };
}

// ---- spec editing ----

const SPEC_LISTS = [
  { kind: 'skill', get: (d) => d.skills?.skillNames, label: 'skillNames', ensure: (d) => { d.skills ??= {}; return (d.skills.skillNames ??= []); } },
  { kind: 'sop', get: (d) => d.agentSops?.agentSopNames, label: 'agentSopNames', ensure: (d) => { d.agentSops ??= {}; return (d.agentSops.agentSopNames ??= []); } },
  { kind: 'context', get: (d) => d.context?.contextNames, label: 'contextNames', ensure: (d) => { d.context ??= {}; return (d.context.contextNames ??= []); } },
];

const sameName = (kind, listed, name) => (kind === 'context' ? listed.replace(/\.md$/, '') === name : listed === name);

// Reads every spec, lets `fn(json, file)` edit it in place and return true when it changed, and rewrites only the changed ones.
function editSpecs(tree, fn) {
  const dir = path.join(tree, 'agents');
  const changed = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.agent-spec.json')).sort()) {
    const file = path.join(dir, f);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (fn(j, file)) { fs.writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`); changed.push(j.name ?? f); }
  }
  return changed;
}

// The lists a spec keeps names in. synth checks that every claudeCli.skills entry still has a skill directory, so a
// dropped skill has to leave that list too, not only the dependencies the kiro install reads.
const CLAUDE_SKILLS = { label: 'claudeCli.skills', get: (j) => j.clientConfig?.claudeCli?.skills, set: (j, v) => { j.clientConfig.claudeCli.skills = v; } };

function removeFromLists(tree, kind, name) {
  const removed = [];
  const def = SPEC_LISTS.find((l) => l.kind === kind);
  const section = kind === 'skill' ? 'skills' : kind === 'sop' ? 'agentSops' : 'context';
  editSpecs(tree, (j) => {
    let changed = false;
    const list = def.get(j.dependencies ?? {});
    if (Array.isArray(list)) {
      const kept = list.filter((x) => !sameName(kind, x, name));
      if (kept.length !== list.length) { j.dependencies[section][def.label] = kept; removed.push({ agent: j.name, list: def.label }); changed = true; }
    }
    const claude = kind === 'skill' ? CLAUDE_SKILLS.get(j) : null;
    if (Array.isArray(claude) && claude.includes(name)) { CLAUDE_SKILLS.set(j, claude.filter((x) => x !== name)); removed.push({ agent: j.name, list: CLAUDE_SKILLS.label }); changed = true; }
    return changed;
  });
  return removed;
}

function addToList(tree, kind, name, agent) {
  const def = SPEC_LISTS.find((l) => l.kind === kind);
  let found = false;
  editSpecs(tree, (j) => {
    if (j.name !== agent) return false;
    found = true;
    j.dependencies ??= {};
    const list = def.ensure(j.dependencies);
    const entry = kind === 'context' ? `${name}.md` : name;
    if (list.includes(entry)) return false;
    list.push(entry);
    return true;
  });
  if (!found) throw new Error(`agent "${agent}" is not an agent spec at the base ref`);
}

// ---- ops ----

function defFile(tree, kind, name) { return path.join(tree, PATH_OF[kind](name)); }

function parseIdFile(arg, flag) {
  const i = arg.indexOf('=');
  if (i < 1 || i === arg.length - 1) throw new Error(`${flag} takes ID=FILE, got "${arg}"`);
  return { id: arg.slice(0, i), file: arg.slice(i + 1) };
}

function parseId(id) {
  if (!/^(skill|agent|sop|context):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`"${id}" is not a capability id (kind:name, kind is skill, agent, sop or context)`);
  return split(id);
}

function opDrop(tree, id) {
  const [kind, name] = parseId(id);
  if (kind === 'agent') throw new Error(`cannot drop an agent (${id}): the routing rules name every agent, so a dropped one is a dangling reference. Replace its prompt instead`);
  const file = defFile(tree, kind, name);
  if (!fs.existsSync(file)) throw new Error(`${id} does not exist at the base ref`);
  const before = readSha(file);
  if (kind === 'skill') fs.rmSync(path.join(tree, 'skills', name), { recursive: true, force: true }); else fs.rmSync(file);
  return { op: 'drop', id, beforeSha256: before, afterSha256: null, removedFrom: removeFromLists(tree, kind, name) };
}

function opReplace(tree, arg) {
  const { id, file: src } = parseIdFile(arg, '--replace');
  const [kind, name] = parseId(id);
  const dest = defFile(tree, kind, name);
  if (!fs.existsSync(dest)) throw new Error(`${id} does not exist at the base ref; use --add for a new capability`);
  if (!fs.existsSync(src)) throw new Error(`replacement file not found: ${src}`);
  const bytes = fs.readFileSync(src);
  checkCandidate(kind, name, bytes.toString('utf8'));
  const before = readSha(dest);
  fs.writeFileSync(dest, bytes);
  return { op: 'replace', id, beforeSha256: before, afterSha256: sha256(bytes) };
}

function checkCandidate(kind, name, text) {
  if (kind === 'skill') {
    const n = fmValue(frontmatter(text), 'name');
    if (n && n !== name) throw new Error(`replacement frontmatter name "${n}" must stay "${name}"`);
  }
  if (kind === 'agent') {
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error(`replacement for agent:${name} is not valid JSON: ${e.message}`); }
    if (j.name !== name) throw new Error(`replacement spec name "${j.name}" must stay "${name}"`);
  }
}

function opAdd(tree, arg, agents) {
  const { id, file: src } = parseIdFile(arg, '--add');
  const [kind, name] = parseId(id);
  if (kind === 'agent') throw new Error('--add does not create agents');
  if (!agents.length) throw new Error('--add needs --to-agent AGENT[,AGENT]');
  const dest = defFile(tree, kind, name);
  if (fs.existsSync(dest)) throw new Error(`${id} already exists; use --replace`);
  if (!fs.existsSync(src)) throw new Error(`file to add not found: ${src}`);
  const bytes = fs.readFileSync(src);
  checkCandidate(kind, name, bytes.toString('utf8'));
  const known = new Set(loadAgentSpecs(tree).map((s) => s.name));
  for (const a of agents) if (!known.has(a)) throw new Error(`agent "${a}" is not an agent spec at the base ref`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, bytes);
  for (const a of agents) addToList(tree, kind, name, a);
  return { op: 'add', id, beforeSha256: null, afterSha256: sha256(bytes), agents: [...agents] };
}

function opPreset(tree, preset) {
  const file = path.join(tree, `agents/${ORCHESTRATOR}.agent-spec.json`);
  if (!fs.existsSync(file)) throw new Error(`preset ${preset} needs agents/${ORCHESTRATOR}.agent-spec.json at the base ref`);
  const before = readSha(file);
  editSpecs(tree, (j) => {
    if (j.name !== ORCHESTRATOR) return false;
    j.dependencies ??= {};
    for (const def of SPEC_LISTS) {
      if (preset === 'skills-only' && def.kind !== 'context') continue;
      def.ensure(j.dependencies).length = 0;
    }
    if (preset === 'bare') {
      j.config.systemPrompt = BARE_PROMPT;
      if (j.dependencies.subagents) j.dependencies.subagents.agentNames = [];
      const sub = j.clientConfig?.kiroCli?.toolsSettings?.subagent;
      if (sub) { sub.availableAgents = []; if ('trustedAgents' in sub) sub.trustedAgents = []; }
    }
    return true;
  });
  return { op: 'preset', id: preset, beforeSha256: before, afterSha256: readSha(file) };
}

// ---- naming ----

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

function namesFor({ drop, replace, add, preset }) {
  const kinds = [drop.length && 'x-minus', replace.length && 'x-replace', add.length && 'x-plus', preset].filter(Boolean);
  const armName = kinds.length === 1 ? kinds[0] : 'x-variant';
  const first = drop[0] ?? (replace[0] ? parseIdFile(replace[0], '--replace').id : null) ?? (add[0] ? parseIdFile(add[0], '--add').id : null);
  const nameOf = first ? first.slice(first.indexOf(':') + 1) : '';
  const extra = drop.length + replace.length + add.length > 1 ? `-and-${drop.length + replace.length + add.length - 1}-more` : '';
  const variantId = slug(preset && !first ? preset : `${armName}-${nameOf}${extra}`);
  return { armName, variantId };
}

// The directory name comes from the inputs (base commit, ops, candidate file bytes, engine) so a plan can print the
// exact path before anything is built. variantHash in variant.json is the hash of the resulting tree.
function variantKey({ sha, drop, replace, add, toAgent, preset, agentEngine }) {
  const h = crypto.createHash('sha256');
  const part = (...x) => h.update(`${x.join('\u0001')}\u0000`);
  part('base', sha, 'engine', agentEngine, 'preset', preset ?? '');
  for (const id of drop) part('drop', id);
  for (const a of replace) { const { id, file } = parseIdFile(a, '--replace'); part('replace', id, fs.existsSync(file) ? readSha(file) : 'missing'); }
  for (const a of add) { const { id, file } = parseIdFile(a, '--add'); part('add', id, fs.existsSync(file) ? readSha(file) : 'missing', ...toAgent); }
  return h.digest('hex');
}

/** Where a variant with these inputs is (or will be) built. Pure: reads the repo refs and candidate files, writes nothing. */
function variantPaths({ repo, base = 'v1.2.0', drop = [], replace = [], add = [], toAgent = [], preset = null, scratch, agentEngine = 'v2' }) {
  drop = toList(drop); replace = toList(replace); add = toList(add); toAgent = toList(toAgent);
  const { ref, sha } = resolveRefOnly(repo, base);
  const { armName, variantId } = namesFor({ drop, replace, add, preset });
  const key = variantKey({ sha, drop, replace, add, toAgent, preset, agentEngine });
  const root = path.join(realOrResolve(scratch), 'variants', `${variantId}-${key.slice(0, 12)}`);
  const dir = path.join(root, 'tree');
  return { ref, sha, armName, variantId, root, dir, armSpec: `${armName}=dir:${dir}` };
}

/**
 * Builds the variant and returns { root, dir, armName, armSpec, variantId, meta }. `dir` is the tree to pass as a dir arm;
 * `variant.json` sits beside it in `root`, so it never changes the arm's content hash.
 */
function buildVariant({ repo, base = 'v1.2.0', drop = [], replace = [], add = [], toAgent = [], preset = null, scratch, agentEngine = 'v2', now = new Date() }) {
  drop = toList(drop); replace = toList(replace); add = toList(add); toAgent = toList(toAgent);
  if (preset !== null && !PRESETS.includes(preset)) throw new Error(`--preset takes ${PRESETS.join(' or ')}`);
  if (!drop.length && !replace.length && !add.length && !preset) throw new Error('nothing to do: give --drop, --replace, --add or --preset');
  if (add.length && !toAgent.length) throw new Error('--add needs --to-agent AGENT[,AGENT]');
  if (!scratch) throw new Error('--scratch DIR is required');
  const scratchReal = checkScratch(scratch, repo);
  const planned = variantPaths({ repo, base, drop, replace, add, toAgent, preset, scratch: scratchReal, agentEngine });
  const { ref, sha } = planned;
  const variantsDir = path.join(scratchReal, 'variants');
  fs.mkdirSync(variantsDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(variantsDir, '.build-'));
  const tree = path.join(work, 'tree');
  try {
    sandbox.exportRef(repo, sha, tree);
    const baseScan = scanRepo(tree);
    const refs = inboundRefs(baseScan, loadAgentSpecs(tree));
    const ops = [];
    if (preset) ops.push(opPreset(tree, preset));
    for (const id of drop) ops.push(opDrop(tree, id));
    for (const r of replace) ops.push(opReplace(tree, r));
    for (const a of add) ops.push(opAdd(tree, a, toAgent));
    const variantHash = armSource.snapshotDir(tree).hash;
    const { armName, variantId, root } = planned;
    fs.rmSync(root, { recursive: true, force: true });
    fs.renameSync(work, root);
    const meta = {
      variantId, armName, agentEngine,
      base: { ref, commitSha: sha, tree: armSource.treeOf(repo, sha) },
      ops,
      inboundRefs: ops.filter((o) => o.op !== 'preset').map((o) => ({ id: o.id, refs: refs.get(o.id) ?? [] })),
      variantHash, createdAt: now.toISOString(), toolVersion: TOOL_VERSION,
    };
    fs.writeFileSync(path.join(root, 'variant.json'), `${JSON.stringify(meta, null, 2)}\n`);
    const dir = path.join(root, 'tree');
    return { root, dir, armName, armSpec: `${armName}=dir:${dir}`, variantId, meta };
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Null, or the reason to stop. A variant that changes only skills/** has no effect unless the acting agent can reach
 * the skill: kiro serves skills through get_skill, filtered by the agent's own list, and nothing loads at startup.
 */
function reachWarning({ ops, specs, actingAgents }) {
  const real = ops.filter((o) => o.op !== 'preset');
  if (!real.length || real.length !== ops.length || real.some((o) => split(o.id)[0] !== 'skill')) return null;
  const msgs = [];
  for (const o of real) {
    if (o.op === 'add') {
      if (!actingAgents.some((a) => (o.agents ?? []).includes(a))) msgs.push(`${o.id} is added only to ${(o.agents ?? []).join(', ')}, not to ${actingAgents.join(', ')}`);
    } else if (!actingAgents.some((a) => kiroReachers(o.id, specs).includes(a))) {
      msgs.push(`${o.id} is not in the filter of ${actingAgents.join(', ')}`);
    }
  }
  return msgs.length ? `capability not reachable at startup: ${msgs.join('; ')}. The arm would differ only under skills/** and the model could not load it` : null;
}

// ---- verify ----

const asSet = (l) => new Set(l ?? []);
const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();

/**
 * Installs the built variant into a scratch HOME with the arm's own CLI, reads the installed agent JSON of every
 * agent and checks the skill and SOP filters and the context files against the spec lists of the variant tree.
 * `prepared` is { bin, exportDir } from the runner's prepare step.
 */
function verifyInstalled({ variant, prepared, tmpRoot = os.tmpdir(), home = null }) {
  fs.mkdirSync(tmpRoot, { recursive: true });
  const ownHome = home === null;
  const h = ownHome ? fs.mkdtempSync(path.join(tmpRoot, 'w-')) : home;
  try {
    sandbox.installInto(h, prepared, variant.meta.agentEngine);
    const specs = loadAgentSpecs(variant.dir);
    const dropped = new Set(variant.meta.ops.filter((o) => o.op === 'drop').map((o) => o.id));
    const problems = [];
    for (const s of loadAgentSpecs(variant.dir)) {
      for (const d of dropped) if (d.startsWith('skill:') && s.claudeSkills.includes(d.slice(6))) problems.push(`${s.name}: claudeCli.skills still lists ${d.slice(6)}`);
    }
    const checked = [];
    const installed = {};
    for (const s of specs) {
      const file = path.join(h, '.kiro/agents', `${s.name}.json`);
      if (!fs.existsSync(file)) continue;
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      const st = startupKiro(j);
      const ctx = (j.resources ?? []).filter((r) => typeof r === 'string' && r.startsWith('file://') && /\.md$/.test(r) && path.basename(path.dirname(r)) === 'context').map((r) => path.basename(r));
      installed[s.name] = { skills: st.skillFilter, sops: st.sopPromptFilter, contexts: ctx };
      checked.push(s.name);
      const cmp = (label, kind, got, want) => {
        const gotSet = asSet(got);
        const wantSet = asSet(want);
        for (const x of diff(gotSet, wantSet)) {
          problems.push(dropped.has(`${kind}:${x.replace(/\.md$/, '')}`)
            ? `${s.name}: ${label} still lists ${x}`
            : `${s.name}: ${label} lists ${x} but the ops do not add it there`);
        }
        for (const x of diff(wantSet, gotSet)) problems.push(`${s.name}: ${label} lacks ${x}`);
      };
      cmp('skill filter', 'skill', st.skillFilter, s.skills);
      cmp('SOP filter', 'sop', st.sopPromptFilter, s.sops);
      cmp('context files', 'context', ctx, s.contextFiles);
    }
    return { ok: problems.length === 0 && checked.length > 0, problems: checked.length ? problems : ['no installed agent JSON was found'], checked, installed };
  } finally {
    if (ownHome) fs.rmSync(h, { recursive: true, force: true });
  }
}

module.exports = { buildVariant, variantPaths, verifyInstalled, reachWarning, checkScratch, PRESETS, TOOL_VERSION, BARE_PROMPT };
