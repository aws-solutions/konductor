// SPDX-License-Identifier: Apache-2.0
'use strict';

// Shared hidden-test helper for the T6 document tasks. One copy sits in the hidden directory of each task
// (hidden/<id>/hidden/doc-key.js); `tools/dryrun.js` refuses a copy that differs from this file.
//
// It reads the last ```json block of an output document, and for scripted-user tasks registers the standard suite:
// one test per hidden fact (found in one requirement), one for contradictions, one for invented numbers (precision),
// and one for the number of questions asked. The conversation comes from the file named by BENCH_CONVERSATION,
// which the runner writes for a scripted task (run-one.js): { "questions": [ { "turn", "text", "count", "matched" } ] }.
// With no BENCH_CONVERSATION (a check run outside the runner) the question count is 0.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** The text of `rel` under the workspace, or '' when it is missing. */
function readDoc(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
}

/** The parsed last ```json fenced block of `text`, or null when there is none or it does not parse. */
function lastJsonBlock(text) {
  const blocks = [...String(text).matchAll(/```json[^\n]*\n([\s\S]*?)\n\s*```/gi)];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try { return JSON.parse(blocks[i][1]); } catch { /* try the one before */ }
  }
  return null;
}

/** The block of `rel`, or {} so callers can read fields without null checks. */
const blockOf = (rel) => lastJsonBlock(readDoc(rel)) ?? {};

/** Items of an array field as strings: a string item as it is, an object item as the join of its string values. */
function itemTexts(list) {
  if (!Array.isArray(list)) return [];
  return list.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? Object.values(x).filter((v) => typeof v === 'string').join(' ') : '')).filter(Boolean);
}

/** Requirement texts of the block: each item's `text` plus any other string fields except `id`. */
function requirementTexts(block) {
  const reqs = Array.isArray(block?.requirements) ? block.requirements : [];
  return reqs.map((r) => {
    if (typeof r === 'string') return r;
    if (!r || typeof r !== 'object') return '';
    return Object.entries(r).filter(([k, v]) => k !== 'id' && typeof v === 'string').map(([, v]) => v).join(' ');
  }).filter(Boolean);
}

/** True when one text matches every regex of `all`. */
const matchesAll = (text, all) => all.every((re) => re.test(text));

/** Numbers in `text` as normalised strings ("2,000" -> "2000", "1.5" stays). 0 and 1 are ignored. */
function numbersIn(text) {
  const out = [];
  for (const m of String(text).matchAll(/(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])|(?<![\w.])\d+(?:\.\d+)?(?![\w])/g)) {
    const n = m[0].replace(/,/g, '');
    if (n !== '0' && n !== '1') out.push(n);
  }
  return out;
}

/** The conversation the harness recorded, or { questions: [] }. */
function conversation() {
  const f = process.env.BENCH_CONVERSATION;
  if (!f) return { questions: [] };
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return { questions: Array.isArray(j.questions) ? j.questions : [] };
  } catch { return { questions: [] }; }
}

/** Questions asked: per asking turn, its `count` when given, else the number of "?" in it, at least 1. */
function questionCount(conv) {
  return conv.questions.reduce((n, q) => n + (Number.isInteger(q.count) ? q.count : Math.max(1, (String(q.text).match(/\?/g) || []).length)), 0);
}

/** The scripted user's answer texts, from answers.json beside this file (written from task.scriptedUser by tools/dryrun.js). */
function scriptedAnswers() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'answers.json'), 'utf8')); } catch { return []; }
}

/**
 * Registers the standard scripted-user suite.
 * doc: output path. facts: [{ id, all: [RegExp], wrong?: [RegExp] }]. ground: fixture paths whose numbers may be used.
 * answers: the scripted user's answer texts (default answers.json). extraNumbers: other allowed numbers. minRequirements (3), maxQuestions (6), minPrecision (0.8).
 */
function scriptedSuite(test, assert, { doc, facts, answers = scriptedAnswers(), ground = [], extraNumbers = [], minRequirements = 3, maxQuestions = 6, minPrecision = 0.8 }) {
  const reqs = () => requirementTexts(blockOf(doc));
  for (const f of facts) {
    test(`states ${f.id}`, () => {
      assert.ok(reqs().some((t) => matchesAll(t, f.all)), `${f.id}: no requirement matches ${f.all.map(String).join(' and ')}`);
    });
  }
  test('no requirement contradicts a fact the user holds', () => {
    const r = reqs();
    assert.ok(r.length >= minRequirements, `${r.length} requirements, need ${minRequirements}`);
    const bad = facts.flatMap((f) => (f.wrong || []).filter((re) => r.some((t) => re.test(t))).map((re) => `${f.id} ${re}`));
    assert.deepEqual(bad, []);
  });
  test(`at least ${Math.round(minPrecision * 100)}% of requirements use no invented number`, () => {
    const r = reqs();
    assert.ok(r.length >= minRequirements, `${r.length} requirements, need ${minRequirements}`);
    const allowed = new Set([...answers.flatMap(numbersIn), ...ground.flatMap((g) => numbersIn(readDoc(g))), ...extraNumbers.map(String)]);
    const invented = r.filter((t) => numbersIn(t).some((n) => !allowed.has(n)));
    assert.ok((r.length - invented.length) / r.length >= minPrecision, `${invented.length} of ${r.length} use a number from nowhere: ${invented.slice(0, 3).join(' | ')}`);
  });
  test(`asks at most ${maxQuestions} questions`, () => {
    const n = questionCount(conversation());
    assert.ok(n <= maxQuestions, `${n} questions`);
  });
}

module.exports = { ROOT, readDoc, lastJsonBlock, blockOf, itemTexts, requirementTexts, matchesAll, numbersIn, conversation, questionCount, scriptedAnswers, scriptedSuite };
