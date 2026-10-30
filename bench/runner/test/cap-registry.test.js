// SPDX-License-Identifier: Apache-2.0
'use strict';

// Registry: schema, rules against the base ref, repo scan and reachability. No model, no cargo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeCapRepo, makeCapBench, entry, writeEntry, scratch } = require('./cap-helpers.js');
const { resolveBase } = require('../../cap/source.js');
const { scanRepo, loadAgentSpecs } = require('../../cap/scan.js');
const { reachability, kiroReachers } = require('../../cap/reach.js');
const { loadRegistry, validateRegistry } = require('../../cap/registry.js');
const { loadTasks } = require('../lib/tasks.js');

function setup() {
  const root = scratch();
  const r = makeCapRepo(root);
  const bench = makeCapBench(root);
  const base = resolveBase('v0', r.repo);
  const scan = scanRepo(base.dir);
  const specs = loadAgentSpecs(base.dir);
  const tasks = loadTasks(bench);
  const run = (entries) => {
    for (const e of entries) writeEntry(bench, e);
    const reg = loadRegistry(bench);
    return validateRegistry(reg, { scan, specs, tasks, baseDir: base.dir });
  };
  return { root, bench, base, scan, specs, tasks, run, done: () => { base.cleanup(); fs.rmSync(root, { recursive: true, force: true }); } };
}

const errs = (f) => f.filter((x) => x.level === 'error').map((x) => x.msg);

test('a good entry validates with no findings', () => {
  const s = setup();
  try { assert.deepEqual(s.run([entry()]), []); } finally { s.done(); }
});

test('an entry whose path is missing at the base ref is an error', () => {
  const s = setup();
  try {
    const f = s.run([entry({ id: 'skill:alpha', path: 'skills/nope/SKILL.md' })]);
    assert.ok(errs(f).some((m) => /path .*skills\/nope\/SKILL\.md.* does not exist at the base ref/.test(m)), JSON.stringify(f));
  } finally { s.done(); }
});

test('a path that does not follow the kind convention is an error', () => {
  const s = setup();
  try {
    const f = s.run([entry({ path: 'skills/beta/SKILL.md' })]);
    assert.ok(errs(f).some((m) => /path must be skills\/alpha\/SKILL\.md/.test(m)), JSON.stringify(f));
  } finally { s.done(); }
});

test('a query split outside train, heldout and reserve is a schema error; a stored split is never recomputed', () => {
  const s = setup();
  try {
    const q = (id, split) => ({ id, text: 'review my handler', expect: 'load', split });
    const bad = s.run([entry({ trigger: { gen: 1, queries: [q('t01', 'dev')] } })]);
    assert.ok(errs(bad).some((m) => /split: must be one of/.test(m)), JSON.stringify(bad));
    const a = s.run([entry({ trigger: { gen: 1, queries: [q('t01', 'heldout'), q('t02', 'heldout')] } })]);
    assert.deepEqual(errs(a), [], 'all heldout is accepted as stored; the validator never reshuffles');
  } finally { s.done(); }
});

test('duplicate query ids and a nearMissOf that is not a capability id are errors', () => {
  const s = setup();
  try {
    const qs = [
      { id: 't01', text: 'a', expect: 'load', split: 'train' },
      { id: 't01', text: 'b', expect: 'none', split: 'train', nearMissOf: 'frontend-review' },
    ];
    const f = s.run([entry({ trigger: { gen: 1, queries: qs } })]);
    assert.ok(errs(f).some((m) => /duplicate query id "t01"/.test(m)));
    assert.ok(errs(f).some((m) => /nearMissOf "frontend-review" is not a capability id/.test(m)));
  } finally { s.done(); }
});

test('a nearMissOf may only go on an expect:none query', () => {
  const s = setup();
  try {
    const f = s.run([entry({ trigger: { gen: 1, queries: [{ id: 't01', text: 'a', expect: 'load', split: 'train', nearMissOf: 'skill:delta' }] } })]);
    assert.ok(errs(f).some((m) => /nearMissOf only applies to expect:none/.test(m)), JSON.stringify(f));
  } finally { s.done(); }
});

