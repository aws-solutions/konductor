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

/** The root session's reply text: every agent_message_chunk that is not a subagent's, joined in order. */
function mainText(events) {
  let out = '';
  for (const ev of events ?? []) {
    const u = ev.data?.update;
    if (ev.type !== 'sessionUpdate' || u?.sessionUpdate !== 'agent_message_chunk') continue;
    const k = u._meta?.kiro;
    if (k?.kind === 'agent-subtask' || k?.agentSubtaskId) continue;
    if (typeof u.content?.text === 'string') out += u.content.text;
  }
  return out;
}

// A line, with markdown bold or a list marker around it allowed: "**Plan: solo, because ...**", "- Review gate: ...".
const lineRe = (label) => new RegExp(`^[ \\t>*_-]*${label}:[ \\t]*(.*?)[ \\t*_]*$`, 'gim');
const linesOf = (text, label) => [...text.matchAll(lineRe(label))].map((m) => `${label}: ${m[1]}`.trim());

function planCall({ text, orch, expect }) {
  const plans = linesOf(text, 'Plan');
  const planLine = plans[0] ?? null;
  const word = planLine ? /^Plan:\s*(solo|team)\b/i.exec(planLine)?.[1]?.toLowerCase() ?? null : null;
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

module.exports = { mainText, planCall, planCallOfRunDir, planCallFields, linesOf, EXPECT, EXPECT_FILE };
