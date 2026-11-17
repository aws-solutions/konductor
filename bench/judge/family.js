// SPDX-License-Identifier: Apache-2.0
'use strict';

// The judge family rule (SR-24), one check for every caller: a judge is never from the agent's own model family. The
// agent's family is read from its model id. An id that names no known family, or names two, has an unknown family. An
// agent of unknown family, or a panel with no judge from another family, is unjudged: the run gets no judgment, so it
// can never count as a pass. Unlike config.js modelFamily, which takes the first word of any id, this check never
// guesses a family.

const FAMILIES = Object.freeze([
  ['claude', /(^|[^a-z])(claude|anthropic)(?![a-z])/],
  ['gpt', /(^|[^a-z])(gpt|openai|chatgpt|o[134](-mini|-pro)?)(?![a-z0-9])/],
  ['gemini', /(^|[^a-z])(gemini|gemma|google)(?![a-z])/],
  ['deepseek', /deepseek/],
  ['glm', /(^|[^a-z])(glm|zhipu|z-ai|zai)(?![a-z])/],
  ['grok', /(^|[^a-z])(grok|xai|x-ai)(?![a-z])/],
  ['llama', /(^|[^a-z])(llama|meta)(?![a-z])/],
  ['mistral', /(^|[^a-z])(mistral|mixtral|codestral|devstral)(?![a-z])/],
  ['qwen', /(^|[^a-z])(qwen|qwq|alibaba)(?![a-z])/],
  ['kimi', /(^|[^a-z])(kimi|moonshot)(?![a-z])/],
  ['nova', /(^|[^a-z])nova(?![a-z])/],
  ['minimax', /minimax/],
]);

/**
 * The model family of a model id, or null when the id names no known family or names more than one. `id` may carry a
 * provider path or a Bedrock routing prefix (openrouter/anthropic/claude-x, global.anthropic.claude-x); case is ignored.
 */
function familyOf(id) {
  if (typeof id !== 'string' || !id.trim()) return null;
  const text = id.toLowerCase();
  const hits = FAMILIES.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The judge seats for one agent under SR-24.
 *   subjectModel  the agent's model id, as the run record names it
 *   judges        the configured judge model ids, in seat order
 * Returns { judged, why, subject: { model, family }, seats: [{ model, family, seated, why }] }. A judge is seated only
 * when its family is known, differs from the agent's, and no earlier seat has that family. `judged` is false, with the
 * reason in `why`, when the agent's family is unknown or no judge is seated; the caller then judges nothing.
 */
function judgeSeats({ subjectModel, judges = [] }) {
  const subject = { model: subjectModel ?? null, family: familyOf(subjectModel) };
  const taken = new Set();
  const seats = judges.map((model) => {
    const family = familyOf(model);
    let why = null;
    if (!family) why = 'its model family is unknown';
    else if (subject.family && family === subject.family) why = `it is in the agent's own family (${family})`;
    else if (taken.has(family)) why = `another seat already has the ${family} family`;
    if (!why && subject.family) taken.add(family);
    return { model, family, seated: !why && Boolean(subject.family), why };
  });
  if (!subject.family) {
    return { judged: false, why: `the agent's model family is unknown (${JSON.stringify(subjectModel ?? null)}), so the run is unjudged, never a pass (SR-24)`, subject, seats: seats.map((s) => ({ ...s, seated: false })) };
  }
  if (!seats.some((s) => s.seated)) {
    return { judged: false, why: `no configured judge is from a family other than the agent's (${subject.family}), so the run is unjudged, never a pass (SR-24)`, subject, seats };
  }
  return { judged: true, why: null, subject, seats };
}

module.exports = { FAMILIES, familyOf, judgeSeats };
