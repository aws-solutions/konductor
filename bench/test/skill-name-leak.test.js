// SPDX-License-Identifier: Apache-2.0
/**
 * Skill-name leak matrix. The judge must not learn which run had the skill, so no spelling of the
 * skill's name may reach the prompt through a reply, a file path or file content, and the size cap
 * must not leave a fragment of the name behind.
 *
 * Every spelling below is planted in each of the three places, in both arms and both orders, and
 * on both judge scales, by rendering the real prompt. A spelling is gone when the prompt, with
 * every separator stripped, no longer holds the name's letters in a row.
 *
 * The spellings that are deliberately kept are in KEPT and asserted there. Run:
 *   node --test bench/test/skill-name-leak.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { judgePrompt } = require('../lib/judge-prompt');
const { SCALES } = require('../lib/judge-scale');
const { sanitizeAnswer } = require('../lib/sanitize');

const TASK = { task: 'Add a changelog entry for the new flag.', rubric: ['Adds an entry.'] };
const NAMES = [
  ['release', 'notes'],
  ['data', 'cleanup'],
];

const title = (word) => word[0].toUpperCase() + word.slice(1);

/** Every spelling that must be removed, for a name made of the two parts `a` and `b`. */
function spellings([a, b]) {
  const name = `${a}-${b}`;
  const A = title(a);
  const B = title(b);
  return {
    exact: name,
    'title case': `${A}-${B}`,
    'upper case': name.toUpperCase(),
    underscore: `${a}_${b}`,
    dot: `${a}.${b}`,
    fused: `${a}${b}`,
    CamelCase: `${A}${B}`,
    camelCase: `${a}${B}`,
    'glued: suffix word': `${name}-guide`,
    'glued: prefix word': `my-${name}`,
    'glued: extension': `${name}.md`,
    'glued: underscore suffix': `${name}_v2`,
    'glued: repeated last part in a path': `docs/${name}-${b}.md`,
    'glued: slash': `docs/${name}/index.md`,
    'glued: camel suffix': `${A}${B}Guide`,
    'glued: camel prefix': `my${A}${B}`,
    'path: skills directory': `skills/${name}/SKILL.md`,
    'path: harness skills directory': `.konductor/skills/${name}/`,
    'path: url segment': `https://example.com/docs/${name}/latest`,
    'frontmatter key': `name: ${name}`,
  };
}

/** Spellings that stay by decision. See the "Names glued to other words" paragraph in sanitize.js. */
const KEPT = (a, b) => [`${a} ${b}`, `${title(a)} ${title(b)}`, `docs/${a} ${b}.md`];

/** The prompt with every separator stripped, so a name cannot hide behind one. */
const squash = (text) => text.toLowerCase().replace(/[\s\-_./\\:]+/g, '');
const fused = ([a, b]) => `${a}${b}`;

const emptyArm = (answer = 'Done.', final = {}) => ({ answer, start: {}, final });

/** The three places a spelling can come from. */
const PLACES = {
  reply: (spelling) => emptyArm(`Summary: ${spelling} is done.`),
  'file path': (spelling) => emptyArm('Done.', { [`notes/${spelling}.txt`]: 'Body.\n' }),
  'file content': (spelling) =>
    emptyArm('Done.', { 'out/result.md': `Body of the file.\n${spelling}\nMore text.\n` }),
};

/** The prompts for one planted arm: planted first and second, on each scale. */
function prompts(planted, options = {}) {
  const other = emptyArm();
  const out = [];
  for (const scale of Object.keys(SCALES)) {
    for (const [a, b] of [
      [planted, other],
      [other, planted],
    ]) {
      const { prompt } = judgePrompt(TASK, a, b, {
        context: { skillName: options.skillName },
        scale,
        nonce: 'n0nce-leak',
        limits: options.limits,
      });
      out.push({ scale, prompt });
    }
  }
  return out;
}

