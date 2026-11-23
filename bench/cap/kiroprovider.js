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

const path = require('node:path');
const { sha256 } = require('../runner/lib/util.js');
const { paidCall, paidJson, ReplyUnreadable } = require('./paidcall.js');

const VERSION = 'kiro-cli-one-turn/1';
const LABELS = new Set(['MET', 'PARTIAL', 'MISSING']);
const LOADING_ARMS = new Set(['with', 'aa']);

/** The keep arm's prompt: the kind's frame line (units.js PAID_FRAME), the unit's text, then the request. */
const withUnit = (frame, text, request) => `${frame}\n<<<FILE\n${text}\nFILE>>>\n\n${request}`;

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
    const loaded = Boolean(skill) && LOADING_ARMS.has(arm);
    const prompt = loaded ? withUnit(frame, skill.text, request) : request;
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

  /** The labels of a judge reply `j`, upper-cased (`Met` reads as MET), or a throw when they are not one per item. */
  const labelsOf = (j, items) => {
    const labels = Array.isArray(j.labels) ? j.labels.map((l) => String(l).trim().toUpperCase()) : null;
    if (!labels || labels.length !== items || !labels.every((l) => LABELS.has(l))) throw new Error(`wanted ${items} labels of MET, PARTIAL or MISSING`);
    return labels;
  };

  // An unreadable reply is moved aside and asked once more (both calls are counted). If the re-ask cannot be read
  // either, the labels are null: scoreOf reads them as invalid and the task does not count (PANEL_RULES 3), and
  // `stats.lost` says how many, so a reading under 12 of 16 can name the cause.
  function judge({ seat, checklist, answer: text }) {
    const o = call('judge', seat, judgePrompt(checklist, text));
    const ask = () => paidJson(o, (j) => labelsOf(j, checklist.length)).value;
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

module.exports = { VERSION, createKiroProvider, withUnit, checklistPrompt, judgePrompt };
