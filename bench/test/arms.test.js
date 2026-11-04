// SPDX-License-Identifier: Apache-2.0
/**
 * Comparison arms unit tests
 *
 * Uses Node's built-in `node:test` and `node:assert`, so no test framework dependency is needed.
 * Run: node --test bench/test/arms.test.js
 *
 * The fixtures under fixtures/arms/ are one toy agent configuration and four toy skills. `plan`
 * is the main target and is an ordinary English word, which makes it the hard case for
 * scrubbing; `triage-kit` is the target of the tests that need a name no prose uses. The tests
 * read nothing but those fixtures, so the suite does not depend on the repository's real agents
 * or skills, and they spawn no processes and make no network or model calls.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  WITH_SKILL,
  WITHOUT_SKILL,
  LOAD_MODES,
  MAX_REMOVED_LINES,
  ANSWER_STYLE_INSTRUCTION,
  ArmsError,
  buildArms,
  verifyArms,
  hashText,
  hashSkillSet,
} = require('../lib/arms');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'arms');

function readFixture(...segments) {
  const full = path.resolve(FIXTURES_DIR, ...segments);
  assert.ok(full.startsWith(`${FIXTURES_DIR}${path.sep}`), `${full} is outside the arms fixtures`);
  return fs.readFileSync(full, 'utf8');
}

/** Reads `skills/<name>/SKILL.md`: `name:` and `description:` front matter lines, then the body. */
function loadSkill(name) {
  const raw = readFixture('skills', name, 'SKILL.md');
  const match = raw.match(/^---\nname: (.+)\ndescription: (.+)\n---\n([\s\S]*)$/);
  assert.ok(match, `${name} has unexpected front matter`);
  return { name: match[1], description: match[2], text: match[3].replace(/^\n/, '') };
}

function fixtureInput(overrides = {}) {
  return {
    agent: JSON.parse(readFixture('agent.json')),
    skills: ['plan', 'triage-kit', 'glossary', 'release-notes'].map(loadSkill),
    target: 'plan',
    loadMode: LOAD_MODES.NONE,
    ...overrides,
  };
}

/** A minimal input for tests that need a specific line in a specific place. */
function smallInput({ prompt = 'Be brief.', description = 'A toy.', extra = '', target = 'plan', ...rest } = {}) {
  return {
    agent: { name: 'toy', description, prompt },
    skills: [
      { name: target, description: 'The target.', text: 'Target body.' },
      { name: 'other', description: 'Another skill.', text: `Other body.\n${extra}` },
    ],
    target,
    loadMode: LOAD_MODES.NONE,
    ...rest,
  };
}

