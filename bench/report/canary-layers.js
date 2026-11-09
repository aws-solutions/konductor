// SPDX-License-Identifier: Apache-2.0
'use strict';

// Scores the canary-layers runs (bench/CANARY-LAYERS.md): for each layer token, was it visible in the stream, and where.
// Reads files only: no model, no network, no writes except --out.
//
// What the stream can show:
//   toolResult  the token came back in a tool or skill result. Direct evidence the layer reached the model's context.
//   echoed      the token is in assistant text or in a tool call the model wrote. The model had it in context, but the
//               stream does not say which layer's channel carried it, so this is inferred from the token's own layer.
//   prompt      the token is in the session's first user message (only possible if the task text carried it).
// What it cannot show: the system prompt, context files and the skill index are not logged. A layer that reaches the
// model but is not repeated looks the same as a layer that never arrived. The task asks the model to report tokens,
// so a missing report is evidence of absence only to the extent the model follows that request.

const fs = require('node:fs');
const path = require('node:path');
const { kiroTimeline } = require('../runner/lib/trace.js');
const { fmtInterval } = require('./probes-stats.js');

const LAYERS = ['rules', 'prompt', 'index', 'skill', 'sop', 'ctx'];
const LAYER_LABEL = {
  rules: 'core-rules context file', prompt: 'agent system prompt', index: 'skill index (description)', skill: 'skill body', sop: 'SOP body', ctx: 'routing-rules context file',
};
const SHAPE = /kd-cl-(?:rules|prompt|index|skill|sop|ctx)-[0-9a-f]{8}/g;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return null; } };

function sessionStarts(runDir) {
  const root = path.join(runDir, 'session');
  if (!fs.existsSync(root)) return '';
  const out = [];
  for (const d of fs.readdirSync(root).filter((n) => n.startsWith('sess_'))) {
    const msgs = readJsonl(path.join(root, d, 'messages.jsonl')) || [];
    for (const m of msgs) if (m.payload?.type === 'user' && typeof m.payload.content === 'string') out.push(m.payload.content);
  }
  return out.join('\n');
}

function configOf(runDir) {
  let dir = path.dirname(runDir);
  for (let i = 0; i < 5; i++) {
    const c = readJson(path.join(dir, 'run-config.json'));
    if (c) return c;
    dir = path.dirname(dir);
  }
  return null;
}

/** Per layer: where the token showed up in one run. `tokens` maps layer to the exact token. */
function scoreEntries({ entries, tokens, promptText = '' }) {
  const TEXT = new Set(['assistant', 'thought', 'final', 'delegate-return']);
  const RESULT = new Set(['tool', 'skill-load', 'skill-find']);
  const assistant = entries.filter((e) => TEXT.has(e.kind)).map((e) => e.text ?? '').join('\n');
  const toolResult = entries.filter((e) => RESULT.has(e.kind)).map((e) => String(e.result ?? '')).join('\n');
  const toolInput = entries.filter((e) => RESULT.has(e.kind) || e.kind === 'delegate').map((e) => JSON.stringify(e.input ?? '')).join('\n');
  const layers = {};
  for (const l of LAYERS) {
    const t = tokens[l];
    const inToolResult = t ? toolResult.includes(t) : false;
    const echoed = t ? assistant.includes(t) || toolInput.includes(t) : false;
    layers[l] = { toolResult: inToolResult, echoed, prompt: t ? promptText.includes(t) : false, seen: inToolResult || echoed };
  }
  const known = new Set(Object.values(tokens));
  const forged = [...new Set((assistant.match(SHAPE) || []).filter((s) => !known.has(s)))];
  return { layers, forged };
}

function scoreRun(runDir, { tokens }) {
  const result = readJson(path.join(runDir, 'result.json')) || {};
  const events = readJsonl(path.join(runDir, 'stream.jsonl'));
  const config = configOf(runDir);
  const arm = result.armId ?? path.basename(path.dirname(path.dirname(runDir)));
  const task = result.taskId ?? path.basename(path.dirname(runDir));
  const agent = result.agent ?? config?.armAgent?.[arm] ?? 'konductor';
  const row = { dir: runDir, arm, task, agent, rep: result.replicate ?? Number(path.basename(runDir)), status: result.status ?? null, usable: false, layers: null, forged: [] };
  if (result.status === 'budget_skipped' || events == null) return { ...row, excluded: events == null ? 'no stream.jsonl' : 'budget-skipped' };
  const s = scoreEntries({ entries: kiroTimeline(events), tokens, promptText: sessionStarts(runDir) });
  return { ...row, usable: true, layers: s.layers, forged: s.forged };
}

function runDirsUnder(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 7) return;
    if (fs.existsSync(path.join(dir, 'result.json'))) { out.push(dir); return; }
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) if (e.isDirectory() && !['workspace', 'session', 'node_modules', '.git'].includes(e.name)) walk(path.join(dir, e.name), depth + 1);
  };
  walk(path.resolve(root), 0);
  return out.sort();
}

