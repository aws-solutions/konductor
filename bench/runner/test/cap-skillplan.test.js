// SPDX-License-Identifier: Apache-2.0
'use strict';

// The per-skill study plan: tiers, tasks, variants, waves and credit estimates from observed data. Free: no model, no credits.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { planSkillStudy, observedCosts, assignTiers, fitBudget } = require('../../cap/skillplan.js');

const { env, SHARED, withRuns } = require('./cap-study-helpers.js');

test('observedCosts uses non-vanilla runs with credits, filters by model and coordinator mode, and counts censored runs', () => {
  const e = env();
  try {
    const { scanRunDirs } = require('../../cap/usage.js');
    const { runs } = scanRunDirs([withRuns(e)], { harnesses: ['kiro-cli'] });
    const o = observedCosts(runs, { model: 'claude-sonnet-5.5', coordinator: true });
    assert.equal(o.n, 5);
    assert.equal(o.credits.mid, 6);
    assert.equal(o.credits.low, 5);
    assert.equal(o.credits.high, 8);
    assert.equal(o.censored, 1);
    assert.equal(o.secMid, 180);
    const any = observedCosts(runs, { model: null, coordinator: false });
    assert.equal(any.n, 6, 'every non-vanilla run with credits when nothing narrows it');
    assert.equal(observedCosts([], {}).n, 0);
  } finally { e.done(); }
});

test('tiers: loaded first, then large, then duplicates, then triage; a skill keeps its highest tier and notes the others', () => {
  const skills = [
    { id: 'skill:a', name: 'a', bytes: 9000, loaded: 3, neighbours: [] },
    { id: 'skill:b', name: 'b', bytes: 8000, loaded: 0, neighbours: [] },
    { id: 'skill:c', name: 'c', bytes: 100, loaded: 0, neighbours: [{ id: 'skill:d', score: 0.7 }] },
    { id: 'skill:d', name: 'd', bytes: 100, loaded: 0, neighbours: [{ id: 'skill:c', score: 0.7 }] },
    { id: 'skill:e', name: 'e', bytes: 90, loaded: 0, neighbours: [] },
  ];
  const t = assignTiers(skills, { largeNames: ['a', 'b'], largeTop: 0, duplicatePairs: [] });
  assert.deepEqual(Object.fromEntries(t.map((x) => [x.id, x.tier])), { 'skill:a': 'loaded', 'skill:b': 'large', 'skill:c': 'duplicates', 'skill:d': 'duplicates', 'skill:e': 'triage' });
  assert.deepEqual(t.find((x) => x.id === 'skill:a').also, ['large']);
  const named = assignTiers(skills, { largeNames: [], largeTop: 0, duplicatePairs: [['e', 'b']] });
  assert.equal(named.find((x) => x.id === 'skill:e').tier, 'duplicates');
  assert.equal(named.find((x) => x.id === 'skill:b').tier, 'duplicates');
  const top = assignTiers(skills, { largeNames: [], largeTop: 2, duplicatePairs: [] });
  assert.deepEqual(top.filter((x) => x.tier === 'large').map((x) => x.id).sort(), ['skill:b']);
});

test('the plan puts used skills in the loaded tier with the data behind it, and everything else lower', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], largeNames: ['big'], largeTop: 0 }));
    const by = Object.fromEntries(p.skills.map((s) => [s.name, s]));
    assert.equal(by.sectioned.tier, 'loaded');
    assert.equal(by.helped.tier, 'loaded');
    assert.equal(by.sectioned.exposure.runsLoaded, 5);
    assert.deepEqual(by.sectioned.tasksLoaded, { 'rev-one': 5 });
    assert.equal(by.big.tier, 'large');
    assert.deepEqual([by.twina.tier, by.twinb.tier], ['duplicates', 'duplicates']);
    assert.equal(by.idle.tier, 'triage');
    assert.equal(by.idle.lift, false);
    assert.equal(p.skills.length, 12);
    const w1 = p.skills.filter((s) => s.tier === 'loaded' && s.lift).reduce((n, s) => n + s.waves[0].runs, 0);
    assert.equal(p.tiers.loaded.waves[1].runs, w1, 'per-tier totals for each wave, every skill assumed to run it');
    assert.equal(p.tiers.triage.skills.length + p.tiers.loaded.skills.length + p.tiers.large.skills.length + p.tiers.duplicates.skills.length, 12);
  } finally { e.done(); }
});

test('a lift skill gets tasks (loaded-in first, regex-only left out), a shortfall against the profile minimum and a scenario command', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)] }));
    const s = p.skills.find((x) => x.name === 'sectioned');
    assert.deepEqual(s.tasks.chosen, ['rev-one']);
    assert.equal(s.tasks.target, 8);
    assert.equal(s.tasks.shortfall, 7);
    assert.match(s.tasks.scenarioCommand, /cap scenarios --cap skill:sectioned --n 7/);
    assert.ok(!s.tasks.chosen.includes('rx-one'));
    assert.ok(s.warnings.some((w) => /7 more scenario/.test(w)));
  } finally { e.done(); }
});