test('a task listed under a capability must exist', () => {
  const s = setup();
  try {
    const f = s.run([entry({ tasks: { lift: ['rev-one', 'no-such-task'], trigger: [], headroom: {} } })]);
    assert.ok(errs(f).some((m) => /tasks\.lift: unknown task "no-such-task"/.test(m)), JSON.stringify(f));
  } finally { s.done(); }
});

test('headroom must name a task and carry a pass rate between 0 and 1', () => {
  const s = setup();
  try {
    const f = s.run([entry({ tasks: { lift: ['rev-one'], trigger: [], headroom: { 'rev-one': { vanillaPass: 1.4, n: 3, source: 'run-1', date: '2026-01-01' }, ghost: { vanillaPass: 0.5, n: 3, source: 'x', date: 'y' } } } })]);
    assert.ok(errs(f).some((m) => /headroom\.rev-one\.vanillaPass must be between 0 and 1/.test(m)), JSON.stringify(f));
    assert.ok(errs(f).some((m) => /headroom: unknown task "ghost"/.test(m)));
  } finally { s.done(); }
});

test('an expected tool that does not fit the kind and harness is an error (a SOP is not served by get_skill on kiro)', () => {
  const s = setup();
  try {
    const f = s.run([entry({ id: 'sop:k-plan', kind: 'sop', path: 'agent-sops/k-plan.sop.md', owner: 'konductor', expect: { 'kiro-cli': { tool: 'get_skill', actingAgents: ['konductor'] } } })]);
    assert.ok(errs(f).some((m) => /expect\.kiro-cli\.tool "get_skill" does not fit a sop; expected "prompt"/.test(m)), JSON.stringify(f));
  } finally { s.done(); }
});

test('an acting agent that does not list the skill is an error, one that does is accepted', () => {
  const s = setup();
  try {
    const bad = s.run([entry({ id: 'skill:delta', path: 'skills/delta/SKILL.md', expect: { 'kiro-cli': { tool: 'get_skill', actingAgents: ['k-dev'] } } })]);
    assert.ok(errs(bad).some((m) => /acting agent "k-dev" does not reach skill:delta on kiro-cli/.test(m)), JSON.stringify(bad));
    const unknown = s.run([entry({ id: 'skill:delta', path: 'skills/delta/SKILL.md', expect: { 'kiro-cli': { tool: 'get_skill', actingAgents: ['k-nobody'] } } })]);
    assert.ok(errs(unknown).some((m) => /acting agent "k-nobody" is not an agent spec/.test(m)));
    const good = s.run([entry({ id: 'skill:delta', path: 'skills/delta/SKILL.md', expect: { 'kiro-cli': { tool: 'get_skill', actingAgents: ['konductor'] } } })]);
    assert.deepEqual(errs(good), []);
  } finally { s.done(); }
});

