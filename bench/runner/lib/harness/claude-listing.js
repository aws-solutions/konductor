// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Claude Code skill listing an arm's runs get: the listing budget, the listing size, which konductor skills keep their
// description and which are name-only, and whether the SOPs are model-invocable. Claude Code sends the model one line per
// skill ("- name: description"); past the budget it keeps the built-in descriptions and fills the rest in name order, and
// a skill that no longer fits is sent by name only (bench/docs/reference.md, "Skill listing").
//
// Found once per arm, from a trial install, with four local `claude -p` calls and no credentials in their environment,
// so none of them can reach a model:
//   1. `/context` at the arm's own budget, and 2. `/context` with the budget lifted. `/context` is computed locally
//      (num_turns 0, total_cost_usd 0). A skill whose token count drops from 2 to 1 is cut.
//   3. `-p ok --debug-file` at the arm's own budget, and 4. the same at budget 1. Claude Code builds the listing and logs
//      `Sending N skills via attachment`, plus `Skill listing over budget: N skills, C chars > B budget` when it is over
//      (always at budget 1, which gives the full listing size), then stops at the credential step.
// The record is cached under the bench cache by the claude binary, the model, the budget settings and the installed
// skill files, so a later command with the same arm makes no call at all.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { writeAtomic } = require('../owned.js');

const PROBE_VERSION = 2;
const LIFTED_BUDGET = '100000000';
const BUDGET_VAR = 'SLASH_COMMAND_TOOL_CHAR_BUDGET';
const DEFAULT_FRACTION = 0.01;
// Models Claude Code counts at 4 chars per token (Claude 3.x, Opus and Sonnet 4.0 to 4.6, Haiku 4.5); every other model is 3.
const FOUR_CHAR_MODELS = /claude-3|(?:opus|sonnet)-4(?:-[0-6])?(?![0-9])|haiku-4-5/;
const SENDING = /Sending (\d+) skills via attachment/;
const OVER = /Skill listing over budget: (\d+) skills, (\d+) chars > (\d+) budget/;
// The flags of a real run (claude-code.js buildCommand) that change what is loaded: no MCP configuration but none.
const RUN_FLAGS = ['--strict-mcp-config'];

/** Token count of a /context cell: "~40" is 40, "~1.2k" is 1200, "< 20" is 0 (below the table's resolution). */
function tokensOf(cell) {
  const m = /^~?\s*([\d.]+)\s*(k|m)?$/i.exec(cell.trim());
  if (!m) return 0;
  return Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[String(m[2]).toLowerCase()] ?? 1));
}

/** The window and the Skills table of a `/context` result: `{ window, skills: [{ name, source, tokens }] }`. */
function parseContext(text) {
  const win = /\*\*Tokens:\*\*\s*[\d.]+\s*[km]?\s*\/\s*([\d.]+\s*[km]?)/i.exec(text);
  const at = text.indexOf('### Skills');
  if (at < 0) throw new Error('/context printed no Skills table');
  const skills = [];
  let inTable = false;
  for (const line of text.slice(at).split('\n').slice(1)) {
    if (!line.startsWith('|')) { if (inTable) break; continue; }
    inTable = true;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3 || cells[0] === 'Skill' || /^-+$/.test(cells[0])) continue;
    skills.push({ name: cells[0], source: cells[1], tokens: tokensOf(cells[2]) });
  }
  return { window: win ? tokensOf(win[1].replace(/\s+/g, '')) : null, skills };
}

/** The listing lines of a debug log: `{ sent, overBudget: { skills, chars, budget } | null }`. */
function parseDebug(text) {
  const sent = SENDING.exec(text);
  const over = OVER.exec(text);
  return { sent: sent ? Number(sent[1]) : null, overBudget: over ? { skills: Number(over[1]), chars: Number(over[2]), budget: Number(over[3]) } : null };
}

/**
 * Where a run's own listing (`run`, parseDebug of its --debug-file) differs from the arm's probe `record` (DEBT D-33):
 * `{ probe, run }`, each `{ sent, overBudget }`, or null when they agree or either is missing. A run that found more
 * skills (project skills from its cwd) sends another count; a run over the budget when the probe was not differs too.
 */
