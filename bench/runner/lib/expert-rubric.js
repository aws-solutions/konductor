// SPDX-License-Identifier: Apache-2.0
'use strict';

// D-62: a task's `expertKey` becomes rubric criteria, one per item, so every judge pass (rubric, pairwise, graded),
// the quote check and the rubric score read it with no code of their own. The items share the weight of the task's
// `expert-key` placeholder criterion (scenarios/lib/stage.js writes it), else EXPERT_WEIGHT, so the key's place
// inside the rubric share is the same with one item or nine. The placeholder itself is dropped: the judge could not
// score it without the items. The weak answers go to the judge prompt (judge/prompts.js) and earn nothing.

const PLACEHOLDER_ID = 'expert-key';
const EXPERT_WEIGHT = 3;
const EXPERT_PREFIX = 'expert:';

/** The rubric a judge scores: the task rubric without the placeholder, then one criterion per expertKey item. */
function judgedRubric(rubric, expertKey) {
  const items = expertKey?.items ?? [];
  if (!items.length) return rubric;
  const own = Array.isArray(rubric) ? rubric : [];
  const placeholder = own.find((r) => r.id === PLACEHOLDER_ID);
  const weight = (placeholder?.weight ?? EXPERT_WEIGHT) / items.length;
  const expert = items.map((it) => ({
    id: `${EXPERT_PREFIX}${it.id}`,
    weight,
    criterion: `Expert point: ${it.text} Pass only when the evidence quotes the passage that makes this point; a statement like a weak answer below earns nothing.`,
  }));
  return [...own.filter((r) => r.id !== PLACEHOLDER_ID), ...expert];
}

module.exports = { judgedRubric, EXPERT_PREFIX, EXPERT_WEIGHT, PLACEHOLDER_ID };
