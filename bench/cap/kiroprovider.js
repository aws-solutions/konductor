// SPDX-License-Identifier: Apache-2.0
'use strict';

// The paid provider for keep-or-prune stages 2 to 4: the same { answer, writeChecklist, judge } interface as the stub
// (stubprovider.js), with every call a spend-checked one-turn kiro-cli call (paidcall.js). It runs only at quick depth
// (one answer per task and arm, no tools), which is what the first pilot needs.
//   answer    the subject model. The keep arm (`with`) gets the unit's text ahead of the request, under its kind's
//             frame line (an instruction file, a started SOP, or the agent it is); the drop arm (`without`) gets the
//             request alone.
//   checklist reading A: the writer model writes the items from the request alone. A given rubric (the dose ladder's)
//             is used as it is, with no call.
//   judge     each seat is its own model. It sees the checklist and the answer only, never the arm or the unit.
// Every reply is saved under `callsDir` by a hash of its model and prompt, so a rerun reads it back free.

const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../runner/lib/util.js');
const { paidCall, paidJson, ReplyUnreadable, jsonOf } = require('./paidcall.js');
const { labelsOf } = require('./judgereply.js');

const VERSION = 'kiro-cli-one-turn/1';
const LOADING_ARMS = new Set(['with', 'aa']);

/** The keep arm's prompt: the kind's frame line (units.js PAID_FRAME), the unit's text, then the request. */
const withUnit = (frame, text, request) => `${frame}\n<<<FILE\n${text}\nFILE>>>\n\n${request}`;

/**
 * The answer prompt of one arm: the keep arm gets the unit under its frame line, the drop arm the bare request. When
 * the subject carries a role line (`skill.role`, the kind's PAID_FRAME role, FW-36), both arms start with it, so the gap
 * measures the file and not knowing the role. A control's skill has no role, so its prompts never change.
 */
function answerPrompt(frame, skill, arm, request) {
  const loaded = Boolean(skill) && LOADING_ARMS.has(arm);
  const body = loaded ? withUnit(frame, skill.text, request) : request;
  return { loaded, prompt: skill?.role ? `${skill.role}\n\n${body}` : body };
}

const checklistPrompt = (request, count) => [
  `Write exactly ${count} checklist items that a good answer to the request below must meet. Base them on the request alone.`,
  'Each item is one statement a reader can check against an answer.',
  `Reply only with JSON: {"items": ["...", ...]} with exactly ${count} items.`, '', 'Request:', '<<<', request, '>>>',
].join('\n');

const judgePrompt = (checklist, answer) => [
  'Score one answer against a checklist. For each item, give MET, PARTIAL or MISSING.',
  `Reply only with JSON: {"labels": ["MET", ...]} with exactly ${checklist.length} labels, in item order.`, '', 'Checklist:',
  ...checklist.map((c, i) => `${i + 1}. ${c}`), '', 'Answer:', '<<<', answer, '>>>',
].join('\n');

/**
 * A paid provider. `paid` is paidCall's spend options { ledger, cap, workDir, bin, authDb }; `callsDir` holds the
 * saved replies; `writerModel` writes the request-only checklists; `frame` is the line the keep arm reads ahead of the
 * unit (PAID_FRAME[kind].answer). `subjectModel` is reported by checkDepth itself.
 */