function listingMismatch(record, run) {
  if (!record || !run || run.sent === null) return null;
  const probe = { sent: record.skillsSent ?? null, overBudget: Boolean(record.overBudget) };
  const seen = { sent: run.sent, overBudget: Boolean(run.overBudget) };
  return probe.sent === seen.sent && probe.overBudget === seen.overBudget ? null : { probe, run: seen };
}

/** The budget Claude Code computes: the env override, else window x chars-per-token x skillListingBudgetFraction. */
function formulaBudget({ window, model, fraction, override }) {
  if (override != null) return Number(override);
  if (!window) return null;
  return Math.floor(window * (FOUR_CHAR_MODELS.test(model) ? 4 : 3) * fraction);
}

const { readTextOrNull: readText } = require('../util.js');

/** The skills installed in `configDir/skills`: `{ name, sop, modelInvocable }` in name order. */
function installedSkills(configDir) {
  const dir = path.join(configDir, 'skills');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { /* none */ }
  return names.flatMap((name) => {
    const text = readText(path.join(dir, name, 'SKILL.md'));
    if (text === null) return [];
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    return [{ name, sop: name.startsWith('sop-'), modelInvocable: !/^disable-model-invocation:\s*true\s*$/m.test(fm) }];
  });
}

/** skillListingBudgetFraction from the installed settings.json, when it is in (0, 1]; else the default. */
function fractionOf(configDir) {
  try {
    const f = JSON.parse(readText(path.join(configDir, 'settings.json')) ?? '{}').skillListingBudgetFraction;
    return typeof f === 'number' && f > 0 && f <= 1 ? f : DEFAULT_FRACTION;
  } catch { return DEFAULT_FRACTION; }
}

/** The cache key of an install: the binary, the model, the budget settings and every installed SKILL.md and settings.json. */
function cacheKey({ claude, model, configDir, override }) {
  const h = crypto.createHash('sha256').update(JSON.stringify({ v: PROBE_VERSION, claude: claude.sha256, model, override: override ?? null }));
  for (const rel of ['settings.json', ...installedSkills(configDir).map((s) => path.join('skills', s.name, 'SKILL.md'))]) {
    h.update(`\0${rel}\0${readText(path.join(configDir, rel)) ?? ''}`);
  }
  return h.digest('hex');
}

/** Runs one probe call; `claude -p` takes the prompt as an argument here, since no task text is involved. */
function call(claude, args, { cwd, env, timeoutMs }) {
  const r = spawnSync(claude.bin, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error(`claude ${args.slice(0, 2).join(' ')}: ${r.error.message}`);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* checked by the caller */ }
  if (json && (json.total_cost_usd ?? 0) !== 0) throw new Error(`claude ${args.slice(0, 2).join(' ')} reported cost ${json.total_cost_usd}; a listing probe must not reach a model`);
  return { status: r.status, json };
}

/**
 * Measures the listing of the install in `home` (its `.claude` dir); `envFor(extra)` gives the run environment with
 * `extra` on top. The caller passes no credentials. Returns the record (see bench/docs/reference.md, "Skill listing").
 */
