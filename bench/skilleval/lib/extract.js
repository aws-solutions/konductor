// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { verifyQuote } = require('./quote.js');
const { writeJson, REQUEST_SIDE_EFFECT, ITEM_SIDE_EFFECT } = require('./util.js');

const TAGS = ['useful', 'generic', 'style'];
const DEFAULT_RULES = 12;
// A document longer than this is read in parts so one model call stays small and quotes stay exact.
const DEFAULT_CHUNK_CHARS = 72000;

function extractPrompt({ skillText, skillName, count, part }) {
  return `Below is the text of an instruction document written for an AI assistant${part ? `, part ${part.index} of ${part.total}. Use only this part` : ''}. Extract about ${count} rules from it that can be tested.

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

/** Splits at a heading near each equal share of the text; a text within `maxChars` stays whole. */
function splitDocument(text, maxChars) {
  if (text.length <= maxChars) return [text];
  const total = Math.ceil(text.length / maxChars);
  const share = text.length / total;
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const line of text.split('\n')) {
    if (chunks.length < total - 1 && len >= share && /^#{1,3}\s/.test(line)) { chunks.push(cur.join('\n')); cur = []; len = 0; }
    cur.push(line);
    len += line.length + 1;
  }
  chunks.push(cur.join('\n'));
  return chunks;
}

async function runExtract({ skill, ask, modelName, count = DEFAULT_RULES, outDir, chunkChars = DEFAULT_CHUNK_CHARS }) {
  const parts = splitDocument(skill.text, chunkChars);
  const ask1 = async (skillText, n, part) => (await ask.askJson(modelName, extractPrompt({ skillText, skillName: skill.skill, count: n, part }), (v) => {
    if (!Array.isArray(v?.rules)) throw new Error('reply has no rules array');
  })).rules;
  let accepted;
  let rejected;
  if (parts.length === 1) {
    ({ accepted, rejected } = screenRules({ raw: await ask1(skill.text, count), skillText: skill.text, skill: skill.skill }));
  } else {
    const perPart = Math.ceil(count / parts.length) + 1;
    const raws = [];
    for (let i = 0; i < parts.length; i++) raws.push(await ask1(parts[i], perPart, { index: i + 1, total: parts.length }));
    const mixed = [];
    for (let k = 0; k < perPart; k++) for (const r of raws) if (r[k] !== undefined) mixed.push(r[k]);
    const screened = screenRules({ raw: mixed, skillText: skill.text, skill: skill.skill });
    rejected = screened.rejected;
    accepted = screened.accepted.slice(0, count).sort((a, b) => a.line - b.line).map((r, i) => ({ ...r, id: `R${String(i + 1).padStart(2, '0')}` }));
  }
  const out = { skill: skill.skill, source: skill.source, model: modelName, requested: count, parts: parts.length, rules: accepted, rejected };
  writeJson(path.join(outDir, 'rules.json'), out);
  return out;
}

module.exports = { splitDocument, DEFAULT_CHUNK_CHARS, extractPrompt, screenRules, runExtract, TAGS, DEFAULT_RULES };
