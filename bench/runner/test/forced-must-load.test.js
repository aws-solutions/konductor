// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const { applyForcedMustLoad, forcedLoadResult, BEGIN, END } = require('../lib/forced-must-load.js');
const { promptFor } = require('../lib/arm-opts.js');
const { resolveArm } = require('../lib/arms.js');
const { checkArgs } = require('../lib/cli-flags.js');
const { prefixIdentity } = require('../../report/aa-identity.js');

function makeRepo() {
  const repo = tmp();
  const w = (rel) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), 'x\n'); };
  w('skills/risk-management/SKILL.md');
  w('skills/kiro-requirements-generation/SKILL.md');
  w('agent-sops/k-existing-design-review.sop.md');
  w('agents/k-developer.agent-spec.json');
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'units');
  return { repo, sha: git('rev-parse', 'HEAD') };
}

const arms = (sha) => [
  { id: 'vanilla', vanilla: true, runtime: 'kiro-cli' },
  { id: 'konductor', vanilla: false, source: 'git', commitSha: sha, ref: sha, runtime: 'kiro-cli', agent: 'konductor' },
  { id: 'konductor-forced', vanilla: false, source: 'git', commitSha: sha, ref: sha, runtime: 'kiro-cli', agent: 'konductor' },
];
const tFields = { id: 't6-req-field-inspections', prompt: 'Write the requirements.', loadCheck: { mustLoad: ['skill:kiro-requirements-generation'] } };
const tMixed = { id: 't2-arch-dr-split-checkout', prompt: 'Review the design.', loadCheck: { mustLoad: ['risk-management', 'k-existing-design-review'] } };

test('the forced arm names each mustLoad unit in front of the prompt; the organic arm at the same ref is untouched', () => {
  const { repo, sha } = makeRepo();
  const a = arms(sha);
  const rec = applyForcedMustLoad(a, { 'forced-must-load': 'konductor-forced' }, { tasks: [tFields, tMixed], repo });
  const forced = a[2];
  const p1 = promptFor(forced, tFields);
  assert.ok(p1.startsWith(`${BEGIN}\nBefore you do anything else, load the skill named "kiro-requirements-generation" with the get_skill tool of the skills server and read it.`));
  assert.ok(p1.includes(`${END}\n\nWrite the requirements.`));
  const p2 = promptFor(forced, tMixed);
  assert.match(p2, /load the skill named "risk-management" .* and read it; then read the SOP named "k-existing-design-review", the installed file "k-existing-design-review\.sop\.md"/);
  assert.equal(promptFor(a[1], tFields), 'Write the requirements.');
  assert.deepEqual(rec['konductor-forced'][tMixed.id].units, ['skill:risk-management', 'sop:k-existing-design-review']);
  assert.deepEqual(forcedLoadResult(forced, tFields).units, ['skill:kiro-requirements-generation']);
  assert.equal(forcedLoadResult(a[1], tFields), null);
});

test('an agent unit is handed the task after the loads', () => {
  const { repo, sha } = makeRepo();
  const a = arms(sha);
  const t = { id: 't', prompt: 'P', loadCheck: { mustLoad: ['risk-management', 'agent:k-developer'] } };
  applyForcedMustLoad(a, { 'forced-must-load': 'konductor-forced' }, { tasks: [t], repo });
  assert.match(promptFor(a[2], t), /and read it\. Then hand the whole task below to the agent named "k-developer" with the subagent tool\. Then do the task below/);
});

test('refusals: no mustLoad, a unit the ref lacks, vanilla, an unknown arm, a missing value', () => {
  const { repo, sha } = makeRepo();
  const none = { id: 't1-neg-config-alias', prompt: 'P', loadCheck: { mustLoad: [] } };
  const ghost = { id: 'g', prompt: 'P', loadCheck: { mustLoad: ['skill:not-there'] } };
  assert.throws(() => applyForcedMustLoad(arms(sha), { 'forced-must-load': 'konductor-forced' }, { tasks: [none, ghost], repo }),
    (e) => /2 problem/.test(e.message) && /t1-neg-config-alias has no loadCheck\.mustLoad/.test(e.message) && /"not-there" is not a skill, SOP or agent/.test(e.message));
  assert.throws(() => applyForcedMustLoad(arms(sha), { 'forced-must-load': 'vanilla' }, { tasks: [tFields], repo }), /vanilla, which has no skills/);
  assert.throws(() => applyForcedMustLoad(arms(sha), { 'forced-must-load': 'nope' }, { tasks: [tFields], repo }), /not among --arms/);
  assert.throws(() => applyForcedMustLoad(arms(sha), { 'forced-must-load': true }, { tasks: [tFields], repo }), /takes ARM/);
  assert.deepEqual(applyForcedMustLoad(arms(sha), {}, { tasks: [tFields], repo }), {});
});

test('a forced arm never pairs as an A/A repeat of the organic arm, and run accepts the flag', () => {
  assert.notEqual(prefixIdentity([{ forcedLoad: { units: ['skill:a'] } }]), prefixIdentity([{}]));
  assert.equal(prefixIdentity([{ forcedLoad: { units: ['skill:a'] } }, {}]), null);
  assert.equal(checkArgs('run', { _: [], 'forced-must-load': 'konductor-forced' }), null);
});

test('vanilla-b=vanilla is a vanilla A/A repeat under its own id; vanilla stays reserved as a name', () => {
  const v = resolveArm('vanilla-b=vanilla', process.cwd());
  assert.equal(v.id, 'vanilla-b');
  assert.equal(v.vanilla, true);
  assert.equal(v.harness, 'none');
  assert.equal(v.repeatOf, 'vanilla');
  assert.equal(v.commitSha, null);
  assert.equal(resolveArm('vanilla', process.cwd()).repeatOf, undefined);
  assert.throws(() => resolveArm('vanilla=vanilla', process.cwd()), /reserved/);
});
