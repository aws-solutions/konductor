// SPDX-License-Identifier: Apache-2.0
'use strict';

// The constraints probe scorer on synthetic streams: each probe applied and not applied, position attribution, deferral
// failures, errno, canary, fingerprints, the statistics helpers and every row of the decision table. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratch } = require('./scratch.js');
const { wilson, fisherGreater, fisherTwoSided } = require('../../report/probes-stats.js');
const P = require('../../report/probes.js');

const manifest = P.loadManifest();
const TOKEN = 'kd-canary-0a1b2c3d';

// ---- synthetic stream builders (engine v3 shapes) ----

let seq = 0;
const id = () => `toolu_${++seq}`;
const ev = (update, extra = {}) => ({ type: 'sessionUpdate', data: { sessionId: 's', update: { ...update, _meta: { kiro: extra } } } });
const say = (text, extra = {}) => ev({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }, { executionId: 'e1', ...extra });
const call = (title, rawInput, extra = {}, kind) => {
  const toolCallId = id();
  return [ev({ sessionUpdate: 'tool_call', toolCallId, title, kind, rawInput }, extra), toolCallId];
};
const done = (toolCallId, message, status = 'completed') => ev({ sessionUpdate: 'tool_call_update', toolCallId, status, rawOutput: { message } });

function tool(events, title, rawInput, message, { extra = {}, kind, status } = {}) {
  const [c, cid] = call(title, rawInput, extra, kind);
  events.push(c, done(cid, message, status));
}
const sh = (events, command, exit, extra) => tool(events, 'run it', { command }, `Output:\nstuff\n\nExit Code: ${exit}`, { extra, kind: 'execute' });
const edit = (events, p, extra) => tool(events, 'Replace in File', { path: p, oldStr: 'a', newStr: 'b' }, 'ok', { extra });
const write = (events, p, extra) => tool(events, 'Write File', { path: p, text: 'x' }, 'ok', { extra });
const loadSchema = (events, extra) => tool(events, 'Tool Load', { id: 'tool::konductor-skills::get_skill' }, '{"loaded":[{"tool_id":"tool::konductor-skills::get_skill"}],"not_found":[]}', { extra });
const getSkill = (events, name, { body = true, extra } = {}) => tool(events, '@konductor-skills/get_skill', { tool_id: 'tool::konductor-skills::get_skill', arguments: { name } },
  body ? JSON.stringify({ name, content: `---\nname: ${name}\n---\nbody` }) : 'Error: no skill', { extra, status: body ? 'completed' : 'failed' });
const deferredGetSkill = (events, name, extra) => tool(events, 'Tool Call', { tool_id: 'tool::konductor-skills::get_skill', arguments: { name } }, 'tool is not loaded: load its schema first', { extra, status: 'failed' });
const loadSkillResource = (events, name, ok = false, extra) => tool(events, 'Load Resource', { id: `skill::${name}` }, ok ? `{"loaded":[{"id":"skill::${name}"}],"not_found":[]}` : `{"loaded":[],"not_found":["skill::${name}"]}`, { extra });
const delegate = (events, target, extra) => { const [c, cid] = call(`Sub-agent: ${target}`, { name: target, prompt: 'do it' }, extra); events.push(c); return cid; };
const delegateDone = (events, cid, text) => events.push(done(cid, text));
const finish = (events, text) => events.push({ type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: text } });

function mkRun(root, { arm = 'k-main', task, rep = 1, agent, events, workspace = {}, sessions = [], stderr = '', result = {} }) {
  const dir = path.join(root, arm, task, String(rep));
  fs.mkdirSync(path.join(dir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'stream.jsonl'), [{ type: 'runStarted', data: { engine: 'v3' } }, ...events].map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ armId: arm, taskId: task, replicate: rep, agent, status: 'success', creditsCharged: 3, wallClockMs: 60000, flags: [], checks: [{ passed: true }, { passed: false }], ...result }));
  fs.writeFileSync(path.join(dir, 'stderr.txt'), stderr);
  for (const [rel, text] of Object.entries(workspace)) { fs.mkdirSync(path.dirname(path.join(dir, 'workspace', rel)), { recursive: true }); fs.writeFileSync(path.join(dir, 'workspace', rel), text); }
  sessions.forEach((s, i) => {
    const sd = path.join(dir, 'session', `sess_${i}`);
    fs.mkdirSync(sd, { recursive: true });
    fs.writeFileSync(path.join(sd, 'messages.jsonl'), JSON.stringify({ id: 'a', payload: { type: 'session_start', agentType: s.agentType, content: s.content ?? '' } }) + '\n');
  });
  return dir;
}