test('the file name must match the id and ids must be unique', () => {
  const s = setup();
  try {
    const dir = path.join(s.bench, 'capabilities/skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'wrong.json'), JSON.stringify(entry()));
    writeEntry(s.bench, entry());
    const f = validateRegistry(loadRegistry(s.bench), { scan: s.scan, specs: s.specs, tasks: s.tasks, baseDir: s.base.dir });
    assert.ok(errs(f).some((m) => /file name must be skill\/alpha\.json/.test(m)), JSON.stringify(f));
    assert.ok(errs(f).some((m) => /duplicate id skill:alpha/.test(m)));
  } finally { s.done(); }
});

test('malformed JSON is reported with its file, not thrown', () => {
  const s = setup();
  try {
    fs.mkdirSync(path.join(s.bench, 'capabilities/skill'), { recursive: true });
    fs.writeFileSync(path.join(s.bench, 'capabilities/skill/bad.json'), '{ not json');
    const reg = loadRegistry(s.bench);
    const f = validateRegistry(reg, { scan: s.scan, specs: s.specs, tasks: s.tasks, baseDir: s.base.dir });
    assert.ok(errs(f).some((m) => /skill\/bad\.json: not valid JSON/.test(m)), JSON.stringify(f));
  } finally { s.done(); }
});

test('an empty or missing capabilities directory is a valid empty registry', () => {
  const s = setup();
  try {
    assert.deepEqual(s.run([]), []);
    fs.rmSync(path.join(s.bench, 'capabilities'), { recursive: true });
    assert.deepEqual(loadRegistry(s.bench).entries, []);
  } finally { s.done(); }
});

test('trigger split targets are warnings, not errors', () => {
  const s = setup();
  try {
    const qs = Array.from({ length: 4 }, (_, i) => ({ id: `t0${i}`, text: `q${i}`, expect: 'load', split: 'train' }));
    const f = s.run([entry({ trigger: { gen: 1, queries: qs } })]);
    assert.deepEqual(errs(f), []);
    assert.ok(f.some((x) => x.level === 'warn' && /no expect:none queries/.test(x.msg)), JSON.stringify(f));
  } finally { s.done(); }
});

// ---- scan and reachability ----

test('scanRepo lists every skill, SOP, context file and agent with bytes', () => {
  const s = setup();
  try {
    const ids = [...s.scan.keys()].sort();
    assert.deepEqual(ids, ['agent:k-dev', 'agent:konductor', 'context:core', 'context:routing', 'skill:alpha', 'skill:beta', 'skill:delta', 'skill:gamma', 'sop:k-orphan', 'sop:k-plan']);
    const a = s.scan.get('skill:alpha');
    assert.equal(a.path, 'skills/alpha/SKILL.md');
    assert.equal(a.bytes, fs.statSync(path.join(s.base.dir, a.path)).size);
    assert.equal(s.scan.get('context:core').path, 'context/core.md');
    assert.equal(s.scan.get('agent:k-dev').path, 'agents/k-dev.agent-spec.json');
  } finally { s.done(); }
});

test('kiro reachability follows the dependencies of each agent spec, not the file tree', () => {
  const s = setup();
  try {
    const r = (id) => kiroReachers(id, s.specs);
    assert.deepEqual(r('skill:alpha'), ['k-dev', 'konductor']);
    assert.deepEqual(r('skill:beta'), ['k-dev']);
    assert.deepEqual(r('skill:delta'), ['konductor']);
    assert.deepEqual(r('skill:gamma'), []);
    assert.deepEqual(r('sop:k-plan'), ['konductor']);
    assert.deepEqual(r('sop:k-orphan'), []);
    assert.deepEqual(r('context:core'), ['k-dev', 'konductor']);
    assert.deepEqual(r('context:routing'), ['konductor']);
    assert.deepEqual(r('agent:k-dev'), ['konductor']);
  } finally { s.done(); }
});

test('the matrix holds one row per capability and one column per acting agent; opencode reaches every skill and SOP', () => {
  const s = setup();
  try {
    const m = reachability(s.scan, s.specs);
    assert.deepEqual(m.agents, ['k-dev', 'konductor']);
    assert.deepEqual(m.kiro['skill:alpha'], { 'k-dev': true, konductor: true });
    assert.deepEqual(m.kiro['skill:gamma'], { 'k-dev': false, konductor: false });
    assert.equal(m.opencode['skill:gamma'], true);
    assert.equal(m.opencode['sop:k-orphan'], true);
    assert.equal(m.opencode['context:core'], null);
    assert.deepEqual(m.dangling, [{ agent: 'k-dev', kind: 'skill', name: 'ghost' }]);
  } finally { s.done(); }
});

test('resolveBase builds from the ref, never from the working tree', () => {
  const s = setup();
  try {
    fs.writeFileSync(path.join(s.root, 'repo', 'skills/alpha/SKILL.md'), 'edited after the tag\n');
    const again = resolveBase('v0', path.join(s.root, 'repo'));
    try {
      assert.match(fs.readFileSync(path.join(again.dir, 'skills/alpha/SKILL.md'), 'utf8'), /Validate every input/);
      assert.equal(again.kind, 'git');
      assert.match(again.commitSha, /^[0-9a-f]{40}$/);
    } finally { again.cleanup(); }
  } finally { s.done(); }
});

test('resolveBase accepts dir: and name=dir: and reads the directory in place', () => {
  const s = setup();
  try {
    const d = resolveBase(`dir:${s.base.dir}`, path.join(s.root, 'repo'));
    assert.equal(d.kind, 'dir');
    assert.equal(d.dir, s.base.dir);
    const n = resolveBase(`x=dir:${s.base.dir}`, path.join(s.root, 'repo'));
    assert.equal(n.dir, s.base.dir);
    assert.throws(() => resolveBase('nope-ref', path.join(s.root, 'repo')), /not found/);
  } finally { s.done(); }
});
