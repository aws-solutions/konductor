// SPDX-License-Identifier: Apache-2.0
'use strict';

// The per-skill study driver with a fake runner: waves, gating, resume, judging arguments, patches and the final report.
// The fake stands in for bench.js run, judge and cap controls --check, so no model, no credits and no kiro-cli are used.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadStudy, runStudy, studyStatus } = require('../../cap/skillstudy.js');
const { setup, fakeExec, REPS } = require('./cap-skillstudy-fake.js');
const { parseArgs } = require('../bench.js');
const { checkArgs } = require('../lib/cli-flags.js');

const runsOf = (calls) => calls.filter((a) => a[0] === 'run');
const armsOf = (argv) => argv[argv.indexOf('--arms') + 1].split(',').map((a) => a.slice(0, a.indexOf('=')));

test('a full study: controls, the delete screen, section removals, narrowed moves, then a PRUNE decision with a patch', async () => {
  const s = setup();
  try {
    const { exec, calls } = fakeExec({ quality: { del: 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 } });
    const r = await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    const order = calls.map((a) => (a[0] === 'run' ? `run:${armsOf(a).join('+')}` : a[0] === 'cap' ? 'controls-check' : a[0]));
    assert.deepEqual(order, [
      'run:base+base-b+ctl-keep+ctl-prune', 'controls-check',
      'run:ctl+ctl-b+del', 'judge',
      'run:ctl+ctl-b+rm1+rm2+rm3', 'judge',
      'run:ctl+ctl-b+mv2+mv3', 'judge',
    ]);
    const d = r.decisions.find((x) => x.name === 'sectioned');
    assert.equal(d.decision, 'PRUNE');
    const act = Object.fromEntries(d.sections.map((x) => [x.id, x.action]));
    assert.deepEqual(act, { workflow: 'remove', template: 'move', checklist: 'keep' });
    const md = fs.readFileSync(path.join(s.studyDir, 'decisions/decisions.md'), 'utf8');
    assert.match(md, /skills\/sectioned\/SKILL\.md:\d+-\d+/);
    const patch = fs.readFileSync(path.join(s.studyDir, 'decisions/patches/sectioned.patch'), 'utf8');
    assert.match(patch, /^diff --git a\/skills\/sectioned\/SKILL\.md b\/skills\/sectioned\/SKILL\.md$/m);
    assert.match(patch, /references\/template\.md/);
    assert.ok(fs.existsSync(path.join(s.studyDir, 'decisions/decisions.json')));
    assert.ok(fs.existsSync(path.join(s.studyDir, 'decisions/evidence.json')));
  } finally { s.e.done(); }
});

test('a delete variant that changes nothing ends the skill after wave 1 with a DELETE call and a delete patch', async () => {
  const s = setup();
  try {
    const { exec, calls } = fakeExec({ quality: {} });
    const r = await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    assert.equal(runsOf(calls).length, 2, 'controls and wave 1 only');
    const d = r.decisions.find((x) => x.name === 'sectioned');
    assert.equal(d.decision, 'DELETE');
    assert.match(fs.readFileSync(path.join(s.studyDir, 'decisions/patches/sectioned.patch'), 'utf8'), /^deleted file mode/m);
    assert.ok(fs.existsSync(path.join(s.studyDir, 'skills/sectioned/w2.skipped')));
  } finally { s.e.done(); }
});

