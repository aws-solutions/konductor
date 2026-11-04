// SPDX-License-Identifier: Apache-2.0
/**
 * A size cap must not leave part of the skill's name behind. A file is cleaned in full and only
 * then cut, and a reply is cleaned in full and only then cut, so a cap that falls inside the name
 * leaves no fragment. Each test puts the cap inside the name at every offset, renders the real
 * prompt on both scales and in both orders, and looks for a run of 4 or more characters from the
 * start or the end of the name in the text that was shown.
 * Run: node --test bench/test/skill-name-cut.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { judgePrompt } = require('../lib/judge-prompt');
const { SCALES } = require('../lib/judge-scale');

const TASK = { task: 'Add a changelog entry for the new flag.', rubric: ['Adds an entry.'] };
const NAMES = ['release-notes', 'data-cleanup', 'zz-skill-sentinel'];

const emptyArm = (answer = 'Done.', final = {}) => ({ answer, start: {}, final });

/** The prompts for one planted arm: planted first and second, on each scale. */
function prompts(planted, options) {
  const other = emptyArm();
  const out = [];
  for (const scale of Object.keys(SCALES)) {
    for (const [a, b] of [
      [planted, other],
      [other, planted],
    ]) {
      const { prompt } = judgePrompt(TASK, a, b, { context: options.context, scale, limits: options.limits });
      out.push({ scale, prompt });
    }
  }
  return out;
}

/** Every start and end fragment of 4 or more characters, shorter than the whole name. */
function fragmentsOf(name) {
  const out = [];
  for (let length = 4; length < name.length; length += 1) out.push(name.slice(0, length), name.slice(-length));
  return out;
}

for (const skillName of NAMES) {
  const context = { skillName };

  test(`a name split by the file cap leaves no fragment in the file (${skillName})`, () => {
    const cap = 20;
    for (let offset = 1; offset < skillName.length; offset += 1) {
      const lead = `${'x'.repeat(cap - offset - 1)} `;
      const planted = emptyArm('Done.', { 'out/result.md': `${lead}${skillName}\nand more text after it.\n` });
      for (const { scale, prompt } of prompts(planted, { context, limits: { maxFileChars: cap } })) {
        const from = prompt.indexOf('### out/result.md (added; cut at the size limit)');
        const to = prompt.indexOf('[... file cut here', from);
        assert.ok(from >= 0 && to > from, `the file is shown and cut at offset ${offset} (${scale})`);
        const shown = prompt.slice(from, to).toLowerCase();
        for (const fragment of fragmentsOf(skillName)) {
          assert.ok(!shown.includes(fragment), `fragment ${JSON.stringify(fragment)} at offset ${offset} (${scale})`);
        }
      }
    }
  });

  test(`a name split by the total cap leaves no fragment either (${skillName})`, () => {
    // The first file uses part of the total, so the second is cut by what is left, inside the name.
    for (let offset = 1; offset < skillName.length; offset += 1) {
      const lead = `${'y'.repeat(7)} `;
      const planted = emptyArm('Done.', {
        'a.md': 'a'.repeat(10),
        'b.md': `${lead}${skillName}\nand more text after it.\n`,
      });
      const limits = { maxFileChars: 100, maxTotalChars: 10 + lead.length + offset };
      for (const { scale, prompt } of prompts(planted, { context, limits })) {
        const from = prompt.indexOf('### b.md');
        const to = prompt.indexOf('[... file cut here', from);
        assert.ok(from >= 0 && to > from, `the second file is shown and cut at offset ${offset} (${scale})`);
        const shown = prompt.slice(from, to).toLowerCase();
        for (const fragment of fragmentsOf(skillName)) {
          assert.ok(!shown.includes(fragment), `fragment ${JSON.stringify(fragment)} at offset ${offset} (${scale})`);
        }
      }
    }
  });

  test(`a name split by the reply cap leaves no fragment in the reply (${skillName})`, () => {
    const cap = 20000;
    for (let offset = 1; offset < skillName.length; offset += 1) {
      const reply = `${'x'.repeat(cap - offset - 1)} ${skillName} and the rest of the reply.`;
      for (const { scale, prompt } of prompts(emptyArm(reply), { context })) {
        const from = prompt.indexOf('xxxx');
        const to = prompt.indexOf('answer cut here', from);
        assert.ok(from >= 0 && to > from, `the reply is cut at offset ${offset} (${scale})`);
        const shown = prompt.slice(from, to).toLowerCase();
        for (const fragment of fragmentsOf(skillName)) {
          assert.ok(!shown.includes(fragment), `fragment ${JSON.stringify(fragment)} at offset ${offset} (${scale})`);
        }
      }
    }
  });
}

test('a cut file that names the skill renders exactly like the same file without the name', () => {
  const context = { skillName: 'release-notes' };
  const lead = `${'x'.repeat(30)} `;
  const long = (name) => emptyArm('Done.', { 'out/long.md': `${lead}${name}\nafter ${'y'.repeat(50)}\n` });
  // The cap falls after "release-no" of the name in the raw text.
  const limits = { maxFileChars: lead.length + 10 };
  const options = { context, limits, nonce: 'n0nce-cut' };
  for (const [named, plain] of [
    [long('release-notes'), long('')],
    [long('Release_Notes'), long('')],
    [long('my-ReleaseNotes'), long('my-')],
  ]) {
    assert.equal(
      judgePrompt(TASK, named, emptyArm(), options).prompt,
      judgePrompt(TASK, plain, emptyArm(), options).prompt,
    );
    assert.equal(
      judgePrompt(TASK, emptyArm(), named, options).prompt,
      judgePrompt(TASK, emptyArm(), plain, options).prompt,
    );
  }
});