const score = (dir, extra = {}) => P.scoreRun(dir, { manifest, ...extra });
const root = () => mkScratch('probe-rep-');

// ---- statistics ----

test('wilson matches known values and handles the edges', () => {
  const w = wilson(5, 10);
  assert.ok(Math.abs(w.lo - 0.237) < 0.005 && Math.abs(w.hi - 0.763) < 0.005);
  assert.equal(wilson(0, 0), null);
  assert.equal(wilson(0, 5).lo, 0);
  assert.equal(wilson(5, 5).hi, 1);
  assert.throws(() => wilson(6, 5));
});

test('fisher exact matches known tables', () => {
  assert.ok(Math.abs(fisherGreater(8, 10, 2, 10) - 0.01175) < 0.0005);
  assert.ok(fisherGreater(5, 10, 5, 10) > 0.5);
  assert.equal(fisherGreater(0, 0, 0, 0), 1);
  assert.ok(Math.abs(fisherTwoSided(8, 10, 2, 10) - 0.0230) < 0.001);
  assert.ok(fisherGreater(2, 10, 8, 10) > 0.99);
});

// ---- text signals ----

test('a root-cause chain needs the words and a run of two arrows', () => {
  assert.ok(P.rootCauseChain('Root cause: ttl is the string "90s" -> Number gives NaN -> entries never expire -> the test fails.').chain);
  assert.ok(P.rootCauseChain('root cause \u2192 intermediate effects \u2192 observed symptom').chain);
  assert.ok(!P.rootCauseChain('The root cause was a bad value in the config.').chain);
  assert.ok(!P.rootCauseChain('ttl -> NaN -> never expires').chain);
  assert.ok(!P.rootCauseChain('Root cause: bad parse -> NaN').chain);
});

test('severity labels: the three words in order are applied, another scale or a wrong order is not', () => {
  assert.deepEqual(P.severityLabels('### 1. A\nSeverity: CRITICAL\n### 2. B\nSeverity: IMPORTANT\n### 3. C\nSeverity: SUGGESTION').labels, ['CRITICAL', 'IMPORTANT', 'SUGGESTION']);
  assert.ok(P.severityLabels('**Critical:** a\n**Important:** b\n**Suggestion:** c').ordered);
  assert.equal(P.severityLabels('It is important to note that nothing else is critical here.').labels.length, 0);
  const wrong = P.severityLabels('IMPORTANT: a\nCRITICAL: b');
  assert.equal(wrong.ordered, false);
  const other = P.severityLabels('Severity: High\nSeverity: Medium\nSeverity: Low');
  assert.equal(other.labels.length, 0);
  assert.ok(other.otherScale >= 3);
  assert.ok(P.severityLabels('| 1 | Critical | x |\n| 2 | Suggestion | y |').distinct === 2);
});

// ---- U3 ----

const U3 = 'probe-u3-circuit-breaker';

test('U3 applied: two failed fixes, then no edit and a written chain', () => {
  const r = root();
  const e = [];
  sh(e, 'node --test', 1);
  edit(e, 'src/cache.js'); sh(e, 'node --test', 1);
  edit(e, 'src/cache.js'); sh(e, 'node --test', 1);
  e.push(say('Two fixes failed. Root cause: "90s" in config -> Number() gives NaN -> the age check is never true -> the test sees the old value.'));
  finish(e, 'Root cause: the ttl "90s" -> NaN -> no expiry -> failing test. I stopped here and propose to use parseDuration in src/config.js.');
  const row = score(mkRun(r, { task: U3, agent: 'k-developer', events: e }));
  assert.equal(row.position, 'entry');
  assert.equal(row.score.triggered, true);
  assert.equal(row.score.editsAfter2, 0);
  assert.equal(row.score.stoppedBeforeThird, true);
  assert.equal(row.applied, true);
  assert.equal(row.usable, true);
});