for (const parts of NAMES) {
  const skillName = parts.join('-');

  test(`baseline: the prompt itself holds no run of ${fused(parts)} (${skillName})`, () => {
    for (const { prompt } of prompts(emptyArm(), { skillName })) {
      assert.ok(!squash(prompt).includes(fused(parts)));
    }
  });

  for (const [label, spelling] of Object.entries(spellings(parts))) {
    test(`leak matrix (${skillName}): ${label}: ${spelling.replace(/\n/g, ' ')}`, () => {
      for (const [place, plant] of Object.entries(PLACES)) {
        for (const { scale, prompt } of prompts(plant(spelling), { skillName })) {
          assert.ok(
            !squash(prompt).includes(fused(parts)),
            `the name reached the ${scale} prompt through the ${place}`,
          );
        }
      }
    });
  }

  test(`leak matrix (${skillName}): copied frontmatter is removed from file content`, () => {
    const content = `---\nname: ${skillName}\ndescription: Writes things.\n---\n\nBody.\n`;
    const planted = emptyArm('Done.', { 'out/copy.md': content });
    for (const { scale, prompt } of prompts(planted, { skillName })) {
      assert.ok(!squash(prompt).includes(fused(parts)), `the name reached the ${scale} prompt`);
      assert.ok(prompt.includes('description: Writes things.'), 'the rest of the file is kept');
    }
  });

  test(`kept by decision (${skillName}): a space between the parts is ordinary English`, () => {
    for (const spelling of KEPT(...parts)) {
      assert.equal(sanitizeAnswer(`See ${spelling} here.`, { skillName }), `See ${spelling} here.`);
      for (const place of Object.keys(PLACES)) {
        const [{ prompt }] = prompts(PLACES[place](spelling), { skillName });
        assert.ok(prompt.includes(spelling), `${JSON.stringify(spelling)} kept in the ${place}`);
      }
    }
  });

  test(`a space is a match next to the word skill (${skillName})`, () => {
    const [a, b] = parts;
    assert.equal(sanitizeAnswer(`Use the ${a} ${b} skill now.`, { skillName }), 'Use now.');
    assert.equal(sanitizeAnswer(`skill: ${a} ${b}`, { skillName }), '');
    assert.equal(sanitizeAnswer(`Use \`${a} ${b}\` now.`, { skillName }), 'Use now.');
  });
}

// --- Words that only share letters with the name ----------------------------------------------

test('false positives: ordinary prose and paths that share letters with the name are left alone', () => {
  const context = { skillName: 'release-notes' };
  const untouched = [
    'The releases are tagged.',
    'Write the notes below.',
    'Cut a release today.',
    'He noted the change.',
    'This is a release-candidate note.',
    'See docs/releases/notes.md for details.',
    'Release the notes to the team.',
    'pre-release notes were drafted',
    'The release/notes split is deliberate.',
    'Check the releasenote and the notesrelease fields.',
    'xrelease-notes and release-notesx are other words.',
    'The word releasenotesguide has no separator before the guide.',
  ];
  for (const line of untouched) {
    // The last two lines hold a name glued to letters with no separator and no case change, and
    // the line before them a word that only contains it: all stay.
    assert.equal(sanitizeAnswer(line, context), line, line);
  }
});

test('false positives: the same words survive in a path and in content through the prompt', () => {
  const context = { skillName: 'release-notes' };
  const planted = emptyArm('The releases and notes are ready. He noted it.', {
    'docs/releases/notes.md': 'A release-candidate note about releases.\n',
  });
  const { prompt } = judgePrompt(TASK, planted, emptyArm(), { context });
  assert.ok(prompt.includes('### docs/releases/notes.md (added)'));
  assert.ok(prompt.includes('A release-candidate note about releases.'));
  assert.ok(prompt.includes('The releases and notes are ready. He noted it.'));
});

test('false positives: a name made of letters only keeps its prose, in a reply, a path and content', () => {
  const context = { skillName: 'plan' };
  const prose = 'Make a plan first. A plan needs owners. We plan to ship, and plan-b exists.';
  assert.equal(sanitizeAnswer(prose, context), prose);
  const planted = emptyArm(prose, { 'docs/plan.md': prose, 'docs/plan-notes.md': 'x' });
  const { prompt } = judgePrompt(TASK, planted, emptyArm(), { context });
  assert.ok(prompt.includes('### docs/plan.md (added)'));
  assert.ok(prompt.includes('### docs/plan-notes.md (added)'));
  assert.equal(prompt.split(prose).length - 1, 2, 'the prose is intact in the reply and the file');
});

test('an ordinary-word name is still removed in the forms prose does not use, paths included', () => {
  const context = { skillName: 'plan' };
  const planted = emptyArm('Used the plan skill.', {
    'skills/plan/SKILL.md': '---\nname: plan\ndescription: Plans.\n---\n',
    '.konductor/skills/plan/notes.md': 'x',
  });
  const { prompt } = judgePrompt(TASK, planted, emptyArm(), { context });
  assert.ok(!/skills\/plan|plan\/SKILL|name: plan|plan skill/i.test(prompt));
  assert.ok(!prompt.includes('.konductor/'));
  assert.ok(prompt.includes('description: Plans.'), 'the rest of the file is kept');
});

test('an ordinary-word name is removed everywhere when the caller says it is not an ordinary word', () => {
  const context = { skillName: 'plan', nameIsCommonWord: false };
  assert.equal(sanitizeAnswer('Make a plan-b first.', context), 'Make a -b first.');
  assert.equal(sanitizeAnswer('See docs/plan-notes.md', context), 'See docs/-notes.md');
});
