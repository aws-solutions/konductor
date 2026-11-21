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

// A "wrong" pattern names a claim that contradicts a fact ("Starter ... included"). A requirement that denies the claim
// ("Starter accounts are not included", "must not include payment card numbers") is correct, so a match counts only
// when no negation sits in the matched text or in the 40 characters before it, within the same sentence. A pattern that
// itself states a negation (/\bno\s+renewal/) is applied as it is.
const NEGATION = /\b(?:not|never|no|without|nor|excluded?|excluding|isn't|aren't|doesn't|don't|won't|cannot|can't|instead of|rather than)\b/i;
const statesNegation = (re) => /\b(?:no|not|never|without|cannot)\b/i.test(re.source.replace(/\\[a-zA-Z]/g, ' '));

/**
 * True when `text` makes the claim of the wrong pattern `re` (see NEGATION). Each sentence is read on its own, so a
 * pattern with `.*` does not join two sentences; a negation within 40 characters before or after the match, in the same
 * sentence, makes it a denial ("exactly-once delivery shall not be promised").
 */
function contradicts(text, re) {
  for (const s of String(text).split(/(?<=[.!?;])\s+/)) {
    if (statesNegation(re)) { if (re.test(s)) return true; continue; }
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of s.matchAll(g)) {
      if (!NEGATION.test(s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40))) return true;
      if (m[0] === '') break;
    }
  }
  return false;
}

/**
 * True when the requirements state the fact: every pattern of `all` matches one requirement, or together at most
 * three requirements (a correct document may put the format and the time zone of an export in two requirements).
 */
function statesFact(reqs, all) {
  if (reqs.some((t) => matchesAll(t, all))) return true;
  const hits = reqs.map((t) => all.map((re) => re.test(t)));
  const n = reqs.length;
  const covers = (...ix) => all.every((_, k) => ix.some((i) => hits[i][k]));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (covers(a, b)) return true;
    for (let c = b + 1; c < n; c++) if (covers(a, b, c)) return true;
  }
  return false;
}

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
 * answers: the scripted user's answer texts (default answers.json). extraNumbers: other allowed numbers. minRequirements (3),
 * maxQuestions (default: one per fact and two more, the scripted user's own cap), minPrecision (0.8).
 * A `wrong` pattern counts only where the requirement does not deny it (`contradicts`).
 */
function scriptedSuite(test, assert, { doc, facts, answers = scriptedAnswers(), ground = [], extraNumbers = [], minRequirements = 3, maxQuestions = facts.length + 2, minPrecision = 0.8 }) {
  const reqs = () => requirementTexts(blockOf(doc));
  for (const f of facts) {
    test(`states ${f.id}`, () => {
      assert.ok(statesFact(reqs(), f.all), `${f.id}: no one to three requirements match ${f.all.map(String).join(' and ')}`);
    });
  }
  test('no requirement contradicts a fact the user holds', () => {
    const r = reqs();
    assert.ok(r.length >= minRequirements, `${r.length} requirements, need ${minRequirements}`);
    const bad = facts.flatMap((f) => (f.wrong || []).filter((re) => r.some((t) => contradicts(t, re))).map((re) => `${f.id} ${re}`));
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
    // Only a document with requirements earns this test, so an empty answer does not get it for free.
    assert.ok(reqs().length >= minRequirements, `${reqs().length} requirements, need ${minRequirements}`);
    const n = questionCount(conversation());
    assert.ok(n <= maxQuestions, `${n} questions`);
  });
}

module.exports = { ROOT, readDoc, lastJsonBlock, blockOf, itemTexts, requirementTexts, matchesAll, contradicts, statesFact, numbersIn, conversation, questionCount, scriptedAnswers, scriptedSuite };
