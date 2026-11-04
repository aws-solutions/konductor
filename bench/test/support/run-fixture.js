// SPDX-License-Identifier: Apache-2.0
/**
 * A synthetic run for the judge driver and pipeline tests: tasks, stored pairs and a scripted
 * grader plugin. Answers are made of marker tokens (ZQHI for the arm with the skill, ZQLO for the
 * arm without), so the scripted grader can tell which answer is which in either presentation
 * order. Nothing here is a real run; models and families are placeholders.
 */
const { makePair, SKILL } = require('./records');
const { roster } = require('./roster');

const CONTEXT = Object.freeze({ skillName: SKILL, aliases: [] });
const START = Object.freeze({ 'CHANGELOG.md': '# Changelog\n' });

/** `count` tasks with ids task-1 ... task-N. */
function makeTasks(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${i + 1}`,
    task: `Request ${i + 1}: add the flag named flag-${i + 1} to the changelog.`,
    rubric: ['Names the flag.', 'Edits the changelog.'],
    target_section: `Section ${(i % 3) + 1}`,
  }));
}

const taskSetOf = (count, extra = {}) => ({ tasks: makeTasks(count), ...extra });

/**
 * Writes the with and without pair of every task into `store`. `checks(task, arm, n)` may return
 * the pair's `check_results` (n is the 1-based task index); undefined means the pair has none.
 */
function writePairs(
  store,
  tasks,
  { skill = SKILL, loaded = () => true, skip = () => false, checks = () => undefined } = {},
) {
  tasks.forEach((task, i) => {
    const n = i + 1;
    for (const arm of ['with', 'without']) {
      if (skip(task, arm)) continue;
      const token = arm === 'with' ? `ZQHI${n}` : `ZQLO${n}`;
      store.writePair(
        makePair({
          skill,
          taskId: task.id,
          arm,
          request: task.task,
          answer: `Reply ${token} for ${task.id}.`,
          start: { ...START },
          final: { 'CHANGELOG.md': `# Changelog\n- ${token} entry\n` },
          loaded: arm === 'with' ? loaded(task) : false,
          checkResults: checks(task, arm, n),
        }),
      );
    }
  });
}

/** Scores [with, without] for each task (by 1-based index) and seat (by 0-based index). */
const SCORES = Object.freeze({
  1: [[5, 2], [4, 2], [5, 3]],
  2: [[4, 2], [4, 3], [5, 2]],
  3: [[5, 3], [4, 2], [4, 2]],
  4: [[4, 3], [5, 2], [4, 3]],
  5: [[5, 2], [5, 3], [4, 2]],
  6: [[4, 2], [4, 2], [5, 3]],
  7: [[5, 3], [4, 3], [4, 2]],
  8: [[4, 2], [5, 2], [5, 2]],
});

const winnerOf = (a, b) => (a > b ? 'A' : b > a ? 'B' : 'TIE');

/** A reply on the overall scale for the scores given to answers A and B. */
const overallReply = (a, b) =>
  JSON.stringify({ winner: winnerOf(a, b), score_a: a, score_b: b, reason: 'scripted' });

/**
 * A grader plugin that reads the prompt to see which answer is which, then replies from `scores`.
 * `reply(ctx)` may override the reply text: ctx has { index, seatIndex, order, a, b, call }.
 * Every call it receives is kept in `plugin.calls`.
 */
function scriptedPlugin({ id = 'scripted', scores = SCORES, reply, status = 'ok', onCall } = {}) {
  const calls = [];
  const models = roster(8).map((s) => s.model);
  return {
    id,
    calls,
    runGrader(call) {
      calls.push(call);
      if (onCall) onCall(call, calls.length);
      const hi = call.prompt.indexOf('ZQHI');
      const lo = call.prompt.indexOf('ZQLO');
      const order = hi < lo ? 'with-first' : 'without-first';
      const index = Number(/ZQHI(\d+)/.exec(call.prompt)[1]);
      const seatIndex = models.indexOf(call.model);
      const [withScore, withoutScore] = scores[index][seatIndex];
      const [a, b] = order === 'with-first' ? [withScore, withoutScore] : [withoutScore, withScore];
      const text = reply ? reply({ index, seatIndex, order, a, b, call }) : overallReply(a, b);
      return { status, raw_text: text, usage: { input_tokens: 10, output_tokens: 5 }, cost: { usd: 0.001 } };
    },
  };
}

module.exports = { CONTEXT, START, SCORES, makeTasks, taskSetOf, writePairs, overallReply, scriptedPlugin };
