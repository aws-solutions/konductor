// SPDX-License-Identifier: Apache-2.0
'use strict';

// The skill-nudge hook arms (design B of reports/skill-awareness-review-2026-11-22.md). A `userPromptSubmit` hook on
// the konductor agent runs a local matcher with no model call: it scores the request text against the agent's own skill
// trigger lines and prints the top 3, with "your call" and "say no skill fits". The filler arm runs a hook of the same
// shape that prints neutral text of about the same size and names no skill, so the effect of the hint is separable from
// the effect of having a hook at all.
//
// Fairness: the index is built from the arm tree only (the agent spec's skill list and each SKILL.md frontmatter
// description), before any task is read. The hook program reads nothing but its stdin payload; it has no file, network
// or environment access in its source (checked by a test). Every line it prints is a fixed template line or an index
// line, and the index lines are the same text the installed prompt already lists under "## Your skills".

const fs = require('node:fs');
const path = require('node:path');
const { frontmatter, fmValue } = require('../runner/lib/frontmatter.js');
const { sha256 } = require('../runner/lib/util.js');

const TOOL_VERSION = 'cap-nudge/1';
const ORCHESTRATOR = 'konductor';
const TRIGGER = 'userPromptSubmit';
const HOOK_TIMEOUT_MS = 10000;
const TOP = 3;

// The first line of each hook's output. Both are unique strings, so a run's session record shows whether the hook fired.
const NUDGE_HEADER = 'Skills whose description matches this request (from your skill list; your call):';
const NUDGE_FOOTER = 'Load one with get_skill if it fits the task; say "no skill fits" if none does.';
const NUDGE_NONE = '  (no listed skill shares words with this request)';
const FILLER_HEADER = 'Notes for this request (no action needed):';
// Neutral sentences: no skill, tool or loading word, so the filler adds a hook and text but no hint.
const FILLER_SENTENCES = [
  'Read the request from start to finish.',
  'Note what it asks for and what a good result looks like.',
  'Then do the work one step at a time.',
  'Check the result before you finish.',
  'Say what you changed and where.',
];

// ---- trigger lines: a port of cli/konductor-rs/src/cli/synth/skill_index.rs (skill_trigger) ----

const TRIGGER_MAX_CHARS = 160;
const MIN_SUMMARY_CHARS = 40;
const ELLIPSIS = '...';
const EVERY_TASK_MARKER = 'MUST USE for every ';

/** A YAML scalar as written in the frontmatter, unquoted the way YAML reads it. */
function unquote(v) {
  if (/^'.*'$/s.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/s.test(v)) { try { return JSON.parse(v); } catch { return v.slice(1, -1); } }
  return v;
}