test('waves: delete screen first, then section removals, then moves; arms, runs and credits follow the observed cost', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], reps: 5, tasksPerSkill: 2, maxSections: 3 }));
    const s = p.skills.find((x) => x.name === 'sectioned');
    assert.deepEqual(s.sections.map((x) => x.id), ['workflow', 'template', 'checklist']);
    const [w1, w2, w3] = s.waves;
    assert.deepEqual(w1.arms, ['ctl', 'ctl-b', 'del']);
    assert.equal(w1.conditional, false);
    assert.equal(w1.runs, 3 * 2 * 5);
    assert.deepEqual(w2.arms, ['ctl', 'ctl-b', 'rm1', 'rm2', 'rm3']);
    assert.equal(w2.conditional, true);
    assert.match(w2.condition, /delete variant lost/);
    assert.deepEqual(w3.arms, ['ctl', 'ctl-b', 'mv1', 'mv2', 'mv3']);
    assert.equal(w1.credits.mid, 30 * 6);
    assert.equal(s.cost.worst.runs, w1.runs + w2.runs + w3.runs);
    assert.equal(w3.runs, (2 + 3) * 2 * 5);
    assert.ok(s.cost.expected.credits.mid < s.cost.worst.credits.mid);
    assert.ok(s.cost.expected.credits.mid > w1.credits.mid);
  } finally { e.done(); }
});

test('a duplicate-tier skill and a skill with no sections get the delete screen only', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], tasksPerSkill: 2, largeNames: ['big'], largeTop: 0 }));
    for (const n of ['twina', 'big']) {
      const s = p.skills.find((x) => x.name === n);
      assert.equal(s.waves.length, 1, n);
      assert.deepEqual(s.waves[0].arms, ['ctl', 'ctl-b', 'del']);
    }
  } finally { e.done(); }
});

test('a triage skill costs nothing, lists its free steps and says why it gets no lift run', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], largeNames: [], largeTop: 0 }));
    const s = p.skills.find((x) => x.name === 'idle');
    assert.equal(s.waves.length, 0);
    assert.equal(s.cost.expected.credits.mid, 0);
    assert.ok(s.steps.some((x) => /cap audit/.test(x)) && s.steps.some((x) => /cap trigger --cap skill:idle --mode proxy/.test(x)));
    assert.match(s.why, /triage/i);
  } finally { e.done(); }
});

test('a skill only a sub-agent lists is entered through that agent and gets no coordinator mode', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], largeNames: ['devonly'], armConfig: 'orchestration.mode=coordinator' }));
    const s = p.skills.find((x) => x.name === 'devonly');
    assert.equal(s.reach.armAgent, 'k-dev');
    assert.equal(s.reach.armConfig, null);
    assert.equal(p.skills.find((x) => x.name === 'sectioned').reach.armConfig, 'orchestration.mode=coordinator');
    assert.equal(p.skills.find((x) => x.name === 'sectioned').reach.armAgent, null);
  } finally { e.done(); }
});

test('a skill nothing lists cannot be studied and is called out', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], largeNames: ['orphan'] }));
    const s = p.skills.find((x) => x.name === 'orphan');
    assert.equal(s.lift, false);
    assert.match(s.why, /no kiro agent lists it/);
  } finally { e.done(); }
});

test('tier and skill filters keep the totals to what is selected', () => {
  const e = env();
  try {
    const all = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)] }));
    const loaded = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], tiers: ['loaded'] }));
    assert.ok(loaded.skills.every((s) => s.tier === 'loaded'));
    assert.ok(loaded.totals.expected.credits.mid <= all.totals.expected.credits.mid);
    const one = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], skills: ['sectioned'] }));
    assert.deepEqual(one.skills.map((s) => s.name), ['sectioned']);
    assert.throws(() => planSkillStudy(SHARED(e, { skills: ['nope'] })), /unknown skill/);
    assert.throws(() => planSkillStudy(SHARED(e, { tiers: ['weird'] })), /--tier takes/);
  } finally { e.done(); }
});

test('totals add up and an explicit credits-per-run replaces the observed one', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [withRuns(e)], creditsPerRun: { low: 1, mid: 2, high: 3 }, tasksPerSkill: 2 }));
    const sum = p.skills.reduce((n, s) => n + s.cost.expected.credits.mid, 0);
    assert.ok(Math.abs(p.totals.expected.credits.mid - sum) < 1e-9);
    const s = p.skills.find((x) => x.name === 'sectioned');
    assert.equal(s.waves[0].credits.mid, s.waves[0].runs * 2);
    assert.match(p.assumptions.join(' '), /credits per run .*given/);
  } finally { e.done(); }
});

