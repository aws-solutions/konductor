// SPDX-License-Identifier: Apache-2.0
'use strict';

// A stand-in for the scripted-user harness, for free dry runs only. It answers a list of asking turns from
// task.scriptedUser with the autonomy tier's oracle (topics are case-insensitive regexes, each fact answered once,
// no match gets the default reply) and returns the conversation record the hidden tests read from BENCH_CONVERSATION.
// shortcut: no model and no agent; it replays fixed question texts. Replace with the B3 harness once it lands.

const { createOracle } = require('../../../runner/lib/autonomy.js');

const FAKE_MAX_TURNS = 10;

/** { questions: [{ turn, text, matched, reply, count }] } for `asks` (one string per asking turn). */
function converse(task, asks) {
  const su = task.scriptedUser;
  if (!su) throw new Error(`${task.id} has no scriptedUser`);
  const oracle = createOracle({
    clarifications: su.facts.map((f) => ({ id: f.id, topic: f.id, keywords: f.topics, answer: f.answer })),
    defaultAnswer: su.defaultReply,
    maxInterjections: FAKE_MAX_TURNS,
  });
  const questions = [];
  asks.forEach((text, i) => {
    const r = oracle.reply(text);
    if (!r) return;
    questions.push({ turn: i + 1, text, matched: r.matched, reply: r.text, count: Math.max(1, (text.match(/\?/g) || []).length) });
  });
  return { questions };
}

/** Fact ids that no ask in `conv` unlocked. */
const unmatchedFacts = (task, conv) => {
  const got = new Set(conv.questions.flatMap((q) => q.matched));
  return task.scriptedUser.facts.map((f) => f.id).filter((id) => !got.has(id));
};

module.exports = { converse, unmatchedFacts, FAKE_MAX_TURNS };