function problemsOf(input) {
  try {
    buildArms(input);
  } catch (error) {
    assert.ok(error instanceof ArmsError, `expected ArmsError, got ${error && error.name}`);
    return error.problems;
  }
  return assert.fail('buildArms did not throw');
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

const names = (skills) => skills.map((skill) => skill.name).sort();

// --- The shape of the result -------------------------------------------------------------------

test('buildArms returns a with-skill and a without-skill arm plus a manifest for each', () => {
  const built = buildArms(fixtureInput());
  assert.deepEqual(Object.keys(built.arms), [WITH_SKILL, WITHOUT_SKILL]);
  assert.deepEqual(Object.keys(built.manifests), [WITH_SKILL, WITHOUT_SKILL]);
  assert.equal(built.target, 'plan');
  assert.equal(built.schema_version, 1);
  assert.equal(built.load_mode, LOAD_MODES.NONE);
  for (const arm of Object.values(built.arms)) assert.deepEqual(Object.keys(arm), ['agent', 'skills']);
});

test('the fixtures stay inside bench/test/fixtures/arms', () => {
  assert.throws(() => readFixture('..', '..', '..', 'lib', 'arms.js'), /outside the arms fixtures/);
});

test('the with-skill arm is the input plus the appended instruction and nothing else', () => {
  const input = fixtureInput();
  const arm = buildArms(input).arms[WITH_SKILL];
  assert.deepEqual(arm.skills, input.skills);
  assert.equal(arm.agent.name, input.agent.name);
  assert.equal(arm.agent.description, input.agent.description);
  assert.equal(arm.agent.prompt, `${input.agent.prompt.trimEnd()}\n\n${ANSWER_STYLE_INSTRUCTION}`);
});

// --- Rule 1: the skill sets differ by exactly the target ---------------------------------------

test('the skill sets differ by exactly the target skill', () => {
  const { arms } = buildArms(fixtureInput());
  assert.deepEqual(names(arms[WITH_SKILL].skills), ['glossary', 'plan', 'release-notes', 'triage-kit']);
  assert.deepEqual(names(arms[WITHOUT_SKILL].skills), ['glossary', 'release-notes', 'triage-kit']);
});

test('a target that is not in the skill set is an error', () => {
  assert.match(problemsOf(fixtureInput({ target: 'missing-skill' })).join('\n'), /no skill is named "missing-skill"/);
});

test('verifyArms accepts a pair built by buildArms', () => {
  assert.deepEqual(verifyArms(buildArms(fixtureInput())), []);
  assert.deepEqual(verifyArms(buildArms(fixtureInput({ loadMode: LOAD_MODES.EXPLICIT }))), []);
});

test('verifyArms rejects a pair whose skill sets differ by more than the target', () => {
  const extra = buildArms(fixtureInput());
  extra.arms[WITHOUT_SKILL].skills.push({ name: 'stowaway', description: 'x', text: 'y' });
  assert.match(verifyArms(extra).join('\n'), /differ by more than the target skill/);

  const missing = buildArms(fixtureInput());
  missing.arms[WITHOUT_SKILL].skills.pop();
  assert.match(verifyArms(missing).join('\n'), /differ by more than the target skill/);

  const kept = buildArms(fixtureInput());
  kept.arms[WITHOUT_SKILL].skills.push({ name: 'plan', description: 'x', text: 'y' });
  assert.match(verifyArms(kept).join('\n'), /still holds the target skill/);

  const dropped = buildArms(fixtureInput());
  dropped.arms[WITH_SKILL].skills = dropped.arms[WITH_SKILL].skills.filter((skill) => skill.name !== 'plan');
  assert.match(verifyArms(dropped).join('\n'), /does not hold the target skill/);
});

test('verifyArms rejects a pair that lists a skill twice', () => {
  const built = buildArms(fixtureInput());
  built.arms[WITH_SKILL].skills.push({ ...built.arms[WITH_SKILL].skills[1] });
  assert.match(verifyArms(built).join('\n'), /same skill name twice/);
});

// --- Rule 2: references are removed from the without arm ---------------------------------------

test('the without arm drops lines of the agent prompt that name the skill', () => {
  const prompt = buildArms(fixtureInput()).arms[WITHOUT_SKILL].agent.prompt;
  assert.doesNotMatch(prompt, /plan skill/i);
  assert.doesNotMatch(prompt, /skills: plan/i);
  assert.match(prompt, /^You are a synthetic assistant used only in tests\./);
  assert.match(prompt, /Answer in plain text\./);
});

test('the without arm drops lines of the agent description that name the skill', () => {
  const input = fixtureInput();
  const { description } = buildArms(input).arms[WITHOUT_SKILL].agent;
  assert.equal(description, 'A small synthetic assistant used only in tests.');
  assert.equal(buildArms(input).arms[WITH_SKILL].agent.description, input.agent.description);
});

test('the without arm drops lines of every other skill that name the target', () => {
  const { skills } = buildArms(fixtureInput()).arms[WITHOUT_SKILL];
  const byName = Object.fromEntries(skills.map((skill) => [skill.name, skill]));
  assert.doesNotMatch(byName['triage-kit'].text, /plan skill/i);
  assert.match(byName['triage-kit'].text, /Sort each item into urgent or routine/);
  assert.doesNotMatch(byName['release-notes'].text, /`plan`/);
  assert.match(byName['release-notes'].text, /Group the notes under added, changed and fixed\./);
  assert.equal(byName.glossary.text, loadSkill('glossary').text);
});

test('scrubbing also covers a skill description', () => {
  const input = smallInput();
  input.skills[1].description = 'Works well after the plan skill.';
  const built = buildArms(input);
  assert.equal(built.arms[WITHOUT_SKILL].skills[0].description, '');
  assert.equal(built.manifests[WITHOUT_SKILL].removed_lines[0].source, 'skill:other.description');
});

test('the recognised ways of naming a skill are all scrubbed', () => {
  const references = [
    'Use the plan skill here.',
    'Skill: plan',
    'Invoke `plan` now.',
    'Run /plan to start.',
    'Call acme:plan first.',
    'Read skills/plan before starting.',
    'Open plan/SKILL.md for detail.',
    'The Plan Skill covers scoping.',
  ];
  for (const reference of references) {
    const built = buildArms(smallInput({ prompt: `Keep this line.\n${reference}\nKeep this too.` }));
    assert.equal(built.arms[WITHOUT_SKILL].agent.prompt.split('\n\n')[0], 'Keep this line.\nKeep this too.', reference);
  }
});

test('a name that is not an ordinary word is scrubbed wherever it appears as a whole token', () => {
  const input = fixtureInput({ target: 'triage-kit' });
  input.skills.find((skill) => skill.name === 'glossary').text = 'Define terms.\nSee triage-kit for sorting.\nTriage-kits are fine to mention.';
  const built = buildArms(input);
  const glossary = built.arms[WITHOUT_SKILL].skills.find((skill) => skill.name === 'glossary');
  assert.equal(glossary.text, 'Define terms.\nTriage-kits are fine to mention.');
  assert.deepEqual(verifyArms(built), []);
});

test('an alias is scrubbed like the target name', () => {
  const input = smallInput({ prompt: 'Keep this.\nUse the planner-v2 skill.\nAnd this.', aliases: ['planner-v2'] });
  const built = buildArms(input);
  assert.equal(built.arms[WITHOUT_SKILL].agent.prompt.split('\n\n')[0], 'Keep this.\nAnd this.');
  assert.deepEqual(built.aliases, ['planner-v2']);
});

test('an alias that repeats the target, another skill or itself is an error', () => {
  assert.match(problemsOf(smallInput({ aliases: ['plan'] })).join('\n'), /repeats the target name/);
  assert.match(problemsOf(smallInput({ aliases: ['other'] })).join('\n'), /name of another skill/);
  assert.match(problemsOf(smallInput({ aliases: ['p-1', 'p-1'] })).join('\n'), /duplicate alias/);
  assert.match(problemsOf(smallInput({ aliases: ['not valid'] })).join('\n'), /aliases\[0\]/);
  assert.match(problemsOf(smallInput({ aliases: 'p-1' })).join('\n'), /aliases: must be an array/);
});

test('an agent name that refers to the target is an error because a name cannot be scrubbed', () => {
  const input = smallInput();
  input.agent.name = 'acme:plan';
  assert.match(problemsOf(input).join('\n'), /agent\.name: refers to the target skill/);
});

test('scrubbing may not leave the agent prompt empty', () => {
  assert.match(problemsOf(smallInput({ prompt: 'Use the plan skill.' })).join('\n'), /left nothing of the prompt/);
});

// --- Rule 3: scrubbing is capped ---------------------------------------------------------------

test('the fixture sits exactly at the cap and builds', () => {
  const built = buildArms(fixtureInput());
  assert.equal(built.manifests[WITHOUT_SKILL].removed_lines.length, MAX_REMOVED_LINES);
});

test('one more reference line than the cap is an error that points at ordinary prose', () => {
  const input = fixtureInput();
  input.skills.find((skill) => skill.name === 'glossary').text += 'Prefer the plan skill when unsure.\n';
  const problems = problemsOf(input);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /delete 6 lines, more than the limit of 5/);
  assert.match(problems[0], /matches ordinary prose/);
});

