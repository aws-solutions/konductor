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

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { frontmatter, fmValue } = require('../runner/lib/frontmatter.js');

const TOOL_VERSION = 'cap-nudge/2';
const ORCHESTRATOR = 'konductor';
const TRIGGER = 'userPromptSubmit';
const HOOK_TIMEOUT_MS = 10000;
const TOP = 3;

// The first line of each hook's output. Both are unique strings, so a run's session record shows whether the hook fired.
const NUDGE_HEADER = 'Skills whose description matches this request (from your skill list; your call):';
const NUDGE_FOOTER = 'Load one with get_skill if it fits the task; say "no skill fits" if none does.';
const NUDGE_NONE = '  (no listed skill shares words with this request)';
const NUDGE_BROAD = 'Also listed for every request (the broadest triggers):';
const TEMPLATE = Object.freeze({ header: NUDGE_HEADER, footer: NUDGE_FOOTER, none: NUDGE_NONE, broad: NUDGE_BROAD });
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
 * The agent's skill index from an arm tree: one { name, trigger, description } per skill in the agent spec's skillNames, in that
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
    const description = unquote(fmValue(frontmatter(text), 'description'));
    const t = skillTrigger(description);
    if (t && !t.everyTask) out.push({ name, trigger: t.text, description: description.split(/\s+/).filter(Boolean).join(' ') });
  }
  return out;
}

// ---- matcher ----
// tokens(), rank(), shown() and render() run inside the hook, copied in by their source text, so they must stay
// self-contained: no closure over module scope and no single quote character (the hook command is a single-quoted
// shell word).

// Words of `text`, lower case, stop words dropped. stem "basic" strips -ing, -ed and a plural s; "strong" also strips
// -ation, -ment, -er and -es and turns -ies into -y, keeping at least 4 letters.
function tokens(text, stem) {
  const stop = new Set(["the", "and", "for", "with", "use", "when", "that", "this", "from", "into", "your", "you", "are", "not", "but", "its", "any", "all", "can", "has", "have", "will", "each", "one", "two", "who", "what", "which", "they", "them", "than", "then", "also", "only", "out", "our", "was", "were", "been", "being", "after", "before", "about", "such", "like", "via", "per", "more", "most", "other", "some", "how", "why", "where", "should", "must", "may", "need", "needs", "does", "doc", "file", "files", "write", "make", "asked", "ask", "task", "work"]);
  const strong = [["ations", ""], ["ation", ""], ["ments", ""], ["ment", ""], ["ings", ""], ["ing", ""], ["ies", "y"], ["ied", "y"], ["ers", ""], ["er", ""], ["es", ""], ["ed", ""], ["s", ""]];
  const out = new Set();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || stop.has(raw)) continue;
    let w = raw;
    if (stem === "strong") {
      for (const [suf, rep] of strong) {
        if (w.endsWith(suf) && w.length - suf.length + rep.length >= 4 && !(suf === "s" && w.endsWith("ss"))) { w = w.slice(0, w.length - suf.length) + rep; break; }
      }
    } else if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length >= 3 && !stop.has(w)) out.add(w);
  }
  return [...out];
}

