// SPDX-License-Identifier: Apache-2.0
/**
 * The replay grader plugin: answers a judge call from a judgment already stored, so a stored run
 * can be judged again with no model call, no credential and no network. It is how anyone checks a
 * published verdict from stored files alone, and how CI runs the whole judging path offline.
 *
 * It implements the grader contract of run/judge.js (`runGrader`). A call is found by
 * `input_sha256`, the judge input digest of the call (provenance.js `judgmentInputs`). That digest
 * covers the template, the sanitizer rules, the request, the checklist, both cleaned answers with
 * their changed files, the order and the seat, and it leaves out the per-call marker id. So a
 * stored reply is found again whatever marker the new prompt carries, and it is only found when the
 * judge would see the same input.
 *
 * A key with no stored reply is an error, never a made-up reply. `canServe(digest)` lets the
 * driver check every pending call before it makes the first one, so a replay with a gap fails
 * before it writes anything.
 *
 * What is served: the stored `raw_text`, exactly. A stored judgment whose reply could not be read
 * (`unparsable`) is served as the same text, and the driver reads it as unparsable again. A stored
 * judgment that never had a reply (`refused`, `invalid`, `transient`) is served with its status
 * and whatever text it stored. Usage is null and cost is zero.
 *
 * Build one from stored judgments: `createReplayPlugin({ records })` takes judgment records, and
 * `replayFromStore(store, skills)` reads them from a run store (store.js).
 */
const { isSha256 } = require('../lib/provenance');

/** The plugin id a seat names to use this plugin. */
const REPLAY_PLUGIN_ID = 'replay';

/** The code of the error thrown for a key with no stored reply. */
const MISSING_REPLY = 'REPLAY_MISSING_REPLY';

const NO_REPLY = new Set(['refused', 'invalid', 'transient']);

function replayError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * @param {{ records: Iterable<object> }} options  stored judgment records
 * @returns {{ id: string, size: number, canServe(digest: string): boolean, runGrader(call: object): object }}
 */
function createReplayPlugin({ records }) {
  const replies = new Map(); // judge input digest -> { status, raw_text } | { conflict: true }
  for (const rec of records || []) {
    const digest = rec && rec.inputs && rec.inputs.judge_input_sha256;
    if (!isSha256(digest) || typeof rec.status !== 'string') continue;
    const reply = { status: rec.status, raw_text: typeof rec.raw_text === 'string' ? rec.raw_text : null };
    const have = replies.get(digest);
    if (have && (have.conflict || have.status !== reply.status || have.raw_text !== reply.raw_text)) {
      replies.set(digest, { conflict: true });
    } else {
      replies.set(digest, reply);
    }
  }

  return {
    id: REPLAY_PLUGIN_ID,
    size: replies.size,
    canServe: (digest) => isSha256(digest) && replies.has(digest) && !replies.get(digest).conflict,
    runGrader(call) {
      const digest = call && call.input_sha256;
      if (!isSha256(digest)) {
        throw new TypeError('replay: the call has no input_sha256, so no stored reply can be found');
      }
      const reply = replies.get(digest);
      if (!reply) {
        throw replayError(MISSING_REPLY, `replay: no stored reply for judge input ${digest}`);
      }
      if (reply.conflict) {
        throw replayError(
          MISSING_REPLY,
          `replay: two stored judgments share judge input ${digest} but disagree on the reply`,
        );
      }
      const status = NO_REPLY.has(reply.status) ? reply.status : 'ok';
      return { status, raw_text: reply.raw_text, usage: null, cost: { usd: 0 } };
    },
  };
}

/** A replay plugin over every stored judgment of `skills` (a skill name or an array of them). */
function replayFromStore(store, skills) {
  const list = Array.isArray(skills) ? skills : [skills];
  return createReplayPlugin({ records: list.flatMap((skill) => store.listJudgments(skill)) });
}

module.exports = { REPLAY_PLUGIN_ID, MISSING_REPLY, createReplayPlugin, replayFromStore };
