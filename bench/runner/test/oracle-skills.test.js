// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { tmp } = require('./helpers.js');
const { applyOracle, oracleResult, targetArms, expectedFor, bodyOf, BEGIN, END } = require('../lib/oracle.js');
const { promptFor, MAX_PREFIX_BYTES } = require('../lib/arm-opts.js');
const { checkArgs } = require('../lib/cli-flags.js');
const { prefixIdentity } = require('../../report/aa-identity.js');

const skill = (name, body) => `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`;

function makeRepo() {
  const repo = tmp();
  const w = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  w('skills/dynamodb-design/SKILL.md', skill('dynamodb-design', 'Use single-table design.'));
  w('skills/dynamodb-validation/SKILL.md', skill('dynamodb-validation', 'Check hot partitions.'));
  w('skills/threat-modeling/SKILL.md', skill('threat-modeling', 'Use STRIDE.'));
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'skills');
  return { repo, sha: git('rev-parse', 'HEAD') };
}

function manifestFile(tasks) {
  const f = path.join(tmp(), 'manifest.json');
  fs.writeFileSync(f, JSON.stringify({ tasks }));
  return f;
}

const entry = (agent, expectedSkills) => ({ agent, expectedSkills, possibleSkills: [] });
const taskDynamo = { id: 'rc-dynamodb-design', prompt: 'Design the table.' };

function arms(sha, extra = {}) {
  return [{ id: 'vanilla', vanilla: true }, { id: 'oracle', vanilla: false, source: 'git', commitSha: sha, ref: sha, agent: 'k-architect', ...extra }];
}

test('the block holds the skill bodies without frontmatter, between the delimiters, ahead of the prompt', () => {
  const { repo, sha } = makeRepo();
  const a = arms(sha);
  const manifest = manifestFile([{ id: 'rc-dynamodb-design', entries: [entry('k-architect', ['dynamodb-design', 'dynamodb-validation'])] }]);
  applyOracle(a, { 'oracle-skills': 'oracle', 'oracle-manifest': manifest }, { tasks: [taskDynamo], repo, benchDir: repo });
  const prompt = promptFor(a[1], taskDynamo);
  assert.ok(prompt.startsWith(BEGIN));
  assert.ok(prompt.includes(`${END}\n\nDesign the table.`));
  assert.ok(prompt.includes('Use single-table design.') && prompt.includes('Check hot partitions.'));
  assert.ok(!prompt.includes('description: dynamodb-design skill'));
  assert.ok(prompt.indexOf('--- SKILL: dynamodb-design ---') < prompt.indexOf('--- SKILL: dynamodb-validation ---'));
  assert.equal(promptFor(a[0], taskDynamo), 'Design the table.', 'vanilla is unchanged');
  assert.deepEqual(oracleResult(a[1], taskDynamo).skills, ['dynamodb-design', 'dynamodb-validation']);
  assert.equal(oracleResult(a[1], taskDynamo).entryMatched, true);
  assert.equal(oracleResult(a[0], taskDynamo), null);
});

test('an arm prefix comes first, then the oracle block, then the prompt', () => {
  const { repo, sha } = makeRepo();
  const a = arms(sha, { prefixText: 'PREFIX\n', prefixInfo: { sha256: 'x', bytes: 7 } });
  applyOracle(a, { 'oracle-skills': true, 'oracle-manifest': manifestFile([{ id: 'rc-dynamodb-design', entries: [entry('k-architect', ['dynamodb-design'])] }]) }, { tasks: [taskDynamo], repo, benchDir: repo });
  const p = promptFor(a[1], taskDynamo);
  assert.ok(p.startsWith('PREFIX\n\n' + BEGIN));
  assert.ok(p.endsWith('Design the table.'));
});

test('bare --oracle-skills applies to every konductor arm and skips vanilla; a list names arms', () => {
  const { sha } = makeRepo();
  const a = arms(sha);
  assert.deepEqual(targetArms(true, a).map((x) => x.id), ['oracle']);
  assert.deepEqual(targetArms('oracle', a).map((x) => x.id), ['oracle']);
  assert.deepEqual(targetArms(undefined, a), []);
  assert.throws(() => targetArms('vanilla', a), /vanilla/);
  assert.throws(() => targetArms('nope', a), /not among --arms/);
  assert.throws(() => targetArms(true, [a[0]]), /every arm is vanilla/);
});

