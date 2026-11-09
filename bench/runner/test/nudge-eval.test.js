// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { evaluate, summarize, render } = require('../../scripts/nudge-eval.js');
const { loadTasks, suiteExtraDirs, BENCH_DIR } = require('../lib/tasks.js');

const manifest = {
  tasks: [
    { id: 't1', entries: [{ agent: 'k-a', expectedSkills: ['s1', 's2'], possibleSkills: ['s3'] }] },
    { id: 't2', entries: [{ agent: 'k-a', expectedSkills: ['s4'], possibleSkills: [] }] },
    { id: 't3', entries: [{ agent: 'k-a', expectedSkills: [], possibleSkills: [] }] },
  ],
};
const tasks = new Map([['t1', { prompt: 'one' }], ['t2', { prompt: 'two' }], ['t3', { prompt: 'three' }]]);
const matcher = {
  loadSkills: (dirs, allow) => [...allow].map((name) => ({ name })),
  matchPrompt: (prompt) => ({ one: [{ name: 's1' }, { name: 's3' }, { name: 's9' }], two: [{ name: 's9' }] }[prompt] ?? []),
};

function repoWith(names) {
  const repo = tmp();
  fs.mkdirSync(path.join(repo, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'agents', 'k-a.agent-spec.json'), JSON.stringify({ name: 'k-a', dependencies: { skills: { skillNames: names } } }));
  return repo;
}

test('precision and recall count expected hits, treat possible skills as neutral, and skip entries with no expected skills', () => {
  const rows = evaluate({ matcher, repo: repoWith(['s1', 's2', 's3', 's4', 's9']), manifest, tasks });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].hits, ['s1']);
  assert.deepEqual(rows[0].neutral, ['s3']);
  assert.deepEqual(rows[0].wrong, ['s9']);
  const s = summarize(rows);
  assert.equal(s.picks, 4);
  assert.equal(s.hits, 1);
  assert.equal(s.expected, 3);
  assert.equal(s.precision, 0.25);
  assert.equal(s.lenientPrecision, 0.5);
  assert.ok(Math.abs(s.recall - 1 / 3) < 1e-9);
  assert.deepEqual(s.perSkill.s1, { expected: 1, found: 1, tasks: ['t1'] });
  assert.deepEqual(s.perSkill.s4, { expected: 1, found: 0, tasks: ['t2'] });
  assert.match(render(rows, s), /\| s2 \| 0 \| 1 \| t1 \|/);
});

test('an agent spec limits the skills the matcher can pick from', () => {
  const rows = evaluate({ matcher: { ...matcher, loadSkills: (d, allow) => { assert.deepEqual([...allow], ['s1']); return []; } }, repo: repoWith(['s1']), manifest, tasks });
  assert.deepEqual(rows[0].reachable, ['s1']);
});

test('the rootcause manifest tasks all have a prompt to match against', () => {
  const m = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, 'suites', 'rootcause.manifest.json'), 'utf8'));
  const all = loadTasks(BENCH_DIR, { extraDirs: suiteExtraDirs('rootcause', BENCH_DIR) });
  const withExpected = m.tasks.filter((t) => t.entries.some((e) => (e.expectedSkills ?? []).length));
  assert.equal(withExpected.length, 20);
  for (const t of withExpected) assert.ok(all.get(t.id)?.prompt, t.id);
});

test('the matcher of the hook arm, when its worktree is present, is scored on the manifest tasks (table printed)', (t) => {
  const repo = process.env.NUDGE_REPO || '/var/tmp/kd-hook';
  const file = path.join(repo, 'skills', 'skill-nudge', 'skill-nudge.js');
  if (!fs.existsSync(file)) return t.skip('hook arm worktree not present');
  const m = JSON.parse(fs.readFileSync(path.join(BENCH_DIR, 'suites', 'rootcause.manifest.json'), 'utf8'));
  const all = loadTasks(BENCH_DIR, { extraDirs: suiteExtraDirs('rootcause', BENCH_DIR) });
  const rows = evaluate({ matcher: require(file), repo, manifest: m, tasks: all });
  const s = summarize(rows);
  console.log(render(rows, s));
  assert.ok(s.entries >= 20);
  assert.ok(s.recall > 0 && s.precision > 0);
});