test('rerunning a finished study runs nothing again, and an interrupted wave is moved aside and rerun', async () => {
  const s = setup();
  try {
    const first = fakeExec({ quality: { del: 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 } });
    await runStudy({ studyDir: s.studyDir, exec: first.exec, log: () => {} });
    const again = fakeExec({});
    await runStudy({ studyDir: s.studyDir, exec: again.exec, log: () => {} });
    assert.equal(again.calls.length, 0);
    const w2 = path.join(s.studyDir, 'skills/sectioned/w2');
    const sum = JSON.parse(fs.readFileSync(path.join(w2, 'summary.json'), 'utf8'));
    fs.writeFileSync(path.join(w2, 'summary.json'), JSON.stringify({ ...sum, interrupted: 'SIGTERM' }));
    fs.rmSync(path.join(s.studyDir, 'skills/sectioned/w3'), { recursive: true, force: true });
    fs.rmSync(path.join(s.studyDir, 'skills/sectioned/w3.done'), { force: true });
    const third = fakeExec({ quality: { del: 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 } });
    await runStudy({ studyDir: s.studyDir, exec: third.exec, log: () => {} });
    assert.deepEqual(runsOf(third.calls).map((a) => armsOf(a).join('+')), ['ctl+ctl-b+rm1+rm2+rm3', 'ctl+ctl-b+mv2+mv3']);
    assert.ok(fs.readdirSync(path.join(s.studyDir, 'incomplete')).some((n) => /^sectioned-w2-/.test(n)));
  } finally { s.e.done(); }
});

test('failed controls stop the study before any skill run, and every call is NEEDS DATA', async () => {
  const s = setup();
  try {
    const { exec, calls } = fakeExec({ trusted: false });
    const r = await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    assert.equal(runsOf(calls).length, 1);
    assert.ok(r.decisions.every((d) => d.decision === 'NEEDS DATA'));
    assert.match(r.decisions[0].reasons.join(' '), /controls/);
    assert.equal(r.stopped, 'controls-failed');
  } finally { s.e.done(); }
});

test('a dry run prints the plan and the exact commands, builds nothing and calls nothing', async () => {
  const s = setup();
  try {
    const lines = [];
    const { exec, calls } = fakeExec();
    const r = await runStudy({ studyDir: s.studyDir, exec, log: (m) => lines.push(m), dryRun: true });
    assert.equal(calls.length, 0);
    assert.equal(fs.existsSync(path.join(s.e.root, 'scratch', 'variants')), false);
    assert.equal(fs.existsSync(path.join(s.studyDir, 'skills/sectioned/w1')), false);
    const text = lines.join('\n');
    assert.match(text, /controls/);
    assert.match(text, /sectioned wave 1: arms ctl, ctl-b, del/);
    assert.match(text, /run --suite \w+ --tasks /);
    assert.equal(r.dryRun, true);
  } finally { s.e.done(); }
});

test('judge arguments name the opencode backend and the credentials file, and are left out when no task is rubric-scored', async () => {
  const s = setup();
  try {
    const { exec, calls } = fakeExec({ quality: {} });
    await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    const j = calls.find((a) => a[0] === 'judge');
    assert.equal(j[j.indexOf('--judge-backend') + 1], 'opencode');
    assert.equal(j[j.indexOf('--aws-creds-file') + 1], s.creds);
    assert.equal(j[j.indexOf('--baseline') + 1], 'ctl');
    assert.ok(j.includes('--budget-usd'));
  } finally { s.e.done(); }
  const h = setup();
  try {
    const st = loadStudy(h.studyDir);
    st.plan.skills.find((x) => x.name === 'sectioned').tasks.chosen = ['hid-one'];
    fs.writeFileSync(path.join(h.studyDir, 'study.json'), JSON.stringify(st));
    const { exec, calls } = fakeExec({ quality: {} });
    await runStudy({ studyDir: h.studyDir, exec, log: () => {} });
    assert.equal(calls.some((a) => a[0] === 'judge'), false);
  } finally { h.e.done(); }
});

test('a missing credentials file stops a study that needs judging before any run is launched', async () => {
  const s = setup();
  try {
    fs.rmSync(s.creds);
    const { exec, calls } = fakeExec();
    await assert.rejects(() => runStudy({ studyDir: s.studyDir, exec, log: () => {} }), /credentials file/);
    assert.equal(calls.length, 0);
  } finally { s.e.done(); }
});

test('every bench.js command the driver builds passes the flag table', async () => {
  const s = setup();
  try {
    const { exec, calls } = fakeExec({ quality: { del: 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 } });
    await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    for (const argv of calls) {
      const [cmd, ...rest] = argv;
      const opts = parseArgs(rest);
      assert.equal(checkArgs(cmd, opts), null, argv.join(' '));
    }
  } finally { s.e.done(); }
});

