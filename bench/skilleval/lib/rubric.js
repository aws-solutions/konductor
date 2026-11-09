// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { writeJson, ITEM_SIDE_EFFECT, jaccard } = require('./util.js');
const { checkConsistency } = require('./consistency.js');

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

const ITEM_RULES = `Each item is one sentence that a grader can mark pass, partial or fail by reading the written reply alone. Never write an item that needs a saved file, a command that ran or any other side effect. Every number or name in an item must come from the request or from a correct count or sum of what it lists; count list entries one by one. Never mention a behaviour by its id.`;

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
${rules.filter((r) => r.bucket !== 'format').map((r) => `- ${r.id}: ${r.text}`).join('\n')}
${rules.some((r) => r.bucket === 'format') ? `\nLayout behaviours (an item for one of these goes in the format bucket, and only when this request makes it relevant):\n${rules.filter((r) => r.bucket === 'format').map((r) => `- ${r.id}: ${r.text}`).join('\n')}\n` : ''}
Write ${MIN_ITEMS} to ${MAX_ITEMS} checklist items for grading the reply. Include at least ${MIN_VALUE_ITEMS} value items${scenario.ruleIds.length ? `, and tie at least one to ${scenario.ruleIds.join(' or ')} using the field "ruleId"` : ''}, at least one guard item, and at most ${MAX_FORMAT_ITEMS} format items. Write the items for this request's specifics, not as generic advice.

${BUCKET_HELP}

${ITEM_RULES}

Reply with only this JSON:
{"items":[{"bucket":"value|guard|format","criterion":"<one sentence>","ruleId":"<rule id or empty>"}]}`;
}

/** Reasons a rubric for this scenario type is not acceptable (empty when it is). */
function validateRubric(items, scenario, rules = []) {
  const reasons = [];
  if (!Array.isArray(items) || items.length < MIN_ITEMS || items.length > MAX_ITEMS) reasons.push(`needs ${MIN_ITEMS} to ${MAX_ITEMS} items (got ${Array.isArray(items) ? items.length : 'none'})`);
  if (!Array.isArray(items)) return reasons;
  const count = (b) => items.filter((i) => i.bucket === b).length;
  for (const i of items) {
    if (!BUCKETS.includes(i.bucket)) reasons.push(`unknown bucket "${i.bucket}"`);
    if (!String(i.criterion ?? '').trim()) reasons.push('empty criterion');
    else if (ITEM_SIDE_EFFECT.test(i.criterion)) reasons.push(`needs a side effect: "${i.criterion.slice(0, 60)}"`);
  }
  const formatIds = new Set(rules.filter((r) => r.bucket === 'format').map((r) => r.id));
  for (const i of items) if (formatIds.has(i.ruleId) && i.bucket !== 'format') reasons.push(`${i.ruleId} is a layout behaviour, so its item belongs in the format bucket`);
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

function repairPrompt({ prompt, items, errors }) {
  const flagged = [...new Set(errors.map((e) => e.index))];
  return `${prompt}

A first draft of the checklist was written:
${items.map((i, n) => `${n}. [${i.bucket}] ${i.criterion}`).join('\n')}

These items disagree with the request and must be fixed:
${errors.map((e) => `- item ${e.index}: ${e.detail}`).join('\n')}

Rewrite only items ${flagged.join(', ')} so that every number and name matches the request exactly; keep each rewritten item in the same bucket and on the same point. Reply with only this JSON, listing only those items:
{"fixes":[{"index":<item number>,"criterion":"<one sentence>"}]}`;
}

/** Writes one rubric. Items that conflict with the request go back to the model once, and only those items are replaced. */
async function writeRubric({ scenario, rules, ask, model, byId }) {
  const prompt = rubricPrompt({ scenario, rules });
  const reply = await ask.askJson(model, prompt, (v) => {
    const reasons = validateRubric(v?.items, scenario, rules);
    if (reasons.length) throw new Error(reasons.join('; '));
  });
  let items = reply.items.map((i) => ({ bucket: i.bucket, criterion: String(i.criterion).trim(), ruleId: byId.has(i.ruleId) ? i.ruleId : null }));
  const verdict = () => checkConsistency({ items, prompt: scenario.prompt, rules });
  const repaired = [];
  let { errors } = verdict();
  if (errors.length) {
    const flagged = new Set(errors.map((e) => e.index));
    const fix = await ask.askJson(model, repairPrompt({ prompt, items, errors }), (v) => {
      if (!Array.isArray(v?.fixes)) throw new Error('reply has no fixes array');
      const got = new Set(v.fixes.map((f) => f.index));
      for (const n of flagged) if (!got.has(n) || !String(v.fixes.find((f) => f.index === n).criterion ?? '').trim()) throw new Error(`no fix for item ${n}`);
    });
    items = items.map((i, n) => (flagged.has(n) ? { ...i, criterion: String(fix.fixes.find((f) => f.index === n).criterion).trim() } : i));
    repaired.push(...flagged);
    const reasons = validateRubric(items, scenario, rules);
    ({ errors } = verdict());
    if (reasons.length || errors.length) throw new Error(`still inconsistent after repair: ${[...reasons, ...errors.map((e) => `item ${e.index}: ${e.detail}`)].join('; ')}`.slice(0, 300));
  }
  return { items, repaired, warnings: verdict().warnings };
}

async function runRubrics({ scenarios, survivors, ask, model, outDir }) {
  const byId = new Map(survivors.map((r) => [r.id, r]));
  const out = [];
  const failed = [];
  for (const scenario of scenarios) {
    const rules = scenario.type === 'near-miss' ? [] : survivors;
    try {
      const { items, repaired, warnings } = await writeRubric({ scenario, rules, ask, model, byId });
      const rubric = toTaskRubric(items);
      out.push({
        scenarioId: scenario.id, type: scenario.type, expectation: scenario.type === 'near-miss' ? NEAR_MISS_EXPECTATION : null, items, rubric,
        repaired: repaired.map((n) => rubric[n].id),
        warnings: warnings.map((w) => ({ item: rubric[w.index].id, kind: w.kind, detail: w.detail })),
      });
    } catch (e) {
      if (e.constructor.name === 'BudgetExceeded') throw e;
      failed.push({ scenarioId: scenario.id, reason: e.message.slice(0, 300) });
    }
  }
  const doc = { model, weights: WEIGHTS, rubrics: out, failed };
  if (outDir) writeJson(path.join(outDir, 'rubric.json'), doc);
  return doc;
}

module.exports = { rubricPrompt, repairPrompt, writeRubric, validateRubric, toTaskRubric, runRubrics, BUCKETS, WEIGHTS, NEAR_MISS_EXPECTATION };
