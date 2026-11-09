// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verifyQuote } = require('../lib/quote.js');
const { makeCachedModel, BudgetExceeded } = require('../lib/model.js');
const { screenRules } = require('../lib/extract.js');
const { decide, flagReasons, loadDecisions, runVote, votePrompt } = require('../lib/vote.js');
const { buildStoplist, stoplistHits } = require('../lib/skill.js');
const { validateScenario, findDuplicate, quotas, runScenarios } = require('../lib/scenarios.js');
const { validateRubric, runRubrics, toTaskRubric, rubricPrompt } = require('../lib/rubric.js');
const { checkConsistency, numbersIn } = require('../lib/consistency.js');
const { splitDocument, runExtract } = require('../lib/extract.js');
const { freeze, verify, assertNotFrozen } = require('../lib/freeze.js');
const { emit, checkTask } = require('../lib/emit.js');
const { loadTasks, loadSuite, isSuiteName } = require('../../runner/lib/tasks.js');
const { main } = require('../skilleval.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skilleval-test-'));
const SKILL = `---
name: widget-audit
description: Audits widget inventories for stale entries. Use when reviewing a widget list before a release.
---

# Widget Audit

## Stale Entry Sweep

Always list every widget that has not been updated in 90 days, oldest first.

**Quarantine Bucket** holds widgets with no owner.

Never merge two widgets that share a serial number without asking.
`;

test('quote verifier finds quotes across markdown noise and rejects invented ones', () => {
  assert.deepEqual(verifyQuote(SKILL, 'Always list every widget that has not been updated in 90 days, oldest first.'), { ok: true, line: 10 });
  assert.equal(verifyQuote(SKILL, '**Quarantine Bucket** holds widgets with no owner.').ok, true);
  assert.equal(verifyQuote(SKILL, 'quarantine   bucket holds widgets\nwith no owner').ok, false);
  assert.match(verifyQuote(SKILL, 'Always list every widget that was updated last week.').reason, /not found/);
  assert.match(verifyQuote(SKILL, 'too short').reason, /shorter/);
});

test('cached model reuses answers, counts spend and stops at the cap', async () => {
  const dir = tmp();
  let calls = 0;
  const caller = async ({ prompt }) => { calls++; return { text: `{"echo":"${prompt}"}`, usd: 0.4 }; };
  const m = makeCachedModel({ caller, cacheDir: dir, budgetUsd: 1 });
  await m.ask('glm-5', 'a');
  await m.ask('glm-5', 'a');
  assert.equal(calls, 1);
  await m.ask('glm-5', 'b');
  await m.ask('glm-5', 'c');
  await assert.rejects(m.ask('glm-5', 'd'), BudgetExceeded);
  assert.equal(await m.ask('glm-5', 'a'), '{"echo":"a"}');
  const again = makeCachedModel({ caller: null, cacheDir: dir, budgetUsd: 1 });
  assert.equal(await again.ask('glm-5', 'b'), '{"echo":"b"}');
  assert.ok(Math.abs(again.spentUsd() - 1.2) < 1e-9);
});

test('askJson retries once with a stricter prompt and then gives up', async () => {
  const replies = ['not json', '{"ok":true}'];
  const m = makeCachedModel({ caller: async () => ({ text: replies.shift(), usd: 0 }), cacheDir: tmp() });
  assert.deepEqual(await m.askJson('glm-5', 'p'), { ok: true });
  const bad = makeCachedModel({ caller: async () => ({ text: 'nope', usd: 0 }), cacheDir: tmp() });
  await assert.rejects(bad.askJson('glm-5', 'p'), /no valid JSON/);
});

test('rule screening rejects unverifiable, skill-named, side-effect, unknown-tag and duplicate rules', () => {
  const good = { text: 'Lists stale widgets with the oldest first', quote: 'Always list every widget that has not been updated in 90 days, oldest first.', tag: 'useful', requestType: 'a request to clean up an inventory' };
  const raw = [
    good,
    { ...good, text: 'Lists stale widgets with the oldest first' },
    { ...good, text: 'Different text', quote: 'This sentence is not in the skill at all, honestly.' },
    { ...good, text: 'Follows the widget-audit procedure' },
    { ...good, text: 'Saves the list to a file on disk' },
    { ...good, text: 'Another rule', tag: 'nice' },
  ];
  const { accepted, rejected } = screenRules({ raw, skillText: SKILL, skill: 'widget-audit' });
  assert.deepEqual(accepted.map((r) => [r.id, r.line]), [['R01', 10]]);
  assert.equal(rejected.length, 5);
  assert.ok(rejected.some((r) => r.reasons.includes('duplicate rule')));
  assert.ok(rejected.some((r) => r.reasons.includes('quote not found in the skill text')));
  assert.ok(rejected.some((r) => r.reasons.includes('names the skill')));
  assert.ok(rejected.some((r) => r.reasons.includes('needs a side effect')));
  assert.ok(rejected.some((r) => r.reasons.some((x) => x.startsWith('unknown tag'))));
});

