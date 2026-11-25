// SPDX-License-Identifier: Apache-2.0
'use strict';

// T13 (documentation, triage, log analysis): the six briefs are complete and in the added phases, the author prompt
// is T8's doc prompt plus the scripted-user section with the brief's facts, the scripted checks of taskErrors fire,
// and buildTask carries the scripted user into the task. No model call.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const T13 = path.join(__dirname, '..', '..', 'scenarios', 't13');
const { loadConfig } = require('../../scenarios/lib/config.js');
const { render } = require('../../scenarios/lib/prompt.js');
const { stageOf } = require('../../scenarios/lib/stage.js');
const { ADDED_PHASES, ROLES } = require('../../scenarios/coverage.js');
const { converse } = require('../../scenarios/t6/tools/fake-user.js');

const cfg = loadConfig(path.join(T13, 'scenario.config.js'));
const briefIds = fs.readdirSync(path.join(T13, 'briefs')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort();
const brief = (id) => JSON.parse(fs.readFileSync(path.join(T13, 'briefs', `${id}.json`), 'utf8'));
// A fake task under an id no batch directory holds, so solutions/ and answers/ of the real tasks do not enter these checks.
const fakeTask = (b, prompt = 'Please write the document.') => ({ id: 't13-none-such', prompt, questions: 'scripted', scriptedUser: { facts: b.scriptedUser.facts, defaultReply: cfg.DEFAULT_REPLY } });

test('six briefs, two per added phase, each a scripted doc task with three facts, a public source and the T8 fields', () => {
  assert.strictEqual(briefIds.length, 6);
  const perPhase = {};
  for (const id of briefIds) {
    const b = brief(id);
    assert.strictEqual(b.id, id);
    assert.strictEqual(b.kind, 'doc');
    assert.strictEqual(b.questions, 'scripted');
    assert.ok(ADDED_PHASES.includes(b.phase), `${id}: phase ${b.phase}`);
    assert.ok(ROLES.includes(b.role), `${id}: role ${b.role}`);
    perPhase[b.phase] = (perPhase[b.phase] || 0) + 1;
    for (const k of ['author', 'reviewer', 'answerer', 'stack', 'size', 'outFile', 'blockFields', 'kindExtra', 'brief', 'voice']) assert.ok(b[k], `${id}: missing ${k}`);
    assert.notStrictEqual(b.author.split('-')[0], b.reviewer.split('-')[0], `${id}: reviewer from the author's family`);
    assert.ok(/claude/.test(`${b.author} ${b.reviewer} ${b.answerer}`) === false, `${id}: a Claude model in the writer path`);
    assert.ok(b.source && typeof b.source.licence === 'string' && b.source.licenceCheckedAt, `${id}: source licence`);
    assert.strictEqual(b.scriptedUser.facts.length, 3, `${id}: three facts`);
    for (const f of b.scriptedUser.facts) {
      assert.match(f.id, /^F[123]$/);
      assert.ok(f.topics.length >= 3, `${id} ${f.id}: topics`);
      for (const t of f.topics) {
        assert.strictEqual(t, t.toLowerCase(), `${id} ${f.id}: topic not lowercase: ${t}`);
        assert.ok(!/^\d+$/.test(t), `${id} ${f.id}: bare number topic ${t}`);
      }
      assert.ok(f.answer.length > 20, `${id} ${f.id}: answer too short`);
    }
    // The generic ask unlocks nothing, and each fact is reachable by a question made of its own topics.
    const task = fakeTask(b);
    const generic = converse(task, [cfg.GENERIC_ASK]).questions[0];
    assert.ok(!generic || generic.matched.length === 0, `${id}: the generic ask unlocks ${generic && generic.matched}`);
    for (const f of b.scriptedUser.facts) {
      const r = converse(task, [`Quick question about the ${f.topics[0]}?`]).questions[0];
      assert.ok(r && r.matched.includes(f.id), `${id}: topic "${f.topics[0]}" does not unlock ${f.id}`);
    }
  }
  assert.deepStrictEqual(perPhase, { documentation: 2, triage: 2, 'log-analysis': 2 });
});

test('the author prompt is the doc prompt plus the scripted section with the exact facts', () => {
  for (const id of briefIds) {
    const b = brief(id);
    const p = render(cfg, id);
    assert.ok(p.includes('block-key.js'), `${id}: no block-kit section`);
    assert.ok(p.includes(b.brief.slice(0, 80)), `${id}: brief text missing`);
    assert.ok(p.includes(b.outFile), `${id}: outFile missing`);
    assert.ok(p.includes('## The scripted user'), `${id}: scripted section missing`);
    assert.ok(p.indexOf('## The scripted user') < p.indexOf('## Task file'), `${id}: scripted section after the task file section`);
    for (const f of b.scriptedUser.facts) assert.ok(p.includes(f.answer), `${id}: ${f.id} answer missing from the prompt`);
    assert.ok(p.includes(cfg.DEFAULT_REPLY));
    assert.ok(p.includes('Public inspiration'), `${id}: source line missing`);
  }
});

test('the author prompt is document-shaped: its own kind section, no incident example items, the key audit rules (D-255)', () => {
  const steps = (id) => (brief(id).twoStep ? ['a', 'b'] : [null]);
  for (const id of briefIds) {
    const all = steps(id).map((s) => render(cfg, id, s)).join('\n');
    assert.doesNotMatch(all, /operations and reliability work/, `${id}: T8's ops intro`);
    assert.match(all, /documentation, triage and log-analysis work/, `${id}: no T13 intro`);
    const key = render(cfg, id, brief(id).twoStep ? 'b' : null);
    for (const t8Item of ['"cause-named"', '"fence-first"', 'rootCause.summary']) assert.ok(!key.includes(t8Item), `${id}: T8 incident example ${t8Item}`);
    for (const rule of [/never add a field the request does not name/, /not the element's JSON text/, /no exact-string pattern beside a tolerance/, /no length cap/i, /do not copy an incident report/i]) {
      assert.match(key, rule, `${id}: key audit rule ${rule} missing`);
    }
  }
});

test('the review prompt (read by stage.js review from this batch directory) exists and names the scripted-user leak check', () => {
  const p = fs.readFileSync(path.join(T13, 'prompts', 'review.md'), 'utf8');
  assert.ok(p.includes('review.json'));
  assert.ok(p.includes('scripted user'));
  assert.ok(p.includes('ASKS.json'));
});

test('taskErrors: a scripted task needs ASKS.json that unlocks every fact, and a prompt that repeats no answer', () => {
  const b = brief(briefIds[0]);
  const noAsks = cfg.taskErrors(fakeTask(b));
  assert.ok(noAsks.some((e) => /ASKS\.json/.test(e)), noAsks.join('; '));
  assert.ok(noAsks.some((e) => /do not unlock: F1, F2, F3/.test(e)), noAsks.join('; '));
  const leaked = cfg.taskErrors(fakeTask(b, `Please write the docs. ${b.scriptedUser.facts[1].answer}`));
  assert.ok(leaked.some((e) => /prompt repeats a fact answer: F2/.test(e)), leaked.join('; '));
  assert.deepStrictEqual(cfg.taskErrors({ id: 'x', prompt: 'p', questions: 'scripted' }), ['a scripted task needs scriptedUser']);
  assert.deepStrictEqual(cfg.taskErrors({ id: 'x', prompt: 'p', questions: 'allowed' }), []);
});

test('conversation plays the reference asks from solutions/<id>/ASKS.json and nothing for the stub', () => {
  const b = brief(briefIds[0]);
  const task = fakeTask(b);
  assert.deepStrictEqual(cfg.conversation(task, 'stub'), { questions: [] });
  assert.strictEqual(cfg.conversation({ id: 'x', prompt: 'p' }, 'reference'), null);
  // No solutions dir for the fake id: the reference asks nothing, so no fact is matched.
  assert.deepStrictEqual(cfg.conversation(task, 'reference'), { questions: [] });
  // A real task's reference asks unlock all three facts.
  const real = JSON.parse(fs.readFileSync(path.join(T13, `${briefIds[0]}.json`), 'utf8'));
  const conv = cfg.conversation(real, 'reference');
  assert.deepStrictEqual([...new Set(conv.questions.flatMap((q) => q.matched))].sort(), ['F1', 'F2', 'F3']);
  assert.deepStrictEqual(cfg.taskErrors(real), []);
});

test('buildTask keeps T8 shape and adds the scripted user from the draft, or from the brief when the draft has none', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't13-build-'));
  const old = process.env.T13_AUTH;
  try {
    process.env.T13_AUTH = root;
    const id = briefIds[0];
    const b = brief(id);
    fs.mkdirSync(path.join(root, 'work', id), { recursive: true });
    const draft = { id, prompt: 'Please update the docs and end with the block.', checks: [{ type: 'file_exists', path: b.outFile, weight: 1, kind: 'substance' }], rubric: [], limits: { softSec: 300, hardSec: 600 }, notes: '' };
    fs.writeFileSync(path.join(root, 'work', id, 'task-draft.json'), JSON.stringify(draft));
    const s = stageOf(cfg);
    const t1 = cfg.stage.buildTask(s, id);
    assert.strictEqual(t1.questions, 'scripted');
    assert.deepStrictEqual(t1.scriptedUser, { facts: b.scriptedUser.facts, defaultReply: cfg.DEFAULT_REPLY });
    assert.strictEqual(t1.phase, b.phase);
    assert.strictEqual(t1.class, 'hard');
    assert.strictEqual(t1.authorship.model, b.author);
    assert.strictEqual(t1.limits.softSec, 600, 'the T8 floor of 600 s applies');
    // handEdited comes from this batch's HAND-EDITS.md (t13- ids), never from T8's.
    const kept = fs.readFileSync(path.join(T13, 'HAND-EDITS.md'), 'utf8').split('## Dropped')[0];
    const listed = /^\| (t13-[a-z0-9-]+)/m.test(kept) && kept.includes(`| ${id} |`);
    assert.strictEqual(Boolean(t1.handEdited), listed);
    if (listed) assert.match(t1.handEdited.editor, /T13/);
    const own = { facts: [{ id: 'F1', topics: ['x'], answer: 'y' }], defaultReply: 'd' };
    fs.writeFileSync(path.join(root, 'work', id, 'task-draft.json'), JSON.stringify({ ...draft, scriptedUser: own }));
    assert.deepStrictEqual(cfg.stage.buildTask(s, id).scriptedUser, own);
  } finally {
    if (old === undefined) delete process.env.T13_AUTH; else process.env.T13_AUTH = old;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
