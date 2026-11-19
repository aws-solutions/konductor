// SPDX-License-Identifier: Apache-2.0
'use strict';

// The scripted user of the bench harness (scriptedToAutonomy + createOracle: topics are plain case-insensitive
// substrings, each fact is given once, anything else gets the default reply), played over a fixed list of asking
// turns for the free dry run. It returns the record the harness writes to BENCH_CONVERSATION for the hidden tests.
// No agent runs here: the reference's asks come from solutions/<id>/ASKS.json.

const { createOracle, scriptedToAutonomy } = require('../../../runner/lib/autonomy.js');

const FAKE_MAX_TURNS = 10;

/** { questions: [{ turn, text, matched, reply, count }] } for `asks` (one string per asking turn). */
function converse(task, asks) {
  const su = task.scriptedUser;
  if (!su) throw new Error(`${task.id} has no scriptedUser`);
  const oracle = createOracle({ ...scriptedToAutonomy(su), maxInterjections: FAKE_MAX_TURNS });
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