test('an unknown skill, a missing task entry and a task with no expected skills are all refused before any run, together', () => {
  const { repo, sha } = makeRepo();
  const a = arms(sha);
  const tasks = [taskDynamo, { id: 'rc-other', prompt: 'x' }, { id: 'rc-none', prompt: 'y' }];
  const manifest = manifestFile([
    { id: 'rc-dynamodb-design', entries: [entry('k-architect', ['dynamodb-design', 'dynamo-typo'])] },
    { id: 'rc-none', entries: [entry('k-architect', [])] },
  ]);
  assert.throws(() => applyOracle(a, { 'oracle-skills': true, 'oracle-manifest': manifest }, { tasks, repo, benchDir: repo }), (e) => {
    assert.match(e.message, /3 problem/);
    assert.match(e.message, /skill "dynamo-typo" has no skills\/dynamo-typo\/SKILL\.md/);
    assert.match(e.message, /task rc-other has no entry/);
    assert.match(e.message, /task rc-none lists no expected skills/);
    return true;
  });
});

test('expected skills follow the arm entry agent, else the union of the task entries', () => {
  const entries = [entry('k-architect', ['a', 'b']), entry('k-developer', ['b', 'c'])];
  assert.deepEqual(expectedFor(entries, 'k-developer'), { skills: ['b', 'c'], entryMatched: true });
  assert.deepEqual(expectedFor(entries, 'konductor'), { skills: ['a', 'b', 'c'], entryMatched: false });
});

test('a skill is read from the arm own ref, not from the checkout', () => {
  const { repo, sha } = makeRepo();
  fs.writeFileSync(path.join(repo, 'skills/dynamodb-design/SKILL.md'), skill('dynamodb-design', 'CHANGED AFTER THE REF'));
  const a = arms(sha);
  applyOracle(a, { 'oracle-skills': true, 'oracle-manifest': manifestFile([{ id: 'rc-dynamodb-design', entries: [entry('k-architect', ['dynamodb-design'])] }]) }, { tasks: [taskDynamo], repo, benchDir: repo });
  assert.ok(promptFor(a[1], taskDynamo).includes('Use single-table design.'));
  assert.ok(!promptFor(a[1], taskDynamo).includes('CHANGED AFTER THE REF'));
});

test('a directory arm reads from its own directory', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'skills/threat-modeling'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skills/threat-modeling/SKILL.md'), skill('threat-modeling', 'From the directory arm.'));
  const a = [{ id: 'd', vanilla: false, source: 'dir', dir, ref: `dir:${dir}`, agent: 'k-architect' }];
  const t = { id: 'rc-threat-model', prompt: 'Model it.' };
  applyOracle(a, { 'oracle-skills': true, 'oracle-manifest': manifestFile([{ id: 'rc-threat-model', entries: [entry('k-architect', ['threat-modeling'])] }]) }, { tasks: [t], repo: dir, benchDir: dir });
  assert.ok(promptFor(a[0], t).includes('From the directory arm.'));
});

test('a block that would pass the argument limit with the prefix is refused', () => {
  const { repo, sha } = makeRepo();
  fs.mkdirSync(path.join(repo, 'skills/big'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'skills/big/SKILL.md'), skill('big', 'x'.repeat(MAX_PREFIX_BYTES)));
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'big']);
  const sha2 = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const a = arms(sha2);
  assert.throws(() => applyOracle(a, { 'oracle-skills': true, 'oracle-manifest': manifestFile([{ id: 'rc-dynamodb-design', entries: [entry('k-architect', ['big'])] }]) }, { tasks: [taskDynamo], repo, benchDir: repo }), /byte limit/);
  assert.ok(sha);
});

test('--oracle-manifest without --oracle-skills is an error and no flag means no oracle', () => {
  const { repo, sha } = makeRepo();
  const a = arms(sha);
  assert.deepEqual(applyOracle(a, {}, { tasks: [taskDynamo], repo, benchDir: repo }), {});
  assert.equal(a[1].oracle, undefined);
  assert.throws(() => applyOracle(a, { 'oracle-manifest': 'x.json' }, { tasks: [taskDynamo], repo, benchDir: repo }), /needs --oracle-skills/);
});

test('bodyOf removes only the frontmatter', () => {
  assert.equal(bodyOf(skill('s', 'Body\n\n---\nkeep this rule')), 'Body\n\n---\nkeep this rule\n');
});

test('both flags are known to the run command and a typo is still refused', () => {
  assert.equal(checkArgs('run', { _: [], 'oracle-skills': true, 'oracle-manifest': 'f.json' }), null);
  assert.match(checkArgs('run', { _: [], 'oracle-skill': true }), /did you mean --oracle-skills/);
});

test('oracle arms never share an A/A identity with the same ref run normally', () => {
  const normal = [{ arm: 'a', armPrefix: null, oracle: null }];
  const oracle = [{ arm: 'b', armPrefix: null, oracle: { skills: ['x'] } }];
  assert.equal(prefixIdentity(normal), '');
  assert.equal(prefixIdentity(oracle), '|oracle');
  assert.equal(prefixIdentity([...normal, ...oracle]), null);
});

test('the README and usage text name the flags', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  assert.match(read('runner/bench.js'), /--oracle-skills \[ARM,ARM\]/);
  assert.match(read('README.md'), /--oracle-skills/);
});
