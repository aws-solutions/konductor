// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('./util.js');

const DEFAULT_PANEL = ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'];
const MIN_WORTH = 2;
const MAX_STYLE = 1;

// A judge sees the rule and the kind of request, nothing about where the rule came from.
function votePrompt({ rule }) {
  return `An AI assistant is answering user requests. Here is a candidate rule for answers to one kind of request.

KIND OF REQUEST: ${rule.requestType}
RULE: ${rule.text}

Decide two things:
1. worth: would a good answer to this kind of request be clearly better for following the rule, in ordinary cases and not only in rare ones? Say false if a competent assistant already does this by default or if following it changes little.
2. style_only: is the rule only about wording, tone, layout or formatting, and not about what the answer says?

Reply with only this JSON:
{"worth":true|false,"style_only":true|false,"reason":"<at most 20 words>"}`;
}

/** Keeps a rule when at least MIN_WORTH judges call it worth following and fewer than 2 call it style only. */
function decide(votes) {
  const valid = votes.filter((v) => !v.error);
  const worthCount = valid.filter((v) => v.worth).length;
  const styleCount = valid.filter((v) => v.styleOnly).length;
  const keep = worthCount >= MIN_WORTH && styleCount <= MAX_STYLE;
  return { worthCount, styleCount, keep };
}

function flagReasons({ rule, votes, worthCount, styleCount }) {
  const reasons = [];
  if (votes.some((v) => v.error)) reasons.push('judge error');
  else if (worthCount > 0 && worthCount < votes.length) reasons.push(`split on worth (${worthCount} of ${votes.length})`);
  if (styleCount > 0) reasons.push(`style (${styleCount} vote${styleCount > 1 ? 's' : ''})`);
  if (rule.tag === 'style') reasons.push('extractor tagged style');
  return reasons;
}

/** Owner decisions: {"R03":"keep"|"drop"}. Anything else is refused so a typo cannot pass silently. */
function loadDecisions(file, ruleIds) {
  if (!file || !fs.existsSync(file)) return {};
  const d = readJson(file);
  for (const [id, v] of Object.entries(d)) {
    if (!ruleIds.includes(id)) throw new Error(`${path.basename(file)}: unknown rule id ${id}`);
    if (v !== 'keep' && v !== 'drop') throw new Error(`${path.basename(file)}: ${id} must be "keep" or "drop" (got ${JSON.stringify(v)})`);
  }
  return d;
}

function flaggedMarkdown({ skill, panel, results }) {
  const rows = results.filter((r) => r.flags.length);
  const lines = [`# Rules flagged for owner review: ${skill}`, '', `Panel: ${panel.join(', ')}. Votes are worth/style per judge (Y or n).`, ''];
  if (!rows.length) return `${lines.join('\n')}No rule was flagged.\n`;
  lines.push('| Rule | Tag | Votes | Vote result | Flags | Rule text |', '| --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const v = r.votes.map((x) => (x.error ? `${x.judge}: error` : `${x.judge}: ${x.worth ? 'Y' : 'n'}/${x.styleOnly ? 'Y' : 'n'}`)).join('; ');
    lines.push(`| ${r.id} | ${r.tag} | ${v} | ${r.keep ? 'keep' : 'drop'} | ${r.flags.join(', ')} | ${r.text.replace(/\|/g, '/')} |`);
  }
  lines.push('', 'Record a decision in owner-decisions.json as {"R03": "keep", "R07": "drop"} and run vote again (cached, no cost).');
  return `${lines.join('\n')}\n`;
}

async function runVote({ rulesDoc, ask, panel = DEFAULT_PANEL, decisionsFile, outDir, concurrency = 3 }) {
  const rules = rulesDoc.rules;
  const decisions = loadDecisions(decisionsFile, rules.map((r) => r.id));
  const jobs = rules.flatMap((rule) => panel.map((judge) => ({ rule, judge })));
  const done = new Map();
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const { rule, judge } = jobs[next++];
      try {
        const v = await ask.askJson(judge, votePrompt({ rule }), (x) => {
          if (typeof x?.worth !== 'boolean' || typeof x?.style_only !== 'boolean') throw new Error('worth and style_only must be booleans');
        });
        done.set(`${rule.id}|${judge}`, { judge, worth: v.worth, styleOnly: v.style_only, reason: String(v.reason ?? '').slice(0, 200) });
      } catch (e) {
        if (e.constructor.name === 'BudgetExceeded') throw e;
        done.set(`${rule.id}|${judge}`, { judge, error: e.message.slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  const results = rules.map((rule) => {
    const votes = panel.map((j) => done.get(`${rule.id}|${j}`));
    const counts = decide(votes);
    const flags = flagReasons({ rule, votes, ...counts });
    const owner = decisions[rule.id] ?? null;
    const survives = owner ? owner === 'keep' : counts.keep;
    return { id: rule.id, text: rule.text, tag: rule.tag, votes, ...counts, flags, ownerDecision: owner, survives };
  });
  const survivors = rulesDoc.rules.filter((r) => results.find((x) => x.id === r.id).survives);
  writeJson(path.join(outDir, 'votes.json'), { skill: rulesDoc.skill, panel, thresholds: { minWorth: MIN_WORTH, maxStyle: MAX_STYLE }, results });
  writeJson(path.join(outDir, 'survivors.json'), { skill: rulesDoc.skill, source: rulesDoc.source, rules: survivors });
  fs.writeFileSync(path.join(outDir, 'flagged.md'), flaggedMarkdown({ skill: rulesDoc.skill, panel, results }));
  return { results, survivors };
}

module.exports = { votePrompt, decide, flagReasons, loadDecisions, runVote, DEFAULT_PANEL, MIN_WORTH, MAX_STYLE };