test('an over-cap input fails before anything is returned, whatever the load mode', () => {
  for (const loadMode of Object.values(LOAD_MODES)) {
    const prompt = Array.from({ length: MAX_REMOVED_LINES + 1 }, (_, i) => `Step ${i}: use the plan skill.`).join('\n');
    assert.throws(() => buildArms(smallInput({ prompt: `Keep.\n${prompt}`, loadMode })), ArmsError);
  }
});

// --- Rule 3 hard case: the skill name is an ordinary English word ------------------------------

test('hard case: prose that only uses the word plan survives and is listed for review', () => {
  const built = buildArms(fixtureInput());
  const { agent, skills } = built.arms[WITHOUT_SKILL];
  assert.match(agent.prompt, /Make a plan before you change anything, and keep each step small\./);
  const triage = skills.find((skill) => skill.name === 'triage-kit');
  assert.match(triage.text, /A good plan names an owner for each step/);
  const glossary = skills.find((skill) => skill.name === 'glossary');
  assert.match(glossary.text, /Terms to cover first: plan, step, owner\./);
  assert.match(glossary.text, /A plan in this glossary means an ordered list of steps\./);

  const kept = built.manifests[WITHOUT_SKILL].ambiguous_kept.map((entry) => entry.text);
  assert.ok(kept.includes('Make a plan before you change anything, and keep each step small.'));
  assert.ok(kept.includes('A plan in this glossary means an ordered list of steps.'));
  assert.equal(built.manifests[WITH_SKILL].ambiguous_kept.length, 0);
});

