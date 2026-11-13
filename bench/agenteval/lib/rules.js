// SPDX-License-Identifier: Apache-2.0
'use strict';

// Optional owner-written rules that a proposed tool sequence must obey. Two kinds, picked by shape:
//   {"before": ["lookup_order", "issue_refund"]}                        whenever the second tool appears, the first appears earlier
//   {"tool": "send_email", "inputPattern": "e-?mail|send me"}           the tool may appear only if the input matches the pattern (case-insensitive)
// A rule may carry a "note" that is repeated in the reason text.

const fs = require('node:fs');

function parseRules(raw, { tools } = {}) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.rules) ? raw.rules : null;
  if (!list) throw new Error('rules must be a JSON array, or an object with a "rules" array');
  const known = tools ? new Set(tools) : null;
  const checkTool = (name, at) => {
    if (typeof name !== 'string' || !name) throw new Error(`rule ${at}: tool names must be non-empty strings`);
    if (known && !known.has(name)) throw new Error(`rule ${at}: "${name}" is not a declared tool`);
    return name;
  };
  return list.map((r, i) => {
    const at = i + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`rule ${at}: must be an object`);
    const note = typeof r.note === 'string' ? r.note : undefined;
    if ('before' in r) {
      if (!Array.isArray(r.before) || r.before.length !== 2) throw new Error(`rule ${at}: "before" needs exactly two tool names`);
      const [first, second] = r.before.map((n) => checkTool(n, at));
      return { kind: 'before', first, second, note };
    }
    if ('tool' in r && 'inputPattern' in r) {
      const tool = checkTool(r.tool, at);
      if (typeof r.inputPattern !== 'string') throw new Error(`rule ${at}: "inputPattern" must be a string`);
      let re;
      try { re = new RegExp(r.inputPattern, 'i'); } catch (e) { throw new Error(`rule ${at}: bad inputPattern: ${e.message}`); }
      return { kind: 'forbidUnless', tool, pattern: r.inputPattern, re, note };
    }
    throw new Error(`rule ${at}: use {"before": [a, b]} or {"tool": t, "inputPattern": p}`);
  });
}

function loadRules(file, opts) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`cannot read rules file ${file}: ${e.message}`); }
  return parseRules(raw, opts);
}

/**
 * @param {ReturnType<typeof parseRules>} rules
 * @param {{tools: string[], input: string}} subject proposed tool names in order, and the normalized input
 * @returns {{code: string, text: string}[]}
 */
function checkRules(rules, { tools, input }) {
  const out = [];
  for (const r of rules) {
    const suffix = r.note ? ` (${r.note})` : '';
    if (r.kind === 'before') {
      const at = tools.indexOf(r.second);
      if (at >= 0 && !tools.slice(0, at).includes(r.first)) {
        out.push({ code: 'rule:before', text: `${r.second} is proposed without ${r.first} before it${suffix}` });
      }
    } else if (tools.includes(r.tool) && !r.re.test(input)) {
      out.push({ code: 'rule:forbidUnless', text: `${r.tool} is proposed but the input does not match /${r.pattern}/i${suffix}` });
    }
  }
  return out;
}

module.exports = { parseRules, loadRules, checkRules };