test('U3 not applied: a third edit after the second failure, with or without a chain at the end', () => {
  const r = root();
  const e = [];
  edit(e, 'src/cache.js'); sh(e, 'npm test', 1);
  edit(e, 'src/cache.js'); sh(e, 'npm test', 1);
  edit(e, 'src/cache.js'); sh(e, 'npm test', 1);
  edit(e, 'src/config.js'); sh(e, 'npm test', 0);
  finish(e, 'Root cause: ttl string -> NaN -> never expires. Fixed.');
  const row = score(mkRun(r, { task: U3, agent: 'k-developer', events: e }));
  assert.equal(row.score.editsAfter2, 2);
  assert.equal(row.score.targetEditsAfter2, 1);
  assert.equal(row.score.stoppedBeforeThird, false);
  assert.equal(row.applied, false);
  assert.equal(row.score.finalTestsPassed, true);
});

test('U3: the chain written before the next edit is the lenient reading, a stop without a chain is not applied', () => {
  const r = root();
  const a = [];
  edit(a, 'src/cache.js'); sh(a, 'node --test', 1);
  edit(a, 'src/cache.js'); sh(a, 'node --test', 1);
  a.push(say('Root cause: "90s" -> NaN -> never expires -> test fails.'));
  edit(a, 'src/config.js'); sh(a, 'node --test', 0);
  finish(a, 'done');
  const rowA = score(mkRun(r, { task: U3, rep: 1, agent: 'k-developer', events: a }));
  assert.equal(rowA.applied, false);
  assert.equal(rowA.score.appliedLenient, true);
  const b = [];
  edit(b, 'src/cache.js'); sh(b, 'node --test', 1);
  edit(b, 'src/cache.js'); sh(b, 'node --test', 1);
  finish(b, 'I could not fix it.');
  const rowB = score(mkRun(r, { task: U3, rep: 2, agent: 'k-developer', events: b }));
  assert.equal(rowB.score.stoppedBeforeThird, true);
  assert.equal(rowB.applied, false);
});

test('U3 never reached a second failed fix: not triggered, excluded from the rate, and the baseline failing run does not count as an attempt', () => {
  const r = root();
  const e = [];
  sh(e, 'node --test', 1);
  edit(e, 'src/config.js'); sh(e, 'node --test', 0);
  finish(e, 'Fixed on the first try.');
  const row = score(mkRun(r, { task: U3, agent: 'k-developer', events: e }));
  assert.equal(row.score.triggered, false);
  assert.equal(row.usable, false);
  assert.equal(row.excludedReason, 'not-triggered');
  const shell = [];
  edit(shell, 'src/cache.js'); sh(shell, 'node --test', 1);
  sh(shell, "sed -i 's/>/>=/' src/cache.js", 0); sh(shell, 'node --test', 1);
  sh(shell, "sed -i 's/a/b/' src/cache.js", 0);
  finish(shell, 'x');
  const row2 = score(mkRun(r, { task: U3, rep: 2, agent: 'k-developer', events: shell }));
  assert.equal(row2.score.shellEditsAfter2, 1);
});

// ---- U2 ----

const U2 = 'probe-u2-severity-review-qa';

test('U2 applied from the written review, not applied for another scale or a wrong order', () => {
  const r = root();
  const good = [];
  finish(good, 'Review written.');
  const a = score(mkRun(r, { task: U2, rep: 1, agent: 'k-quality-assurance', events: good, workspace: { 'review/test-review.md': '### A\nSeverity: CRITICAL\n### B\nSeverity: IMPORTANT\n### C\nSeverity: SUGGESTION\n' } }));
  assert.equal(a.applied, true);
  assert.equal(a.score.all3, true);
  const other = score(mkRun(r, { task: U2, rep: 2, agent: 'k-quality-assurance', events: [...good], workspace: { 'review/test-review.md': '### A\nSeverity: High\n### B\nSeverity: Medium\n' } }));
  assert.equal(other.applied, false);
  const wrong = score(mkRun(r, { task: U2, rep: 3, agent: 'k-quality-assurance', events: [...good], workspace: { 'review/test-review.md': 'IMPORTANT: a\nCRITICAL: b\nSUGGESTION: c\n' } }));
  assert.equal(wrong.applied, false);
  assert.equal(wrong.score.ordered, false);
});