test('hard case: treating the word as a distinctive name would delete real instructions, and the cap stops it', () => {
  const problems = problemsOf(fixtureInput({ nameIsCommonWord: false }));
  assert.match(problems.join('\n'), /more than the limit of 5/);
});

test('hard case: a distinctive name can be declared an ordinary word, which keeps its bare mentions', () => {
  const input = fixtureInput({ target: 'triage-kit', nameIsCommonWord: true });
  input.skills.find((skill) => skill.name === 'glossary').text = 'Define terms.\nSee triage-kit for sorting.';
  const built = buildArms(input);
  const glossary = built.arms[WITHOUT_SKILL].skills.find((skill) => skill.name === 'glossary');
  assert.match(glossary.text, /See triage-kit for sorting\./);
  assert.ok(built.manifests[WITHOUT_SKILL].ambiguous_kept.some((entry) => entry.text === 'See triage-kit for sorting.'));
});

test('hard case: a line that mixes a reference with unrelated prose is removed whole, and the manifest shows it', () => {
  const built = buildArms(smallInput({ prompt: 'Keep.\nLoad the plan skill, then make a plan.\nKeep too.' }));
  assert.equal(built.arms[WITHOUT_SKILL].agent.prompt.split('\n\n')[0], 'Keep.\nKeep too.');
  assert.deepEqual(built.manifests[WITHOUT_SKILL].removed_lines, [
    { source: 'agent.prompt', line: 2, text: 'Load the plan skill, then make a plan.' },
  ]);
});

test('hard case: words that merely contain the name are not references', () => {
  const prompt = 'Keep.\nThe planner and the planning skill are separate.\nMake a plan-b skill list.\nA skill plan-view helps.';
  const built = buildArms(smallInput({ prompt }));
  assert.equal(built.arms[WITHOUT_SKILL].agent.prompt.split('\n\n')[0], prompt);
});

// --- Rule 4: the answer-style instruction ------------------------------------------------------

test('both arms end with the identical answer-style instruction', () => {
  for (const loadMode of Object.values(LOAD_MODES)) {
    const { arms } = buildArms(fixtureInput({ loadMode }));
    for (const armName of [WITH_SKILL, WITHOUT_SKILL]) {
      assert.ok(arms[armName].agent.prompt.endsWith(`\n\n${ANSWER_STYLE_INSTRUCTION}`), `${armName} / ${loadMode}`);
      assert.equal(arms[armName].agent.prompt.split(ANSWER_STYLE_INSTRUCTION).length, 2);
    }
  }
});