const v = (worth, styleOnly) => ({ judge: 'j', worth, styleOnly });

test('vote keeps a rule with at least 2 worth votes and fewer than 2 style votes', () => {
  assert.equal(decide([v(true, false), v(true, false), v(false, false)]).keep, true);
  assert.equal(decide([v(true, false), v(false, false), v(false, false)]).keep, false);
  assert.equal(decide([v(true, true), v(true, false), v(true, false)]).keep, true);
  assert.equal(decide([v(true, true), v(true, true), v(true, false)]).keep, false);
  assert.equal(decide([v(true, false), { judge: 'j', error: 'x' }, v(true, false)]).keep, true);
  assert.equal(decide([v(true, false), { judge: 'j', error: 'x' }, v(false, false)]).keep, false);
});

test('flags cover split votes, style votes, style tags and judge errors, not unanimous votes', () => {
  const f = (votes, tag = 'useful') => flagReasons({ rule: { tag }, votes, ...decide(votes) });
  assert.deepEqual(f([v(true, false), v(true, false), v(true, false)]), []);
  assert.deepEqual(f([v(false, false), v(false, false), v(false, false)]), []);
  assert.match(f([v(true, false), v(true, false), v(false, false)])[0], /split on worth \(2 of 3\)/);
  assert.ok(f([v(true, true), v(true, false), v(true, false)]).some((x) => x.startsWith('style')));
  assert.ok(f([v(true, false), v(true, false), v(true, false)], 'style').includes('extractor tagged style'));
  assert.deepEqual(f([v(true, false), { judge: 'j', error: 'x' }, v(true, false)]), ['judge error']);
});

test('judge prompt shows the rule and request type only', () => {
  const p = votePrompt({ rule: { text: 'Lists stale items oldest first', requestType: 'cleaning up an inventory', quote: 'SECRET QUOTE', id: 'R01' } });
  assert.match(p, /Lists stale items oldest first/);
  assert.match(p, /cleaning up an inventory/);
  assert.doesNotMatch(p, /SECRET QUOTE|R01/);
});

test('runVote applies owner decisions, writes the flagged list and rejects a bad decision file', async () => {
  const dir = tmp();
  const rules = [1, 2, 3].map((n) => ({ id: `R0${n}`, text: `rule ${n}`, tag: 'useful', requestType: 'x', quote: 'q', line: n }));
  const answers = { 'rule 1': [true, true, true], 'rule 2': [true, true, false], 'rule 3': [false, false, false] };
  const caller = async ({ model, prompt }) => {
    const rule = Object.keys(answers).find((k) => prompt.includes(`RULE: ${k}\n`));
    const idx = ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5'].indexOf(model);
    return { text: JSON.stringify({ worth: answers[rule][idx], style_only: false, reason: 'r' }), usd: 0.001 };
  };
  const ask = makeCachedModel({ caller, cacheDir: path.join(dir, 'cache') });
  const decisionsFile = path.join(dir, 'owner-decisions.json');
  const first = await runVote({ rulesDoc: { skill: 's', source: {}, rules }, ask, outDir: dir, decisionsFile });
  assert.deepEqual(first.survivors.map((r) => r.id), ['R01', 'R02']);
  assert.match(fs.readFileSync(path.join(dir, 'flagged.md'), 'utf8'), /R02[^\n]*split on worth/);
  fs.writeFileSync(decisionsFile, JSON.stringify({ R02: 'drop', R03: 'keep' }));
  const second = await runVote({ rulesDoc: { skill: 's', source: {}, rules }, ask, outDir: dir, decisionsFile });
  assert.deepEqual(second.survivors.map((r) => r.id), ['R01', 'R03']);
  assert.equal(ask.stats.calls, 9);
  fs.writeFileSync(decisionsFile, JSON.stringify({ R09: 'keep' }));
  assert.throws(() => loadDecisions(decisionsFile, ['R01']), /unknown rule id/);
  fs.writeFileSync(decisionsFile, JSON.stringify({ R01: 'maybe' }));
  assert.throws(() => loadDecisions(decisionsFile, ['R01']), /must be "keep" or "drop"/);
});

