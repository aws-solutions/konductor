// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { writeJson, ITEM_SIDE_EFFECT, jaccard } = require('./util.js');

const BUCKETS = ['value', 'guard', 'format'];
const WEIGHTS = { value: 3, guard: 2, format: 1 };
const MIN_ITEMS = 4;
const MAX_ITEMS = 6;
const MIN_VALUE_ITEMS = 2;
const MAX_FORMAT_ITEMS = 2;
const NEAR_MISS_EXPECTATION = 'skill not loaded';

const BUCKET_HELP = `Buckets:
- value: something substantive a strong answer says or does that a weaker answer would miss (name the specific content).
- guard: something a strong answer must not get wrong or do (a false claim, an unsupported assumption, padding, an unrequested deliverable, ignoring a detail the user gave).
- format: how the answer is laid out (order, length, structure the user can use), only if it matters for this request.`;

const ITEM_RULES = `Each item is one sentence that a grader can mark pass, partial or fail by reading the written reply alone. Never write an item that needs a saved file, a command that ran or any other side effect.`;

function rubricPrompt({ scenario, rules }) {
  if (scenario.type === 'near-miss') {
    return `A user sent this request to an AI assistant:

"""
${scenario.prompt}
"""

A specialised analysis procedure looks related but should NOT be applied here. Write ${MIN_ITEMS} to ${MAX_ITEMS} checklist items that all belong to the guard bucket: they check that the reply answers the actual request directly, stays in scope, and does not bring in unrequested ceremony, long reports, scoring schemes or deliverables.

${ITEM_RULES}

Reply with only this JSON:
{"items":[{"bucket":"guard","criterion":"<one sentence>"}]}`;
  }
  return `A user sent this request to an AI assistant:

"""
${scenario.prompt}
"""

Behaviours that make a strong answer to requests like this:
${rules.map((r) => `- ${r.id}: ${r.text}`).join('\n')}

Write ${MIN_ITEMS} to ${MAX_ITEMS} checklist items for grading the reply. Include at least ${MIN_VALUE_ITEMS} value items${scenario.ruleIds.length ? `, and tie at least one to ${scenario.ruleIds.join(' or ')} using the field "ruleId"` : ''}, at least one guard item, and at most ${MAX_FORMAT_ITEMS} format items. Write the items for this request's specifics, not as generic advice.

${BUCKET_HELP}

${ITEM_RULES}

Reply with only this JSON:
{"items":[{"bucket":"value|guard|format","criterion":"<one sentence>","ruleId":"<rule id or empty>"}]}`;
}

/** Reasons a rubric for this scenario type is not acceptable (empty when it is). */
function validateRubric(items, scenario) {
  const reasons = [];
  if (!Array.isArray(items) || items.length < MIN_ITEMS || items.length > MAX_ITEMS) reasons.push(`needs ${MIN_ITEMS} to ${MAX_ITEMS} items (got ${Array.isArray(items) ? items.length : 'none'})`);
  if (!Array.isArray(items)) return reasons;
  const count = (b) => items.filter((i) => i.bucket === b).length;
  for (const i of items) {
    if (!BUCKETS.includes(i.bucket)) reasons.push(`unknown bucket "${i.bucket}"`);
    if (!String(i.criterion ?? '').trim()) reasons.push('empty criterion');
    else if (ITEM_SIDE_EFFECT.test(i.criterion)) reasons.push(`needs a side effect: "${i.criterion.slice(0, 60)}"`);
  }
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) if (jaccard(items[a].criterion ?? '', items[b].criterion ?? '') >= 0.8) reasons.push('two items repeat each other');
  if (scenario.type === 'near-miss') {
    if (count('guard') !== items.length) reasons.push('near-miss rubric must be guard items only');
  } else {
    if (count('value') < MIN_VALUE_ITEMS) reasons.push(`needs at least ${MIN_VALUE_ITEMS} value items`);
    if (count('guard') < 1) reasons.push('needs a guard item');
    if (count('format') > MAX_FORMAT_ITEMS) reasons.push(`at most ${MAX_FORMAT_ITEMS} format items`);
  }
  return reasons;
}

/** Items in the bench task rubric shape ({id, criterion, weight}); the bucket is the id prefix and sets the weight. */
function toTaskRubric(items) {
  const seen = {};
  return items.map((i) => {
    seen[i.bucket] = (seen[i.bucket] ?? 0) + 1;
    return { id: `${i.bucket}-${seen[i.bucket]}`, criterion: i.criterion.trim(), weight: WEIGHTS[i.bucket] };
  });
}

async function runRubrics({ scenarios, survivors, ask, model, outDir }) {
  const byId = new Map(survivors.map((r) => [r.id, r]));
  const out = [];
  const failed = [];
  for (const scenario of scenarios) {
    const rules = scenario.type === 'near-miss' ? [] : survivors;
    try {
      const reply = await ask.askJson(model, rubricPrompt({ scenario, rules }), (v) => {
        const reasons = validateRubric(v?.items, scenario);
        if (reasons.length) throw new Error(reasons.join('; '));
      });
      const items = reply.items.map((i) => ({ bucket: i.bucket, criterion: i.criterion.trim(), ruleId: byId.has(i.ruleId) ? i.ruleId : null }));
      out.push({ scenarioId: scenario.id, type: scenario.type, expectation: scenario.type === 'near-miss' ? NEAR_MISS_EXPECTATION : null, items, rubric: toTaskRubric(items) });
    } catch (e) {
      if (e.constructor.name === 'BudgetExceeded') throw e;
      failed.push({ scenarioId: scenario.id, reason: e.message.slice(0, 300) });
    }
  }
  const doc = { model, weights: WEIGHTS, rubrics: out, failed };
  if (outDir) writeJson(path.join(outDir, 'rubric.json'), doc);
  return doc;
}

module.exports = { rubricPrompt, validateRubric, toTaskRubric, runRubrics, BUCKETS, WEIGHTS, NEAR_MISS_EXPECTATION };