test('the answer-style instruction forbids describing tools, skills and loaded instructions', () => {
  assert.match(ANSWER_STYLE_INSTRUCTION, /Do not describe, name or list the tools, skills or loaded instructions/);
});

test('verifyArms rejects a pair whose prompts do not share the instruction', () => {
  const built = buildArms(fixtureInput());
  built.arms[WITHOUT_SKILL].agent.prompt += ' Be brief.';
  assert.match(verifyArms(built).join('\n'), /identical answer-style instruction/);
});

// --- Rule 5: the load mode is recorded ---------------------------------------------------------

test('the two load modes are named', () => {
  assert.deepEqual(LOAD_MODES, { EXPLICIT: 'explicit-load', NONE: 'no-instruction' });
});

test('explicit-load tells only the with-skill arm to load the skill by name', () => {
  const { arms } = buildArms(fixtureInput({ loadMode: LOAD_MODES.EXPLICIT }));
  const instruction = 'Before you begin, load the skill named "plan" and follow it.';
  assert.ok(arms[WITH_SKILL].agent.prompt.endsWith(`\n\n${instruction}\n\n${ANSWER_STYLE_INSTRUCTION}`));
  assert.equal(arms[WITHOUT_SKILL].agent.prompt.includes(instruction), false);
  assert.equal(arms[WITHOUT_SKILL].agent.prompt.includes('load the skill'), false);
});

test('no-instruction adds nothing about loading to either arm', () => {
  const { arms } = buildArms(fixtureInput({ loadMode: LOAD_MODES.NONE }));
  for (const arm of Object.values(arms)) assert.doesNotMatch(arm.agent.prompt, /load the skill/);
});

test('the load mode used is recorded on the result and in both manifests', () => {
  for (const loadMode of Object.values(LOAD_MODES)) {
    const built = buildArms(fixtureInput({ loadMode }));
    assert.equal(built.load_mode, loadMode);
    assert.equal(built.manifests[WITH_SKILL].load_mode, loadMode);
    assert.equal(built.manifests[WITHOUT_SKILL].load_mode, loadMode);
  }
});

test('the load mode has no default', () => {
  const input = fixtureInput();
  delete input.loadMode;
  assert.match(problemsOf(input).join('\n'), /loadMode: must be one of explicit-load, no-instruction; there is no default/);
  assert.match(problemsOf(fixtureInput({ loadMode: 'auto' })).join('\n'), /loadMode/);
});

test('verifyArms rejects a pair whose prompt does not match its recorded mode', () => {
  const explicitButMissing = buildArms(fixtureInput({ loadMode: LOAD_MODES.EXPLICIT }));
  explicitButMissing.load_mode = LOAD_MODES.NONE;
  explicitButMissing.manifests[WITH_SKILL].load_mode = LOAD_MODES.NONE;
  explicitButMissing.manifests[WITHOUT_SKILL].load_mode = LOAD_MODES.NONE;
  assert.match(verifyArms(explicitButMissing).join('\n'), /does not allow/);

  const noneButExpected = buildArms(fixtureInput({ loadMode: LOAD_MODES.NONE }));
  noneButExpected.load_mode = LOAD_MODES.EXPLICIT;
  assert.match(verifyArms(noneButExpected).join('\n'), /lacks the load instruction/);

  const leaked = buildArms(fixtureInput({ loadMode: LOAD_MODES.EXPLICIT }));
  leaked.arms[WITHOUT_SKILL].agent.prompt = leaked.arms[WITH_SKILL].agent.prompt;
  assert.match(verifyArms(leaked).join('\n'), /without-skill prompt holds a load instruction/);
});

// --- Rule 6: the manifests ---------------------------------------------------------------------

