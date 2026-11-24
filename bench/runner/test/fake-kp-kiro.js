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
//   FAKE_KP_BROKEN_FIRST, FAKE_KP_COUNTER, FAKE_KP_SEE_LEDGER  see below

const fs = require('node:fs');
const path = require('node:path');

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
  const answer = prompt.slice(prompt.indexOf('Answer:\n<<<'));
  // A dose ladder answer (authored, no unit mark): like the stub judge, an oracle that marks MISSING the item a planted
  // defect breaks, so the ladder control passes (FAKE_KP_NO_ORACLE=1 turns it off, and the ladder then fails).
  const ladder = process.env.FAKE_KP_NO_ORACLE ? { tasks: [] } : JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'cap', 'controls', 'dose-ladder-v1.json'), 'utf8'));
  const defects = ladder.tasks.flatMap((t) => t.defects.map((d) => ({ item: d.rubric_item, edits: Array.isArray(d.edits) ? d.edits : [{ find: d.find, replace: d.replace }] })));
  const broken = (i) => defects.some((d) => d.item === i && d.edits.every((e) => !answer.includes(e.find) && answer.includes(e.replace)));
  const isLadder = !process.env.FAKE_KP_NO_ORACLE && !answer.includes('Reply:');
  // Otherwise, like the stub: an item of the request-only checklist (reading A, the fake writer's "meets point" items)
  // is met by any answer, and a rubric item (reading B) only by the keep arm, whose answer carries the unit's mark. So
  // the convention control shows a B gain with A near 0, as it must.
  const items = prompt.slice(prompt.indexOf('Checklist:\n'), prompt.indexOf('\n\nAnswer:')).split('\n').slice(1);
  const met = (i) => /meets point/.test(items[i] ?? '') || answer.includes('UNIT-LOADED') || i === 0;
  reply = { labels: Array.from({ length: n }, (_, i) => (isLadder ? (broken(i) ? 'MISSING' : 'MET') : met(i) ? 'MET' : 'MISSING')) };
  // FAKE_KP_TITLE_CASE=1: labels spelled Met / Missing, which a judge model may do.
  if (process.env.FAKE_KP_TITLE_CASE) reply.labels = reply.labels.map((l) => l[0] + l.slice(1).toLowerCase());
} else {
  kind = 'answer';
  reply = null;
}
// FAKE_KP_BROKEN_FIRST=<kind>:<n> with FAKE_KP_COUNTER=<file>: only the first n calls of that kind reply with no JSON.
let brokenFirst = false;
if (process.env.FAKE_KP_BROKEN_FIRST && process.env.FAKE_KP_COUNTER) {
  const [k, n] = process.env.FAKE_KP_BROKEN_FIRST.split(':');
  if (k === kind) {
    const seen = fs.existsSync(process.env.FAKE_KP_COUNTER) ? Number(fs.readFileSync(process.env.FAKE_KP_COUNTER, 'utf8')) : 0;
    fs.writeFileSync(process.env.FAKE_KP_COUNTER, String(seen + 1));
    brokenFirst = seen < Number(n);
  }
}
// FAKE_KP_SEE_LEDGER=<ledger>:<copy>: copies the ledger as it stands during the call (the reservation test).
if (process.env.FAKE_KP_SEE_LEDGER) {
  const [from, to] = process.env.FAKE_KP_SEE_LEDGER.split(':');
  fs.copyFileSync(from, to);
}
// FAKE_KP_PROSE=1: the JSON reply of a judge comes wrapped in a sentence, which the strict reader refuses.
const json = reply && process.env.FAKE_KP_PROSE && kind === 'judge' ? `Here is my verdict: ${JSON.stringify(reply)} Hope that helps.` : reply && JSON.stringify(reply);
const text = process.env.FAKE_KP_BROKEN === kind || brokenFirst ? 'I cannot answer in JSON.' : reply ? json : `Reply: ${prompt.includes('<<<FILE') ? 'UNIT-LOADED ' : ''}every point answered.`;
// FAKE_KP_SLEEP_MS=<ms>: waits that long before answering (the kill test).
if (process.env.FAKE_KP_SLEEP_MS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.FAKE_KP_SLEEP_MS));
// FAKE_KP_ENV_OUT=<file>: writes the env the call was given (the env allowlist test).
if (process.env.FAKE_KP_ENV_OUT) fs.writeFileSync(process.env.FAKE_KP_ENV_OUT, JSON.stringify(process.env));
if (process.env.FAKE_KP_LOG) fs.appendFileSync(process.env.FAKE_KP_LOG, `${model} ${kind} ${process.env.HOME}\n`);
const line = (type, data) => process.stdout.write(`${JSON.stringify({ type, data })}\n`);
line('metadata', { sessionId: 'fake-kp', meteringUsage: [{ value: Number(process.env.FAKE_KP_CREDITS ?? 0.5), unit: 'credit' }] });
if (!process.env.FAKE_KP_UNFINISHED) line('runFinished', { status: 'success', stopReason: 'end_turn', finalText: text, finalTextTruncated: false });
