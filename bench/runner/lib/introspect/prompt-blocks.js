// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the first request of a run held: system blocks, listed skills, context files, tool names and hook texts. Split out of report.js (DEBT D-25).

const path = require('node:path');
const skills = require('../skills.js');
const { clip } = require('./report-text.js');

// ---- What the first request held (P5) ----

/** The plain text of a message content: a string, a list of text blocks, or an object with text. */
const textOf = (c) => {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(textOf).join('\n');
  if (typeof c === 'object') return typeof c.text === 'string' ? c.text : textOf(c.content ?? '');
  return String(c);
};

// Claude Code labels each injected file "Contents of <path> (<kind>):".
const CONTENTS_OF = /Contents of (\S+?)(?: \(([^)]*)\))?:/g;
const SKILL_BODY = /Base directory for this skill: (\S+)/g;
const SKILL_MD_PATH = /([\w.-]+)\/SKILL\.md/g;
const HOOK_INSTRUCTION = /<HOOK_INSTRUCTION[^>]*>([\s\S]*?)<\/HOOK_INSTRUCTION>/g;
// Tool names a prompt tells the model to call: a backticked snake_case word, or the name part of a tool::<server>::<name> id.
const TOOL_NAME_MENTION = /`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`|\btool::[\w.-]+::([A-Za-z][\w-]*)/g;

/**
 * The tool names the prompt mentions, each with its mention count and whether a tool of that name is in the request's
 * tool list (exactly, or as the last part of a namespaced name such as server___name or @server/name).
 */
function toolNamesInPrompt(text, tools) {
  const counts = new Map();
  for (const m of String(text).matchAll(TOOL_NAME_MENTION)) {
    const name = m[1] ?? m[2];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const offered = tools.map((t) => String(t.name));
  const inList = (n) => offered.some((t) => t === n || t.endsWith(`/${n}`) || t.endsWith(`__${n}`) || t.endsWith(`::${n}`));
  return [...counts].map(([name, mentions]) => ({ name, mentions, inToolList: inList(name) }))
    .sort((a, b) => (a.inToolList - b.inToolList) || (b.mentions - a.mentions) || a.name.localeCompare(b.name));
}

/** The files Claude Code injected into a prompt ("Contents of <path> (<kind>):"), as {path, kind}, in order. */
function contextFilesOf(text) {
  const out = [];
  for (const m of text.matchAll(CONTENTS_OF)) out.push({ path: m[1], kind: m[2] ?? null });
  return out;
}

/** Skill names listed for the model: "- name: description" lines after a skills header. */
function listedSkills(text) {
  const names = new Set();
  let inList = false;
  for (const line of String(text).split('\n')) {
    if (/skills? (are )?available|available skills|following skills|^#+ .*\bskills\b/i.test(line)) { inList = true; continue; }
    if (!inList) continue;
    const m = /^\s*[-*]\s+`?([A-Za-z0-9][\w:.-]{1,80})`?\s*:/.exec(line);
    if (m) names.add(m[1]);
    else if (/^#/.test(line)) inList = false;
  }
  return [...names];
}

/** Top-level sections of a prompt block: markdown H1/H2 headings and column-0 XML-style tags, with their sizes. */
function sectionsOf(text) {
  const marks = [];
  const re = /^(#{1,2} .+|<([a-zA-Z_-]+)(?: [^>]*)?>|Available agent types.*|The following skills are available.*|When you launch multiple agents.*)\s*$/gm;
  for (const m of String(text).matchAll(re)) marks.push({ at: m.index, title: clip(m[1], 80) });
  return marks.map((m, i) => ({ title: m.title, chars: (marks[i + 1]?.at ?? text.length) - m.at }));
}

/** One row per prompt block: where it sits, its role, its size, a 100-character head and, for a long block, its section titles. */
function summarizeBlocks(blocks) {
  return blocks.map((b) => ({ where: b.where, role: b.role, chars: b.text.length, head: clip(b.text, 100), sections: b.text.length > 1500 ? sectionsOf(b.text) : [] }));
}

// Claude Code prepends a hook's stdout to a prompt block as "<Event>:<matcher> hook <outcome>: <text>".
const HOOK_OUTPUT = /(?:^|\n)([A-Z][A-Za-z]+(?::[^\s:]+)?) hook ([a-z]+(?: [a-z]+)?): /g;

/**
 * Hook text injected into the prompt blocks, with the block it sits in: <HOOK_INSTRUCTION> tags (kiro-cli) and Claude
 * Code hook output lines. `known` are hook outputs from the stream; a known text found verbatim gives the exact length,
 * otherwise the text runs to the next blank line.
 */
function hookTextsIn(blocks, known = []) {
  const out = [];
  for (const b of blocks) {
    for (const m of b.text.matchAll(HOOK_INSTRUCTION)) out.push({ where: b.where, kind: 'HOOK_INSTRUCTION', hook: null, chars: m[1].length, head: clip(m[1], 200) });
    for (const m of b.text.matchAll(HOOK_OUTPUT)) {
      const start = m.index + m[0].length;
      const rest = b.text.slice(start);
      const k = known.find((t) => t && rest.startsWith(t));
      const text = k ?? rest.split(/\n\n/)[0];
      out.push({ where: b.where, kind: 'hook output', hook: m[1], outcome: m[2], chars: text.length, head: clip(text, 200), matchedStream: Boolean(k) });
    }
  }
  return out;
}

/** The P5 summary of one first request: model, blocks, context files, listed skills, preloaded skill bodies, tools and hook texts. */
function analyzeBlocks({ model, blocks, tools, hookOutputs = [] }) {
  const all = blocks.map((b) => b.text).join('\n');
  const toolChars = tools.reduce((s, t) => s + t.descChars, 0);
  return {
    model,
    blocks: summarizeBlocks(blocks),
    tools,
    toolChars,
    contextFiles: contextFilesOf(all),
    systemReminders: [...all.matchAll(/<system-reminder>([\s\S]*?)<\/system-reminder>/g)].map((m) => ({ chars: m[1].length, head: clip(m[1], 140) })),
    hookInstructions: hookTextsIn(blocks, hookOutputs),
    skillsListed: listedSkills(all),
    skillBodiesPreloaded: [...new Set([...all.matchAll(SKILL_BODY)].map((m) => path.basename(m[1])))],
    skillMdMentioned: [...new Set([...all.matchAll(SKILL_MD_PATH)].map((m) => m[1]))],
    toolNamesInPrompt: toolNamesInPrompt(all, tools),
    totalChars: all.length + toolChars,
  };
}

/** analyzeBlocks of a Claude Code request `body`: its system blocks and the first user message. */
function analyzeClaudeRequest(body, { hookOutputs = [] } = {}) {
  const blocks = [];
  (Array.isArray(body.system) ? body.system : body.system ? [body.system] : []).forEach((b, i) => blocks.push({ where: `system[${i}]`, role: 'system', text: textOf(b) }));
  (body.messages || []).forEach((m, i) => blocks.push({ where: `messages[${i}]`, role: m.role, text: textOf(m.content) }));
  const tools = (body.tools || []).map((t) => ({ name: t.name ?? '?', descChars: JSON.stringify(t).length }));
  return analyzeBlocks({ model: body.model ?? null, blocks, tools, hookOutputs });
}

module.exports = { textOf, HOOK_INSTRUCTION, toolNamesInPrompt, listedSkills, sectionsOf, hookTextsIn, analyzeBlocks, analyzeClaudeRequest };