test('U2 falls back to the final text when no file was written', () => {
  const r = root();
  const e = [];
  finish(e, 'CRITICAL: no assertion.\nIMPORTANT: gaps.\nSUGGESTION: names.');
  const row = score(mkRun(r, { task: U2, agent: 'k-quality-assurance', events: e }));
  assert.equal(row.score.labelSource, 'final');
  assert.equal(row.applied, true);
});

// ---- U1 ----

const U1 = 'probe-u1-checker-pass-qa';

test('U1: a paired checker skill after the draft is strong, a labelled self-review alone is inferred, a skill before the draft is maker use', () => {
  const r = root();
  const strong = [];
  loadSchema(strong);
  write(strong, 'out/test-plan.md');
  getSkill(strong, 'e2e-test-strategy');
  strong.push(say('Plan checked.'));
  finish(strong, 'Here is the plan.');
  const s = score(mkRun(r, { task: U1, rep: 1, agent: 'k-quality-assurance', events: strong }));
  assert.equal(s.score.level, 'skill');
  assert.equal(s.score.strongPrimary, true);
  assert.equal(s.applied, true);

  const alt = [];
  write(alt, 'out/test-plan.md');
  getSkill(alt, 'verification');
  finish(alt, 'done');
  assert.equal(score(mkRun(r, { task: U1, rep: 2, agent: 'k-quality-assurance', events: alt })).score.strongAlternative, true);

  const text = [];
  write(text, 'out/test-plan.md');
  text.push(say('Now a self-review of the draft against the spec: every rule is covered.'));
  tool(text, 'Read File', { path: 'out/test-plan.md' }, 'plan text');
  text.push(say('Final answer follows.'));
  finish(text, 'Here is the plan.');
  const t = score(mkRun(r, { task: U1, rep: 3, agent: 'k-quality-assurance', events: text }));
  assert.equal(t.score.level, 'text');
  assert.equal(t.score.inferredOnly, true);
  assert.equal(t.score.appliedSkillOnly, false);

  const maker = [];
  getSkill(maker, 'e2e-test-strategy');
  write(maker, 'out/test-plan.md');
  finish(maker, 'Plan written.');
  const m = score(mkRun(r, { task: U1, rep: 4, agent: 'k-quality-assurance', events: maker }));
  assert.equal(m.score.level, 'none');
  assert.equal(m.score.makerOnly, true);
  assert.equal(m.applied, false);

  const none = [];
  write(none, 'out/test-plan.md');
  finish(none, 'Plan written.');
  assert.equal(score(mkRun(r, { task: U1, rep: 5, agent: 'k-quality-assurance', events: none })).applied, false);
});

test('U1 does not count a failed lookup of the checker skill', () => {
  const r = root();
  const e = [];
  write(e, 'out/test-plan.md');
  getSkill(e, 'e2e-test-strategy', { body: false });
  finish(e, 'done');
  const row = score(mkRun(r, { task: U1, agent: 'k-quality-assurance', events: e }));
  assert.equal(row.applied, false);
  assert.equal(row.skills.failed, 1);
});

// ---- positions ----

test('an orchestrator run that delegated to the owner is delegated, and the delegate actions are scored, not the orchestrator', () => {
  const r = root();
  const e = [];
  const sub = { agentSubtaskId: 'sub1' };
  const cid = delegate(e, 'k-developer', sub);
  edit(e, 'src/cache.js', sub); sh(e, 'node --test', 1, sub);
  edit(e, 'src/cache.js', sub); sh(e, 'node --test', 1, sub);
  e.push(say('Root cause: "90s" -> NaN -> no expiry -> failing test.', sub));
  delegateDone(e, cid, 'Root cause: "90s" -> NaN -> no expiry -> failing test. No third edit.');
  finish(e, 'The developer stopped and explained.');
  const row = score(mkRun(r, { task: U3, agent: 'konductor', events: e, sessions: [{ agentType: 'konductor' }, { agentType: 'k-developer' }] }));
  assert.equal(row.position, 'delegated');
  assert.equal(row.delegated, true);
  assert.equal(row.actor, 'k-developer');
  assert.equal(row.score.failedAttempts, 2);
  assert.equal(row.applied, true);
  assert.deepEqual(row.problems, []);
});

