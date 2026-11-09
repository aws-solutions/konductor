// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { verifyQuote } = require('./quote.js');
const { writeJson, REQUEST_SIDE_EFFECT, ITEM_SIDE_EFFECT } = require('./util.js');

const TAGS = ['useful', 'generic', 'style'];
const DEFAULT_RULES = 12;

function extractPrompt({ skillText, skillName, count }) {
  return `Below is the text of an instruction document written for an AI assistant. Extract about ${count} rules from it that can be tested.

A testable rule:
- describes a result that a written answer to a user request can visibly show (something that is present, absent, ordered, named, or quantified in the answer). It must not depend on a saved file, a command that ran, or any other side effect.
- is stated in plain words that make sense without the document. Never use the document's name ("${skillName}", "${skillName.replace(/-/g, ' ')}") or its headings in the rule or in the request type.
- quotes one source line (or one sentence) of the document exactly as written, at least 20 characters, so a script can find it.
- comes with a request type: a short phrase for the kind of plain user request where the rule applies, for example "asking whether the tests for a payments module cover its requirements". Describe the user's situation, not the document's topic name.
- is about what the written answer says or how it reasons. Skip rules about tools, sub-agents, output files, file paths, progress trackers, dates and times, parameters, running commands, or how a calling process behaves.
- is tagged "useful" (changes the substance of a good answer), "generic" (any careful assistant would do it anyway) or "style" (only about wording, tone, layout or format).

Prefer rules that come from different parts of the document and that a request could trigger without mentioning the rule.

Reply with only this JSON:
{"rules":[{"text":"<rule>","quote":"<exact source text>","tag":"useful|generic|style","requestType":"<kind of user request>"}]}

DOCUMENT:
<<<DOCUMENT
${skillText}
DOCUMENT>>>`;
}

/**
 * Splits the model's rules into accepted and rejected. A rule is rejected when its quote is not in the skill text, its tag is
 * unknown, its text or request type names the skill, or it needs a side effect to be checked.
 */
function screenRules({ raw, skillText, skill }) {
  const accepted = [];
  const rejected = [];
  const seen = new Set();
  for (const r of raw) {
    const reasons = [];
    const text = String(r?.text ?? '').trim();
    const requestType = String(r?.requestType ?? '').trim();
    const tag = String(r?.tag ?? '').trim().toLowerCase();
    if (!text) reasons.push('empty rule text');
    if (!requestType) reasons.push('empty request type');
    if (!TAGS.includes(tag)) reasons.push(`unknown tag "${r?.tag}"`);
    const q = verifyQuote(skillText, r?.quote);
    if (!q.ok) reasons.push(q.reason);
    if (text.toLowerCase().includes(skill) || requestType.toLowerCase().includes(skill)) reasons.push('names the skill');
    if (ITEM_SIDE_EFFECT.test(text) || REQUEST_SIDE_EFFECT.test(text)) reasons.push('needs a side effect');
    const key = text.toLowerCase().replace(/\s+/g, ' ');
    if (text && seen.has(key)) reasons.push('duplicate rule');
    seen.add(key);
    if (reasons.length) { rejected.push({ text, quote: r?.quote ?? '', tag, requestType, reasons }); continue; }
    accepted.push({ text, quote: String(r.quote).trim(), line: q.line, tag, requestType });
  }
  return { accepted: accepted.map((r, i) => ({ id: `R${String(i + 1).padStart(2, '0')}`, ...r })), rejected };
}

async function runExtract({ skill, ask, modelName, count = DEFAULT_RULES, outDir }) {
  const reply = await ask.askJson(modelName, extractPrompt({ skillText: skill.text, skillName: skill.skill, count }), (v) => {
    if (!Array.isArray(v?.rules)) throw new Error('reply has no rules array');
  });
  const { accepted, rejected } = screenRules({ raw: reply.rules, skillText: skill.text, skill: skill.skill });
  const out = { skill: skill.skill, source: skill.source, model: modelName, requested: count, rules: accepted, rejected };
  writeJson(path.join(outDir, 'rules.json'), out);
  return out;
}

module.exports = { extractPrompt, screenRules, runExtract, TAGS, DEFAULT_RULES };
