// SPDX-License-Identifier: Apache-2.0
'use strict';

// Post-run audit of a real-repository run. The agent has open network access (the model API needs it), the
// fix is public, and the model may remember it. Two things are measured after the run and never block it:
//   externalFetch  the agent ran a command that fetches or installs something, or touched a URL of the
//                  upstream repository, its pull request, its issue or its package page;
//   fixRecall      the agent's change to non-test files repeats 80 or more consecutive characters of the
//                  upstream fix verbatim (indentation ignored).
// Both are recorded in result.json and reported on their own; neither changes the check results.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isTestPath } = require('../../real/lib.js');

const MIN_RECALL = 80;
const EVIDENCE_MAX = 200;

const SHELL_TOOL = /^(shell|bash|execute_bash|execute_command|run_command|terminal)$/i;
// Tools that fetch or browse. Search patterns, file contents and delegation prompts are not scanned.
const WEB_TOOL = /(^|[_-])(web|fetch|http|https|browse|browser|download|url|curl)([_-]|$)/i;

const COMMANDS = [
  /\bgit\s+(clone|fetch)\b/,
  /\b(curl|wget)\b/,
  /(^|[^\w-])gh\s/,
  /\bpip3?\s+(install|download)\b/,
  /\bnpm\s+(install|i)\b/,
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const loose = (name) => esc(name).replace(/(\\?[-_.])/g, '[-_.]');

function repoPath(url) {
  const m = /^https?:\/\/github\.com\/([^/]+\/[^/.]+)/i.exec(url || '');
  return m ? m[1] : null;
}

// URL patterns for the upstream repository and the package pages that hold released copies of the fix.
function urlPatterns(entry) {
  if (!entry) return [];
  const out = [];
  const repo = repoPath(entry.repo?.url);
  if (repo) {
    const r = esc(repo);
    out.push(new RegExp(`github\\.com/${r}`, 'i'), new RegExp(`(raw|gist|codeload)\\.githubusercontent\\.com/${r}`, 'i'),
      new RegExp(`api\\.github\\.com/repos/${r}`, 'i'), new RegExp(`codeload\\.github\\.com/${r}`, 'i'));
  }
  for (const n of entry.repo?.packageNames || []) {
    const p = loose(n);
    out.push(new RegExp(`pypi\\.org/(project|simple|pypi)/${p}(/|\\b)`, 'i'), new RegExp(`files\\.pythonhosted\\.org/\\S*?${p}[-_]`, 'i'),
      new RegExp(`registry\\.npmjs\\.org/${p}\\b`, 'i'), new RegExp(`npmjs\\.com/package/${p}\\b`, 'i'),
      new RegExp(`(unpkg\\.com|cdn\\.jsdelivr\\.net/npm)/${p}\\b`, 'i'));
  }
  return out;
}

const shorten = (s) => (s.length > EVIDENCE_MAX ? `${s.slice(0, EVIDENCE_MAX)}...` : s);

/**
 * events: parsed stream events. entry: the manifest entry (for URL patterns; may be null).
 * Returns [{tool, text}], one per offending tool call, first occurrence of each tool call id.
 */
function scanStream(events, entry) {
  const urls = urlPatterns(entry);
  const seen = new Set();
  const found = [];
  for (const ev of events || []) {
    const u = ev?.data?.update;
    if (ev?.type !== 'sessionUpdate' || u?.sessionUpdate !== 'tool_call') continue;
    if (u.toolCallId) {
      if (seen.has(u.toolCallId)) continue;
      seen.add(u.toolCallId);
    }
    const tool = u._meta?.kiro?.toolName ?? null;
    const input = u.rawInput;
    if (!tool || !input) continue;
    let text = null;
    let commands = false;
    if (SHELL_TOOL.test(tool)) {
      text = typeof input.command === 'string' ? input.command : null;
      commands = true;
    } else if (WEB_TOOL.test(tool)) {
      text = JSON.stringify(input);
    }
    if (!text) continue;
    if ((commands && COMMANDS.some((re) => re.test(text))) || urls.some((re) => re.test(text))) {
      found.push({ tool, text: shorten(text) });
    }
  }
  return found;
}

const JUNK_DIRS = new Set(['__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.hypothesis', 'node_modules', '.git', '.tox', '.venv', '.nox']);

function walk(dir, rel = '') {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (JUNK_DIRS.has(e.name) || e.name === '.bench-answer-key.md' || e.name.endsWith('.pyc')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

// Trimmed non-empty added lines of a text diff of one file (everything the agent put in that is not in the base).
function addedLinesOf(baseFile, workFile) {
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', '-U0', '--text', '--', baseFile || '/dev/null', workFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 1 && r.status !== 0) return [];
  const out = [];
  let inHunk = false;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (inHunk && line.startsWith('+')) { const t = line.slice(1).trim(); if (t) out.push(t); }
  }
  return out;
}

// Added lines per file of the upstream patch, test files left out.
function upstreamTexts(patch) {
  const files = new Map();
  let file = null;
  for (const line of String(patch || '').split('\n')) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (m) { file = isTestPath(m[2]) ? null : m[2]; continue; }
    if (!file || !line.startsWith('+') || line.startsWith('+++')) continue;
    const t = line.slice(1).trim();
    if (t) files.set(file, [...(files.get(file) || []), t]);
  }
  return [...files].map(([f, ls]) => ({ file: f, text: ls.join('\n') }));
}

function longestMatch(agent, upstream) {
  if (agent.length < MIN_RECALL || upstream.length < MIN_RECALL) return 0;
  const grams = new Map();
  for (let i = 0; i + MIN_RECALL <= upstream.length; i++) {
    const k = upstream.slice(i, i + MIN_RECALL);
    const list = grams.get(k);
    if (!list) grams.set(k, [i]);
    else if (list.length < 50) list.push(i);
  }
  let best = 0;
  for (let i = 0; i + MIN_RECALL <= agent.length; i++) {
    const list = grams.get(agent.slice(i, i + MIN_RECALL));
    if (!list) continue;
    for (const pos of list) {
      let k = MIN_RECALL;
      while (i + k < agent.length && pos + k < upstream.length && agent[i + k] === upstream[pos + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/**
 * Compares the agent's change to non-test files with the upstream fix patch. baseDir is the pristine base tree,
 * workDir the agent's final workspace, patch the upstream diff (test files in it are ignored).
 * Returns {matchedChars, files}: the longest verbatim run found and the upstream files it came from.
 */
function fixRecall({ baseDir, workDir, patch }) {
  const up = upstreamTexts(patch);
  if (!up.length) return { matchedChars: 0, files: [] };
  const changed = walk(workDir).filter((rel) => {
    if (isTestPath(rel)) return false;
    const b = path.join(baseDir, rel);
    try { return !fs.existsSync(b) || !fs.readFileSync(b).equals(fs.readFileSync(path.join(workDir, rel))); } catch { return false; }
  });
  const agentText = changed.map((rel) => {
    const b = path.join(baseDir, rel);
    return addedLinesOf(fs.existsSync(b) ? b : null, path.join(workDir, rel)).join('\n');
  }).join('\n');
  let best = 0;
  const files = [];
  for (const u of up) {
    const m = longestMatch(agentText, u.text);
    if (m >= MIN_RECALL) files.push(u.file);
    if (m > best) best = m;
  }
  return { matchedChars: best, files };
}

function contaminationFlags({ externalFetch = [], fixRecallChars = 0 }) {
  return [...(externalFetch.length ? ['externalFetch'] : []), ...(fixRecallChars >= MIN_RECALL ? ['fixRecall'] : [])];
}

module.exports = { scanStream, fixRecall, contaminationFlags, MIN_RECALL, WEB_TOOL, SHELL_TOOL };