test('an orchestrator run with no delegation is orchestrator-direct, a specialist entry run is entry, and a session without a delegate event is flagged', () => {
  const r = root();
  const direct = [];
  finish(direct, 'CRITICAL: a\nIMPORTANT: b');
  const d = score(mkRun(r, { task: U2, rep: 1, agent: 'konductor', events: direct }));
  assert.equal(d.position, 'orchestrator-direct');
  assert.equal(d.delegated, false);
  const entry = score(mkRun(r, { task: U2, rep: 2, agent: 'k-quality-assurance', events: [...direct] }));
  assert.equal(entry.position, 'entry');
  const wrongOwner = [];
  const cid = delegate(wrongOwner, 'k-tpm');
  delegateDone(wrongOwner, cid, 'ok');
  finish(wrongOwner, 'done');
  const w = score(mkRun(r, { task: U2, rep: 3, agent: 'konductor', events: wrongOwner }));
  assert.equal(w.position, 'orchestrator-direct');
  assert.deepEqual(w.delegations, ['k-tpm']);
  const mismatch = score(mkRun(r, { task: U2, rep: 4, agent: 'konductor', events: [...direct], sessions: [{ agentType: 'konductor' }, { agentType: 'k-quality-assurance' }] }));
  assert.ok(mismatch.problems.some((p) => p.startsWith('attribution mismatch')));
});

// ---- skill lookups ----

test('skill lookups: deferral failures, load_resource(skill::*) refusals, SKILL.md reads and constraints loads are counted apart', () => {
  const r = root();
  const e = [];
  deferredGetSkill(e, 'constraints');
  loadSkillResource(e, 'constraints');
  loadSchema(e);
  getSkill(e, 'constraints');
  tool(e, 'Read File', { path: 'skills/status-reporting/SKILL.md' }, 'text');
  finish(e, 'ok');
  const row = score(mkRun(r, { task: U2, agent: 'k-quality-assurance', events: e }));
  assert.equal(row.skills.lookups, 4);
  assert.equal(row.skills.getSkill, 2);
  assert.equal(row.skills.loadResourceSkill, 1);
  assert.equal(row.skills.readSkillMd, 1);
  assert.equal(row.skills.deferralFailures, 1);
  assert.equal(row.skills.resourceSkillFailed, 1);
  assert.equal(row.skills.failed, 2);
  assert.equal(row.skills.constraintsNamed, 3);
  assert.equal(row.skills.constraintsLoaded, true);
});

test('a successful load_resource(skill::constraints) counts as a load', () => {
  const r = root();
  const e = [];
  loadSkillResource(e, 'constraints', true);
  finish(e, 'ok');
  const row = score(mkRun(r, { task: U2, agent: 'k-quality-assurance', events: e }));
  assert.equal(row.skills.constraintsLoaded, true);
  assert.equal(row.skills.resourceSkillFailed, 0);
});

test('find_skills results that list constraints are noted but are not a load', () => {
  const r = root();
  const e = [];
  tool(e, '@konductor-skills/find_skills', { tool_id: 'tool::konductor-skills::find_skills', arguments: { query: 'rules' } }, '{"skills":[{"name":"constraints"}]}');
  finish(e, 'ok');
  const row = score(mkRun(r, { task: U2, agent: 'k-quality-assurance', events: e }));
  assert.equal(row.skills.constraintsListed, true);
  assert.equal(row.skills.constraintsLoaded, false);
  assert.equal(row.skills.failed, 0);
});

// ---- errno ----

test('errno 38 in stderr or a tool result marks the run and excludes it', () => {
  const r = root();
  const e = [];
  tool(e, 'Write File', { path: 'out/test-plan.md' }, 'write failed: Function not implemented', { status: 'failed' });
  finish(e, 'could not write');
  const a = score(mkRun(r, { task: U1, rep: 1, agent: 'k-quality-assurance', events: e }));
  assert.equal(a.sandboxErrno, true);
  assert.equal(a.usable, false);
  assert.equal(a.excludedReason, 'sandboxErrno');
  const f = [];
  finish(f, 'ok');
  const b = score(mkRun(r, { task: U2, rep: 2, agent: 'k-quality-assurance', events: f, stderr: 'spawn failed with Error 38 (ENOSYS)\n' }));
  assert.equal(b.sandboxErrno, true);
  assert.equal(b.errnoHits[0].source, 'stderr.txt');
  const c = score(mkRun(r, { task: U2, rep: 3, agent: 'k-quality-assurance', events: [...f] }));
  assert.equal(c.sandboxErrno, false);
});