function createKiroProvider({ paid, callsDir, writerModel, frame }) {
  if (!frame) throw new Error('the paid provider needs the frame line of the unit kind');
  const call = (kind, model, prompt) => ({ model, prompt, out: path.join(callsDir, kind, sha256(`${model}\n${prompt}`).slice(0, 24)), label: kind, ...paid });

  function answer({ request, skill, arm, replicate = 0, model }) {
    const { loaded, prompt } = answerPrompt(frame, skill, arm, request);
    // shortcut: quick depth only, so one answer per task and arm; a deep run needs a replicate in the key and full sessions.
    if (replicate) throw new Error('the paid provider runs quick depth only (one answer per task and arm)');
    return { text: paidCall(call('answer', model, prompt)).text, loaded, model, version: VERSION };
  }

  function writeChecklist({ request, rubric = null, count = 5 }) {
    if (Array.isArray(rubric) && rubric.length) return [...rubric];
    return paidJson(call('checklist', writerModel, checklistPrompt(request, count)), (j) => {
      if (!Array.isArray(j.items) || j.items.length !== count || !j.items.every((x) => typeof x === 'string' && x.trim())) throw new Error(`wanted ${count} items`);
      return j.items;
    }).value;
  }

  // Judge replies that could not be read: `reasked` got their one re-ask, `lost` were still unreadable after it.
  const stats = { reasked: 0, lost: 0 };

  // An unreadable reply is moved aside and asked once more (both calls are counted). If the re-ask cannot be read
  // either, the labels are null: scoreOf reads them as invalid and the task does not count (PANEL_RULES 3), and
  // `stats.lost` says how many, so a reading under 12 of 16 can name the cause.
  function judge({ seat, checklist, answer: text }) {
    const o = call('judge', seat, judgePrompt(checklist, text));
    // The strict reader: one JSON object, upper-case labels, one per item (judgereply.js); anything else is unreadable.
    const ask = () => paidJson(o, (labels) => labels, (text) => labelsOf(text, checklist.length)).value;
    let labels = null;
    try { labels = ask(); } catch (e) {
      if (!(e instanceof ReplyUnreadable)) throw e;
      stats.reasked += 1;
      try { labels = ask(); } catch (e2) {
        if (!(e2 instanceof ReplyUnreadable)) throw e2;
        stats.lost += 1;
      }
    }
    return { labels, version: `${VERSION} ${seat}` };
  }

  return { name: 'kiro', version: VERSION, answer, writeChecklist, judge, stats };
}

/** Where the paid provider saves the reply of one call (`<callsDir>/<kind>/<hash>.json`), so a plan can see it is cached. */
const savedReply = (callsDir, kind, model, prompt) => path.join(callsDir, kind, `${sha256(`${model}\n${prompt}`).slice(0, 24)}.json`);

/**
 * A free stand-in with the paid provider's prompts and cache keys, for a dry run: it makes no call, and counts each
 * call the paid run would make as cached (its saved reply exists, and is read back) or new. A new answer gets a
 * unique stand-in text, so the judgments of it count as new too. `sectionOf({ request, taskId })` names the section
 * (convention, ladder, unit) a call belongs to. Returns { provider, tally }: tally[section] = { calls, cached, new }.
 */
function createPlanProvider({ callsDir, writerModel, frame, sectionOf }) {
  const tally = {};
  const count = (section, cached) => {
    const t = (tally[section] ??= { calls: 0, cached: 0, new: 0 });
    t.calls += 1;
    if (cached) t.cached += 1; else t.new += 1;
  };
  const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).text;
  const seen = new Set();
  // A call made twice in one run is paid once (the second reads the first's saved reply).
  const once = (file, section) => {
    const cached = fs.existsSync(file);
    if (!seen.has(file)) count(section, cached);
    seen.add(file);
    return cached;
  };
  function answer({ request, skill, arm, model }) {
    const { loaded, prompt } = answerPrompt(frame, skill, arm, request);
    const file = savedReply(callsDir, 'answer', model, prompt);
    const text = once(file, sectionOf({ request })) ? read(file) : `NEW ANSWER ${sha256(`${model}\n${prompt}`)}`;
    return { text, loaded, model, version: VERSION };
  }
  function writeChecklist({ request, rubric = null, count: n = 5 }) {
    if (Array.isArray(rubric) && rubric.length) return [...rubric];
    const file = savedReply(callsDir, 'checklist', writerModel, checklistPrompt(request, n));
    // A cached checklist is read back, because the judge prompts (and so their cache keys) are built from its items.
    if (once(file, sectionOf({ request }))) return jsonOf(read(file)).items;
    return Array.from({ length: n }, (_, i) => `NEW ITEM ${i + 1} ${sha256(request)}`);
  }
  function judge({ seat, checklist, answer: text, taskId }) {
    const file = savedReply(callsDir, 'judge', seat, judgePrompt(checklist, text));
    once(file, sectionOf({ taskId }));
    return { labels: checklist.map(() => 'MET'), version: `${VERSION} ${seat}` };
  }
  return { provider: { name: 'plan', version: VERSION, answer, writeChecklist, judge }, tally };
}

module.exports = { VERSION, createKiroProvider, createPlanProvider, savedReply, withUnit, answerPrompt, checklistPrompt, judgePrompt };