const tally = (rows, layer) => ({
  n: rows.length,
  seen: rows.filter((r) => r.layers[layer].seen).length,
  toolResult: rows.filter((r) => r.layers[layer].toolResult).length,
  echoed: rows.filter((r) => r.layers[layer].echoed).length,
});

/** Layer x group tables. Groups stay separate (per agent, per task, per agent and task); nothing is pooled across agents. */
function summarize(rows, expected = {}) {
  const usable = rows.filter((r) => r.usable);
  const by = (keyFn) => {
    const out = {};
    for (const r of usable) (out[keyFn(r)] ??= []).push(r);
    return out;
  };
  const table = (groups) => Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, Object.fromEntries(LAYERS.map((l) => [l, tally(rs, l)]))]));
  return {
    runs: rows.length, usable: usable.length,
    byAgent: table(by((r) => r.agent)),
    byTask: table(by((r) => r.task)),
    byAgentTask: table(by((r) => `${r.agent} / ${r.task}`)),
    expected,
    forged: usable.filter((r) => r.forged.length).map((r) => ({ agent: r.agent, task: r.task, rep: r.rep, tokens: r.forged })),
  };
}

const pct = (c) => (c.n ? `${Math.round((c.seen / c.n) * 100)}%` : 'n/a');

function renderMarkdown(sum) {
  const L = ['# Canary layers report', '', `${sum.usable} usable of ${sum.runs} runs.`, ''];
  L.push('Cell: runs where the token was seen / usable runs. "tool" is a tool or skill result (direct), "echo" is assistant text or a written tool call (inferred). "spec" says whether the agent spec declares the layer for that agent.', '');
  const section = (title, groups, specFor) => {
    L.push(`## ${title}`, '', `| group | ${LAYERS.map((l) => l).join(' | ')} |`, `|---|${LAYERS.map(() => '---').join('|')}|`);
    for (const [k, t] of Object.entries(groups).sort()) {
      const cells = LAYERS.map((l) => {
        const c = t[l];
        const spec = specFor ? (specFor(k, l) === true ? 'spec yes' : specFor(k, l) === false ? 'spec no' : '') : '';
        return `${fmtInterval(c.seen, c.n)} tool ${c.toolResult} echo ${c.echoed}${spec ? ` (${spec})` : ''}`;
      });
      L.push(`| ${k} | ${cells.join(' | ')} |`);
    }
    L.push('');
  };
  section('By entry agent', sum.byAgent, (agent, layer) => sum.expected?.[agent]?.[layer]);
  section('By task', sum.byTask);
  section('By entry agent and task', sum.byAgentTask);
  L.push('## Layers', '', ...LAYERS.map((l) => `- ${l}: ${LAYER_LABEL[l]}`), '');
  L.push('## Reading it', '', '- A layer with "spec yes" and 0 seen did not reach the model, or reached it and was not reported. Only a tool result settles delivery.',
    '- The skill index token shows only if the model called find_skills. The skill and SOP tokens show only if the model loaded that skill or SOP.',
    '- "spec no" with seen > 0 means the layer arrived by another route.', '');
  if (sum.forged.length) L.push('## Forged tokens', '', ...sum.forged.map((f) => `- ${f.agent} / ${f.task} rep ${f.rep}: ${f.tokens.join(', ')}`), '');
  return L.join('\n');
}

function cmdCanaryReport(opts) {
  const need = (k) => { if (!opts[k] || opts[k] === true) throw new Error(`canary-report needs --${k}`); return String(opts[k]); };
  const layers = readJson(path.resolve(need('layers-file')));
  if (!layers?.tokens) throw new Error('--layers-file must be the layers.json written by canary-layers.js build');
  const roots = need('run').split(',').map((d) => path.resolve(d));
  for (const r of roots) if (!fs.existsSync(r)) throw new Error(`--run directory not found: ${r}`);
  const rows = roots.flatMap((r) => runDirsUnder(r)).map((d) => scoreRun(d, { tokens: layers.tokens }));
  if (!rows.length) throw new Error(`no run directories (result.json) under ${roots.join(', ')}`);
  const sum = summarize(rows, layers.expected);
  const out = path.resolve(need('out'));
  fs.mkdirSync(out, { recursive: true });
  const md = renderMarkdown(sum);
  fs.writeFileSync(path.join(out, 'canary-report.md'), `${md}\n`);
  fs.writeFileSync(path.join(out, 'canary-report.json'), `${JSON.stringify(sum, null, 2)}\n`);
  console.log(md);
  console.log(`\nWrote canary-report.md and canary-report.json to ${out}`);
}

module.exports = { LAYERS, scoreEntries, scoreRun, runDirsUnder, summarize, renderMarkdown, cmdCanaryReport, pct };
