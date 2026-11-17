// SPDX-License-Identifier: Apache-2.0
// Ported from Michael Lin's scripts/bench/lib/stub-provider.js (pull request #260, commit 33b385f9), same repository and Apache-2.0 licence. The idea, the stub- run id rule and the full-answer mark are his; the provider calls are cap's.
/**
 * The stub provider for the keep-or-prune checks: a stand-in for the subject, the checklist writer and the judges, so
 * a whole quick or deep check runs with no model, no credentials, no network and no spend. Everything above the
 * provider (arms, SR-24 seats, judgments and their freshness, gaps, the copied rules, controls, the record) is the
 * real code.
 *
 *   subject   answers from the request alone. Every arm covers the request (FULL_ANSWER_MARK). An arm that has the
 *             skill loaded (`with`, and `aa`, its A/A repeat in a deep check) also follows the skill: it appends the
 *             skill's text, so the skill's literal conventions appear in the answer. `without` never loads it.
 *   writer    the request-only checklist (reading A): the rubric when it is given one (the dose ladder's writer is
 *             given its rubric, as in his checklist job), else `count` generic items about the request.
 *   judges    one label per item: MET, PARTIAL or MISSING. An item that quotes literals in backticks is MET when the
 *             answer holds every one of them, else MISSING. Any other item is MET when the answer covers the request.
 *             On a dose ladder task the judge knows the planted defects and marks the item a defect breaks MISSING
 *             (an oracle: it shows the pipeline reads rising harm, not that a real judge would see it). Each seat
 *             then downgrades about one MET in ten to PARTIAL, picked by a hash of seat, answer and item, so seats
 *             and arms differ a little and the intervals are not all [0, 0].
 *
 * Stub data must never be mistaken for a measurement: the stub runs only in a run whose id is `stub` or starts with
 * `stub-` (assertStubRun), and every answer and judgment it makes names the stub version.
 */
'use strict';

const crypto = require('node:crypto');

const STUB_VERSION = 'stub';
const STUB_RUN = /^stub(-|$)/;
/** The phrase every stub answer carries: it marks an answer that covers the request. */
const FULL_ANSWER_MARK = 'every point of the request is answered in order';
/** About one MET in this many becomes PARTIAL. */
const NOISE_ONE_IN = 10;
const LOADING_ARMS = new Set(['with', 'aa']);
const LITERAL = /`([^`]+)`/g;

const hashOf = (...parts) => crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');

/** True when `runId` is `stub` or starts with `stub-`: the only run ids that may hold stub data. */
const isStubRun = (runId) => STUB_RUN.test(String(runId));

/** Throws when `runId` may not hold stub data. */
function assertStubRun(runId) {
  if (!isStubRun(runId)) {
    throw new Error(`the stub provider makes up answers and judgments, so it runs only in a run whose id is "stub" or starts with "stub-" (got ${JSON.stringify(runId)}); pass --run stub-<name>`);
  }
}

/** The backticked literals of an item, in order. */
const literalsOf = (text) => [...String(text).matchAll(LITERAL)].map((m) => m[1]);

/**
 * The defects of each dose ladder task, by task id: [{ item, edits }], where `item` is the rubric index a defect
 * breaks and `edits` its find/replace pairs. Null `ladder` gives an empty map.
 */
function defectsByTask(ladder) {
  const map = new Map();
  for (const task of ladder?.tasks ?? []) {
    map.set(task.id, task.defects.map((d) => ({ item: d.rubric_item, edits: Array.isArray(d.edits) ? d.edits : [{ find: d.find, replace: d.replace }] })));
  }
  return map;
}

/** True when every edit of a defect is in `text`: its find is gone and its replacement is there. */
const carries = (text, defect) => defect.edits.every((e) => !text.includes(e.find) && text.includes(e.replace));

/**
 * A stub provider. `ladder` is the dose ladder whose planted defects the stub judge may read (null for none).
 * Returns { name, version, answer, writeChecklist, judge }; see the module comment for what each one does.
 */
function createStubProvider({ ladder = null } = {}) {
  const defects = defectsByTask(ladder);

  /**
   * One subject answer. `request` is the task prompt, `skill` { name, text } or null, `arm` with, aa or without,
   * `replicate` the run number in a deep check (0 in a quick one), `model` the subject model id it reports.
   * Returns { text, loaded, model, version }.
   */
  function answer({ request, skill, arm, replicate = 0, model }) {
    const loaded = Boolean(skill) && LOADING_ARMS.has(arm);
    const tag = hashOf(request, String(replicate)).slice(0, 8);
    const body = `Reply ${tag}: ${FULL_ANSWER_MARK}, with the figures it gives and a short check at the end.`;
    return { text: loaded ? `${body}\n\n${skill.text}` : body, loaded, model, version: STUB_VERSION };
  }

  /** The request-only checklist: `rubric` as given, or `count` generic items. */
  function writeChecklist({ rubric = null, count = 5 }) {
    if (Array.isArray(rubric) && rubric.length) return [...rubric];
    return Array.from({ length: count }, (_, i) => `The answer covers requested point number ${i + 1} of this task.`);
  }

  const baseLabel = (item, index, text, taskDefects) => {
    if (taskDefects) {
      const broken = taskDefects.some((d) => d.item === index && carries(text, d));
      return broken ? 'MISSING' : 'MET';
    }
    const literals = literalsOf(item);
    if (literals.length) return literals.every((l) => text.includes(l)) ? 'MET' : 'MISSING';
    return text.includes(FULL_ANSWER_MARK) ? 'MET' : 'MISSING';
  };

  /**
   * One judgment: `seat` the judge model id, `checklist` the items, `answer` the answer text, `taskId` the task (the
   * stub reads it only to find dose ladder defects). Returns { labels, version }, one label per item.
   */
  function judge({ seat, checklist, answer: text, taskId }) {
    const taskDefects = defects.get(taskId) ?? null;
    const labels = checklist.map((item, index) => {
      const label = baseLabel(item, index, text, taskDefects);
      const roll = parseInt(hashOf(seat, text, String(index)).slice(0, 8), 16) % NOISE_ONE_IN;
      return label === 'MET' && roll === 0 ? 'PARTIAL' : label;
    });
    return { labels, version: STUB_VERSION };
  }

  return { name: 'stub', version: STUB_VERSION, answer, writeChecklist, judge };
}

module.exports = { STUB_VERSION, FULL_ANSWER_MARK, isStubRun, assertStubRun, literalsOf, createStubProvider };