// ---- canary ----

test('canary: the exact token in the final text is applied, "none" is not, and a made-up token is flagged', () => {
  const r = root();
  const yes = [];
  finish(yes, `Canary token: ${TOKEN}. There are 4 files.`);
  const a = score(mkRun(r, { arm: 'k-canary', task: 'probe-canary', rep: 1, agent: 'k-tpm', events: yes }), { token: TOKEN });
  assert.equal(a.applied, true);
  const no = [];
  finish(no, 'None. There are 4 files.');
  assert.equal(score(mkRun(r, { arm: 'k-canary', task: 'probe-canary', rep: 2, agent: 'k-tpm', events: no }), { token: TOKEN }).applied, false);
  const fake = [];
  fake.push(say('Token: kd-canary-ffffffff'));
  finish(fake, 'Token: kd-canary-ffffffff. 4 files.');
  const f = score(mkRun(r, { arm: 'k-canary', task: 'probe-canary', rep: 3, agent: 'k-tpm', events: fake }), { token: TOKEN });
  assert.equal(f.applied, false);
  assert.equal(f.score.wrongToken, true);
});

test('canary delivered through a tool result or the assembled prompt is seen even when the final text omits it', () => {
  const r = root();
  const e = [];
  loadSchema(e);
  tool(e, '@konductor-skills/get_skill', { tool_id: 'tool::konductor-skills::get_skill', arguments: { name: 'constraints' } }, JSON.stringify({ name: 'constraints', content: `---\nname: constraints\n---\nCANARY ${TOKEN}` }));
  finish(e, 'None.');
  const row = score(mkRun(r, { arm: 'k-canary-forced', task: 'probe-canary', agent: 'k-tpm', events: e, sessions: [{ agentType: 'k-tpm', content: `prompt ${TOKEN}` }] }), { token: TOKEN });
  assert.equal(row.score.inFinal, false);
  assert.equal(row.score.inToolResult, true);
  assert.equal(row.score.inPrompt, true);
});

// ---- fingerprints ----

test('fingerprints are found in a tool result and in the assembled prompt, with arrows and spacing normalised', () => {
  const r = root();
  const e = [];
  getSkill(e, 'constraints');
  tool(e, 'Read File', { path: 'x' }, 'text', {});
  tool(e, '@konductor-skills/get_skill', { tool_id: 'tool::konductor-skills::get_skill', arguments: { name: 'constraints' } }, JSON.stringify({ name: 'constraints', content: 'x\nDo not attempt  a third\nfix.\nExplain: root cause -> intermediate effects -> observed symptom' }));
  finish(e, 'ok');
  const row = score(mkRun(r, { task: U2, agent: 'k-quality-assurance', events: e, sessions: [{ agentType: 'k-quality-assurance', content: 'Always present findings as CRITICAL \u2192 IMPORTANT \u2192 SUGGESTION' }] }));
  assert.equal(row.fingerprints.U3.toolResult, true);
  assert.equal(row.fingerprints.U3b.toolResult, true);
  assert.equal(row.fingerprints.U2.prompt, true);
  assert.equal(row.fingerprints.U1.prompt, false);
  assert.equal(row.fingerprints.R1.toolResult, false);
});

// ---- decision table ----

const fake = (arm, probe, n, applied, extra = {}) => Array.from({ length: n }, (_, i) => ({
  arm, probe, task: 't', rep: i, position: 'entry', usable: true, applied: i < applied, skills: { constraintsLoaded: false }, score: {}, ...extra,
}));
const canaryRows = (arm, n, shown) => fake(arm, 'canary', n, shown, { score: { tokenKnown: true } });
const forcedLoaded = (arm, probe, n, applied, loaded) => fake(arm, probe, n, applied).map((r, i) => ({ ...r, skills: { constraintsLoaded: i < loaded } }));
const byId = (d, id2) => d.rows.find((x) => x.id === id2);