test('a manifest holds the prompt hash, the skill-set hash and the removed lines', () => {
  const built = buildArms(fixtureInput());
  const manifest = built.manifests[WITHOUT_SKILL];
  const arm = built.arms[WITHOUT_SKILL];
  assert.equal(manifest.arm, WITHOUT_SKILL);
  assert.equal(manifest.agent_prompt_sha256, crypto.createHash('sha256').update(arm.agent.prompt, 'utf8').digest('hex'));
  assert.equal(manifest.agent_prompt_sha256, hashText(arm.agent.prompt));
  assert.equal(manifest.skill_set_sha256, hashSkillSet(arm.skills));
  assert.match(manifest.skill_set_sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.skill_names, ['glossary', 'release-notes', 'triage-kit']);
  assert.deepEqual(
    manifest.removed_lines.map((entry) => [entry.source, entry.line]),
    [
      ['agent.description', 2],
      ['agent.prompt', 2],
      ['agent.prompt', 4],
      ['skill:triage-kit.text', 4],
      ['skill:release-notes.text', 4],
    ],
  );
  assert.deepEqual(manifest.removed_lines[1].text, 'Available skills: plan, triage-kit, glossary, release-notes.');
});

test('the with-skill manifest records no removed lines and the full skill set', () => {
  const manifest = buildArms(fixtureInput()).manifests[WITH_SKILL];
  assert.deepEqual(manifest.removed_lines, []);
  assert.deepEqual(manifest.skill_names, ['glossary', 'plan', 'release-notes', 'triage-kit']);
});

test('the skill-set hash does not depend on the order the skills were listed in', () => {
  const input = fixtureInput();
  const reversed = fixtureInput({ skills: [...input.skills].reverse() });
  const a = buildArms(input).manifests;
  const b = buildArms(reversed).manifests;
  assert.equal(a[WITH_SKILL].skill_set_sha256, b[WITH_SKILL].skill_set_sha256);
  assert.equal(a[WITHOUT_SKILL].skill_set_sha256, b[WITHOUT_SKILL].skill_set_sha256);
});

test('a one-character change to a skill changes the skill-set hash', () => {
  const input = fixtureInput();
  const changed = fixtureInput();
  changed.skills.find((skill) => skill.name === 'glossary').text += '.';
  assert.notEqual(
    buildArms(input).manifests[WITH_SKILL].skill_set_sha256,
    buildArms(changed).manifests[WITH_SKILL].skill_set_sha256,
  );
  assert.notEqual(
    buildArms(input).manifests[WITH_SKILL].agent_prompt_sha256,
    buildArms(fixtureInput({ loadMode: LOAD_MODES.EXPLICIT })).manifests[WITH_SKILL].agent_prompt_sha256,
  );
});

test('nothing from a manifest appears in the arm descriptions a subject receives', () => {
  const built = buildArms(fixtureInput());
  const shown = JSON.stringify(built.arms);
  assert.equal(shown.includes('removed_lines'), false);
  assert.equal(shown.includes('ambiguous_kept'), false);
  assert.equal(shown.includes(built.manifests[WITHOUT_SKILL].agent_prompt_sha256), false);
  for (const entry of built.manifests[WITHOUT_SKILL].removed_lines) {
    assert.equal(JSON.stringify(built.arms[WITHOUT_SKILL]).includes(JSON.stringify(entry.text).slice(1, -1)), false, entry.text);
  }
});

test('verifyArms rejects a manifest that does not match its arm', () => {
  const built = buildArms(fixtureInput());
  built.manifests[WITHOUT_SKILL].agent_prompt_sha256 = '0'.repeat(64);
  built.manifests[WITH_SKILL].skill_set_sha256 = '0'.repeat(64);
  const text = verifyArms(built).join('\n');
  assert.match(text, /without-skill: manifest prompt hash does not match/);
  assert.match(text, /with-skill: manifest skill-set hash does not match/);
});

// --- Purity of the result ----------------------------------------------------------------------

test('building twice gives the same result', () => {
  assert.deepEqual(buildArms(fixtureInput()), buildArms(fixtureInput()));
});

