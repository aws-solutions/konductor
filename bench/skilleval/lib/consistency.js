// SPDX-License-Identifier: Apache-2.0
'use strict';

// Checks the facts a rubric item states against the request it grades. Errors are provable conflicts with the request and send
// the item back to the model for repair. Warnings are claims the request does not contain; a human reads them before the freeze.

const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has', 'have', 'our', 'these', 'those', 'of', 'in', 'on', 'to', 'a', 'an']);
const GENERIC = new Set(['test', 'case', 'file', 'item', 'issue', 'gap', 'result', 'step', 'item', 'one', 'total', 'requirement', 'criterion']);
const TOTAL_CUE = /(?:total|overall|combined|altogether|sum|all)\W+(?:\w+\W+){0,3}$/i;
// A number about a recommended model or a threshold comes from the guidance, not from the request.
const BENCHMARK_CUE = /recommend|ideal|target|threshold|benchmark|pyramid|trophy|best practice|guideline|should be/i;
const NUMBER = /(?<![A-Za-z0-9_.])(\d+(?:\.\d+)?)(%|\s*(?:ms|s|x|k|kb|mb|gb)\b)?(?![A-Za-z0-9_])/g;

const stem = (w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

function labelTokens(text) {
  return String(text).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t)).map(stem);
}

const normalize = (text) => String(text).replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');

/** Every number in the text with its position and the single word that follows it. */
function numbersIn(text) {
  const t = normalize(text);
  const out = [];
  for (const m of t.matchAll(NUMBER)) {
    const end = m.index + m[0].length;
    const next = t.slice(end).match(/^\s*(?:of\s+)?([A-Za-z][A-Za-z0-9.-]*)/);
    out.push({ value: Number(m[1]), percent: m[2] === '%', index: m.index, end, word: next ? next[1] : '', label: next ? labelTokens(next[1]) : [] });
  }
  return out;
}

/** Counts of comma separated entries in lists such as "file.js with a, b, c", labelled by the words before the list. */
function listFacts(prompt) {
  const facts = [];
  for (const seg of normalize(prompt).split(/\n|;/)) {
    const m = seg.match(/^(.*)\b(?:with|containing|contains|including|includes|:)\s+([^:]+)$/);
    if (!m) continue;
    const entries = m[2].replace(/([.?!])\s.*$/s, '').split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((e) => e.replace(/\.(?:\s.*)?$/, '').trim()).filter(Boolean);
    if (entries.length < 2) continue;
    facts.push({ value: entries.length, label: [...new Set(labelTokens(m[1].trim().split(/\s+/).slice(-5).join(' ')))], source: 'list' });
  }
  return facts;
}

function promptFacts(prompt) {
  const literal = numbersIn(prompt).filter((n) => n.label.length).map((n) => ({ value: n.value, label: n.label, source: 'stated' }));
  return [...literal, ...listFacts(prompt)];
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Errors: a count that contradicts the request, a total that is not the sum of its parts, a rule id in the text. */
function itemErrors(criterion, facts) {
  const errors = [];
  const text = normalize(criterion);
  if (/\bR\d{2}\b/.test(text)) errors.push('names a rule id, which the grader never sees');
  for (const n of numbersIn(text)) {
    const label = n.label[0];
    if (!label) continue;
    const related = facts.filter((f) => f.label.includes(label));
    if (!related.length) continue;
    const generic = GENERIC.has(label);
    const total = TOTAL_CUE.test(text.slice(Math.max(0, n.index - 30), n.index)) || /^\s*[A-Za-z0-9.-]+\s*\(/.test(text.slice(n.end));
    if (generic && !total) continue;
    const lists = related.filter((f) => f.source === 'list');
    if (!lists.length && BENCHMARK_CUE.test(text)) continue;
    const allowed = new Set(related.map((f) => f.value));
    if (generic) allowed.add(sum(lists.map((f) => f.value)));
    if (!allowed.has(n.value)) {
      const seen = [...new Set(related.map((f) => f.value))].join(', ');
      errors.push(`"${n.value} ${n.word}" conflicts with the request, which gives ${generic ? `${seen}, total ${sum(lists.map((f) => f.value))}` : seen} for ${n.word}`);
    }
  }
  for (const m of text.matchAll(/(\d+)\s+\w+\s*\(([^)]*)\)/g)) {
    const parts = [...m[2].matchAll(/(\d+)\s+[A-Za-z]/g)].map((p) => Number(p[1]));
    if (parts.length >= 2 && sum(parts) !== Number(m[1])) errors.push(`total ${m[1]} is not the sum of its parts (${parts.join(' + ')} = ${sum(parts)})`);
  }
  return [...new Set(errors)];
}

function entitiesIn(criterion) {
  const out = new Set();
  const text = String(criterion);
  for (const m of text.matchAll(/`([^`]{2,60})`|"([^"]{2,60})"/g)) out.add((m[1] ?? m[2]).trim());
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b|\b\w+_\w+\b|\b[\w-]+\.[a-z]{2,4}\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,}\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/(?<=[a-z,;:)] )[A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})*/g)) out.add(m[0]);
  return [...out];
}

const FILLER_ENTITY = new Set(['the', 'answer', 'reply']);

/**
 * Checks the items of one rubric against the request. `rules` are the rules the rubric writer saw; numbers and names that come
 * from them are policy, not claims about the request, so they pass.
 */
function checkConsistency({ items, prompt, rules = [] }) {
  const facts = promptFacts(prompt);
  const promptText = normalize(prompt).toLowerCase();
  const promptTokens = new Set(labelTokens(prompt));
  const known = new Set(numbersIn(prompt).map((n) => n.value));
  for (const r of rules) for (const n of numbersIn(r.text)) known.add(n.value);
  const ruleText = rules.map((r) => r.text).join('\n').toLowerCase();
  const ruleTokens = new Set(labelTokens(ruleText));
  const listCounts = facts.filter((f) => f.source === 'list').map((f) => f.value);
  for (const c of listCounts) known.add(c);
  const derived = new Set([sum(listCounts)]);
  const errors = [];
  const warnings = [];
  items.forEach((item, index) => {
    for (const detail of itemErrors(item.criterion, facts)) errors.push({ index, kind: 'conflict', detail });
    for (const n of numbersIn(item.criterion)) {
      if (n.value <= 1 || known.has(n.value)) continue;
      const note = derived.has(n.value) ? ' (derivable from counts in the request)' : '';
      warnings.push({ index, kind: 'number', detail: `${n.value}${n.percent ? '%' : ''} is not in the request${note}` });
    }
    for (const e of entitiesIn(item.criterion)) {
      const low = e.toLowerCase();
      if (FILLER_ENTITY.has(low) || /^R\d{2}$/.test(e)) continue;
      const toks = labelTokens(e);
      const inPrompt = promptText.includes(low) || (toks.length > 0 && toks.every((t) => promptTokens.has(t)));
      const inRules = ruleText.includes(low) || (toks.length > 0 && toks.every((t) => ruleTokens.has(t)));
      if (!inPrompt && !inRules) warnings.push({ index, kind: 'name', detail: `"${e}" is not in the request` });
    }
  });
  const dedupe = (xs) => xs.filter((x, i) => xs.findIndex((y) => y.index === x.index && y.detail === x.detail) === i);
  return { errors: dedupe(errors), warnings: dedupe(warnings) };
}

module.exports = { checkConsistency, itemErrors, numbersIn, listFacts, promptFacts, entitiesIn, labelTokens };