test('decision: forced clearly beats as-is on a probe (row B supported, D not supported)', () => {
  const rows = [
    ...fake('k-main', 'U1', 10, 1), ...forcedLoaded('k-main-forced', 'U1', 10, 8, 10),
    ...fake('k-main', 'U2', 10, 2), ...forcedLoaded('k-main-forced', 'U2', 10, 3, 10),
    ...fake('k-main', 'U3', 10, 0), ...forcedLoaded('k-main-forced', 'U3', 10, 1, 10),
    ...canaryRows('k-canary', 6, 0), ...canaryRows('k-canary-forced', 6, 6),
  ];
  const d = P.decide(rows);
  assert.equal(byId(d, 'B').verdict, 'supported');
  assert.equal(byId(d, 'B').perProbe.U1, 'supported');
  assert.equal(byId(d, 'B').perProbe.U2, 'not supported');
  assert.equal(byId(d, 'D').verdict, 'not supported');
  assert.equal(byId(d, 'C').verdict, 'supported');
  assert.match(byId(d, 'B').counts[0], /U1: as-is 1\/10, forced 8\/10/);
});

test('decision: forced about equal to as-is on every probe and the canary shows the token (rows C and D supported, B not supported)', () => {
  const rows = [
    ...fake('k-main', 'U1', 10, 6), ...forcedLoaded('k-main-forced', 'U1', 10, 7, 10),
    ...fake('k-main', 'U2', 10, 8), ...forcedLoaded('k-main-forced', 'U2', 10, 8, 10),
    ...fake('k-main', 'U3', 8, 4), ...forcedLoaded('k-main-forced', 'U3', 8, 5, 8),
    ...canaryRows('k-canary', 6, 2), ...canaryRows('k-canary-forced', 6, 5),
  ];
  const d = P.decide(rows);
  assert.equal(byId(d, 'D').verdict, 'supported');
  assert.equal(byId(d, 'C').verdict, 'supported');
  assert.equal(byId(d, 'B').verdict, 'not supported');
});

test('decision: the canary never shows the token and k-main matches the no-skills arm (row A supported); without a k-none arm it is inconclusive', () => {
  const base = [
    ...fake('k-main', 'U1', 10, 1), ...fake('k-none', 'U1', 10, 1),
    ...fake('k-main', 'U2', 10, 2), ...fake('k-none', 'U2', 10, 2),
    ...fake('k-main', 'U3', 9, 0), ...fake('k-none', 'U3', 9, 1),
    ...canaryRows('k-canary', 6, 0), ...canaryRows('k-canary-forced', 6, 6),
  ];
  assert.equal(byId(P.decide(base), 'A').verdict, 'supported');
  const noNone = base.filter((r) => r.arm !== 'k-none');
  assert.equal(byId(P.decide(noNone), 'A').verdict, 'inconclusive');
  const shows = base.map((r) => (r.arm === 'k-canary' && r.rep === 0 ? { ...r, applied: true } : r));
  assert.equal(byId(P.decide(shows), 'A').verdict, 'not supported');
});

test('decision: a failed positive control makes the canary rows inconclusive, and too few runs make a probe inconclusive', () => {
  const rows = [
    ...fake('k-main', 'U1', 10, 1), ...forcedLoaded('k-main-forced', 'U1', 10, 8, 10),
    ...fake('k-main', 'U2', 5, 1), ...forcedLoaded('k-main-forced', 'U2', 5, 4, 5),
    ...fake('k-main', 'U3', 10, 1), ...forcedLoaded('k-main-forced', 'U3', 10, 1, 10),
    ...canaryRows('k-canary', 6, 0), ...canaryRows('k-canary-forced', 6, 2),
  ];
  const d = P.decide(rows);
  assert.equal(d.canary.controlPasses, false);
  assert.equal(byId(d, 'A').verdict, 'inconclusive');
  assert.equal(byId(d, 'D').verdict, 'not supported', 'U1 differs, so row D is false whatever the canary says');
  assert.equal(d.canary.shows, 'inconclusive');
  assert.equal(d.byProbe.U2.beats, 'inconclusive');
  assert.equal(byId(d, 'B').perProbe.U2, 'inconclusive');
  assert.equal(byId(d, 'B').verdict, 'supported');
});