test('the input is not modified and may be frozen', () => {
  const input = fixtureInput();
  const before = JSON.stringify(input);
  const built = buildArms(deepFreeze(input));
  assert.equal(JSON.stringify(input), before);
  assert.notEqual(built.arms[WITH_SKILL].skills[0], input.skills[0]);
  assert.notEqual(built.arms[WITH_SKILL].agent, input.agent);
});

// --- Bad input ---------------------------------------------------------------------------------

test('bad input is reported as an ArmsError with every problem listed', () => {
  const cases = [
    [null, /input: must be an object/],
    [[], /input: must be an object/],
    [fixtureInput({ extra: 1 }), /unknown field "extra"/],
    [fixtureInput({ agent: null }), /agent: must be an object/],
    [fixtureInput({ agent: { name: 'a', prompt: 'p' } }), /agent\.description: missing/],
    [fixtureInput({ agent: { name: 'a', description: '', prompt: 'p', model: 'x' } }), /agent: unknown field "model"/],
    [fixtureInput({ agent: { name: 'a', description: '', prompt: '  ' } }), /agent\.prompt: must not be blank/],
    [fixtureInput({ skills: 'none' }), /skills: must be an array/],
    [fixtureInput({ skills: [{ name: 'Plan', description: '', text: '' }] }), /skills\[0\]\.name: must be a lowercase slug/],
    [fixtureInput({ skills: [{ name: 'plan', description: '', text: 5 }] }), /skills\[0\]\.text: must be a string/],
    [fixtureInput({ skills: [{ name: 'plan', description: '', text: '', tags: [] }] }), /unknown field "tags"/],
    [fixtureInput({ nameIsCommonWord: 'yes' }), /nameIsCommonWord: must be true or false/],
    [fixtureInput({ target: 'Not A Slug' }), /target: must be a lowercase slug/],
  ];
  for (const [input, pattern] of cases) assert.match(problemsOf(input).join('\n'), pattern);
});

test('two skills with the same name are an error', () => {
  const input = fixtureInput();
  input.skills.push({ ...input.skills[1] });
  assert.match(problemsOf(input).join('\n'), /already used by another skill/);
});

test('an input that throws while being read is an ArmsError', () => {
  const input = fixtureInput();
  Object.defineProperty(input, 'agent', {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  assert.match(problemsOf(input).join('\n'), /could not be inspected/);
});

test('an ArmsError is an Error that carries its problems', () => {
  const error = new ArmsError(['a', 'b', 'c', 'd']);
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ArmsError');
  assert.deepEqual(error.problems, ['a', 'b', 'c', 'd']);
  assert.match(error.message, /a; b; c; and 1 more/);
});

test('verifyArms never throws and reports a value that is not a built pair', () => {
  for (const value of [undefined, null, 5, 'x', [], {}, { arms: {}, manifests: {} }, { arms: {}, manifests: {}, target: 'p', aliases: [] }]) {
    assert.ok(verifyArms(value).length > 0, String(JSON.stringify(value)));
  }
  const built = buildArms(fixtureInput());
  built.arms[WITH_SKILL] = { agent: { name: 'x' }, skills: [] };
  assert.match(verifyArms(built).join('\n'), /each arm needs an agent and a skill list/);
  const hostile = { get arms() { throw new Error('boom'); }, manifests: {} };
  assert.match(verifyArms(hostile).join('\n'), /could not be inspected/);
});

test('verifyArms notices a reference left behind in the without-skill arm', () => {
  const built = buildArms(fixtureInput());
  built.arms[WITHOUT_SKILL].agent.prompt = `Use the plan skill.\n${built.arms[WITHOUT_SKILL].agent.prompt}`;
  assert.match(verifyArms(built).join('\n'), /agent\.prompt of the without-skill arm still refers to the target skill/);

  const inSkill = buildArms(fixtureInput());
  inSkill.arms[WITHOUT_SKILL].skills[0].text += '\nSee `plan`.';
  assert.match(verifyArms(inSkill).join('\n'), /skill:triage-kit\.text of the without-skill arm still refers/);
});
