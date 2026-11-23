#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// A stand-in for `kiro-cli chat` in the paid keep-or-prune tests (cap-paid.test.js): it reads the prompt (the last
// argument), answers in the shape each step asks for, and prints a stream-json reply with one metering entry. No model,
// no network. Env:
//   FAKE_KP_LOG       a file that gets one line per call: "<model> <kind> <HOME>"
//   FAKE_KP_CREDITS   the credits each call reports (default 0.5)
//   FAKE_KP_FAIL      task ids the reviewer fails until the writer's fix (the fix adds " FIXED" to the prompt)
//   FAKE_KP_NOFIX     task ids the writer's fix leaves unchanged, so they fail the recheck and are dropped
//   FAKE_KP_BROKEN    a step kind (write, review, checklist, judge, answer) that replies with no JSON
//   FAKE_KP_UNFINISHED  any value: the call ends with no runFinished event

const fs = require('node:fs');

const args = process.argv.slice(2);
const model = args[args.indexOf('--model') + 1];
const prompt = args[args.length - 1];
const list = (name) => (process.env[name] ?? '').split(',').filter(Boolean);
const jsonAfter = (label, end) => JSON.parse(prompt.slice(prompt.indexOf(label) + label.length, prompt.indexOf(end, prompt.indexOf(label))));

let kind;
let reply;
if (prompt.startsWith('You write benchmark tasks')) {
  kind = 'write';
  const briefs = jsonAfter('Briefs:\n', '\n\nReply');
  reply = { tasks: briefs.map((b) => ({ id: b.id, prompt: `Situation: ${b.situation}. What do you do next?`, rubric: [`The answer ${b.good}.`, 'The answer names the next step.', 'The answer stays on the request.'] })) };
} else if (prompt.startsWith('You review benchmark tasks')) {
  kind = 'review';
  const tasks = jsonAfter('Tasks:\n', '\n\nReply');
  reply = { reviews: tasks.map((t) => ({ id: t.id, verdict: list('FAKE_KP_FAIL').includes(t.id) && !t.prompt.endsWith(' FIXED') ? 'fail' : 'pass', note: 'checked' })) };
} else if (prompt.startsWith('You wrote these benchmark tasks')) {
  kind = 'fix';
  const failed = jsonAfter('notes:\n', '\n\nReply');
  reply = { tasks: failed.map((t) => ({ id: t.id, prompt: list('FAKE_KP_NOFIX').includes(t.id) ? t.prompt : `${t.prompt} FIXED`, rubric: t.rubric })) };
} else if (prompt.startsWith('Write exactly')) {
  kind = 'checklist';
  const n = Number(/^Write exactly (\d+)/.exec(prompt)[1]);
  reply = { items: Array.from({ length: n }, (_, i) => `The answer meets point ${i + 1}.`) };
} else if (prompt.startsWith('Score one answer')) {
  kind = 'judge';
  const n = Number(/with exactly (\d+) labels/.exec(prompt)[1]);
  // The keep arm's answer carries the unit's mark, so the fake judges score it higher than the drop arm's.
  const answer = prompt.slice(prompt.indexOf('Answer:\n<<<'));
  reply = { labels: Array.from({ length: n }, (_, i) => (answer.includes('UNIT-LOADED') || i === 0 ? 'MET' : 'MISSING')) };
} else {
  kind = 'answer';
  reply = null;
}
const text = process.env.FAKE_KP_BROKEN === kind ? 'I cannot answer in JSON.' : reply ? JSON.stringify(reply) : `Reply: ${prompt.includes('<<<FILE') ? 'UNIT-LOADED ' : ''}every point answered.`;
if (process.env.FAKE_KP_LOG) fs.appendFileSync(process.env.FAKE_KP_LOG, `${model} ${kind} ${process.env.HOME}\n`);
const line = (type, data) => process.stdout.write(`${JSON.stringify({ type, data })}\n`);
line('metadata', { sessionId: 'fake-kp', meteringUsage: [{ value: Number(process.env.FAKE_KP_CREDITS ?? 0.5), unit: 'credit' }] });
if (!process.env.FAKE_KP_UNFINISHED) line('runFinished', { status: 'success', stopReason: 'end_turn', finalText: text, finalTextTruncated: false });