// A sentence ends at . ! or ? only when a space and then an uppercase letter, quote or backtick follow.
function splitSentences(text) {
  const chars = [...text];
  const out = [];
  let start = 0;
  let pos = 0;
  const offsets = chars.map((c) => { const at = pos; pos += c.length; return at; });
  for (let i = 0; i < chars.length; i++) {
    if (!'.!?'.includes(chars[i]) || i + 2 >= chars.length) continue;
    const next = chars[i + 2];
    if (chars[i + 1] === ' ' && (next !== next.toLowerCase() || '"\'`'.includes(next))) {
      out.push(text.slice(start, offsets[i] + 1));
      start = offsets[i + 2];
    }
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

function capOnWordBoundary(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  const keep = max - ELLIPSIS.length;
  const prefix = chars.slice(0, keep).join('');
  const space = prefix.lastIndexOf(' ');
  const atWord = space >= 0 && chars[keep] !== ' ' ? prefix.slice(0, space) : prefix;
  return `${atWord.replace(/[,;: ]+$/, '')}${ELLIPSIS}`;
}

function withSummary(summary, chosen, chosenAt) {
  const n = [...chosen].length;
  if (chosenAt === 0 || n + 1 >= TRIGGER_MAX_CHARS) return capOnWordBoundary(chosen, TRIGGER_MAX_CHARS);
  const room = TRIGGER_MAX_CHARS - n - 1;
  if (room < MIN_SUMMARY_CHARS) return chosen;
  return `${capOnWordBoundary(summary, room)} ${chosen}`;
}

/** { text, everyTask } for a frontmatter description, or null when it is blank. Same text synth puts in the prompt. */
function skillTrigger(description) {
  const plain = String(description ?? '').replace(/\u2014/g, ' - ').replace(/\u2013/g, '-');
  const collapsed = plain.split(/\s+/).filter(Boolean).join(' ');
  if (!collapsed) return null;
  const sentences = splitSentences(collapsed);
  let at = sentences.findIndex((s) => s.startsWith('Use ') || s.startsWith('MUST USE'));
  if (at < 0) at = 0;
  return { text: withSummary(sentences[0], sentences[at], at), everyTask: sentences[at].startsWith(EVERY_TASK_MARKER) };
}

// ---- index ----

/**
 * The agent's skill index from an arm tree: one { name, trigger } per skill in the agent spec's skillNames, in that
 * order, with the every-task skill (constraints) left out as synth leaves it out. Reads the spec and SKILL.md
 * frontmatter only. A listed skill with no directory or no description is skipped, as synth skips it.
 */
function buildIndex(tree, agent = ORCHESTRATOR) {
  const spec = JSON.parse(fs.readFileSync(path.join(tree, 'agents', `${agent}.agent-spec.json`), 'utf8'));
  const names = spec.dependencies?.skills?.skillNames ?? [];
  const out = [];
  for (const name of names) {
    let text;
    try { text = fs.readFileSync(path.join(tree, 'skills', name, 'SKILL.md'), 'utf8'); } catch { continue; }
    const t = skillTrigger(unquote(fmValue(frontmatter(text), 'description')));
    if (t && !t.everyTask) out.push({ name, trigger: t.text });
  }
  return out;
}

// ---- matcher ----
// tokens(), rank() and render() run inside the hook, copied in by their source text, so they must stay self-contained:
// no closure over module scope and no single quote character (the hook command is a single-quoted shell word).

function tokens(text) {
  const stop = new Set(["the", "and", "for", "with", "use", "when", "that", "this", "from", "into", "your", "you", "are", "not", "but", "its", "any", "all", "can", "has", "have", "will", "each", "one", "two", "who", "what", "which", "they", "them", "than", "then", "also", "only", "out", "our", "was", "were", "been", "being", "after", "before", "about", "such", "like", "via", "per", "more", "most", "other", "some", "how", "why", "where", "should", "must", "may", "need", "needs", "does", "doc", "file", "files", "write", "make", "asked", "ask", "task", "work"]);
  const out = new Set();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || stop.has(raw)) continue;
    let w = raw;
    if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length >= 3 && !stop.has(w)) out.add(w);
  }
  return [...out];
}

// data: { skills: [{ name, trigger, words }], idf: { word: weight } }. Top `top` by summed weight of shared words,
// score above 0 only, ties kept in index order.
function rank(prompt, data, top) {
  const asked = new Set(tokens(prompt));
  const scored = data.skills.map((s, i) => ({ i, name: s.name, trigger: s.trigger, score: s.words.filter((w) => asked.has(w)).reduce((n, w) => n + (data.idf[w] || 0), 0) }));
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, top);
}

function render(hits, t) {
  const lines = [t.header];
  if (hits.length) for (const h of hits) lines.push("  " + h.name + ": " + h.trigger);
  else lines.push(t.none);
  lines.push(t.footer);
  return lines.join("\n") + "\n";
}

/** The data the hook carries: each skill's words (from its name and trigger line) and an idf weight per word. */
function matcherData(index) {
  const skills = index.map((s) => ({ name: s.name, trigger: s.trigger, words: tokens(`${s.name.replace(/-/g, ' ')} ${s.trigger}`) }));
  const df = new Map();
  for (const s of skills) for (const w of s.words) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = {};
  for (const [w, n] of [...df.entries()].sort()) idf[w] = Number(Math.log(skills.length / n).toFixed(4));
  return { skills, idf };
}

// The request text from a hook payload: kiro-cli sends JSON with the prompt under `prompt`; anything else is read raw.
function promptOf(stdin) {
  let j = null;
  try { j = JSON.parse(stdin); } catch { return stdin; }
  if (j && typeof j === "object") {
    for (const k of ["prompt", "user_prompt", "userPrompt", "message", "input"]) if (typeof j[k] === "string") return j[k];
    return "";
  }
  return typeof j === "string" ? j : "";
}