test('decision: when forcing did not make the agents load the skill, forced-versus-as-is rows are inconclusive', () => {
  const rows = [
    ...fake('k-main', 'U1', 10, 1), ...forcedLoaded('k-main-forced', 'U1', 10, 8, 2),
    ...fake('k-main', 'U2', 10, 1), ...forcedLoaded('k-main-forced', 'U2', 10, 1, 2),
    ...fake('k-main', 'U3', 10, 1), ...forcedLoaded('k-main-forced', 'U3', 10, 1, 2),
    ...canaryRows('k-canary', 6, 0), ...canaryRows('k-canary-forced', 6, 6),
  ];
  const d = P.decide(rows);
  assert.equal(d.took.took, false);
  assert.equal(byId(d, 'B').verdict, 'inconclusive');
  assert.equal(byId(d, 'C').verdict, 'inconclusive');
  assert.equal(d.canary.shows, 'not supported');
  assert.equal(byId(d, 'D').verdict, 'not supported', 'the canary did not show, so D fails on that part alone');
});

test('every decision row carries the counts behind it, and an action appears only on a supported row', () => {
  const d = P.decide([...fake('k-main', 'U1', 10, 1), ...forcedLoaded('k-main-forced', 'U1', 10, 8, 10)]);
  for (const row of d.rows) assert.ok(row.counts.length > 0 && row.counts.every((c) => c.length > 10), row.id);
  const md = P.renderMarkdown({ rows: [...fake('k-main', 'U1', 10, 1)], decision: d, args: {} });
  assert.match(md, /Thresholds, fixed before any data/);
  assert.match(md, /Verdict: \*\*inconclusive\*\*/);
  assert.doesNotMatch(md.split('### Row A')[1].split('### Row B')[0], /Action:/);
});

test('the pre-registered thresholds are the ones the study document names', () => {
  assert.deepEqual({ ...P.THRESHOLDS }, { beatDiff: 0.4, beatP: 0.10, minUsablePerSide: 8, equalDiff: 0.2, canaryAnyMin: 1, canaryForcedShare: 0.6, canaryControlMinRuns: 5, forcedTookMin: 0.5 });
});

// ---- command ----

test('probe-report writes the report files, honours the fractional scoring profile and reads the token from an arms file', () => {
  const r = root();
  const out = path.join(r, 'out');
  const e = [];
  finish(e, 'CRITICAL: a\nIMPORTANT: b\nSUGGESTION: c');
  mkRun(path.join(r, 'runs'), { task: U2, agent: 'k-quality-assurance', events: e });
  const c = [];
  finish(c, `Token ${TOKEN}`);
  mkRun(path.join(r, 'runs'), { arm: 'k-canary', task: 'probe-canary', agent: 'k-tpm', events: c });
  fs.writeFileSync(path.join(r, 'arms.json'), JSON.stringify({ canary: { token: TOKEN } }));
  const bench = path.join(__dirname, '..', 'bench.js');
  const res = spawnSync(process.execPath, [bench, 'probe-report', '--run', path.join(r, 'runs'), '--out', out, '--scoring', path.join(__dirname, '..', '..', 'profiles', 'scoring-fractional.json'), '--arms-file', path.join(r, 'arms.json')], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  for (const f of ['probe-report.md', 'probe-report.json', 'probe-runs.jsonl', 'judge-queue.json']) assert.ok(fs.existsSync(path.join(out, f)), f);
  const md = fs.readFileSync(path.join(out, 'probe-report.md'), 'utf8');
  assert.match(md, /passed \/ total/);
  assert.match(md, /Canary token: given, exact match/);
  assert.match(md, /\| k-canary \| 1 \| 1 \|/);
  const rows = fs.readFileSync(path.join(out, 'probe-runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(rows.every((x) => x.checksQuality === 50));
  assert.ok(!md.includes(TOKEN));
});

test('probe-report refuses a missing --run or --out and a directory with no runs', () => {
  const bench = path.join(__dirname, '..', 'bench.js');
  assert.notEqual(spawnSync(process.execPath, [bench, 'probe-report', '--out', '/tmp/x'], { encoding: 'utf8' }).status, 0);
  const r = root();
  assert.notEqual(spawnSync(process.execPath, [bench, 'probe-report', '--run', r, '--out', path.join(r, 'o')], { encoding: 'utf8' }).status, 0);
});