test('with no observed runs and no override the plan still builds and says its cost is unknown', () => {
  const e = env();
  try {
    const p = planSkillStudy(SHARED(e, { runDirs: [] }));
    assert.equal(p.observed.n, 0);
    assert.equal(p.totals.expected.credits.mid, null);
    assert.ok(p.skills.every((s) => s.cost.expected.credits.mid === null || s.waves.length === 0));
    assert.match(p.assumptions.join(' '), /no observed runs/);
  } finally { e.done(); }
});

test('fitBudget takes skills in tier order until the next one would pass the budget and defers the rest', () => {
  const mk = (id, tier, mid) => ({ id, tier, lift: mid > 0, cost: { expected: { credits: { mid } } } });
  const fit = fitBudget([mk('a', 'loaded', 100), mk('b', 'loaded', 100), mk('c', 'large', 100), mk('d', 'triage', 0)], 250);
  assert.deepEqual(fit.map((s) => [s.id, s.inBudget]), [['a', true], ['b', true], ['c', false], ['d', true]]);
});

test('planning writes nothing under the repo or the run directories', () => {
  const e = env();
  try {
    const dir = withRuns(e);
    const before = JSON.stringify(fs.readdirSync(dir));
    planSkillStudy(SHARED(e, { runDirs: [dir] }));
    assert.equal(JSON.stringify(fs.readdirSync(dir)), before);
    assert.equal(require('node:child_process').execFileSync('git', ['-C', e.repo, 'status', '--porcelain'], { encoding: 'utf8' }), '');
  } finally { e.done(); }
});

test('pickTasks leaves out real-repo tasks (they need a repo cache the study does not pass) and says so', () => {
  const { pickTasks } = require('../../cap/skillplan.js');
  const t = (id, extra = {}) => [id, { id, target: null, hidden: id, checks: [{ type: 'tests' }], ...extra }];
  const tasks = new Map([t('a'), t('r', { real: { repo: 'x' } }), t('b')]);
  const p = pickTasks({ name: 'x', linked: [], tasks, tasksLoaded: { r: 9, a: 2, b: 1 }, target: 3, allowRegex: false });
  assert.deepEqual(p.chosen, ['a', 'b']);
  assert.deepEqual(p.skippedReal, ['r']);
});

// ---- shared screen: one control and A/A for several skills that enter the same way ----

test('screen: skills with the same entry share one run with a delete arm each, and the shared cost is counted once', () => {
  const e = env();
  try {
    const runs = withRuns(e, { tasks: ['rev-one', 'hid-one'] });
    const base = SHARED(e, { runDirs: [runs], reps: 5, tasksPerSkill: 2, skills: ['sectioned', 'helped'], armConfig: 'orchestration.mode=coordinator', creditsPerRun: { low: 1, mid: 2, high: 3 } });
    const solo = planSkillStudy(base);
    const p = planSkillStudy({ ...base, screen: true, screenTasks: 5 });
    assert.equal(p.screens.length, 1);
    const sc = p.screens[0];
    assert.deepEqual(sc.skills.sort(), ['helped', 'sectioned']);
    assert.deepEqual(sc.arms, ['ctl', 'ctl-b', 'del-helped', 'del-sectioned']);
    assert.deepEqual(sc.tasks, ['hid-one', 'rev-one']);
    assert.equal(sc.runs, 4 * 2 * 5);
    assert.equal(sc.credits.mid, 40 * 2);
    for (const s of p.skills) {
      assert.equal(s.screen, sc.id);
      assert.equal(s.waves[0].shared, sc.id);
      assert.equal(s.waves[0].runs, 0);
    }
    const sec = p.skills.find((s) => s.name === 'sectioned');
    assert.equal(sec.waves.length, 3, 'its own section waves stay');
    const soloW1 = solo.skills.filter((s) => s.lift).reduce((n, s) => n + s.waves[0].credits.mid, 0);
    const shared = sc.credits.mid;
    assert.ok(shared < soloW1, `shared screen ${shared} should cost less than separate wave 1s ${soloW1}`);
    const sum = p.screens.reduce((n, x) => n + x.credits.mid, 0) + p.skills.reduce((n, s) => n + s.cost.expected.credits.mid, 0);
    assert.ok(Math.abs(p.totals.expected.credits.mid - sum) < 1e-9);
  } finally { e.done(); }
});

test('screen: skills that enter through different agents get separate screens, and a lone skill stays unscreened', () => {
  const e = env();
  try {
    const runs = withRuns(e, { tasks: ['rev-one', 'hid-one'] });
    const p = planSkillStudy(SHARED(e, { runDirs: [runs], reps: 5, tasksPerSkill: 2, skills: ['sectioned', 'devonly'], largeNames: ['devonly'], screen: true, creditsPerRun: { low: 1, mid: 2, high: 3 } }));
    assert.equal(p.screens.length, 0, 'each entry has one skill, so nothing is shared');
    assert.ok(p.skills.every((s) => !s.screen && s.waves[0].runs > 0));
  } finally { e.done(); }
});
