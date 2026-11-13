// SPDX-License-Identifier: Apache-2.0
'use strict';

// Recovers the tool sequence from a generator-written expected_trajectory. The field is untyped in the generator, so entries come as
// call strings, dicts, [name, args] pairs, prose and chatter. The result is a proposal for a reviewer, never a verdict.

const STRONG_KEYS = ['tool', 'tool_name', 'function', 'function_name'];
const WEAK_KEYS = ['name', 'action', 'step'];
const RESPONSE_TYPE = /^tool[_ -]?(?:response|result|output)s?$/i;
const RESPONSE_KEYS = ['tool_response', 'tool_result', 'tool_output'];
const CHATTER = /^\s*(?:here (?:are|is)\b|sure[,.!]|certainly[,.!]|below (?:are|is)\b|expected(?:_output)?\b|this expected output\b|good\.|let'?s\b|ok(?:ay)?[,.!])/i;
const NEGATION = /\b(?:not|never|no|don't|do not|doesn't|without|avoid|shouldn't|must not|should not)\b[^.;\n]*$/i;
const SNAKE = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/;
const CALL = /(?<![A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\(/g;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function makeMatchers(declared) {
  const alts = [...declared].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  return {
    word: new RegExp(`(?<![A-Za-z0-9_])(${alts})(?![A-Za-z0-9_])`, 'g'),
    plain: new RegExp(`^\\s*(${alts})\\s*(?:\\([\\s\\S]*\\))?\\s*$`),
  };
}

// A name counts as undeclared only when it is shaped like a tool call (name(...)), or the field holding it is a tool-name field
// and the value is snake_case. Plain words such as "response" and action labels in prose are not tool names.
function undeclaredIn(text, declared, { strict }) {
  const out = [];
  const whole = text.trim();
  if (strict && SNAKE.test(whole) && !declared.has(whole)) out.push(whole);
  for (const m of text.matchAll(CALL)) {
    const name = m[1];
    if (declared.has(name)) continue;
    if (m.index === text.search(/\S/) || name.includes('_')) out.push(name);
  }
  return out;
}

function scanText(text, matchers, declared, { strictUndeclared }) {
  const found = [];
  const negated = [];
  for (const m of text.matchAll(matchers.word)) {
    if (NEGATION.test(text.slice(Math.max(0, m.index - 40), m.index))) negated.push(m[1]);
    else found.push(m[1]);
  }
  return { found, negated, undeclared: undeclaredIn(text, declared, { strict: strictUndeclared }) };
}

function nameFieldOf(step) {
  for (const key of [...STRONG_KEYS, ...WEAK_KEYS]) {
    const v = step[key];
    if (typeof v === 'string' && v.trim()) return { key, value: v, strong: STRONG_KEYS.includes(key) };
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v.name === 'string') return { key, value: v.name, strong: STRONG_KEYS.includes(key) };
  }
  return null;
}

/**
 * @param {unknown} trajectory raw expected_trajectory (any shape, null allowed)
 * @param {string[]} declaredTools tool names the agent declares
 * @returns {{tools: string[], quality: 'clean'|'extracted'|'none', undeclared: string[], notes: string[], steps: number}}
 */
function extractTools(trajectory, declaredTools) {
  if (!Array.isArray(declaredTools) || declaredTools.length === 0 || declaredTools.some((t) => typeof t !== 'string' || !t)) {
    throw new TypeError('declaredTools must be a non-empty array of tool names');
  }
  const declared = new Set(declaredTools);
  const matchers = makeMatchers(declared);
  const steps = trajectory == null ? [] : Array.isArray(trajectory) ? trajectory : [trajectory];
  const tools = [];
  const undeclared = [];
  const notes = [];
  let allPlain = true;
  let chatter = 0;
  let responses = 0;
  let recovered = 0;
  let skipped = 0;
  const addUndeclared = (names) => { for (const n of names) if (!undeclared.includes(n)) undeclared.push(n); };

  const handleString = (text, i, { strict }) => {
    const r = scanText(text, matchers, declared, { strictUndeclared: strict });
    for (const n of r.negated) notes.push(`step ${i + 1}: negated mention of ${n} ignored`);
    addUndeclared(r.undeclared);
    tools.push(...r.found);
    if (r.found.length) recovered++;
    return r.found.length > 0 || r.undeclared.length > 0;
  };

  steps.forEach((step, i) => {
    if (typeof step === 'string') {
      if (!step.trim()) { allPlain = false; return; }
      if (CHATTER.test(step)) { chatter++; allPlain = false; return; }
      const plain = step.match(matchers.plain);
      if (plain) { tools.push(plain[1]); return; }
      allPlain = false;
      if (!handleString(step, i, { strict: true })) skipped++;
      return;
    }
    allPlain = false;
    if (Array.isArray(step)) {
      const [first, ...rest] = step;
      if (typeof first !== 'string') { skipped++; return; }
      if (!handleString(first, i, { strict: true })) skipped++;
      for (const extra of rest) {
        if (typeof extra === 'string' && SNAKE.test(extra.trim()) && !declared.has(extra.trim())) addUndeclared([extra.trim()]);
      }
      return;
    }
    if (step && typeof step === 'object') {
      const isResponse = RESPONSE_TYPE.test(String(step.type ?? '')) || (RESPONSE_KEYS.some((k) => k in step) && !nameFieldOf(step));
      if (isResponse) { responses++; return; }
      const field = nameFieldOf(step);
      let hit = false;
      if (field) hit = handleString(field.value, i, { strict: field.strong });
      if (!hit) {
        for (const [key, value] of Object.entries(step)) {
          if (typeof value !== 'string' || (field && key === field.key)) continue;
          if (handleString(value, i, { strict: false })) { hit = true; break; }
        }
      }
      if (!hit) skipped++;
      return;
    }
    skipped++;
  });

  if (chatter) notes.push(`${chatter} generator chatter step${chatter > 1 ? 's' : ''} ignored`);
  if (responses) notes.push(`${responses} tool response step${responses > 1 ? 's' : ''} ignored`);
  if (skipped) notes.push(`${skipped} step${skipped > 1 ? 's' : ''} with no tool name ignored`);
  if (recovered) notes.push(`names recovered from ${recovered} richer step${recovered > 1 ? 's' : ''}`);
  if (undeclared.length) notes.push(`undeclared tool names: ${undeclared.join(', ')}`);
  if (steps.length === 0) notes.push('empty trajectory');

  let quality = 'none';
  if (tools.length) quality = allPlain && undeclared.length === 0 ? 'clean' : 'extracted';
  return { tools, quality, undeclared, notes, steps: steps.length };
}

module.exports = { extractTools };
