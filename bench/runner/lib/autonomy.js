// SPDX-License-Identifier: Apache-2.0
'use strict';

// The autonomy tier: a scripted user answers the agent's questions from a fixed list, deterministically
// and without a model. This module holds the decisions (does an answer match, when is the cap hit, which
// result fields follow); the runner (run-one.js) only moves processes.

const fs = require('node:fs');
const path = require('node:path');
const { extractQuestion } = require('./stream.js');
const { questionsOf } = require('./ask-channel.js');

const DEFAULT_MAX_INTERJECTIONS = 4;
const DEFAULT_ANSWER = 'Use your best judgment and continue.';
const CAP_MESSAGE = 'Proceed with your best judgment now and do not ask further questions.';
const QUESTION_CHARS = 300;
const REPLY_CHARS = 600;

// Heuristic: the final message names its assumptions or says which option it picked.
const ASSUMPTION_RE = /\bassum(?:e|ed|es|ing|ption|ptions)\b|\bi (?:went with|chose|picked|decided|defaulted|opted)\b|\bdefault(?:ed)? to\b/i;

function normalizeAutonomy(a) {
  return {
    scripted: a.scripted === true,
    clarifications: a.clarifications || [],
    maxInterjections: a.maxInterjections ?? DEFAULT_MAX_INTERJECTIONS,
    defaultAnswer: a.defaultAnswer ?? DEFAULT_ANSWER,
    noQuestionNeeded: a.noQuestionNeeded === true,
  };
}

