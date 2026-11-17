// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseJsonReply, parseJsonStrict } = require('../../judge/validate.js');
const { judgeOnce } = require('../../judge/run.js');

// Reply shapes copied from glm-5 rubric replies that failed as "not valid JSON" in a recorded study. Only the quoted run
// output is shortened.
const DOUBLED_OPEN = '{"criteria":[{"id":"investigated","verdict":"fail","evidence":"(nothing in the output)"},{"id":"verified","verdict":"pass","evidence":""`node --test` passes, 1431 tests including my 4 new ones"}]}';
const SPACE_THEN_QUOTE = '{"criteria":[{"id":"verified","verdict":"pass","evidence":" "**Cause:** when a table is open, the table rule asks the other block rules"}]}';
const DOUBLED_BOTH = '{"criteria":[{"id":"verified","verdict":"partial","evidence":""tests/test_cli_stdin.py" covers these cases, each with `html` on and off""}]}';
const CODE_BACKSLASH = '{"criteria":[{"id":"investigated","verdict":"pass","evidence":"Your repro now captures `\'\\x1b[?25l\\x1b[2K\'`"},{"id":"no-regression","verdict":"pass","evidence":".replace(/[\\s-]+/g, \'-\')"}]}';
const RETRACTED = '{"criteria":[{"id":"verified","verdict":"pass","evidence":" "}]}\n\n---\n\nI need to re-evaluate based on the output provided. Let me provide the correct JSON:';
const MISSING_COLON = '{"criteria":[{"id":"chg-scoped","verdict":"pass","evidence "--- src/slug.js (modified: +2 -1)"}]}';

test('a quote wrapped in its own quote marks is read, keeping the marks as text', () => {
  for (const reply of [DOUBLED_OPEN, SPACE_THEN_QUOTE, DOUBLED_BOTH]) assert.equal(parseJsonStrict(reply).ok, false, 'the strict parser rejects it');
  const a = parseJsonReply(DOUBLED_OPEN);
  assert.equal(a.repaired, true);
  assert.deepEqual(a.value.criteria.map((c) => c.id), ['investigated', 'verified']);
  assert.equal(a.value.criteria[1].evidence, '"`node --test` passes, 1431 tests including my 4 new ones');
  assert.equal(parseJsonReply(SPACE_THEN_QUOTE).value.criteria[0].evidence, ' "**Cause:** when a table is open, the table rule asks the other block rules');
  assert.equal(parseJsonReply(DOUBLED_BOTH).value.criteria[0].evidence, '"tests/test_cli_stdin.py" covers these cases, each with `html` on and off"');
});

test('a backslash JSON cannot read (\\x, \\s), copied from code into a quote, is kept as text', () => {
  assert.equal(parseJsonStrict(CODE_BACKSLASH).ok, false);
  const r = parseJsonReply(CODE_BACKSLASH);
  assert.equal(r.repaired, true);
  assert.equal(r.value.criteria[0].evidence, "Your repro now captures `'\\x1b[?25l\\x1b[2K'`");
  assert.equal(r.value.criteria[1].evidence, ".replace(/[\\s-]+/g, '-')");
  assert.equal(parseJsonReply('{"a":"tab\\tand \\"quoted\\" \\x"}').value.a, 'tab\tand "quoted" \\x', 'valid escapes keep their meaning');
});

test('prose after the JSON and a broken structure still fail, as does a valid reply nothing needed to repair', () => {
  assert.equal(parseJsonReply(RETRACTED).ok, false, 'the trailing prose takes the answer back');
  assert.equal(parseJsonReply(MISSING_COLON).ok, false);
  assert.equal(parseJsonReply('Sure! {"a":1}').ok, false);
  const clean = parseJsonReply('{"criteria":[{"id":"c1","verdict":"pass","evidence":"he said \\"yes\\", then left"}]}');
  assert.equal(clean.repaired, undefined);
  assert.equal(clean.value.criteria[0].evidence, 'he said "yes", then left');
  assert.equal(parseJsonReply('```json\n{"a":"b""}\n```').value.a, 'b"', 'a fenced reply is repaired too');
});

test('judgeOnce uses a repaired reply without a retry and marks the call', async () => {
  const rubric = [{ id: 'investigated' }, { id: 'verified' }];
  const prompts = [];
  const caller = async ({ prompt }) => { prompts.push(prompt); return { text: DOUBLED_OPEN, credits: 0, latencyMs: 1 }; };
  const check = (v) => (v.criteria.map((c) => c.id).join() === rubric.map((c) => c.id).join() ? { ok: true, criteria: v.criteria } : { ok: false, error: 'ids' });
  const out = await judgeOnce({ caller, model: 'glm-5', prompt: 'p', check });
  assert.equal(out.error, undefined);
  assert.equal(out.parseFailures, 0);
  assert.equal(prompts.length, 1);
  assert.equal(out.calls[0].jsonRepaired, true);
  assert.equal(out.value.criteria[1].verdict, 'pass');
});