// A JS value as source text with no single quote, so it fits inside a single-quoted shell word.
const literal = (v) => JSON.stringify(v).replace(/'/g, '\\u0027');

/** The hook program for the nudge arm: reads the payload on stdin and prints the top 3 hint. */
function nudgeSource(index) {
  const t = { header: NUDGE_HEADER, footer: NUDGE_FOOTER, none: NUDGE_NONE };
  return [
    `const D=${literal(matcherData(index))};const T=${literal(t)};`,
    tokens.toString(), rank.toString(), render.toString(), promptOf.toString(),
    `let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",(c)=>{s+=c;});process.stdin.on("end",()=>{process.stdout.write(render(rank(promptOf(s),D,${TOP}),T));});`,
  ].join('\n');
}

/** Neutral text near `bytes` long: the header, then whole filler sentences in a fixed order while they fit. */
function fillerText(bytes) {
  const lines = [FILLER_HEADER];
  let n = Buffer.byteLength(`${FILLER_HEADER}\n`);
  for (let i = 0; i < FILLER_SENTENCES.length * 6; i++) {
    const line = `  ${FILLER_SENTENCES[i % FILLER_SENTENCES.length]}`;
    const k = Buffer.byteLength(`${line}\n`);
    if (n + k > bytes) break;
    lines.push(line);
    n += k;
  }
  return `${lines.join('\n')}\n`;
}

/** The hook program for the filler arm: same shape (node, reads all of stdin), prints fixed neutral text. */
function fillerSource(bytes) {
  return `const F=${literal(fillerText(bytes))};let s="";process.stdin.on("data",(c)=>{s+=c;});process.stdin.on("end",()=>{process.stdout.write(F);});`;
}

/**
 * The filler size, from the index alone (no task): header, footer and three average index lines. A typical nudge
 * output is about this long.
 */
function typicalNudgeBytes(index) {
  const lines = index.map((s) => Buffer.byteLength(`  ${s.name}: ${s.trigger}\n`));
  const mean = lines.length ? lines.reduce((a, b) => a + b, 0) / lines.length : 0;
  return Math.round(Buffer.byteLength(`${NUDGE_HEADER}\n${NUDGE_FOOTER}\n`) + TOP * mean);
}

function hookCommand(source) {
  if (source.includes("'")) throw new Error('hook source holds a single quote, so it cannot be one shell word');
  return `node -e '${source}'`;
}

/**
 * Variant op: wires a userPromptSubmit hook into the orchestrator's agent spec (clientConfig.kiroCli.hooks, which synth
 * converts for engine v3). kind 'nudge' or 'filler'. Returns the op record for variant.json, with the hook command's
 * sha256 so every run that used it can be matched to the exact matcher.
 */
function opHook(tree, kind) {
  if (kind !== 'nudge' && kind !== 'filler') throw new Error('--hook takes nudge or filler');
  const index = buildIndex(tree);
  if (!index.length) throw new Error(`agents/${ORCHESTRATOR}.agent-spec.json lists no skill with a description; a nudge hook would have nothing to say`);
  const fillerBytes = typicalNudgeBytes(index);
  const command = hookCommand(kind === 'nudge' ? nudgeSource(index) : fillerSource(fillerBytes));
  const file = path.join(tree, 'agents', `${ORCHESTRATOR}.agent-spec.json`);
  const before = sha256(fs.readFileSync(file));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kiro = ((j.clientConfig ??= {}).kiroCli ??= {});
  if (kiro.hooks?.[TRIGGER]?.length) throw new Error(`${ORCHESTRATOR} already has a ${TRIGGER} hook; this op adds the only one`);
  kiro.hooks = { ...(kiro.hooks ?? {}), [TRIGGER]: [{ command, timeout_ms: HOOK_TIMEOUT_MS }] };
  fs.writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`);
  return {
    op: 'hook', id: `hook:${kind}`, agent: ORCHESTRATOR, trigger: TRIGGER, toolVersion: TOOL_VERSION,
    commandSha256: sha256(command), commandBytes: Buffer.byteLength(command), indexSha256: sha256(JSON.stringify(index)), skills: index.length,
    header: kind === 'nudge' ? NUDGE_HEADER : FILLER_HEADER, ...(kind === 'filler' ? { fillerBytes } : {}),
    beforeSha256: before, afterSha256: sha256(fs.readFileSync(file)),
  };
}

/** What the nudge hook prints for `prompt`, computed here instead of in a hook process (for the person's leak check). */
function preview(index, prompt) {
  const data = matcherData(index);
  const hits = rank(prompt, data, TOP);
  const all = rank(prompt, data, data.skills.length);
  return {
    hits: hits.map((h) => ({ name: h.name, score: Number(h.score.toFixed(3)) })),
    // Rank-1 margin: how far the top skill is ahead of the second, as a share of its own score. Near 1 is a strong nudge.
    margin: all.length ? Number(((all[0].score - (all[1]?.score ?? 0)) / all[0].score).toFixed(3)) : null,
    text: render(hits, { header: NUDGE_HEADER, footer: NUDGE_FOOTER, none: NUDGE_NONE }),
  };
}

module.exports = {
  TOOL_VERSION, TRIGGER, NUDGE_HEADER, NUDGE_FOOTER, NUDGE_NONE, FILLER_HEADER, FILLER_SENTENCES,
  skillTrigger, unquote, buildIndex, tokens, rank, matcherData, promptOf, nudgeSource, fillerSource, fillerText, typicalNudgeBytes,
  hookCommand, opHook, preview,
};