test('stoplist bans skill vocabulary and allows name and description words', () => {
  const stop = buildStoplist({ skill: 'widget-audit', text: SKILL, description: 'Audits widget inventories for stale entries. Use when reviewing a widget list before a release.' });
  assert.ok(stop.includes('widget-audit') && stop.includes('widget audit') && stop.includes('stale entry sweep') && stop.includes('quarantine bucket'));
  assert.deepEqual(stoplistHits('Can you audit our widget list for stale entries?', stop), []);
  assert.deepEqual(stoplistHits('Run a Widget Audit now', stop), ['widget audit']);
  assert.deepEqual(stoplistHits('put it in the quarantine-bucket', stop), ['quarantine bucket']);
});

test('scenario validators reject vocabulary, side effects, procedure names and duplicates', () => {
  const stoplist = ['widget audit', 'quarantine bucket'];
  const ok = { title: 'Old widget cleanup', prompt: 'We have about 400 widgets and nobody knows which are stale. How should I start cleaning the list up?' };
  const check = (s) => validateScenario(s, { stoplist, skill: 'widget-audit' });
  assert.deepEqual(check(ok), []);
  assert.ok(check({ ...ok, prompt: `${ok.prompt} Use the Quarantine Bucket idea.` }).some((r) => r.startsWith('skill vocabulary')));
  assert.ok(check({ ...ok, prompt: `${ok.prompt} Save the result to a file called out.md.` }).includes('asks for a side effect'));
  assert.ok(check({ ...ok, prompt: `${ok.prompt} Run the tests afterwards please.` }).includes('asks for a side effect'));
  assert.ok(check({ ...ok, prompt: `${ok.prompt} Use the k-developer agent.` }).includes('names a konductor procedure'));
  assert.ok(check({ ...ok, prompt: 'short' }).includes('prompt too short'));
  const earlier = [{ id: 'r01', ...ok }];
  assert.equal(findDuplicate({ title: 'Other title', prompt: ok.prompt.replace('start', 'begin') }, earlier).id, 'r01');
  assert.equal(findDuplicate({ title: 'old widget cleanup', prompt: 'something entirely different about invoices and tax rates for next year' }, earlier).id, 'r01');
  assert.equal(findDuplicate({ title: 'Invoices', prompt: 'something entirely different about invoices and tax rates for next year' }, earlier), undefined);
});

test('quotas split the cap 50, 30, 20 percent and 20 gives 10, 6, 4', () => {
  assert.deepEqual(quotas(20), { rule: 10, blind: 6, 'near-miss': 4 });
  assert.deepEqual(quotas(8), { rule: 4, blind: 2, 'near-miss': 2 });
});

test('rubric validation: item count, buckets, side effects, near-miss guard-only', () => {
  const item = (bucket, criterion) => ({ bucket, criterion });
  const good = [item('value', 'Lists the stale widgets oldest first'), item('value', 'Names the owner gap explicitly'), item('guard', 'Does not claim the list was verified'), item('format', 'Keeps the answer under one page')];
  const rule = { type: 'rule', ruleIds: ['R01'] };
  assert.deepEqual(validateRubric(good, rule), []);
  assert.ok(validateRubric(good.slice(0, 3), rule).some((r) => r.includes('4 to 6')));
  assert.ok(validateRubric([...good.slice(0, 3), item('value', 'The answer saved a file named report.md')], rule).some((r) => r.includes('side effect')));
  assert.ok(validateRubric([...good.slice(0, 3), item('style', 'Is polite')], rule).some((r) => r.includes('unknown bucket')));
  assert.ok(validateRubric(good, { type: 'near-miss', ruleIds: [] }).some((r) => r.includes('guard items only')));
  const guards = [1, 2, 3, 4].map((n) => item('guard', `Guard check number ${n} about a different point ${n * 7}`));
  assert.deepEqual(validateRubric(guards, { type: 'near-miss', ruleIds: [] }), []);
  assert.deepEqual(toTaskRubric(good).map((r) => [r.id, r.weight]), [['value-1', 3], ['value-2', 3], ['guard-1', 2], ['format-1', 1]]);
});

