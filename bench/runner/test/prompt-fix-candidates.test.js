// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { applyEdits } = require('../../ops/prompt-fixes/build-candidates.js');
const { BASE, EDITS } = require('../../ops/prompt-fixes/edits.js');

const SPEC = 'agents/konductor.agent-spec.json';
const fakeRead = (files) => (rel) => {
  if (!(rel in files)) throw new Error(`no ${rel}`);
  return files[rel];
};
const spec = (prompt) => `${JSON.stringify({ name: 'konductor', config: { systemPrompt: prompt } }, null, 2)}\n`;

test('applyEdits: replace, span, move and append, in order, on files and on the prompt string', () => {
  const read = fakeRead({ 'a.md': 'one two three\n## X\nmoved\n## Y\nend\n', [SPEC]: spec('p1\n## T\ntodo\n## C\nc') });
  const out = applyEdits(read, [
    { fix: '1', file: 'a.md', before: 'two', after: 'TWO' },
    { fix: '2', file: 'a.md', from: '## X\n', to: '## Y\n', moveTo: 'b.md' },
    { fix: '3', file: `${SPEC}#systemPrompt`, from: '## T\n', to: '## C\n', after: '' },
    { fix: '4', file: `${SPEC}#systemPrompt`, append: '\nlast' },
  ]);
  assert.equal(out.get('a.md'), 'one TWO three\n## Y\nend\n');
  assert.equal(out.get('b.md'), '## X\nmoved\n');
  const j = JSON.parse(out.get(SPEC));
  assert.equal(j.config.systemPrompt, 'p1\n## C\nc\nlast');
  assert.equal(j.name, 'konductor');
});

test('applyEdits: a before text found zero or two times fails and names the fix', () => {
  const read = fakeRead({ 'a.md': 'x y x' });
  assert.throws(() => applyEdits(read, [{ fix: '9', file: 'a.md', before: 'x', after: 'z' }]), /fix 9.*found 2 times/);
  assert.throws(() => applyEdits(read, [{ fix: '8', file: 'a.md', before: 'nope', after: 'z' }]), /fix 8.*found 0 times/);
  assert.throws(() => applyEdits(read, [{ fix: '7', file: 'a.md', from: 'y', to: 'q', after: '' }]), /fix 7.*"q".*found 0 times/);
});

test('applyEdits: an edit sees the text the earlier edits left', () => {
  const read = fakeRead({ 'a.md': 'alpha' });
  const out = applyEdits(read, [{ fix: '1', file: 'a.md', before: 'alpha', after: 'beta' }, { fix: '2', file: 'a.md', before: 'beta', after: 'gamma' }]);
  assert.equal(out.get('a.md'), 'gamma');
});

test('variantArgs: one --replace and one --add flag, comma-joined (a repeated flag keeps only its last value)', () => {
  const { variantArgs } = require('../../ops/prompt-fixes/build-candidates.js');
  const a = variantArgs('/o');
  assert.equal(a.filter((x) => x === '--replace').length, 1);
  assert.equal(a.filter((x) => x === '--add').length, 1);
  assert.equal(a[a.indexOf('--replace') + 1].split(',').length, 3);
  assert.ok(a[a.indexOf('--replace') + 1].includes('context:k-direct-work=/o/context/k-direct-work.md'));
});

// The real edits against konductor c042c7ba, read from git (skipped when this clone lacks the commit).
const repo = path.join(__dirname, '..', '..', '..');
const hasBase = spawnSync('git', ['-C', repo, 'cat-file', '-e', `${BASE}^{commit}`]).status === 0;
test('the prompt-fix edits apply once each to konductor c042c7ba', { skip: !hasBase && 'no c042c7ba in this clone' }, () => {
  const read = (rel) => {
    const r = spawnSync('git', ['-C', repo, 'show', `${BASE}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`no ${rel} at ${BASE}`);
    return r.stdout;
  };
  const out = applyEdits(read, EDITS);
  const dw = out.get('context/k-direct-work.md');
  assert.match(dw, /^Decide how to work before your first write or spawn\./m);
  assert.match(dw, /\| The phase made \| Gate review\? \|/);
  assert.ok(dw.includes('when the user asks for one') && dw.includes('`design-evaluation` for a design or threat model'), 'konductor tests read these');
  const core = out.get('context/k-core-rules.md');
  assert.ok(!core.includes('## Specialist handoffs'));
  assert.match(out.get('context/k-specialist-rules.md'), /^## Specialist handoffs\n\nIf you are a `k-\*` specialist/);
  const prompt = JSON.parse(out.get(SPEC)).config.systemPrompt;
  for (const s of ['Then write your Plan line.', '`Review gate: ran <agent>`', '`UNRESOLVED:`', '## Self-Check', '`Skills: none fit`']) assert.ok(prompt.includes(s), s);
  for (const s of ['## TODO Tracking', '## Direct-Execution Exception', 'Mid-Conversation']) assert.ok(!prompt.includes(s), s);
  assert.ok(prompt.includes('a one-file change of at most 50 changed lines whose build, test and lint commands passed'));
  assert.ok(prompt.includes('unless it touches auth, secrets, data, or infrastructure. When you use this exemption, say so in your status report with the diff stat.'));
});