function clip(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

const escapeRegExp = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The autonomy block of a `questions: scripted` task (schema v3 `scriptedUser`): each hidden fact is a clarification whose
 * keywords are its topics, matched as case-insensitive substrings of the agent's question (not as patterns), and the default
 * reply answers anything else. A fact is given once. The cap leaves room for one question per fact and two more.
 */
function scriptedToAutonomy(scriptedUser) {
  const facts = scriptedUser.facts ?? [];
  return {
    scripted: true,
    clarifications: facts.map((f) => ({ id: f.id, topic: f.topics.join(', '), keywords: f.topics.map(escapeRegExp), answer: f.answer })),
    defaultAnswer: scriptedUser.defaultReply,
    maxInterjections: Math.max(DEFAULT_MAX_INTERJECTIONS, facts.length + 2),
  };
}

// A pattern that does not compile never matches: the validator rejects it up front, and a run must not die on it.
function compileKeywords(keywords) {
  const out = [];
  for (const k of keywords || []) {
    try { out.push(new RegExp(k, 'i')); } catch { /* skipped */ }
  }
  return out;
}

// The reply is the positional input of the agent CLI; a leading dash would be read as an option.
const safeLead = (text) => (text.startsWith('-') ? `Answer: ${text}` : text);

/**
 * The scripted user. reply(questionText) returns
 *   {text, matched, kind: 'clarification'|'default'|'cap', unmatched, counted}
 * or null once the proceed message was already sent. `counted` is true when the reply is an interjection.
 */
function createOracle(autonomy) {
  const a = normalizeAutonomy(autonomy);
  const compiled = a.clarifications.map((c) => ({ c, res: compileKeywords(c.keywords) }));
  const state = { interjections: 0, unmatched: 0, capHit: false, answered: new Set(), capSent: false };

  function reply(question) {
    if (state.capSent) return null;
    if (state.interjections >= a.maxInterjections) {
      state.capSent = true;
      state.capHit = true;
      return { text: CAP_MESSAGE, matched: [], kind: 'cap', unmatched: false, counted: false };
    }
    const text = String(question ?? '');
    const hits = compiled.filter(({ c, res }) => !state.answered.has(c.id) && res.some((re) => re.test(text))).map(({ c }) => c);
    state.interjections++;
    if (!hits.length) {
      state.unmatched++;
      return { text: safeLead(a.defaultAnswer), matched: [], kind: 'default', unmatched: true, counted: true };
    }
    for (const c of hits) state.answered.add(c.id);
    const body = hits.length === 1 ? hits[0].answer : hits.map((c, i) => `${i + 1}. ${c.answer}`).join('\n');
    return { text: safeLead(body), matched: hits.map((c) => c.id), kind: 'clarification', unmatched: false, counted: true };
  }
  return { reply, state };
}

/**
 * Tracks one multi-turn run. record(summary) is called after each turn that ended cleanly and returns the
 * reply to send, or null when the run is over (the agent did not ask, or it asked again after the proceed message).
 * record(null) counts a turn that did not end cleanly (timeout, error); that ends the run.
 */
function newConversation(autonomy) {
  const oracle = createOracle(autonomy);
  const conv = { turns: 0, questions: [], askedFirstTurn: null, oracle };
  conv.record = (summary) => {
    conv.turns++;
    if (!summary) return null;
    // One extractor for every harness (ask-channel.js questionsOf): the final text decides, a QUESTION: line counts as the
    // same question in prose, and no harness's own `askedUser` signal is read. `signal` and `markerLines` are diagnostics.
    // A turn the model stopped before its end (a stop reason other than end_turn, such as max_tokens) is not a question,
    // but it is answered with the default too, so the work can go on; `signal: "cut-off"` records it.
    const found = questionsOf(summary.finalText);
    const cutOff = !found.asked && Boolean(summary.stopReason) && summary.stopReason !== 'end_turn';
    const asked = found.asked || cutOff;
    if (conv.turns === 1) conv.askedFirstTurn = asked;
    if (!asked) return null;
    const text = cutOff ? extractQuestion(summary) : found.text;
    const count = cutOff ? 1 : found.count;
    const signal = cutOff ? 'cut-off' : found.markerLines ? 'marker' : 'prose';
    const q = { turn: conv.turns, text: clip(text.replace(/\s+/g, ' ').trim(), QUESTION_CHARS), count, signal, markerLines: found.markerLines, matched: [], answered: false, reply: '' };
    conv.questions.push(q);
    const r = oracle.reply(text);
    if (!r) return null;
    q.matched = r.matched;
    q.answered = true;
    q.reply = clip(r.text, REPLY_CHARS);
    return r;
  };
  return conv;
}

// The per-turn stream texts of a run, oldest first: stream-1.jsonl, stream-2.jsonl, ... for a multi-turn run, else stream.jsonl.
function turnStreamTexts(outDir) {
  const turns = [];
  for (let n = 1; fs.existsSync(path.join(outDir, `stream-${n}.jsonl`)); n++) turns.push(fs.readFileSync(path.join(outDir, `stream-${n}.jsonl`), 'utf8'));
  return turns.length ? turns : [fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8')];
}

function assumptionsStated(finalText) {
  return typeof finalText === 'string' && ASSUMPTION_RE.test(finalText);
}

const full = (t) => Boolean(t) && t.total > 0 && t.passed === t.total;

// intended and invariant come from aggregateGroup (null when the task has no such check).
function completedWithoutHelp({ autonomous, intendedTests, invariantTests }) {
  return autonomous === true && full(intendedTests) && full(invariantTests);
}

/**
 * The autonomy fields of a result. Null for a task without an autonomy block, so such results are unchanged.
 * `conv` is null when the run died before any turn started.
 */
function autonomyFields({ task, conv, checks, finalText, aggregateGroup }) {
  if (!task.autonomy) return null;
  const intendedTests = aggregateGroup(checks, 'intended');
  const invariantTests = aggregateGroup(checks, 'invariant');
  if (!conv || conv.turns === 0) {
    return {
      ...(task.autonomy.scripted ? { factsUnlocked: [], factsLocked: task.autonomy.clarifications.map((c) => c.id) } : {}),
      turns: 0, interjections: 0, questions: [], questionsAsked: 0, unmatchedQuestions: 0, askedFirstTurn: null, interjectionCapHit: false,
      autonomous: null, intendedTests, invariantTests, completedWithoutHelp: null, assumptionsStated: null,
    };
  }
  const s = conv.oracle.state;
  if (task.autonomy.scripted) {
    // Questions are expected on a scripted task, so "autonomous" and the no-help fields do not apply; the facts the agent drew out do.
    const ids = (task.autonomy.clarifications ?? []).map((c) => c.id);
    return {
      turns: conv.turns, interjections: s.interjections, questions: conv.questions, questionsAsked: conv.questions.length, unmatchedQuestions: s.unmatched,
      askedFirstTurn: conv.askedFirstTurn, interjectionCapHit: s.capHit, autonomous: null, intendedTests, invariantTests, completedWithoutHelp: null,
      assumptionsStated: assumptionsStated(finalText), factsUnlocked: ids.filter((id) => s.answered.has(id)), factsLocked: ids.filter((id) => !s.answered.has(id)),
    };
  }
  const autonomous = s.interjections === 0 && !s.capHit;
  return {
    turns: conv.turns,
    interjections: s.interjections,
    questions: conv.questions,
    questionsAsked: conv.questions.length,
    unmatchedQuestions: s.unmatched,
    askedFirstTurn: conv.askedFirstTurn,
    interjectionCapHit: s.capHit,
    autonomous,
    intendedTests,
    invariantTests,
    completedWithoutHelp: completedWithoutHelp({ autonomous, intendedTests, invariantTests }),
    assumptionsStated: assumptionsStated(finalText),
  };
}

module.exports = {
  turnStreamTexts, normalizeAutonomy, scriptedToAutonomy, createOracle, newConversation, autonomyFields, completedWithoutHelp, assumptionsStated, clip,
  CAP_MESSAGE, DEFAULT_ANSWER, DEFAULT_MAX_INTERJECTIONS, QUESTION_CHARS, REPLY_CHARS,
};