function fakeCaller(skillName) {
  return async ({ model, prompt }) => {
    let reply;
    if (prompt.startsWith('Below is the text')) {
      reply = { rules: [
        { text: 'Lists stale widgets with the oldest first', quote: 'Always list every widget that has not been updated in 90 days, oldest first.', tag: 'useful', requestType: 'cleaning up an inventory' },
        { text: 'Asks before merging two widgets that share a serial number', quote: 'Never merge two widgets that share a serial number without asking.', tag: 'useful', requestType: 'deduplicating an inventory' },
      ] };
    } else if (prompt.startsWith('An AI assistant is answering')) {
      reply = { worth: true, style_only: false, reason: 'ok' };
    } else if (prompt.includes('For each rule below')) {
      const ids = [...prompt.matchAll(/^(R\d+):/gm)].map((m) => m[1]);
      reply = { scenarios: ids.map((id, i) => ({ ruleId: id, title: `Inventory problem ${i} ${id}`, prompt: [
        'Our inventory has duplicate entries and old rows. How should we tidy the table of 400 items without losing data?',
        'A customer shipped seventeen pallets to the wrong depot and finance wants a plan for reconciling the books by Friday.'][i % 2] })) };
    } else if (prompt.includes('look related to that tool')) {
      reply = { scenarios: [{ title: 'Explain a column', prompt: 'What does the status column in our spreadsheet usually mean for shipped items in logistics?' }] };
    } else if (prompt.includes('might send where that tool')) {
      reply = { scenarios: [{ title: 'Clean old stock list', prompt: 'Our stock list for the warehouse is a mess and I need to decide what to remove first before the new season.' }] };
    } else {
      const near = prompt.includes('should NOT be applied');
      reply = { items: near
        ? [1, 2, 3, 4].map((n) => ({ bucket: 'guard', criterion: `Stays on the question asked, point ${n} ${'x'.repeat(n)} unique${n * 13}` }))
        : [{ bucket: 'value', criterion: 'Orders the stale rows oldest first', ruleId: 'R01' }, { bucket: 'value', criterion: 'Asks before merging duplicates' }, { bucket: 'guard', criterion: 'Does not delete rows silently' }, { bucket: 'format', criterion: 'Uses a short list' }] };
    }
    return { text: JSON.stringify(reply), usd: 0.002, model, skillName };
  };
}

