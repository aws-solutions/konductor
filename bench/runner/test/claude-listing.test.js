// SPDX-License-Identifier: Apache-2.0
'use strict';

// The skill listing record (plugins/claude-code/listing.js and kiro.js skillListingOf): the /context and debug-log
// parsers, the budget formula, the probe against the fake claude (which answers by the real fill rule), the cache, the
// cost guard, and Kiro's equivalent record. No model call, nothing outside the scratch directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { makeFakeClaude } = require('./fake-claude.js');
const L = require('../../plugins/claude-code/listing.js');
const cc = require('../../plugins/claude-code/harness.js');
const kiro = require('../lib/harness/kiro.js');

const MODEL = 'us.anthropic.claude-sonnet-5-5';
const CONTEXT = [
  '## Context Usage', '', '**Model:** us.anthropic.claude-sonnet-5-5  ', '**Tokens:** 17k / 1m (2%)', '', '### Skills', '',
  '| Skill | Source | Tokens |', '|-------|--------|--------|', '| zz-skill-01 | User | ~40 |', '| zz-skill-07 | User | < 20 |', '| big | Project | ~1.2k |', '| dataviz | Built-in | ~480 |', '', '### Other', '| x | y | z |',
].join('\n');

test('the /context parser reads the window and the Skills table, and stops at the table end', () => {
  const r = L.parseContext(CONTEXT);
  assert.equal(r.window, 1e6);
  assert.deepEqual(r.skills, [
    { name: 'zz-skill-01', source: 'User', tokens: 40 }, { name: 'zz-skill-07', source: 'User', tokens: 0 },
    { name: 'big', source: 'Project', tokens: 1200 }, { name: 'dataviz', source: 'Built-in', tokens: 480 },
  ]);
  assert.throws(() => L.parseContext('## Context Usage'), /no Skills table/);
});

test('the debug parser reads the sent count and the over-budget line', () => {
  const log = '[DEBUG] Sending 25 skills via attachment (initial)\n[WARN] Skill listing over budget: 25 skills, 7758 chars > 7000 budget — descriptions will be truncated.';
  assert.deepEqual(L.parseDebug(log), { sent: 25, overBudget: { skills: 25, chars: 7758, budget: 7000 } });
  assert.deepEqual(L.parseDebug('[DEBUG] Sending 3 skills via attachment (initial)'), { sent: 3, overBudget: null });
});