// data: { stem, norm, skills: [{ name, trigger, w: { word: weight }, len }], idf: { word: weight }, broad: [index] }.
// Score: the sum of weight x idf over words the request shares with the skill, divided by sqrt(len) when norm is on.
// Top `top` with a score above 0, ties kept in index order.
function rank(prompt, data, top) {
  const asked = new Set(tokens(prompt, data.stem));
  const scored = data.skills.map((s, i) => {
    let score = 0;
    for (const w of Object.keys(s.w)) if (asked.has(w)) score += s.w[w] * (data.idf[w] || 0);
    if (data.norm) score = score / Math.sqrt(s.len || 1);
    return { i, name: s.name, trigger: s.trigger, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, top);
}

// The matched skills and, for a hybrid matcher, the fixed broad skills not already matched.
function shown(prompt, data, top) {
  const hits = rank(prompt, data, top);
  const broad = data.broad.map((i) => data.skills[i]).filter((b) => !hits.some((h) => h.name === b.name));
  return { hits, broad };
}

function render(view, t) {
  const lines = [t.header];
  if (view.hits.length) for (const h of view.hits) lines.push("  " + h.name + ": " + h.trigger);
  else lines.push(t.none);
  if (view.broad.length) {
    lines.push(t.broad);
    for (const b of view.broad) lines.push("  " + b.name + ": " + b.trigger);
  }
  lines.push(t.footer);
  return lines.join("\n") + "\n";
}

// The matcher variants studied on the 26 LITE tasks outside the experiment (reports/nudge-arm-prep-2026-11-22.md).
// v1: plain word overlap on the name and trigger line. v2: strong stemming, name words x3, words of the "Use ..."
// clause x2, length-normalised. v3: v2 plus the rest of the frontmatter description at x0.5. v4: v3 plus the two
// skills with the most distinct trigger words, listed on every request.
const MATCHERS = Object.freeze({
  'v1-overlap': { stem: 'basic', norm: false, nameW: 1, useW: 1, restW: 1, descW: 0, broad: 0 },
  'v2-weighted': { stem: 'strong', norm: true, nameW: 3, useW: 2, restW: 1, descW: 0, broad: 0 },
  'v3-desc': { stem: 'strong', norm: true, nameW: 3, useW: 2, restW: 1, descW: 0.5, broad: 0 },
  'v4-hybrid': { stem: 'strong', norm: true, nameW: 3, useW: 2, restW: 1, descW: 0.5, broad: 2 },
});
// The variant the arms use. Chosen on the 26 tuning tasks only, then frozen before the 8 were scored.
const FROZEN_MATCHER = 'v2-weighted';

/**
 * The data the hook carries for `variant`: per skill a weight per word (from its name, its trigger line and, for v3
 * and v4, its frontmatter description), an idf weight per word, and the broad skills.
 */
function matcherData(index, variant = FROZEN_MATCHER) {
  const m = MATCHERS[variant];
  if (!m) throw new Error(`unknown matcher ${variant} (${Object.keys(MATCHERS).join(', ')})`);
  const skills = index.map((s) => {
    const w = {};
    const put = (words, weight) => { for (const x of words) if (weight > (w[x] ?? 0)) w[x] = weight; };
    const at = s.trigger.indexOf('Use ');
    const use = at >= 0 ? s.trigger.slice(at) : '';
    const rest = at >= 0 ? s.trigger.slice(0, at) : s.trigger;
    if (m.descW) put(tokens(s.description ?? '', m.stem), m.descW);
    put(tokens(rest, m.stem), m.restW);
    put(tokens(use, m.stem), m.useW);
    put(tokens(s.name.replace(/-/g, ' '), m.stem), m.nameW);
    const len = Object.keys(w).length;
    return { name: s.name, trigger: s.trigger, w, len, triggerWords: tokens(s.trigger, m.stem).length };
  });
  const df = new Map();
  for (const s of skills) for (const x of Object.keys(s.w)) df.set(x, (df.get(x) ?? 0) + 1);
  const idf = {};
  for (const [x, n] of [...df.entries()].sort()) idf[x] = Number(Math.log(skills.length / n).toFixed(4));
  const broad = skills.map((s, i) => ({ i, n: s.triggerWords })).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, m.broad).map((b) => b.i);
  return { stem: m.stem, norm: m.norm, skills: skills.map(({ triggerWords, ...s }) => s), idf, broad };
}

/** Names the hook shows for `prompt`: the matched ones, then any broad ones. */
function shownFor(prompt, data) {
  const v = shown(prompt, data, TOP);
  return [...v.hits, ...v.broad].map((s) => s.name);
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
function nudgeSource(index, variant = FROZEN_MATCHER) {
  return [
    `const D=${literal(matcherData(index, variant))};const T=${literal(TEMPLATE)};`,
    tokens.toString(), rank.toString(), shown.toString(), render.toString(), promptOf.toString(),
    `let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",(c)=>{s+=c;});process.stdin.on("end",()=>{process.stdout.write(render(shown(promptOf(s),D,${TOP}),T));});`,
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
function typicalNudgeBytes(index, variant = FROZEN_MATCHER) {
  const lines = index.map((s) => Buffer.byteLength(`  ${s.name}: ${s.trigger}\n`));
  const mean = lines.length ? lines.reduce((a, b) => a + b, 0) / lines.length : 0;
  const broad = MATCHERS[variant].broad;
  return Math.round(Buffer.byteLength(`${NUDGE_HEADER}\n${NUDGE_FOOTER}\n${broad ? `${NUDGE_BROAD}\n` : ''}`) + (TOP + broad) * mean);
}

function hookCommand(source) {
  if (source.includes("'")) throw new Error('hook source holds a single quote, so it cannot be one shell word');
  return `node -e '${source}'`;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Variant op: wires a userPromptSubmit hook into the orchestrator's agent spec (clientConfig.kiroCli.hooks, which synth
 * converts for engine v3). kind 'nudge' or 'filler'. Returns the op record for variant.json, with the hook command's
 * sha256 so every run that used it can be matched to the exact matcher.
 */
function opHook(tree, kind) {
  if (kind !== 'nudge' && kind !== 'filler') throw new Error('--hook takes nudge or filler');
  const index = buildIndex(tree);
  if (!index.length) throw new Error(`agents/${ORCHESTRATOR}.agent-spec.json lists no skill with a description; a nudge hook would have nothing to say`);
  const fillerBytes = typicalNudgeBytes(index, FROZEN_MATCHER);
  const command = hookCommand(kind === 'nudge' ? nudgeSource(index) : fillerSource(fillerBytes));
  const file = path.join(tree, 'agents', `${ORCHESTRATOR}.agent-spec.json`);
  const before = sha256(fs.readFileSync(file));
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const kiro = ((j.clientConfig ??= {}).kiroCli ??= {});
  if (kiro.hooks?.[TRIGGER]?.length) throw new Error(`${ORCHESTRATOR} already has a ${TRIGGER} hook; this op adds the only one`);
  kiro.hooks = { ...(kiro.hooks ?? {}), [TRIGGER]: [{ command, timeout_ms: HOOK_TIMEOUT_MS }] };
  fs.writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`);
  return {
    op: 'hook', id: `hook:${kind}`, agent: ORCHESTRATOR, trigger: TRIGGER, toolVersion: TOOL_VERSION, matcher: FROZEN_MATCHER,
    commandSha256: sha256(command), commandBytes: Buffer.byteLength(command), indexSha256: sha256(JSON.stringify(index)), skills: index.length,
    header: kind === 'nudge' ? NUDGE_HEADER : FILLER_HEADER, ...(kind === 'filler' ? { fillerBytes } : {}),
    beforeSha256: before, afterSha256: sha256(fs.readFileSync(file)),
  };
}

/** What the nudge hook prints for `prompt`, computed here instead of in a hook process (for the person's leak check). */
function preview(index, prompt, variant = FROZEN_MATCHER) {
  const data = matcherData(index, variant);
  const view = shown(prompt, data, TOP);
  const all = rank(prompt, data, data.skills.length);
  return {
    hits: view.hits.map((h) => ({ name: h.name, score: Number(h.score.toFixed(3)) })),
    broad: view.broad.map((b) => b.name),
    // Rank-1 margin: how far the top skill is ahead of the second, as a share of its own score. Near 1 is a strong nudge.
    margin: all.length ? Number(((all[0].score - (all[1]?.score ?? 0)) / all[0].score).toFixed(3)) : null,
    text: render(view, TEMPLATE),
  };
}

module.exports = {
  TOOL_VERSION, TRIGGER, NUDGE_HEADER, NUDGE_FOOTER, NUDGE_NONE, NUDGE_BROAD, FILLER_HEADER, FILLER_SENTENCES, MATCHERS, FROZEN_MATCHER,
  skillTrigger, unquote, buildIndex, tokens, rank, shown, shownFor, matcherData, promptOf, nudgeSource, fillerSource, fillerText, typicalNudgeBytes,
  hookCommand, opHook, preview,
};