test('the run command carries the arms, tasks, replicates, engine, model, per-arm config and the seed', async () => {
  const s = setup();
  try {
    const st = loadStudy(s.studyDir);
    st.plan.armConfig = 'orchestration.mode=coordinator';
    for (const sk of st.plan.skills) if (sk.reach) sk.reach.armConfig = 'orchestration.mode=coordinator';
    fs.writeFileSync(path.join(s.studyDir, 'study.json'), JSON.stringify(st));
    const { exec, calls } = fakeExec({ quality: {} });
    await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    const a = runsOf(calls)[1];
    const get = (n) => a[a.indexOf(`--${n}`) + 1];
    assert.equal(get('replicates'), String(REPS));
    assert.equal(get('agent-engine'), 'v3');
    assert.equal(get('model'), 'claude-sonnet-5.5');
    assert.equal(get('seed'), '7');
    assert.equal(get('parallel'), '1');
    assert.match(get('arm-config'), /ctl=orchestration\.mode=coordinator,ctl-b=orchestration\.mode=coordinator,del=orchestration\.mode=coordinator/);
    assert.match(get('arms'), /^ctl=v0,ctl-b=v0,del=dir:/);
    assert.equal(get('tasks'), 'rev-one,hid-one');
  } finally { s.e.done(); }
});

