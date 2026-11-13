// SPDX-License-Identifier: Apache-2.0
'use strict';

// Deterministic checks on the text of a generated case: is the input a real scenario, and does the expected output still hold
// unfilled template slots. Nothing here calls a model.

const SCHEMA_ECHOES = new Set(['string', 'input']);
const MIN_INPUT_CHARS = 15;
const QUOTE_PAIRS = [['"', '"'], ["'", "'"], ['\u201C', '\u201D'], ['\u2018', '\u2019']];
const LEADING_LABEL = /^\s*(?:customer|user|client|caller)(?:\s+(?:message|says|said|writes))?\s*:\s*/i;
const TURN_LABEL = /^\s*["'\u201C\u2018]?(?:customer|user|client|caller|agent|assistant|support|human|bot)(?:\s+(?:message|says|said|writes))?\s*:/gim;
const CHATTER = /^\s*(?:here (?:are|is)\b|sure[,!.]|certainly[,!.]|below (?:are|is)\b|test cases?\b|the following (?:test )?cases?\b|i(?:'ll| will) (?:generate|create|write)\b)/i;

const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function stripQuotes(s) {
  const t = s.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (t.length > 2 && t.startsWith(open) && t.endsWith(close)) return t.slice(1, -1).trim();
  }
  return t;
}

// Quotes can sit outside the label (`"Customer: ..."`) or inside it (`Customer: "..."`), so alternate until nothing changes.
function normalizeInput(raw) {
  let s = raw.trim();
  for (let i = 0; i < 4; i++) {
    const next = stripQuotes(s).replace(LEADING_LABEL, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

const looksLikeTitle = (s) => {
  if (/[\n.?!,:;"]/.test(s)) return false;
  const ws = s.split(/\s+/).filter(Boolean);
  return ws.length >= 1 && ws.length <= 6 && ws.every((w) => /^_?[A-Z]/.test(w));
};

/**
 * @param {unknown} input generated case input
 * @param {{taskDescription?: string}} [ctx]
 * @returns {{ok: boolean, input: string, normalized: boolean, multiTurn: boolean, reasons: {code: string, text: string}[]}}
 */
function checkInput(input, ctx = {}) {
  const reasons = [];
  const finish = (text, normalized, multiTurn) => ({ ok: reasons.length === 0, input: text, normalized, multiTurn, reasons });
  if (typeof input !== 'string' || !input.trim()) {
    reasons.push({ code: 'input:empty', text: 'the input is missing or blank' });
    return finish('', false, false);
  }
  const raw = input.trim();
  const text = normalizeInput(raw);
  const normalized = text !== raw;
  const multiTurn = (raw.match(TURN_LABEL) ?? []).length > 1;

  const task = ctx.taskDescription ? words(ctx.taskDescription) : '';
  if (SCHEMA_ECHOES.has(words(text))) {
    reasons.push({ code: 'input:placeholder', text: `the input is the schema word "${text}"` });
  } else if (CHATTER.test(text)) {
    reasons.push({ code: 'input:chatter', text: 'the input is generator chatter, not a customer message' });
  } else if ((task && words(text) === task) || looksLikeTitle(text)) {
    reasons.push({ code: 'input:title-like', text: 'the input looks like a title or the task description, not a customer message' });
  } else if (text.length < MIN_INPUT_CHARS) {
    reasons.push({ code: 'input:too-short', text: `the input is shorter than ${MIN_INPUT_CHARS} characters` });
  }
  return finish(text, normalized, multiTurn);
}

const UNFILLED = [
  /<[^<>\n@]{2,80}>/,
  /\[[^[\]\n]{1,80}\]/,
  /\{[^{}\n]{1,60}\}/,
  /(?:^|\s)\.\.\.(?:\s|$)/,
];

/**
 * @param {unknown} output generated expected_output
 * @returns {{placeholderOutput: boolean, matches: string[]}}
 */
function checkExpectedOutput(output) {
  if (typeof output !== 'string') return { placeholderOutput: false, matches: [] };
  const matches = [];
  if (SCHEMA_ECHOES.has(words(output))) matches.push(output.trim());
  for (const re of UNFILLED) {
    const m = output.match(re);
    if (m) matches.push(m[0].trim());
  }
  return { placeholderOutput: matches.length > 0, matches };
}

module.exports = { checkInput, checkExpectedOutput, normalizeInput, MIN_INPUT_CHARS };
