// SPDX-License-Identifier: Apache-2.0
'use strict';

// The capability registry: bench/capabilities/<kind>/<name>.json, validated with the bench schema validator.
// It holds only what the repo cannot derive (queries, task links, headroom, expectations). Description text, size
// and reachability are read from the ref being benchmarked.

const fs = require('node:fs');
const path = require('node:path');
const { validate, loadSchema } = require('../runner/lib/schema.js');
const { PATH_OF, KINDS } = require('./scan.js');
const { kiroReachers } = require('./reach.js');

const ID_RE = /^(skill|agent|sop|context):[a-z0-9][a-z0-9._-]*$/;

// The tool a capability of each kind is expected to be used through, per harness.
const EXPECTED_TOOL = {
  'kiro-cli': { skill: 'get_skill', sop: 'prompt', agent: 'subagent', context: 'resource' },
  opencode: { skill: 'skill', sop: 'skill', agent: 'task', context: 'resource' },
};

const registryDir = (benchDir) => path.join(benchDir, 'capabilities');

/** Reads every entry. A file that is not valid JSON becomes an entry with `parseError`; nothing throws. */
function loadRegistry(benchDir) {
  const dir = registryDir(benchDir);
  const entries = [];
  if (!fs.existsSync(dir)) return { dir, entries };
  for (const kind of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    for (const f of fs.readdirSync(path.join(dir, kind)).filter((n) => n.endsWith('.json')).sort()) {
      const rel = `${kind}/${f}`;
      try { entries.push({ file: rel, data: JSON.parse(fs.readFileSync(path.join(dir, kind, f), 'utf8')) }); } catch (e) { entries.push({ file: rel, data: null, parseError: e.message }); }
    }
  }
  return { dir, entries };
}

const SPLITS = ['train', 'heldout', 'reserve'];

function checkQueries(e, add) {
  const seen = new Set();
  const counts = { load: 0, none: 0 };
  for (const q of e.trigger?.queries ?? []) {
    if (seen.has(q.id)) add('error', `trigger.queries: duplicate query id "${q.id}"`);
    seen.add(q.id);
    if (q.expect in counts) counts[q.expect]++;
    if (q.nearMissOf !== undefined) {
      if (!ID_RE.test(q.nearMissOf)) add('error', `trigger.queries.${q.id}: nearMissOf "${q.nearMissOf}" is not a capability id`);
      if (q.expect !== 'none') add('error', `trigger.queries.${q.id}: nearMissOf only applies to expect:none queries`);
    }
  }
  const n = (e.trigger?.queries ?? []).length;
  if (n) {
    if (!counts.none) add('warn', 'trigger.queries: no expect:none queries, precision cannot be measured');
    if (!counts.load) add('warn', 'trigger.queries: no expect:load queries, recall cannot be measured');
    const near = (e.trigger.queries).filter((q) => q.nearMissOf).length;
    if (counts.none && near * 2 < counts.none) add('warn', `trigger.queries: ${near} of ${counts.none} negatives are near-misses; aim for at least half`);
    const bySplit = Object.fromEntries(SPLITS.map((s) => [s, e.trigger.queries.filter((q) => q.split === s).length]));
    if (n >= 10 && bySplit.train / n < 0.5) add('warn', `trigger.queries: only ${bySplit.train} of ${n} queries are in train; the target is about 60%`);
  }
}

function checkExpect(e, ctx, add) {
  for (const [harness, spec] of Object.entries(e.expect ?? {})) {
    const want = EXPECTED_TOOL[harness]?.[e.kind];
    if (want && spec.tool !== want) add('error', `expect.${harness}.tool "${spec.tool}" does not fit a ${e.kind}; expected "${want}"`);
    if (harness !== 'kiro-cli') continue;
    const names = new Set(ctx.specs.map((s) => s.name));
    const reach = new Set(kiroReachers(e.id, ctx.specs));
    for (const a of spec.actingAgents ?? []) {
      if (!names.has(a)) add('error', `expect.kiro-cli.actingAgents: acting agent "${a}" is not an agent spec at the base ref`);
      else if (!reach.has(a)) add('error', `expect.kiro-cli.actingAgents: acting agent "${a}" does not reach ${e.id} on kiro-cli (its spec does not list it)`);
    }
  }
}

function checkTasks(e, ctx, add) {
  const known = (id) => ctx.tasks.has(id);
  for (const field of ['lift', 'trigger']) {
    for (const id of e.tasks?.[field] ?? []) if (!known(id)) add('error', `tasks.${field}: unknown task "${id}"`);
  }
  for (const [id, h] of Object.entries(e.tasks?.headroom ?? {})) {
    if (!known(id)) { add('error', `tasks.headroom: unknown task "${id}"`); continue; }
    const p = h?.vanillaPass;
    if (typeof p !== 'number' || p < 0 || p > 1) add('error', `tasks.headroom.${id}.vanillaPass must be between 0 and 1`);
    if (!Number.isInteger(h?.n) || h.n < 1) add('error', `tasks.headroom.${id}.n must be an integer >= 1`);
  }
}

/**
 * Findings for the registry: `[{level: 'error'|'warn', where, msg}]`. `ctx` = { scan, specs, tasks, baseDir }.
 * Splits are checked as stored (they must be a known value); they are never recomputed.
 */
function validateRegistry(registry, ctx) {
  const findings = [];
  const schema = loadSchema('capability');
  const ids = new Map();
  for (const { file, data, parseError } of registry.entries) {
    const add = (level, msg) => findings.push({ level, where: `capabilities/${file}`, msg });
    if (parseError) { findings.push({ level: 'error', where: `capabilities/${file}`, msg: `${file}: not valid JSON (${parseError})` }); continue; }
    const problems = validate(schema, data);
    for (const p of problems) add('error', p);
    if (problems.length) continue;
    const [kind, name] = [data.kind, data.id.slice(data.id.indexOf(':') + 1)];
    if (!data.id.startsWith(`${kind}:`)) add('error', `id ${data.id} does not start with its kind "${kind}:"`);
    if (ids.has(data.id)) add('error', `duplicate id ${data.id} (also in ${ids.get(data.id)})`);
    else ids.set(data.id, file);
    if (file !== `${kind}/${name}.json`) add('error', `file name must be ${kind}/${name}.json for id ${data.id}`);
    const wantPath = KINDS.includes(kind) ? PATH_OF[kind](name) : null;
    if (wantPath && data.path !== wantPath) add('error', `path must be ${wantPath} for id ${data.id}, got ${data.path}`);
    if (!fs.existsSync(path.join(ctx.baseDir, data.path))) add('error', `path ${data.path} does not exist at the base ref`);
    checkQueries(data, add);
    checkExpect(data, ctx, add);
    checkTasks(data, ctx, add);
  }
  return findings;
}

module.exports = { loadRegistry, validateRegistry, registryDir, EXPECTED_TOOL, ID_RE };