test('end to end with a fake backend: extract, vote, scenarios, freeze, verify, emit', async () => {
  const root = tmp();
  process.env.SKILLEVAL_ROOT = root;
  const skillFile = path.join(root, 'in.md');
  fs.writeFileSync(skillFile, SKILL);
  const logs = [];
  const run = (...a) => main(a, { caller: fakeCaller('widget-audit'), log: (x) => logs.push(x) });
  try {
    await run('extract', '--skill', 'widget-audit', '--skill-file', skillFile);
    const rules = JSON.parse(fs.readFileSync(path.join(root, 'widget-audit', 'rules.json'), 'utf8'));
    assert.equal(rules.rules.length, 2);
    await run('vote', '--skill', 'widget-audit');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'widget-audit', 'survivors.json'), 'utf8')).rules.length, 2);
    await run('scenarios', '--skill', 'widget-audit', '--max', '8');
    const sc = JSON.parse(fs.readFileSync(path.join(root, 'widget-audit', 'scenarios.json'), 'utf8'));
    assert.ok(sc.count >= 3 && sc.count <= 8);
    assert.deepEqual(sc.scenarios.filter((s) => s.type === 'rule').map((s) => s.ruleIds[0]), ['R01', 'R02']);

    const before = logs.length;
    await run('extract', '--skill', 'widget-audit');
    assert.match(logs.slice(before).join('\n'), /new spend USD 0\.0000/);

    assert.equal(await run('freeze', '--skill', 'widget-audit', '--noise-margin', '0.07'), 0);
    assert.equal(await run('verify', '--skill', 'widget-audit'), 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'widget-audit', 'thresholds.json'), 'utf8')).qualityLoss.noiseMargin, 0.07);
    await assert.rejects(run('vote', '--skill', 'widget-audit'), /is frozen/);

    const dir = path.join(root, 'widget-audit');
    const benchDir = path.join(root, 'bench');
    fs.mkdirSync(path.join(benchDir, 'suites'), { recursive: true });
    const r = emit({ skill: 'widget-audit', dir, benchDir });
    assert.equal(r.emitted.length, sc.count);
    const suite = JSON.parse(fs.readFileSync(path.join(benchDir, 'suites', 'skilleval-widget-audit.json'), 'utf8'));
    assert.deepEqual(suite.tasks, r.emitted);
    const loaded = loadTasks(undefined, { extraDirs: [r.tasksDir] });
    assert.equal(isSuiteName('skilleval-widget-audit', benchDir), true);
    assert.equal(isSuiteName('skilleval-other', benchDir), false);
    assert.deepEqual(loadSuite('skilleval-widget-audit', loaded, benchDir).taskIds, r.emitted);
    for (const id of r.emitted) {
      const t = loaded.get(id);
      assert.ok(t, id);
      assert.equal(t.class, 'simple');
      assert.equal(t.timeoutSec, 300);
      assert.deepEqual(t.checks, []);
      assert.ok(t.rubric.length >= 4 && t.rubric.length <= 6);
      assert.deepEqual(checkTask(t), []);
    }
    const nearTask = loaded.get(r.emitted.find((id) => /-n\d+$/.test(id)));
    assert.ok(nearTask.rubric.every((x) => x.id.startsWith('guard-')));
    const expectations = JSON.parse(fs.readFileSync(path.join(dir, 'expectations.json'), 'utf8'));
    assert.equal(expectations.natural[nearTask.id].skill, 'not loaded');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'oracle-manifest.json'), 'utf8'));
    assert.equal(manifest.tasks.length, sc.count);
    assert.deepEqual(manifest.tasks[0].entries[0].expectedSkills, ['widget-audit']);
  } finally {
    delete process.env.SKILLEVAL_ROOT;
  }
});

test('freeze refuses a second freeze with changed inputs and verify catches an edit', () => {
  const dir = tmp();
  for (const f of ['survivors.json', 'scenarios.json', 'rubric.json']) fs.writeFileSync(path.join(dir, f), `{"f":"${f}"}\n`);
  assert.throws(() => freeze(dir, { skill: 's', source: {} }).status === 'frozen' && freeze(dir, { skill: 's', source: {}, noiseMargin: 0.2 }), /another noise margin/);
  const again = freeze(dir, { skill: 's', source: {} });
  assert.equal(again.status, 'unchanged');
  assert.equal(verify(dir).ok, true);
  assert.throws(() => assertNotFrozen(dir, 'vote'), /is frozen/);
  fs.writeFileSync(path.join(dir, 'rubric.json'), '{"f":"edited"}\n');
  const bad = verify(dir);
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /rubric: rubric.json changed/);
  assert.throws(() => freeze(dir, { skill: 's', source: {} }), /already frozen/);
  fs.rmSync(path.join(dir, 'freeze.json'));
  assert.match(verify(dir).problems[0], /no freeze.json/);
});

test('runScenarios and runRubrics drop invalid items and tolerate fewer scenarios than the cap', async () => {
  const stoplist = ['quarantine bucket'];
  const caller = async ({ prompt }) => {
    let reply;
    if (prompt.includes('For each rule below')) reply = { scenarios: [{ ruleId: 'R01', title: 'A', prompt: 'Please tidy my widget list and mention the quarantine bucket for orphans, thanks a lot.' }] };
    else reply = { scenarios: [] };
    return { text: JSON.stringify(reply), usd: 0 };
  };
  const ask = makeCachedModel({ caller, cacheDir: tmp() });
  const skill = { skill: 'widget-audit', description: 'Audits widgets.' };
  const doc = await runScenarios({ skill, survivors: [{ id: 'R01', tag: 'useful', text: 't', requestType: 'x' }], ask, model: 'glm-5', max: 20, stoplist, domain: 'inventory', repairRounds: 1 });
  assert.equal(doc.count, 0);
  assert.equal(doc.rejected.length, 2);
  assert.ok(doc.rejected[0].reasons[0].startsWith('skill vocabulary'));
  const rub = await runRubrics({ scenarios: [{ id: 'r01', type: 'rule', ruleIds: ['R01'], prompt: 'p' }], survivors: [], ask: makeCachedModel({ caller: async () => ({ text: '{"items":[]}', usd: 0 }), cacheDir: tmp() }), model: 'glm-5' });
  assert.equal(rub.rubrics.length, 0);
  assert.match(rub.failed[0].reason, /4 to 6/);
});