function measure({ claude, model, home, envFor, scratch, timeoutMs = 60000 }) {
  const configDir = path.join(home, '.claude');
  const override = envFor({})[BUDGET_VAR] ?? null;
  const cwd = fs.mkdtempSync(path.join(scratch, 'listing-'));
  try {
    const context = (extra) => {
      const { status, json } = call(claude, ['-p', '/context', '--model', model, '--output-format', 'json', ...RUN_FLAGS], { cwd, env: envFor(extra), timeoutMs });
      if (status !== 0 || typeof json?.result !== 'string') throw new Error(`claude -p /context exited ${status} without a result`);
      if ((json.num_turns ?? 0) !== 0) throw new Error(`claude -p /context took ${json.num_turns} turns; it must be computed locally`);
      return parseContext(json.result);
    };
    const debug = (extra, name) => {
      const file = path.join(cwd, name);
      call(claude, ['-p', 'ok', '--model', model, '--output-format', 'json', ...RUN_FLAGS, '--debug-file', file], { cwd, env: envFor(extra), timeoutMs });
      return parseDebug(readText(file) ?? '');
    };
    const atBudget = context({});
    const lifted = context({ [BUDGET_VAR]: LIFTED_BUDGET });
    const real = debug({}, 'debug-budget.log');
    const full = debug({ [BUDGET_VAR]: '1' }, 'debug-full.log');
    if (real.sent === null || !full.overBudget) throw new Error('the claude debug log has no skill listing lines (Sending N skills / Skill listing over budget)');

    const installed = installedSkills(configDir);
    const ours = new Map(installed.map((s) => [s.name, s]));
    const full2 = new Map(lifted.skills.map((s) => [s.name, s.tokens]));
    // shortcut: a skill whose whole entry is under the table's 20-token resolution cannot show a cut; konductor's are longer.
    const cut = (s) => s.tokens < (full2.get(s.name) ?? s.tokens);
    const listed = atBudget.skills.filter((s) => s.source !== 'Built-in');
    const kListed = listed.filter((s) => ours.has(s.name));
    const others = listed.filter((s) => !ours.has(s.name));
    const sops = installed.filter((s) => s.sop);
    const budgetChars = real.overBudget?.budget ?? formulaBudget({ window: atBudget.window, model, fraction: fractionOf(configDir), override });
    return {
      harness: 'claude-code',
      source: 'claude -p /context at the budget and with it lifted, and claude -p --debug-file at the budget and at 1; no credentials, no model call',
      claudeVersion: claude.version, model, contextWindow: atBudget.window,
      budgetChars, budgetSource: real.overBudget ? 'debug log' : override != null ? BUDGET_VAR : 'window x chars per token x skillListingBudgetFraction',
      listingChars: full.overBudget.chars, skillsSent: real.sent, overBudget: Boolean(real.overBudget),
      konductorDescribed: kListed.filter((s) => !cut(s)).map((s) => s.name),
      konductorNameOnly: kListed.filter(cut).map((s) => s.name),
      nameOnly: kListed.filter(cut).length,
      konductorNotListed: installed.filter((s) => s.modelInvocable && !kListed.some((k) => k.name === s.name)).map((s) => s.name),
      otherDescribed: others.filter((s) => !cut(s)).length, otherNameOnly: others.filter(cut).length,
      otherSkills: others.map((s) => `${s.name} (${s.source})`),
      builtins: atBudget.skills.length - listed.length,
      sops: sops.length, sopsModelInvocable: sops.length ? sops.every((s) => s.modelInvocable) : null,
    };
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/**
 * The listing record of the install in `home`, from the cache under `cacheDir` when one with the same key is there.
 * Returns `{ listing, error, cached }`; a probe that fails gives `listing: null` and the reason, never a partial record.
 */
function skillListing({ claude, model, home, envFor, cacheDir = null, scratch = os.tmpdir(), timeoutMs }) {
  const key = cacheKey({ claude, model, configDir: path.join(home, '.claude'), override: envFor({})[BUDGET_VAR] ?? null });
  const file = cacheDir ? path.join(cacheDir, 'claude-listing', `${key.slice(0, 32)}.json`) : null;
  const hit = file ? readText(file) : null;
  if (hit) {
    try { const rec = JSON.parse(hit); if (rec.cacheKey === key) return { listing: rec, error: null, cached: true }; } catch { /* measured again */ }
  }
  try {
    const listing = { ...measure({ claude, model, home, envFor, scratch, timeoutMs }), cacheKey: key };
    if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); writeAtomic(file, `${JSON.stringify(listing, null, 2)}\n`); }
    return { listing, error: null, cached: false };
  } catch (e) {
    return { listing: null, error: e.message, cached: false };
  }
}

module.exports = { skillListing, measure, parseContext, parseDebug, listingMismatch, formulaBudget, installedSkills, tokensOf, BUDGET_VAR, RUN_FLAGS };