test('status reports waves done, runs and credits from the ledgers', async () => {
  const s = setup();
  try {
    const { exec } = fakeExec({ quality: { del: 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 } });
    const before = studyStatus(s.studyDir);
    assert.match(before, /waves done: 0\//);
    await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    const after = studyStatus(s.studyDir);
    assert.match(after, /waves done: 3\/3/);
    assert.match(after, /credits so far: \d+/);
    assert.match(after, /sectioned/);
  } finally { s.e.done(); }
});

test('a stop request between steps ends the run cleanly and a later run resumes', async () => {
  const s = setup();
  try {
    let n = 0;
    const first = fakeExec({ quality: { del: 0.3 } });
    const r = await runStudy({ studyDir: s.studyDir, exec: first.exec, log: () => {}, shouldStop: () => ++n > 3 });
    assert.equal(r.stopped, 'stop-requested');
    const rest = fakeExec({ quality: { del: 0.3 } });
    await runStudy({ studyDir: s.studyDir, exec: rest.exec, log: () => {} });
    assert.equal(rest.calls.filter((a) => a[0] === 'run').length + first.calls.filter((a) => a[0] === 'run').length >= 3, true);
  } finally { s.e.done(); }
});

test('a duplicate-tier skill is screened by delete only and never gets section waves', async () => {
  const s = setup({ tiers: ['duplicates'], skills: ['twina'] });
  try {
    const st = loadStudy(s.studyDir);
    st.plan.skills.find((x) => x.name === 'twina').tasks.chosen = ['rev-one', 'hid-one'];
    fs.writeFileSync(path.join(s.studyDir, 'study.json'), JSON.stringify(st));
    const { exec, calls } = fakeExec({ quality: {} });
    const r = await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    assert.deepEqual(runsOf(calls).map((a) => armsOf(a).join('+')), ['base+base-b+ctl-keep+ctl-prune', 'ctl+ctl-b+del']);
    assert.ok(r.decisions.some((d) => d.name === 'twina'));
  } finally { s.e.done(); }
});

test('a shared screen runs one control and A/A with a delete arm per skill, then each skill follows its own waves', async () => {
  const s = setup({ skills: ['sectioned', 'helped'], planOpts: { screen: true } });
  try {
    const { exec, calls } = fakeExec({ quality: { 'del-sectioned': 0.3, rm2: 0.3, rm3: 0.3, mv3: 0.3 } });
    const r = await runStudy({ studyDir: s.studyDir, exec, log: () => {} });
    const order = calls.map((a) => (a[0] === 'run' ? `run:${armsOf(a).join('+')}` : a[0] === 'cap' ? 'controls-check' : a[0]));
    assert.deepEqual(order, [
      'run:base+base-b+ctl-keep+ctl-prune', 'controls-check',
      'run:ctl+ctl-b+del-helped+del-sectioned', 'judge',
      'run:ctl+ctl-b+rm1+rm2+rm3', 'judge',
      'run:ctl+ctl-b+mv2+mv3', 'judge',
    ]);
    const by = Object.fromEntries(r.decisions.map((d) => [d.name, d]));
    assert.equal(by.sectioned.decision, 'PRUNE');
    assert.equal(by.helped.decision, 'DELETE');
    assert.ok(fs.existsSync(path.join(s.studyDir, 'decisions/patches/helped.patch')));
    const again = fakeExec({});
    await runStudy({ studyDir: s.studyDir, exec: again.exec, log: () => {} });
    assert.equal(again.calls.length, 0, 'a finished screen is not rerun');
    assert.match(studyStatus(s.studyDir), /helped \(loaded\): w1 done \(shared screen-konductor\)/);
  } finally { s.e.done(); }
});

test('a dry run names the shared screen and builds nothing', async () => {
  const s = setup({ skills: ['sectioned', 'helped'], planOpts: { screen: true } });
  try {
    const lines = [];
    await runStudy({ studyDir: s.studyDir, exec: fakeExec().exec, log: (m) => lines.push(m), dryRun: true });
    assert.match(lines.join('\n'), /screen-konductor: arms ctl, ctl-b, del-helped, del-sectioned/);
    assert.match(lines.join('\n'), /sectioned wave 1: shared screen-konductor/);
    assert.equal(fs.existsSync(path.join(s.studyDir, 'screens')), false);
  } finally { s.e.done(); }
});

// ---- dry run says what a resume would do, and writes nothing ----

const listing = (dir) => {
  const out = [];
  const walk = (d) => { for (const n of fs.readdirSync(d).sort()) { const f = path.join(d, n); const st = fs.statSync(f); out.push(`${path.relative(dir, f)}:${st.isDirectory() ? 'd' : `${st.size}:${st.mtimeMs}`}`); if (st.isDirectory()) walk(f); } };
  walk(dir);
  return out;
};

test('a dry run after a finished and judged screen says the run and the judge are skipped, and writes nothing', async () => {
  const s = setup({ skills: ['sectioned', 'helped'], planOpts: { screen: true } });
  try {
    await runStudy({ studyDir: s.studyDir, exec: fakeExec().exec, log: () => {} });
    const before = listing(s.studyDir);
    const lines = [];
    const { exec, calls } = fakeExec();
    await runStudy({ studyDir: s.studyDir, exec, log: (m) => lines.push(m), dryRun: true });
    const text = lines.join('\n');
    assert.match(text, /controls: already checked \(passed\)/);
    assert.match(text, /screen-konductor: finished and judged: the run and the judge are skipped/);
    assert.equal(calls.length, 0);
    assert.deepEqual(listing(s.studyDir), before, 'no file was created, changed or moved');
  } finally { s.e.done(); }
});

test('a dry run names a finished screen that is not judged, an unfinished one and a screen not started', async () => {
  const s = setup({ skills: ['sectioned', 'helped'], planOpts: { screen: true } });
  try {
    await runStudy({ studyDir: s.studyDir, exec: fakeExec().exec, log: () => {} });
    const dir = path.join(s.studyDir, 'screens', 'screen-konductor');
    const say = async () => { const lines = []; await runStudy({ studyDir: s.studyDir, exec: fakeExec().exec, log: (m) => lines.push(m), dryRun: true }); return lines.join('\n'); };
    fs.renameSync(path.join(dir, 'judgments.json'), path.join(s.e.root, 'judgments.aside'));
    assert.match(await say(), /screen-konductor: finished, not judged: the run is skipped and the judge would run/);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({ ...summary, results: summary.results.slice(1) }));
    assert.match(await say(), /screen-konductor: runs \d+\/\d+: the directory would be moved to incomplete\/ and the run repeated/);
    fs.rmSync(path.join(dir, 'summary.json'));
    assert.match(await say(), /screen-konductor: no-summary: the directory would be moved to incomplete\//);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.match(await say(), /screen-konductor: not started: the run would start/);
  } finally { s.e.done(); }
});
