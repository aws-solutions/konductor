// SPDX-License-Identifier: Apache-2.0
// The judge family rule SR-24 (judge/family.js): no judge from the agent's own family, and an unknown family or a
// panel with no other family is unjudged, never a pass. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { familyOf, judgeSeats } = require('../../judge/family.js');

const seated = (r) => r.seats.filter((s) => s.seated).map((s) => s.model);

test('familyOf reads the family through provider paths and routing prefixes, and never guesses one', () => {
  assert.equal(familyOf('claude-sonnet-5.5'), 'claude');
  assert.equal(familyOf('global.anthropic.claude-opus-5-5'), 'claude');
  assert.equal(familyOf('openrouter/openai/gpt-5.1'), 'gpt');
  assert.equal(familyOf('deepseek-v3.2'), 'deepseek');
  assert.equal(familyOf('zai/glm-4.6'), 'glm');
  assert.equal(familyOf('auto'), null);
  assert.equal(familyOf('my-house-model-7'), null);
  assert.equal(familyOf(''), null);
  assert.equal(familyOf(undefined), null);
  assert.equal(familyOf('claude-vs-gpt-merge'), null, 'an id naming two families has no known family');
});

test('a Claude agent gets no Claude judge, and the other families are seated', () => {
  const r = judgeSeats({ subjectModel: 'claude-sonnet-5.5', judges: ['claude-opus-5', 'deepseek-v3.2', 'glm-4.6'] });
  assert.equal(r.judged, true);
  assert.deepEqual(seated(r), ['deepseek-v3.2', 'glm-4.6']);
  assert.match(r.seats[0].why, /agent's own family \(claude\)/);
});

test('an OpenAI agent gets no GPT judge', () => {
  const r = judgeSeats({ subjectModel: 'gpt-5.1', judges: ['gpt-5-mini', 'grok-4', 'qwen3-coder'] });
  assert.deepEqual(seated(r), ['grok-4', 'qwen3-coder']);
});

test('an agent of unknown family is unjudged, never a pass, whatever the panel', () => {
  const r = judgeSeats({ subjectModel: 'auto', judges: ['deepseek-v3.2', 'glm-4.6', 'grok-4'] });
  assert.equal(r.judged, false);
  assert.deepEqual(seated(r), []);
  assert.match(r.why, /unknown.*unjudged, never a pass \(SR-24\)/);
});

test('a panel with no judge from another family is unjudged; an unknown judge or a repeated family is not seated', () => {
  const same = judgeSeats({ subjectModel: 'claude-sonnet-5.5', judges: ['claude-opus-5', 'anthropic/claude-haiku-5'] });
  assert.equal(same.judged, false);
  assert.match(same.why, /no configured judge is from a family other than the agent's \(claude\)/);
  const odd = judgeSeats({ subjectModel: 'claude-sonnet-5.5', judges: ['mystery-1', 'deepseek-v3.2', 'deepseek-r2'] });
  assert.deepEqual(seated(odd), ['deepseek-v3.2']);
  assert.match(odd.seats[0].why, /unknown/);
  assert.match(odd.seats[2].why, /already has the deepseek family/);
});