test('the budget formula: 3 chars per token for current models, 4 for the older list, and the env override wins', () => {
  assert.equal(L.formulaBudget({ window: 1e6, model: MODEL, fraction: 0.01 }), 30000);
  assert.equal(L.formulaBudget({ window: 2e5, model: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', fraction: 0.01 }), 8000);
  assert.equal(L.formulaBudget({ window: 2e5, model: 'claude-opus-4-20250514', fraction: 0.01 }), 8000);
  assert.equal(L.formulaBudget({ window: 2e5, model: MODEL, fraction: 0.01 }), 6000);
  assert.equal(L.formulaBudget({ window: 1e6, model: MODEL, fraction: 0.01, override: '40000' }), 40000);
});

/** A HOME with `n` konductor skills of about 140 listing chars each, plus one user-only SOP. */
function home(root, n = 12) {
  const h = path.join(root, 'home');
  for (let i = 1; i <= n; i++) {
    const name = `zz-skill-${String(i).padStart(2, '0')}`;
    write(path.join(h, '.claude/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: Skill number ${i}, with a description long enough to take about one hundred and twenty chars.\n---\nbody\n`);
  }
  write(path.join(h, '.claude/skills/sop-x/SKILL.md'), '---\nname: sop-x\ndescription: An SOP.\ndisable-model-invocation: true\n---\nb\n');
  return h;
}

function probe(root, cfg = {}, o = {}) {
  const bin = makeFakeClaude(path.join(root, 'tools'), { dir: root, ...cfg });
  const h = o.home ?? home(root);
  const claude = { bin, version: '9.9.9', sha256: 'a'.repeat(64) };
  const envFor = (extra) => ({ ...cc.envSetup({ arm: { vanilla: false }, ctx: {}, home: h, tmpdir: path.join(root, 't'), baseEnv: { PATH: process.env.PATH } }).env, ...(o.env ?? {}), ...extra });
  fs.mkdirSync(path.join(root, 't'), { recursive: true });
  return L.skillListing({ claude, model: MODEL, home: h, envFor, cacheDir: o.cacheDir ?? null, scratch: path.join(root, 't') });
}

test('a listing under its budget: every konductor skill described, the user-only SOP not listed, budget from the formula', () => {
  const root = tmp();
  try {
    const { listing, error } = probe(root);
    assert.equal(error, null);
    assert.equal(listing.budgetChars, 30000);
    assert.equal(listing.budgetSource, 'window x chars per token x skillListingBudgetFraction');
    assert.equal(listing.overBudget, false);
    assert.equal(listing.skillsSent, 14, '12 skills and 2 built-ins');
    assert.equal(listing.konductorDescribed.length, 12);
    assert.deepEqual([listing.nameOnly, listing.konductorNameOnly, listing.builtins, listing.sops, listing.sopsModelInvocable], [0, [], 2, 1, false]);
    assert.ok(listing.listingChars > 2280);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a listing over its budget: the tail of the name order is name-only, with the exact budget from the debug log', () => {
  const root = tmp();
  try {
    const { listing, error } = probe(root, { listingBudget: 3500 });
    assert.equal(error, null);
    assert.equal(listing.budgetChars, 3500);
    assert.equal(listing.budgetSource, 'debug log');
    assert.equal(listing.overBudget, true);
    assert.ok(listing.nameOnly > 0 && listing.nameOnly < 12);
    assert.equal(listing.konductorNameOnly.at(-1), 'zz-skill-12');
    assert.equal(listing.konductorDescribed[0], 'zz-skill-01');
    assert.equal(listing.konductorDescribed.length + listing.nameOnly, 12);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the record is cached by the install: the same install reads the cache, a changed SKILL.md measures again', () => {
  const root = tmp();
  try {
    const cacheDir = path.join(root, 'cache');
    const first = probe(root, {}, { cacheDir });
    assert.equal(first.cached, false);
    const again = probe(root, { contextCost: 1 }, { cacheDir, home: path.join(root, 'home') });
    assert.equal(again.cached, true, 'no probe call: a costly fake would have been refused');
    assert.deepEqual(again.listing, first.listing);
    fs.appendFileSync(path.join(root, 'home/.claude/skills/zz-skill-01/SKILL.md'), 'more\n');
    assert.equal(probe(root, {}, { cacheDir, home: path.join(root, 'home') }).cached, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a probe that reports a cost, or a claude with no listing lines, gives no record and says why', () => {
  const root = tmp();
  try {
    const costly = probe(root, { contextCost: 0.01 });
    assert.equal(costly.listing, null);
    assert.match(costly.error, /reported cost 0\.01; a listing probe must not reach a model/);
    const silent = probe(path.join(root, 'b'), { noListingLines: true });
    assert.equal(silent.listing, null);
    assert.match(silent.error, /no skill listing lines/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the probe environment holds no credentials even when the caller has them', () => {
  const root = tmp();
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE', AWS_SECRET_ACCESS_KEY: 'secretsecretsecret', AWS_PROFILE: 'p' });
    const bin = makeFakeClaude(path.join(root, 'tools'), { dir: root });
    const r = cc.vanillaSkillListing({ claude: { bin, version: '9.9.9', sha256: 'b'.repeat(64) }, config: { model: MODEL } });
    assert.equal(r.skillListingError, null);
    assert.equal(r.skillListing.konductorDescribed.length, 0);
    const seen = fs.readFileSync(path.join(root, 'probe-env.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(seen.length, 4, 'two /context calls and two debug calls');
    for (const { aws } of seen) assert.deepEqual(aws.filter((k) => /ACCESS_KEY|SECRET|SESSION_TOKEN|PROFILE/.test(k)), []);
    for (const { args } of seen) for (const f of L.RUN_FLAGS) assert.ok(args.includes(f), `probe ${args.slice(0, 2).join(' ')} passes ${f} like a real run`);
    assert.equal(fs.existsSync(path.join(root, 'started.json')), false, 'the probes never start a run');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Kiro\'s record: the installed SKILL.md dirs, every one described, no known budget; the catalog when none are installed', () => {
  const root = tmp();
  try {
    for (const n of ['b-skill', 'a-skill', 'sop-plan']) write(path.join(root, '.kiro/skills', n, 'SKILL.md'), 'x');
    const r = kiro.skillListingOf(root, null);
    assert.deepEqual([r.harness, r.skillsSent, r.nameOnly, r.budgetChars, r.sops, r.sopsModelInvocable], ['kiro-cli', 3, 0, null, 1, true]);
    assert.deepEqual(r.konductorDescribed, ['a-skill', 'b-skill', 'sop-plan']);
    const viaMcp = kiro.skillListingOf(path.join(root, 'none'), { catalog: { skills: ['x', 'y'], sops: ['plan'] } });
    assert.deepEqual([viaMcp.skillsSent, viaMcp.sops], [2, 1]);
    assert.match(viaMcp.source, /catalog/);
    assert.equal(kiro.vanillaSkillListing().skillListing.skillsSent, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every flag the probes copy from a real run is on the real command line', () => {
  const { args } = cc.buildCommand({ arm: { vanilla: true }, task: { prompt: 'x' }, config: { model: MODEL, effort: 'high' }, ctx: { claude: { bin: 'claude' } } });
  for (const f of L.RUN_FLAGS) assert.ok(args.includes(f), f);
});

test('a fake HOME with .claude/skills above the scratch dir: the guard refuses it, and the listing shows the leaked skills', () => {
  const root = tmp();
  try {
    const fakeHome = path.join(root, 'owner');
    write(path.join(fakeHome, '.claude/skills/owner-skill/SKILL.md'), '---\nname: owner-skill\ndescription: The owner\'s own skill, long enough to be cut when the budget is tight.\n---\nb\n');
    const under = path.join(fakeHome, 'scratch');
    fs.mkdirSync(under);
    assert.throws(() => cc.checkScratchRoot(under, { homes: [fs.realpathSync(fakeHome)] }), /is under the real HOME .*owner; Claude Code would load .*\.claude\/skills as project skills\. Set TMPDIR/);
    assert.throws(() => cc.checkScratchRoot(under, { homes: [] }), /is below .*owner, which holds a \.claude entry/);
    const clean = path.join(root, 'clean');
    fs.mkdirSync(clean);
    assert.equal(cc.checkScratchRoot(clean, { homes: [fs.realpathSync(fakeHome)] }), fs.realpathSync(clean));
    // Without the guard, a probe below that HOME records the owner's skill as a foreign one.
    const { listing } = probe(under, {}, { home: home(path.join(root, 'arm'), 2) });
    assert.deepEqual(listing.otherSkills, ['owner-skill (Project)']);
    assert.equal(listing.otherDescribed + listing.otherNameOnly, 1);
    assert.deepEqual(listing.konductorDescribed, ['zz-skill-01', 'zz-skill-02']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
