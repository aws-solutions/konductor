// SPDX-License-Identifier: Apache-2.0
'use strict';

// The nudge and filler hook arms (cap/nudge.js, `cap variant --hook`). A stub agent stands in for kiro-cli: it reads the
// built arm's agent spec, converts its hooks the way synth does for engine v3, runs the userPromptSubmit command with a
// JSON payload on stdin, and puts the hook's stdout in front of the prompt, which is what the model would see. No cargo,
// no model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeCapRepo, scratch, git } = require('./cap-helpers.js');
const { write } = require('./helpers.js');
const { buildVariant } = require('../../cap/variant.js');
const nudge = require('../../cap/nudge.js');
const { snapshotDir } = require('../lib/arm-source.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const skillMd = (name, desc) => `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nBody of ${name}. The answer is 42.\n`;
const DESCS = {
  constraints: 'Always-on rules. MUST USE for every task.',
  'decision-writing': "'Writes decision records. Use when drafting or reviewing a decision record (ADR, PDR, UXDR).'",
  'risk-management': 'Use when a plan needs its risks listed with likelihood, impact and mitigation.',
  'code-review': 'Use when reviewing a folder, repo, diff or PR for bugs.',
  'user-story-writing': 'Use when writing requirements as user stories with acceptance criteria.',
};

function files(repo) {
  for (const [n, d] of Object.entries(DESCS)) write(path.join(repo, `skills/${n}/SKILL.md`), skillMd(n, d));
  const spec = { schemaVersion: '1', name: 'konductor', config: { systemPrompt: 'Orchestrate.' }, dependencies: { skills: { skillNames: Object.keys(DESCS) } }, clientConfig: { kiroCli: { resources: [] } } };
  write(path.join(repo, 'agents/konductor.agent-spec.json'), `${JSON.stringify(spec, null, 2)}\n`);
}

function setup() {
  const root = scratch();
  const r = makeCapRepo(root, { files });
  const build = (hook) => buildVariant({ repo: r.repo, base: 'v0', scratch: path.join(root, 'scratch'), hook, agentEngine: 'v3' });
  return { root, build, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// The v3 hook document synth writes for a V2-shaped hook entry (kiro_cli_v3.rs convert_hook_entry).
const v3Hooks = (spec) => Object.entries(spec.clientConfig?.kiroCli?.hooks ?? {}).flatMap(([trigger, list]) => list.map((h, i) => ({
  name: `${trigger}-${i}`, trigger, action: { type: 'command', command: h.command }, timeout: Math.max(1, Math.ceil((h.timeout_ms ?? 10000) / 1000)),
})));

/** Stub agent: what reaches the model for one user turn on this arm tree. */
function stubAgentTurn(tree, prompt, payload = (p) => JSON.stringify({ hook_event_name: 'userPromptSubmit', cwd: '/w', prompt: p })) {
  const spec = JSON.parse(fs.readFileSync(path.join(tree, 'agents/konductor.agent-spec.json'), 'utf8'));
  const context = [];
  for (const h of v3Hooks(spec).filter((x) => x.trigger === 'userPromptSubmit')) {
    const r = spawnSync('sh', ['-c', h.action.command], { input: payload(prompt), encoding: 'utf8', timeout: h.timeout * 1000, env: { PATH: process.env.PATH } });
    assert.equal(r.status, 0, r.stderr);
    context.push(r.stdout);
  }
  return { context: context.join(''), prompt };
}

test('skillTrigger matches synth: Use sentence led by the summary, every-task marker, dashes, the 160-char cut', () => {
  assert.deepEqual(nudge.skillTrigger('Writes records. Use when drafting a record.'), { text: 'Writes records. Use when drafting a record.', everyTask: false });
  assert.deepEqual(nudge.skillTrigger('Use when x happens. More text.'), { text: 'Use when x happens.', everyTask: false });
  assert.equal(nudge.skillTrigger('Always on. MUST USE for every task.').everyTask, true);
  assert.equal(nudge.skillTrigger('Does A \u2014 then B. Use when needed.').text, 'Does A - then B. Use when needed.');
  const long = nudge.skillTrigger(`Use when ${'word '.repeat(60)}end.`).text;
  assert.ok(long.length <= 160 && long.endsWith('...'), long);
  assert.equal(nudge.skillTrigger('   '), null);
  assert.equal(nudge.unquote("'it''s'"), "it's");
});

test('buildIndex reads the spec list and frontmatter only, drops the every-task skill, keeps spec order', () => {
  const s = setup();
  try {
    const v = s.build('nudge');
    const idx = nudge.buildIndex(v.dir);
    assert.deepEqual(idx.map((x) => x.name), ['decision-writing', 'risk-management', 'code-review', 'user-story-writing']);
    assert.equal(idx[0].trigger, 'Writes decision records. Use when drafting or reviewing a decision record (ADR, PDR, UXDR).');
  } finally { s.done(); }
});

test('the nudge arm: the stub agent sees the top matches with their trigger lines, your call and no skill fits', () => {
  const s = setup();
  try {
    const v = s.build('nudge');
    assert.equal(v.armName, 'konductor-nudge');
    const { context } = stubAgentTurn(v.dir, 'Write a decision record for the deploy strategy, with its risks.');
    const lines = context.trimEnd().split('\n');
    assert.equal(lines[0], nudge.NUDGE_HEADER);
    assert.equal(lines.at(-1), nudge.NUDGE_FOOTER);
    assert.match(lines[1], /^ {2}decision-writing: Writes decision records\. Use when drafting/);
    assert.ok(lines.length - 2 <= 3, 'at most three skills');
    assert.match(context, /your call/);
    assert.match(context, /no skill fits/);
  } finally { s.done(); }
});

test('leak check: every hint line is a template line or an index line, so the hook adds no words of its own', () => {
  const s = setup();
  try {
    const v = s.build('nudge');
    const idx = nudge.buildIndex(v.dir);
    const allowed = new Set([nudge.NUDGE_HEADER, nudge.NUDGE_FOOTER, nudge.NUDGE_NONE, nudge.NUDGE_BROAD, ...idx.map((x) => `  ${x.name}: ${x.trigger}`)]);
    for (const p of ['Review this PR for bugs.', 'Plan the cutover and list risks.', 'Hello there.', '', 'requirements user stories acceptance']) {
      for (const line of stubAgentTurn(v.dir, p).context.trimEnd().split('\n')) assert.ok(allowed.has(line), `unexpected line: ${line}`);
    }
    assert.equal(stubAgentTurn(v.dir, 'Hello there.').context.split('\n')[1], nudge.NUDGE_NONE);
  } finally { s.done(); }
});

test('fairness: the hook program reads only stdin; it has no file, process-env, network or child-process access', () => {
  const s = setup();
  try {
    const cmd = JSON.parse(fs.readFileSync(path.join(s.build('nudge').dir, 'agents/konductor.agent-spec.json'), 'utf8')).clientConfig.kiroCli.hooks.userPromptSubmit[0].command;
    for (const bad of [/\brequire\s*\(/, /process\.env/, /readFile/, /\bimport\s*\(/, /child_process/, /\bfetch\s*\(/, /XMLHttpRequest/, /process\.argv/, /globalThis/]) assert.equal(bad.test(cmd), false, String(bad));
    assert.ok(cmd.startsWith("node -e '") && cmd.endsWith("'") && !cmd.slice(9, -1).includes("'"));
  } finally { s.done(); }
});

test('the hook reads a raw-text payload and a JSON payload with no prompt without failing', () => {
  const s = setup();
  try {
    const v = s.build('nudge');
    assert.match(stubAgentTurn(v.dir, 'review the diff', (p) => p).context, /code-review/);
    assert.equal(stubAgentTurn(v.dir, 'x', () => JSON.stringify({ cwd: '/w' })).context.split('\n')[1], nudge.NUDGE_NONE);
  } finally { s.done(); }
});

test('the filler arm: same hook shape, about the typical nudge size, names no skill and no tool', () => {
  const s = setup();
  try {
    const v = s.build('filler');
    assert.equal(v.armName, 'konductor-filler');
    const op = v.meta.ops.find((o) => o.op === 'hook');
    const { context } = stubAgentTurn(v.dir, 'Write a decision record.');
    assert.equal(context.split('\n')[0], nudge.FILLER_HEADER);
    assert.equal(context, stubAgentTurn(v.dir, 'Something else entirely.').context, 'the filler does not depend on the request');
    for (const n of [...Object.keys(DESCS), 'get_skill', 'skill', 'load']) assert.equal(context.toLowerCase().includes(n), false, n);
    const bytes = Buffer.byteLength(context);
    assert.ok(bytes <= op.fillerBytes && bytes > op.fillerBytes * 0.8, `${bytes} vs ${op.fillerBytes}`);
  } finally { s.done(); }
});

test('variant.json records the hook op with the command sha, and the build is reproducible', () => {
  const s = setup();
  try {
    const a = s.build('nudge');
    const op = a.meta.ops[0];
    const cmd = JSON.parse(fs.readFileSync(path.join(a.dir, 'agents/konductor.agent-spec.json'), 'utf8')).clientConfig.kiroCli.hooks.userPromptSubmit[0].command;
    assert.equal(op.op, 'hook');
    assert.equal(op.id, 'hook:nudge');
    assert.equal(op.commandSha256, sha(cmd));
    assert.equal(op.skills, 4);
    assert.equal(a.meta.variantHash, snapshotDir(a.dir).hash);
    const hash = a.meta.variantHash;
    const b = s.build('nudge');
    assert.equal(b.meta.variantHash, hash, 'same base, same hook: same tree');
    assert.notEqual(s.build('filler').meta.variantHash, hash);
    assert.throws(() => s.build('loud'), /--hook takes nudge or filler/);
  } finally { s.done(); }
});

test('a second userPromptSubmit hook is refused rather than stacked', () => {
  const root = scratch();
  try {
    const r = makeCapRepo(root, { files: (repo) => {
      files(repo);
      const f = path.join(repo, 'agents/konductor.agent-spec.json');
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.clientConfig.kiroCli.hooks = { userPromptSubmit: [{ command: 'true' }] };
      fs.writeFileSync(f, JSON.stringify(j));
    } });
    assert.throws(() => buildVariant({ repo: r.repo, base: 'v0', scratch: path.join(root, 'scratch'), hook: 'nudge' }), /already has a userPromptSubmit hook/);
    assert.ok(git);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preview gives the hits, the rank-1 margin and the exact text the hook prints', () => {
  const s = setup();
  try {
    const v = s.build('nudge');
    const idx = nudge.buildIndex(v.dir);
    const p = 'Review this PR diff for bugs.';
    const pv = nudge.preview(idx, p);
    assert.equal(pv.hits[0].name, 'code-review');
    assert.ok(pv.margin > 0 && pv.margin <= 1);
    assert.equal(pv.text, stubAgentTurn(v.dir, p).context);
  } finally { s.done(); }
});

test('nudge-check: hook seen from the session record, the hook source alone does not count, full and preview loads apart', () => {
  const { checkRuns, hookSeen } = require('../../cap/nudgecli.js');
  const root = scratch();
  try {
    const runDir = (arm, rep, messages, stream = '') => {
      const d = path.join(root, 'run', arm, 't1', String(rep));
      write(path.join(d, 'result.json'), JSON.stringify({ armId: arm, taskId: 't1', replicate: rep, status: 'success', credits: 2, toolCalls: 4, finalText: rep === 2 ? 'No skill fits, so I wrote it directly.' : 'Done.' }));
      write(path.join(d, 'stream.jsonl'), stream);
      write(path.join(d, 'session/sess_1/messages.jsonl'), messages);
      return d;
    };
    const printed = (text) => `${JSON.stringify({ payload: { type: 'user', content: text } })}\n`;
    const hint = `${nudge.NUDGE_HEADER}\n  a: Use when a.\n${nudge.NUDGE_FOOTER}\n`;
    const source = `${JSON.stringify({ payload: { type: 'config', hooks: [{ command: `node -e '${JSON.stringify({ header: nudge.NUDGE_HEADER })}'` }] } })}\n`;
    const preview = JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: 'c1', title: '@konductor-skills/get_skill', rawInput: { tool_id: 'tool::konductor-skills::get_skill', arguments: { name: 'big' } }, _meta: { kiro: { serverName: 'konductor-skills' } } } } })
      + '\n' + JSON.stringify({ type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', rawOutput: { response: '{"name":"big","content":"---', message: 'The output from "x" (40,000 chars) exceeded the 30,000-char limit; here is a preview of the tool\'s result:' } } } });
    assert.equal(hookSeen(runDir('konductor-nudge', 1, printed(hint), preview), nudge.NUDGE_HEADER), true);
    assert.equal(hookSeen(runDir('konductor-nudge', 2, source), nudge.NUDGE_HEADER), false, 'the header inside the hook source is not the printed text');
    runDir('konductor-filler', 1, printed(nudge.fillerText(300)));
    const rows = checkRuns([path.join(root, 'run')]);
    const by = (arm, rep) => rows.find((r) => r.armId === arm && r.replicate === rep);
    assert.equal(by('konductor-nudge', 1).hookSeen, true);
    assert.deepEqual(by('konductor-nudge', 1).skillsLoaded, ['big']);
    assert.deepEqual(by('konductor-nudge', 1).skillsLoadedFull, []);
    assert.equal(by('konductor-nudge', 1).skillLoadsPreview, 1);
    assert.equal(by('konductor-nudge', 2).hookSeen, false);
    assert.equal(by('konductor-nudge', 2).saidNoSkillFits, true);
    assert.equal(by('konductor-filler', 1).hookSeen, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('matcher variants: the frozen one is v2-weighted, each variant runs in a hook, the hybrid adds the broad skills', () => {
  const s = setup();
  try {
    const v = s.build('nudge');
    const idx = nudge.buildIndex(v.dir);
    assert.equal(nudge.FROZEN_MATCHER, 'v2-weighted');
    assert.equal(v.meta.ops[0].matcher, 'v2-weighted');
    assert.deepEqual(Object.keys(nudge.MATCHERS), ['v1-overlap', 'v2-weighted', 'v3-desc', 'v4-hybrid']);
    const p = 'Plan the cutover and list its risks with likelihood and impact.';
    for (const name of Object.keys(nudge.MATCHERS)) {
      const out = spawnSync('sh', ['-c', nudge.hookCommand(nudge.nudgeSource(idx, name))], { input: JSON.stringify({ prompt: p }), encoding: 'utf8' });
      assert.equal(out.status, 0, out.stderr);
      assert.equal(out.stdout, nudge.preview(idx, p, name).text, name);
    }
    const hy = nudge.preview(idx, p, 'v4-hybrid');
    assert.match(hy.text, new RegExp(nudge.NUDGE_BROAD.replace(/[()]/g, '\\$&')));
    assert.equal(hy.hits.length + hy.broad.length <= 5, true);
    assert.ok(!hy.broad.some((b) => hy.hits.some((h) => h.name === b)), 'a broad skill already matched is not listed twice');
    assert.throws(() => nudge.matcherData(idx, 'v9'), /unknown matcher v9/);
  } finally { s.done(); }
});

test('strong stemming folds plural and -ation forms; name and Use-clause words outweigh the summary', () => {
  assert.deepEqual(nudge.tokens('validations requirements policies reviewing', 'strong'), ['valid', 'require', 'policy', 'review']);
  const idx = [{ name: 'risk-management', trigger: 'Tracks things. Use when listing risks.', description: '' }, { name: 'other', trigger: 'Lists risks a lot and risks more.', description: '' }, { name: 'third', trigger: 'Formats tables.', description: '' }];
  // A word every skill has gets idf 0, so the fixture needs a skill without it.
  const d = nudge.matcherData(idx, 'v2-weighted');
  assert.equal(d.skills[0].w.risk, 3, 'a name word gets weight 3');
  assert.equal(d.skills[0].w.list, 2, 'a Use-clause word gets weight 2');
  assert.equal(nudge.shownFor('What are the risks?', d)[0], 'risk-management');
});