const AUTH_PROMPT = 'How many tests do we have for login? Our suite has these files: auth.unit.test.js with testLogin, testLogout, testReset, testRefresh, testExpiry, testBadCredentials, testLockout; auth.integration.test.js with testLoginAPI, testLogoutAPI, testOAuthFlow, test2FASetup, test2FAVerification; auth.e2e.test.js with testFullLoginFlow, testPasswordRecoveryFlow. Give totals by type.';
const crit = (...c) => c.map((criterion) => ({ bucket: 'value', criterion }));

test('consistency check flags a count that contradicts the lists in the request', () => {
  const bad = checkConsistency({ items: crit('Reports 16 tests (7 unit, 5 integration, and 4 e2e), not the file count of 3.'), prompt: AUTH_PROMPT });
  assert.deepEqual(bad.errors.map((e) => e.index), [0, 0]);
  assert.ok(bad.errors.some((e) => /"4 e2e" conflicts/.test(e.detail) && e.detail.includes('gives 2')));
  assert.ok(bad.errors.some((e) => /"16 tests" conflicts/.test(e.detail) && e.detail.includes('total 14')));
  const good = checkConsistency({ items: crit('Reports 14 tests in total (7 unit, 5 integration, and 2 e2e).'), prompt: AUTH_PROMPT });
  assert.deepEqual(good.errors, []);
  assert.ok(good.warnings.some((w) => /14 is not in the request \(derivable/.test(w.detail)));
});

test('consistency check compares stated percentages and ignores numbers about a recommended model', () => {
  const prompt = 'Our split is 45% unit, 25% integration and 30% e2e across the suite.';
  assert.equal(checkConsistency({ items: crit('Notes that 54% unit tests is below the target.'), prompt }).errors.length, 0);
  assert.equal(checkConsistency({ items: crit('Reports the split as 54% unit, 25% integration and 21% e2e.'), prompt }).errors.length, 2);
  assert.equal(checkConsistency({ items: crit('Says the recommended pyramid has 70% unit tests.'), prompt }).errors.length, 0);
});

test('consistency check flags a total that is not the sum of its parts and a rule id in the text', () => {
  const r = checkConsistency({ items: crit('Reports 20 items (7 unit, 5 integration, 2 e2e).', 'Applies R03 to the split.'), prompt: 'No numbers here at all.' });
  assert.ok(r.errors.some((e) => e.index === 0 && /not the sum/.test(e.detail)));
  assert.ok(r.errors.some((e) => e.index === 1 && /rule id/.test(e.detail)));
});

test('consistency check warns on numbers and names the request does not contain, and passes those from the rules', () => {
  const rules = [{ id: 'R03', text: 'Report Aligned within 10% and Misaligned beyond 25%, using the pyramid.' }];
  const r = checkConsistency({
    items: crit('Rates it Aligned when within 10%, and mentions Cypress and the `loginSession` helper at 95% load.'),
    prompt: 'Our login tests are slow.', rules,
  });
  assert.deepEqual(r.errors, []);
  const details = r.warnings.map((w) => w.detail);
  assert.ok(details.some((d) => d.startsWith('95% is not in the request')));
  assert.ok(details.some((d) => d.includes('"Cypress"')));
  assert.ok(details.some((d) => d.includes('"loginSession"')));
  assert.ok(!details.some((d) => d.includes('10')) && !details.some((d) => d.includes('Aligned')));
});

test('numbers inside identifiers are not numbers and thousands separators are folded', () => {
  assert.deepEqual(numbersIn('test2FASetup runs in 1,200 ms on e2e hosts').map((n) => n.value), [1200]);
});

test('rubric prompt keeps layout rules apart and validation ties them to the format bucket', () => {
  const rules = [{ id: 'R01', text: 'Name the model.', bucket: 'value' }, { id: 'R09', text: 'List critical issues first.', bucket: 'format' }];
  const p = rubricPrompt({ scenario: { type: 'rule', prompt: 'x', ruleIds: ['R01'] }, rules });
  assert.match(p, /- R01: Name the model\./);
  assert.match(p, /Layout behaviours[^\n]*\n- R09: List critical issues first\./);
  assert.ok(p.indexOf('- R01:') < p.indexOf('Layout behaviours'));
  const item = (bucket, ruleId, n) => ({ bucket, ruleId, criterion: `distinct point number ${n} about ${'z'.repeat(n)}` });
  const items = [item('value', 'R01', 1), item('value', '', 2), item('guard', '', 3), item('value', 'R09', 4)];
  assert.ok(validateRubric(items, { type: 'rule', ruleIds: ['R01'] }, rules).some((r) => r.includes('R09 is a layout behaviour')));
  items[3] = item('format', 'R09', 4);
  assert.deepEqual(validateRubric(items, { type: 'rule', ruleIds: ['R01'] }, rules), []);
});

test('a conflicting rubric item is sent back once and only that item is replaced', async () => {
  const draft = [
    { bucket: 'value', criterion: 'Reports 16 tests (7 unit, 5 integration, and 4 e2e).', ruleId: 'R02' },
    { bucket: 'value', criterion: 'Counts test cases and not test files.' },
    { bucket: 'guard', criterion: 'Does not claim the suite was executed.' },
    { bucket: 'format', criterion: 'Gives the totals as a short table.' },
  ];
  const seen = [];
  const caller = async ({ prompt }) => {
    seen.push(prompt);
    if (prompt.includes('must be fixed')) return { text: JSON.stringify({ fixes: [{ index: 0, criterion: 'Reports 14 tests (7 unit, 5 integration, and 2 e2e).' }] }), usd: 0.001 };
    return { text: JSON.stringify({ items: draft }), usd: 0.001 };
  };
  const ask = makeCachedModel({ caller, cacheDir: tmp() });
  const scenario = { id: 'r01', type: 'rule', ruleIds: ['R02'], prompt: AUTH_PROMPT };
  const rub = await runRubrics({ scenarios: [scenario], survivors: [{ id: 'R02', text: 'Count cases.', bucket: 'value' }], ask, model: 'glm-5' });
  assert.deepEqual(rub.failed, []);
  const r = rub.rubrics[0];
  assert.equal(seen.length, 2);
  assert.match(seen[1], /item 0: "4 e2e" conflicts/);
  assert.deepEqual(r.repaired, ['value-1']);
  assert.equal(r.items[0].criterion, 'Reports 14 tests (7 unit, 5 integration, and 2 e2e).');
  assert.deepEqual(r.items.slice(1).map((i) => i.criterion), draft.slice(1).map((i) => i.criterion));
  assert.ok(r.warnings.every((w) => w.item && w.kind));
});

test('a rubric that is still inconsistent after the repair round is dropped with the reason', async () => {
  const draft = [
    { bucket: 'value', criterion: 'Reports 16 tests (7 unit, 5 integration, and 4 e2e).' },
    { bucket: 'value', criterion: 'Counts test cases and not test files.' },
    { bucket: 'guard', criterion: 'Does not claim the suite was executed.' },
    { bucket: 'format', criterion: 'Gives the totals as a short table.' },
  ];
  const caller = async ({ prompt }) => (prompt.includes('must be fixed')
    ? { text: JSON.stringify({ fixes: [{ index: 0, criterion: 'Reports 16 tests (7 unit, 5 integration, and 4 e2e) again.' }] }), usd: 0 }
    : { text: JSON.stringify({ items: draft }), usd: 0 });
  const ask = makeCachedModel({ caller, cacheDir: tmp() });
  const rub = await runRubrics({ scenarios: [{ id: 'r01', type: 'rule', ruleIds: [], prompt: AUTH_PROMPT }], survivors: [], ask, model: 'glm-5' });
  assert.equal(rub.rubrics.length, 0);
  assert.match(rub.failed[0].reason, /still inconsistent after repair/);
});

test('owner decisions take a bucket, survivors carry it and the rule table shows it', async () => {
  const dir = tmp();
  const rules = [1, 2, 3].map((n) => ({ id: `R0${n}`, text: `rule ${n}`, tag: 'useful', requestType: 'x', quote: 'q', line: n }));
  const caller = async () => ({ text: JSON.stringify({ worth: true, style_only: false, reason: 'r' }), usd: 0 });
  const ask = makeCachedModel({ caller, cacheDir: path.join(dir, 'cache') });
  const decisionsFile = path.join(dir, 'owner-decisions.json');
  fs.writeFileSync(decisionsFile, JSON.stringify({ R02: { decision: 'keep', bucket: 'format' }, R03: 'drop' }));
  const out = await runVote({ rulesDoc: { skill: 's', source: {}, rules }, ask, outDir: dir, decisionsFile });
  assert.deepEqual(out.survivors.map((r) => [r.id, r.bucket]), [['R01', 'value'], ['R02', 'format']]);
  const table = fs.readFileSync(path.join(dir, 'rule-table.md'), 'utf8');
  assert.match(table, /\| R02 \| format \| kept \(owner\) \|/);
  assert.match(table, /\| R03 \| - \| dropped \(owner\) \|/);
  fs.writeFileSync(decisionsFile, JSON.stringify({ R01: { decision: 'keep', bucket: 'guard' } }));
  assert.throws(() => loadDecisions(decisionsFile, ['R01']), /bucket must be "value" or "format"/);
  fs.writeFileSync(decisionsFile, JSON.stringify({ R01: { decision: 'drop', bucket: 'format' } }));
  assert.throws(() => loadDecisions(decisionsFile, ['R01']), /takes no bucket/);
});

test('a layout rule gets no rule scenario of its own', async () => {
  const survivors = [{ id: 'R01', text: 'Name the model.', tag: 'useful', requestType: 'a', bucket: 'value' }, { id: 'R02', text: 'Order findings.', tag: 'useful', requestType: 'b', bucket: 'format' }];
  const prompts = [];
  const caller = async ({ prompt }) => {
    prompts.push(prompt);
    return { text: JSON.stringify({ scenarios: [{ ruleId: 'R01', title: 'Plan the checks', prompt: 'Our nightly job fails about once a week and nobody knows why. What should we look at first?' }] }), usd: 0 };
  };
  const ask = makeCachedModel({ caller, cacheDir: tmp() });
  const doc = await runScenarios({ skill: { skill: 'widget-audit', description: 'd' }, survivors, ask, model: 'glm-5', max: 2, stoplist: [], domain: 'ops', repairRounds: 0 });
  const rulePrompts = prompts.filter((p) => p.includes('For each rule below'));
  assert.ok(rulePrompts.length > 0 && rulePrompts.every((p) => p.includes('R01:') && !p.includes('R02:')));
  assert.deepEqual(doc.scenarios.filter((s) => s.type === 'rule').map((s) => s.ruleIds[0]), ['R01']);
});

test('a long document is read in parts split at headings and the rules are merged by source line', async () => {
  const body = (n) => Array.from({ length: 6 }, (_, i) => `Rule sentence number ${n}-${i} says to always check the widget ledger.`).join('\n');
  const text = ['# One', body(1), '## Two', body(2), '## Three', body(3)].join('\n');
  const parts = splitDocument(text, 300);
  assert.ok(parts.length >= 2 && parts.every((p) => p.length <= 400));
  assert.equal(parts.join('\n'), text);
  assert.ok(parts.slice(1).every((p) => p.startsWith('#')));
  assert.deepEqual(splitDocument('short', 300), ['short']);
  const seen = [];
  const caller = async ({ prompt }) => {
    seen.push(prompt);
    const n = prompt.match(/part (\d+) of/)[1];
    return { text: JSON.stringify({ rules: [0, 1].map((i) => ({ text: `check the ledger ${n}-${i}`, quote: `Rule sentence number ${n}-${i} says to always check the widget ledger.`, tag: 'useful', requestType: 'auditing a ledger' })) }), usd: 0 };
  };
  const ask = makeCachedModel({ caller, cacheDir: tmp() });
  const outDir = tmp();
  const out = await runExtract({ skill: { skill: 'widget-audit', text, source: {} }, ask, modelName: 'glm-5', count: 4, outDir, chunkChars: 300 });
  assert.equal(out.parts, seen.length);
  assert.ok(seen.every((p) => p.includes('Use only this part')));
  assert.equal(out.rules.length, 4);
  assert.deepEqual(out.rules.map((r) => r.id), ['R01', 'R02', 'R03', 'R04']);
  assert.deepEqual(out.rules.map((r) => r.line), [...out.rules.map((r) => r.line)].sort((a, b) => a - b));
});
