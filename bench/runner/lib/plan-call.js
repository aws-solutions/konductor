// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plan call of one run (prompt-fix spec Part C, metrics 1 to 3). Reads the root session's reply text from
// stream.jsonl and finds the lines the adaptive prompt asks for: `Plan: solo|team ...`, `Plan changed: ...`,
// `Skills: ...` and `Review gate: ...`. A writer spawn is a spawn whose brief is not a review: orch.makerSpawns, the
// same split orch-metrics.js makes (fixes count as writers). Scored against the pre-registered expectation in
// bench/scenarios/konductor/prompt-fix/expect.json:
//   planRight    the Plan word matches expect.plan (null for 'proceed', scored on finishing instead, or no expectation)
//   actionRight  solo: no writer spawn; team: 2 or more (null as above)
//   reviewRight  always: a reviewer spawn ran; exempt-or-one: a reviewer ran or a Review gate line names an exemption
//                (null for not-needed or no expectation)

const fs = require('node:fs');
const path = require('node:path');
const { parseStream } = require('./stream.js');

const EXPECT_FILE = path.join(__dirname, '..', '..', 'scenarios', 'konductor', 'prompt-fix', 'expect.json');
const EXPECT = JSON.parse(fs.readFileSync(EXPECT_FILE, 'utf8'));

/** Whether a session update is a subagent's rather than the root session's. */
const isSubUpdate = (u) => u?._meta?.kiro?.kind === 'agent-subtask' || Boolean(u?._meta?.kiro?.agentSubtaskId);

/**
 * The root session's reply in order: `text`, every agent_message_chunk that is not a subagent's, and `tools`, each root
 * tool_call update with the text offset it came at ({ at, update }). Each message starts on a new line: the stream sends
 * no line break between two messages (a new replayId, or text after a tool call), so without one a placeholder message
 * ending `Skills: none fit` and the next message `Plan: solo, because ...` read as the one line `Skills: none fitPlan: ...`.
 */
function rootReply(events) {
  let text = '';
  const tools = [];
  let lastId = null;
  let afterTool = false;
  for (const ev of events ?? []) {
    const u = ev.data?.update;
    if (ev.type !== 'sessionUpdate' || !u || isSubUpdate(u)) continue;
    if (u.sessionUpdate === 'tool_call') {
      tools.push({ at: text.length, update: u });
      afterTool = true;
    } else if (u.sessionUpdate === 'agent_message_chunk' && typeof u.content?.text === 'string') {
      const id = u._meta?.kiro?.replayId ?? null;
      const newMessage = afterTool || (id !== null && lastId !== null && id !== lastId);
      if (newMessage && text && !text.endsWith('\n')) text += '\n';
      text += u.content.text;
      afterTool = false;
      if (id !== null) lastId = id;
    }
  }
  return { text, tools };
}

/** The root session's reply text (rootReply), one message per line start. */
const mainText = (events) => rootReply(events).text;

// A line, with markdown bold or a list marker around it allowed: "**Plan: solo, because ...**", "- Review gate: ...".
const lineRe = (label) => new RegExp(`^[ \\t>*_-]*${label}:[ \\t]*(.*?)[ \\t*_]*$`, 'gim');
const linesOf = (text, label) => [...text.matchAll(lineRe(label))].map((m) => `${label}: ${m[1]}`.trim());

const PLAN_WORD = /^Plan:\s*(solo|team)\b/i;
const planWord = (line) => PLAN_WORD.exec(line ?? '')?.[1]?.toLowerCase() ?? null;
/** The Plan line that counts: the first that names solo or team (a `Plan: after a read-only look` placeholder may come
 * before it), else the first Plan line, else null. */
const firstPlanLine = (plans) => plans.find((l) => planWord(l)) ?? plans[0] ?? null;

function planCall({ text, orch, expect }) {
  const planLine = firstPlanLine(linesOf(text, 'Plan'));
  const word = planWord(planLine);
  const gates = linesOf(text, 'Review gate');
  const reviewGateLine = gates.at(-1) ?? null;
  const writerSpawns = orch ? orch.makerSpawns ?? 0 : null;
  const reviewers = orch ? orch.reviewerSpawns ?? 0 : null;
  const scored = expect && (expect.plan === 'solo' || expect.plan === 'team');
  const actionOk = scored && orch ? (expect.plan === 'solo' ? writerSpawns === 0 : writerSpawns >= 2) : null;
  let reviewRight = null;
  if (expect?.review === 'always' && orch) reviewRight = reviewers > 0;
  else if (expect?.review === 'exempt-or-one' && orch) reviewRight = reviewers > 0 || /^Review gate:\s*not needed\b/i.test(reviewGateLine ?? '');
  return {
    planLine,
    plan: word,
    planChanged: linesOf(text, 'Plan changed'),
    skillsLine: linesOf(text, 'Skills')[0] ?? null,
    reviewGateLine,
    unresolved: /^[ \t*_-]*UNRESOLVED:/m.test(text),
    writerSpawns,
    planRight: scored ? word === expect.plan : null,
    actionRight: actionOk,
    reviewRight,
  };
}

/** The plan call of a run directory, or null when it has no stream. `taskId` picks the expectation. */
function planCallOfRunDir(runDir, taskId, orch) {
  const file = path.join(runDir, 'stream.jsonl');
  if (!fs.existsSync(file)) return null;
  const { events } = parseStream(fs.readFileSync(file, 'utf8'));
  return planCall({ text: mainText(events), orch, expect: EXPECT.tasks[taskId] ?? null });
}

/** The result.json fields: only for a pre-registered task or a run that wrote a Plan line, so other results keep their shape. */
function planCallFields(pc, taskId) {
  if (!pc || (!EXPECT.tasks[taskId] && pc.planLine === null)) return {};
  return { planCall: pc, planLine: pc.planLine, planRight: pc.planRight, writerSpawns: pc.writerSpawns, reviewGateLine: pc.reviewGateLine };
}

module.exports = { rootReply, mainText, planCall, planCallOfRunDir, planCallFields, linesOf, planWord, firstPlanLine, EXPECT, EXPECT_FILE };
