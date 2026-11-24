// SPDX-License-Identifier: Apache-2.0
// Tests for the judge-input step (bench/cap/judgeinput.js): sanitize, redact, cap, leak scan. Pure functions on
// the committed sanitize.answers.json fixture. Secret-shaped strings are built here at run time, never written out.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const fs = require('node:fs');
const judgeInput = require('../../cap/judgeinput.js');
const {
  createJudgeInput,
  scanLeaks,
  sanitizerProvenance,
  provenanceParts,
  MAX_ANSWER_CHARS,
  MAX_REMOVED_SHARE,
} = judgeInput;
const { SHAPES, MASK } = require('../lib/scrub.js');
const sanitizer = require('../../cap/sanitize.js');
const { argsSha256: sha256 } = require('../lib/plant/canonical.js');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'sanitize');
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));

const SKILL = 'e2e-test-strategy';
const ANSWERS = readFixture('sanitize.answers.json');
const RULE_CASES = readFixture('sanitize.rules.json');
const SKILL_CASES = readFixture('skill-narration.cases.json');
const KEY = ['AK', 'IA'].join('') + 'Q'.repeat(16); // shaped like an AWS access key id; not a real one
const defaultInput = createJudgeInput();
const prepare = (text, input = defaultInput) =>
  input.prepare(text, { skill: SKILL });
/** scanLeaks with the default sanitizer settings, which the default judge input sanitizes with. */
const scan = (text, options = {}) =>
  scanLeaks(text, { settings: defaultInput.settings, ...options });
const collectLeakIds = (leaks) => leaks.map((leak) => leak.id).sort();

for (const answerCase of ANSWERS.cases) {
  test(`both arms: ${answerCase.name} is eligible and clean`, () => {
    const result = prepare(answerCase.stored);
    assert.deepEqual(
      [
        result.text,
        result.eligible,
        result.reason,
        result.leaks,
        result.redacted,
        result.truncated,
      ],
      [answerCase.sanitized, true, null, [], false, false],
    );
  });
}

// [what leaked, the arm it comes from, text, ids the scan reports]. The scan runs on text that is already sanitized.
const LEAK_CASES = [
  [
    'a plugin-qualified name',
    'with',
    'I will load bench:e2e-test-strategy now',
    ['plugin-name', 'skill-name', 'skill-word'],
  ],
  [
    'the skill slug',
    'with',
    'Following e2e-test-strategy here.',
    ['skill-name', 'skill-word'],
  ],
  [
    '"no such skill exists"',
    'without',
    'No such skill exists for that.',
    ['skill-word'],
  ],
  [
    '"skill-loading"',
    'without',
    'I only have a skill-loading tool.',
    ['skill-word'],
  ],
  [
    'a Skill tool result',
    'without',
    'Skill execution was blocked.\nThe Skill tool failed.',
    ['skill-word', 'tool-marker'],
  ],
  ['raw tool markers', 'with', 'tool_use then tool_result', ['tool-marker']],
  ['an agent id', 'with', 'Ask k-developer first.', ['agent-id']],
  [
    'a harness path',
    'with',
    'Saved to /tmp/bench-subject-ab12/notes.md',
    ['harness-path'],
  ],
  [
    'arm labels',
    'with',
    'the WITHOUT ARM text, with2 and condition ii',
    ['arm-label', 'arm-label-caps'],
  ],
  [
    'guidance narration',
    'with',
    'We loaded the guidance first.',
    ['skill-word'],
  ],
  [
    'a name inside fenced code is still a leak',
    'with',
    '```\nbench:other\n```',
    ['plugin-name'],
  ],
];
LEAK_CASES.push(
  [
    'a skill name in prose',
    'with',
    `Our ${SKILL} gives a plan.`,
    ['skill-name'],
  ],
  ['an agent id in a blockquote', 'with', '> Ask k-developer.', ['agent-id']],
  [
    'a name left in prose next to a URL that holds it',
    'with',
    `Ask konductor, see https://github.com/aws-solutions/konductor/blob/main`,
    ['agent-id'],
  ],
);
for (const [name, arm, text, expected, skill = SKILL] of LEAK_CASES) {
  test(`leak scan, ${arm} arm: ${name}`, () =>
    assert.deepEqual(collectLeakIds(scan(text, { skill })), expected));
}

test('leak scan: near-misses are clean (ordinary prose, a one-word skill name, narration-like text in fenced code)', () => {
  for (const [text, skill] of [
    ['Skill level: senior. Use a skills matrix. The skillset is wide.', SKILL],
    ['Run git status, then git diff.', 'git'],
    ["```\nI'll load the Skill tool in this example\n```", SKILL],
    [
      'Benchmark: bench press, scripts/benchmark.js, k-means, and the arm of a robot.',
      SKILL,
    ],
    ['Follow the guidance in the AWS style guide.', SKILL],
    // Names the sanitizer's rewrites leave alone are content, so the scan does not look for them there.
    ['See https://github.com/aws-solutions/konductor/blob/main.', SKILL],
    ['Run `npm install konductor-installer` first.', SKILL],
    [`Edit \`${SKILL}/notes.md\` and ${SKILL}.md.`, SKILL],
    ['```sh\nkonductor build\nk-developer run\n```', SKILL],
    [`\`\`\`\nrun ${SKILL}\n\`\`\``, SKILL],
    ['> ```\n> konductor build\n> ```', SKILL],
  ])
    assert.deepEqual(scan(text, { skill }), [], text);
  const [hit] = scan('see bench:some-thing here');
  assert.deepEqual([hit.sample, hit.count], ['bench:s', 1]);
});

// The sanitizer keeps each near-miss in its fixture, so the scan must not fail it: a hit here would drop the whole pair
// from both readings for text the sanitizer judged ordinary.
test('every near-miss the sanitizer keeps is eligible through prepare', () => {
  for (const ruleCase of RULE_CASES) {
    for (const keepText of [].concat(ruleCase.keep)) {
      const result = prepare(keepText);
      assert.deepEqual(
        [result.eligible, result.reason],
        [true, null],
        `${ruleCase.rule}: ${keepText}`,
      );
    }
  }
});

// What an arm whose skill load failed, or an arm with no skill, writes. It must never reach a judge: the sanitizer drops
// the sentence, and the scan, which shares its pattern, flags it if it were ever left in.
const MISSING_SKILL_NARRATION = [
  'No skill matched the request, so I wrote it by hand.',
  `I could not find a skill named ${SKILL}.`,
  'No skills are available in this session.',
  'There is no skill for this, so I used my own steps.',
  'I checked for a skill but none applied.',
  'Skill not found, so I proceeded without it.',
  'No matching skill was found.',
  'No relevant skill applied here.',
  'There was no skill available.',
  'The skill was unavailable, so I continued.',
  'I looked for a matching skill and found none.',
  'Skill unavailable.',
  'The skill could not be found.',
  'I did not find a skill for this task.',
  'No skill could be found.',
  'No skill was relevant here.',
  'I found no matching skill.',
  'None of the skills applied.',
  'I could not locate a skill for this.',
  'I was unable to find a skill.',
  'There is no such skill here.',
];

test('missing-skill narration is dropped by prepare and flagged by the leak scan', () => {
  const rest = 'Rank flows by risk first. Then test login. Then test checkout.';
  for (const sentence of MISSING_SKILL_NARRATION) {
    const result = prepare(`${sentence} ${rest}`);
    assert.equal(result.text, rest, sentence);
    assert.ok(collectLeakIds(scan(sentence)).includes('skill-word'), sentence);
  }
});

// The sanitizer and the scan share one check for skill narration (sanitize.js), so a sentence the sanitizer drops is a
// leak if it is left in, and a sentence it keeps is clean. Every row of the case tables, both ways.
const DROPPED_BY_SANITIZER = [
  ...Object.values(SKILL_CASES.drop).flat(),
  ...SKILL_CASES.drop_shape,
  ...SKILL_CASES.drop_named,
  ...SKILL_CASES.drop_cost,
  ...SKILL_CASES.drop_window,
];
const KEPT_BY_SANITIZER = [...SKILL_CASES.keep, ...SKILL_CASES.keep_risky];
test('leak scan parity: every sentence the sanitizer drops is flagged skill-word, and prepare drops it', () => {
  assert.ok(DROPPED_BY_SANITIZER.length >= 80);
  for (const sentence of DROPPED_BY_SANITIZER) {
    assert.ok(
      collectLeakIds(scan(sentence, { skill: SKILL })).includes('skill-word'),
      `not flagged: ${sentence}`,
    );
    const result = prepare(
      `${sentence}${/[.!?]$/.test(sentence) ? ' ' : '\n'}${SKILL_CASES.rest}`,
    );
    assert.deepEqual(
      [result.text, result.leaks],
      [SKILL_CASES.rest, []],
      sentence,
    );
  }
});

test('leak scan parity: no ordinary sentence the sanitizer keeps is flagged', () => {
  assert.ok(KEPT_BY_SANITIZER.length >= 31);
  for (const sentence of KEPT_BY_SANITIZER)
    assert.deepEqual(scan(sentence, { skill: SKILL }), [], sentence);
});

test("leak scan: the narration check is the sanitizer's own, skips fenced code and table rows, and respects the request", () => {
  assert.deepEqual(
    scan('A good tester needs skill. No skill could be found. Run it.'),
    [{ id: 'skill-word', count: 1, sample: 'No skill could be found.' }],
  );
  assert.deepEqual(
    scan('```\nNo skill could be found.\n```\nRow 1.'),
    [],
    'a fenced sample is example content',
  );
  assert.deepEqual(
    scan('| Login | No skill could be found |'),
    [{ id: 'skill-word', count: 1, sample: 'No skill could be found' }],
    'a table cell is read like a sentence',
  );
  assert.deepEqual(
    collectLeakIds(scan('Row 1.\nI used the\nskill to answer this.')),
    ['skill-word'],
    'a sentence wrapped over two lines is read whole',
  );
  assert.deepEqual(
    collectLeakIds(
      scan('No relevant skill was available, so I\nAnswered directly.'),
    ),
    ['skill-word'],
    'the scan joins the lines of a paragraph whatever the next one starts with',
  );
  assert.deepEqual(
    scan('I used the\n```\ncode\n```\nskill to answer this.'),
    [],
    'a fence between two lines keeps them apart',
  );
  assert.deepEqual(
    scan('- Rank by skill\n- found a gap'),
    [],
    'a list item is not the continuation of the one above',
  );
  assert.deepEqual(
    collectLeakIds(scan('   I looked for a matching skill and found none.')),
    ['skill-word'],
    'an indented line is split as the sanitizer splits it',
  );
  assert.deepEqual(
    scan('Please load the skill now.', { request: 'Please load the skill' }),
    [],
    "a sentence the request holds is the user's own",
  );
});

test('leak scan: it sees narration that has only a weak cue, and a label line is not narration', () => {
  for (const [sentence, request] of [
    ['Using the skill, here is the review.', ''],
    ['Skills used: none.', ''],
    ['The skill was loaded.', ''],
    ['Skills used: none.', 'Write a Claude Code skill.'],
    ['The skill was loaded.', 'Write a Claude Code skill.'],
  ])
    assert.deepEqual(
      collectLeakIds(scan(`Review.\n\n${sentence}`, { request })),
      ['skill-word'],
      `${sentence} / ${request}`,
    );
  // A label or a title is not joined to the line under it, so "Skills" and "Load testing" are not one sentence.
  for (const text of [
    '**Skills**\nLoad testing and API testing are covered.',
    'Team skills\nWe call each owner before the release.',
    'Skills needed\nPlanning, execution.',
    'Skills list:\nLoad testing and API testing are covered.',
    'These are the skills this plan covers:\nLoad testing and API testing.',
  ])
    assert.deepEqual(scan(text), [], text);
  // A longer line without a stop still joins the next one, whatever it starts with.
  assert.deepEqual(
    collectLeakIds(scan('I looked for the right skill and\nFound none.')),
    ['skill-word'],
  );
  assert.equal(
    prepare('**Skills**\nLoad testing and API testing are covered.').eligible,
    true,
  );
});

test('leak scan: a name, an agent id or a path the request holds is not a leak', () => {
  const request =
    'Ask k-developer to open scripts/bench/run.js and use bench:other for e2e-test-strategy.';
  const text =
    'Ask k-developer to open scripts/bench/run.js and use bench:other for e2e-test-strategy.';
  assert.deepEqual(scan(text, { skill: SKILL, request }), []);
  assert.deepEqual(collectLeakIds(scan(text, { skill: SKILL })), [
    'agent-id',
    'harness-path',
    'plugin-name',
    'skill-name',
  ]);
});

test('leak scan: the skill-word entry names its matcher, and the hash covers the name', () => {
  const entry = provenanceParts().leak_scan.find(
    (tuple) => tuple[0] === 'skill-word',
  );
  assert.equal(entry[4], 'skill-narration');
  assert.deepEqual(
    provenanceParts()
      .leak_scan.filter((tuple) => tuple[0] !== 'skill-word')
      .map((tuple) => tuple[4]),
    Array(judgeInput.LEAK_TABLE.length - 1).fill(''),
  );
});

test('leak scan: a sourced guidance reference is not narration, an unsourced one is', () => {
  for (const source of ['of', 'in', 'from', 'on', 'at', 'by', 'published']) {
    const line = `I followed the guidance ${source} the style guide.`;
    assert.deepEqual(scan(line), [], line);
  }
  assert.deepEqual(collectLeakIds(scan('I followed the guidance.')), [
    'skill-word',
  ]);
});

test('a leak fails the answer: not eligible, with the ids as the reason, and the text is still returned', () => {
  const result = prepare('tool_use call\nRow 1');
  assert.deepEqual(
    [result.eligible, result.reason, collectLeakIds(result.leaks)],
    [false, 'narration remains after sanitizing: tool-marker', ['tool-marker']],
  );
  assert.equal(result.text, 'tool_use call\nRow 1');
});

// The scan and the sanitizer share the narration lists, so the scan's own value is in what the sanitizer leaves alone on
// purpose: table rows, an arm label (the sanitizer no longer removes labels) and a raw tool marker. Each of these is
// caught by another entry of the scan, and the answer is not eligible.
test('narration that the lists leave alone on purpose is caught by the other leak entries', () => {
  const padding =
    ' Rank flows by risk first, then test login and checkout.'.repeat(6);
  const row = prepare(
    `| Flow | Note |\n|---|---|\n| Login | Skill execution was blocked |\n${padding}`,
  );
  assert.deepEqual([row.eligible, row.leaks], [true, []]);
  assert.ok(
    row.text.includes('| Login |  |'),
    'the sanitizer emptied the narrating cell and kept the row',
  );
  assert.equal(row.counts['skill-narration'], 1);
  // A raw marker in a cell the scan reads is still caught by its own entry, when the sanitizer was not run first.
  assert.deepEqual(
    collectLeakIds(scan('| Login | Skill execution was blocked |')),
    ['skill-word', 'tool-marker'],
  );
  const label = prepare(
    `Under the WITHOUT ARM condition the plan reads the same.${padding}`,
  );
  assert.deepEqual(
    [label.eligible, collectLeakIds(label.leaks)],
    [false, ['arm-label-caps']],
  );
  const marker = prepare(`The log shows tool_result after the call.${padding}`);
  assert.deepEqual(
    [marker.eligible, collectLeakIds(marker.leaks)],
    [false, ['tool-marker']],
  );
  // A fenced sample of the same sentence is example content: eligible, as for the sanitizer.
  assert.equal(
    prepare(`\`\`\`\nSkill execution was blocked\n\`\`\`\n${padding}`).eligible,
    true,
  );
});

test('narration the request holds stays in the answer and is not a leak; without the request it is dropped', () => {
  const request = 'Please load the skill and explain what it does.';
  const body =
    'Row 1 covers login first, then the cart. Row 2 covers search and filters, and Row 3 covers the account page.';
  const answer = `I will load the skill now. ${body}`;
  const kept = defaultInput.prepare(answer, { skill: SKILL, request });
  assert.deepEqual([kept.text, kept.eligible, kept.leaks], [answer, true, []]);
  const dropped = defaultInput.prepare(answer, { skill: SKILL });
  assert.deepEqual([dropped.text, dropped.eligible], [body, true]);
});

test('nothing left, or too long to sanitize: not eligible', () => {
  assert.deepEqual(
    [prepare('Skill loaded\n').eligible, prepare('Skill loaded\n').reason],
    [false, 'sanitizing left no answer'],
  );
  const long = prepare('a'.repeat(1000001));
  assert.deepEqual(
    [long.text, long.eligible, long.reason],
    ['', false, 'the answer is too long to sanitize'],
  );
});

test('redaction runs after sanitizing: key ids and exact credential values never reach a judge', () => {
  const secret = 'not-a-real-secret-value-1234';
  const withLiteral = createJudgeInput({ literals: [secret] });
  const result = prepare(
    `Row 1 ${KEY}\nExport ${secret} now.\nRow 2 stays in the answer as ordinary text, with enough words in it to keep the removed share low.\nI'll load the e2e-test-strategy skill.`,
    withLiteral,
  );
  assert.equal(result.text, `Row 1 ${MASK}\nExport ${MASK} now.\nRow 2 stays in the answer as ordinary text, with enough words in it to keep the removed share low.`);
  assert.deepEqual([result.redacted, result.eligible], [true, true]);
  for (const value of [KEY, secret]) assert.ok(!result.text.includes(value));
});

test('redaction sees through characters the sanitizer normalizes away, and leaves prose that only names a variable', () => {
  const split = `${KEY.slice(0, 4)}\u200b${KEY.slice(4)}`;
  assert.equal(prepare(`Row 1 ${split}`).text, `Row 1 ${MASK}`);
  const prose = 'Set AWS_SESSION_TOKEN in the environment, then call the API.';
  assert.deepEqual(
    [prepare(prose).text, prepare(prose).redacted],
    [prose, false],
  );
});

test('size cap: cut after redaction so a cut cannot split a secret; flagged truncated; room for a long answer', () => {
  const small = createJudgeInput({ maxChars: 50 });
  const result = prepare(`${'x'.repeat(39)} ${KEY} ${'y'.repeat(100)}`, small);
  assert.deepEqual(
    [result.truncated, result.redacted, result.eligible],
    [true, true, true],
  );
  assert.ok(
    result.text.startsWith(`${'x'.repeat(39)} ${MASK}`) &&
      result.text.endsWith('characters]'),
    result.text,
  );
  assert.ok(!result.text.includes(KEY.slice(0, 8)));
  const exact = prepare('z'.repeat(50), small);
  assert.deepEqual([exact.truncated, exact.text.length], [false, 50]);
  assert.equal(prepare('word '.repeat(10000)).truncated, false);
  assert.ok(MAX_ANSWER_CHARS >= 50000);
  for (const invalidMaxChars of [0, -1, 1.5, '5'])
    assert.throws(
      () => createJudgeInput({ maxChars: invalidMaxChars }),
      TypeError,
    );
});

/** True when `text` holds a surrogate unit that is not one half of a pair. */
const hasLoneSurrogate = (text) =>
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(
    text,
  );

test('size cap: the cut never lands between the two halves of a surrogate pair', () => {
  const small = createJudgeInput({ maxChars: 10 });
  const emoji = '\u{1F600}';
  assert.equal(emoji.length, 2);
  // The pair sits at units 9 and 10: a cut at 10 would keep the first half only, so the cut moves back one unit.
  const split = prepare(`${'x'.repeat(9)}${emoji}${'y'.repeat(5)}`, small);
  assert.equal(split.truncated, true);
  assert.equal(split.text, `${'x'.repeat(9)}[truncated 7 characters]`);
  assert.equal(hasLoneSurrogate(split.text), false);
  // The pair ends exactly at the cap: it is kept whole.
  const whole = prepare(`${'x'.repeat(8)}${emoji}${'y'.repeat(5)}`, small);
  assert.equal(whole.text, `${'x'.repeat(8)}${emoji}[truncated 5 characters]`);
  // A pair that starts at the cap is cut off whole.
  const after = prepare(`${'x'.repeat(10)}${emoji}`, small);
  assert.equal(after.text, `${'x'.repeat(10)}[truncated 2 characters]`);
  // Text that fits is not touched, a pair at its very end included.
  const fits = prepare(`${'x'.repeat(8)}${emoji}`, small);
  assert.deepEqual(
    [fits.truncated, fits.text],
    [false, `${'x'.repeat(8)}${emoji}`],
  );
  // The first and the last pair of the range: U+10000 is D800 DC00, U+10FFFF is DBFF DFFF.
  for (const edge of ['\u{10000}', '\u{10FFFF}']) {
    const result = prepare(`${'x'.repeat(9)}${edge}tail`, small);
    assert.equal(result.text, `${'x'.repeat(9)}[truncated 6 characters]`, edge);
  }
  // The default cap of 50,000 units behaves the same.
  const long = prepare(
    `${'a'.repeat(MAX_ANSWER_CHARS - 1)}${emoji}${'b'.repeat(10)}`,
  );
  assert.equal(
    long.text,
    `${'a'.repeat(MAX_ANSWER_CHARS - 1)}[truncated 12 characters]`,
  );
  assert.equal(hasLoneSurrogate(long.text), false);
});

test('size cap: wherever the cut falls in a text of pairs, no half of a pair is kept and the kept part is at most the cap', () => {
  const emoji = '\u{1F680}';
  for (let cap = 1; cap <= 9; cap += 1) {
    for (const lead of ['', 'a']) {
      const input = createJudgeInput({ maxChars: cap });
      const result = prepare(`${lead}${emoji.repeat(8)}`, input);
      const kept = result.text.replace(/\[truncated \d+ characters\]$/, '');
      assert.equal(hasLoneSurrogate(result.text), false, `${cap}/${lead}`);
      assert.ok(kept.length <= cap, `${cap}/${lead}: kept ${kept.length}`);
      // The cut moves back by at most the one unit that would have split a pair.
      assert.ok(kept.length >= cap - 1, `${cap}/${lead}: kept ${kept.length}`);
    }
  }
});

test('size cap: a surrogate unit that is not half of a pair is not moved, so only a real pair is protected', () => {
  const small = createJudgeInput({ maxChars: 4 });
  // A high surrogate with no low one after it, and a low one with no high one before it, sit at the cut.
  const loneHigh = prepare('abc\ud83dxyz', small);
  assert.equal(loneHigh.text, 'abc\ud83d[truncated 3 characters]');
  const loneLow = prepare('abcd\ude00xyz', small);
  assert.equal(loneLow.text, 'abcd[truncated 4 characters]');
  const lowAtCut = prepare('abc\ude00xyz', small);
  assert.equal(lowAtCut.text, 'abc\ude00[truncated 3 characters]');
  // Units next to the two ranges are not surrogates: U+D7FF and U+E000 are ordinary characters, a low surrogate before
  // a low one and a high surrogate after a high one are no pair.
  for (const [before, after] of [
    ['\ud7ff', '\udc00'],
    ['\ud83d', '\ue000'],
    ['\udc00', '\udc00'],
    ['\ud83d', '\ud83d'],
    ['\ud83d', '\udbff'],
    ['\udbff', '\udbff'],
  ]) {
    const result = prepare(`abc${before}${after}xyz`, small);
    assert.equal(
      result.text,
      `abc${before}[truncated 4 characters]`,
      `${before.charCodeAt(0).toString(16)} ${after.charCodeAt(0).toString(16)}`,
    );
  }
});

test('size cap: the cut is placed in the redacted text, where a redacted secret has changed the length', () => {
  const marker = MASK;
  assert.notEqual(marker.length, KEY.length);
  // In the redacted text the pair straddles the cap; in the stored text it does not.
  const small = createJudgeInput({ maxChars: marker.length + 1 });
  const result = prepare(`${KEY}\u{1F600}tail`, small);
  assert.equal(result.redacted, true);
  assert.equal(result.text, `${marker}[truncated 6 characters]`);
  assert.equal(hasLoneSurrogate(result.text), false);
});

test('deterministic: the same stored answer gives the same result, and the input is not changed', () => {
  const stored = Object.freeze(`${ANSWERS.cases[0].stored}\n${KEY}`);
  assert.deepEqual(prepare(stored), prepare(stored));
  assert.deepEqual(
    prepare(stored),
    createJudgeInput().prepare(stored, { skill: SKILL }),
  );
});

// Pinned: the one provenance hash, for the default options. Any change to a covered rule or setting changes it; bump
// SANITIZER_VERSION when it does. Then update this line.
const PINNED_PROVENANCE_HASH =
  'ec58a8eb851df809376e1defa232b61bc84824ca69568d0a6ae6edc3d6b89987';

test('provenance: version 10, pinned, one value from every path, changed by the cap and the settings, not by per-run literals', () => {
  assert.equal(defaultInput.provenance.sanitizerVersion, 10);
  assert.equal(
    defaultInput.provenance.sanitizerRulesSha256,
    PINNED_PROVENANCE_HASH,
  );
  const hashWithOptions = (options) =>
    createJudgeInput(options).provenance.sanitizerRulesSha256;
  assert.equal(
    hashWithOptions({ literals: ['another-secret-value'] }),
    PINNED_PROVENANCE_HASH,
    'secrets of one run are not part of it',
  );
  assert.equal(
    new Set([
      PINNED_PROVENANCE_HASH,
      hashWithOptions({ maxChars: 100 }),
      hashWithOptions({ settings: { plugin: 'other' } }),
      hashWithOptions({ maxRemovedShare: 0.5 }),
    ]).size,
    4,
  );
  assert.equal(
    createJudgeInput().settings.plugin,
    sanitizer.DEFAULT_SETTINGS.plugin,
  );
  const result = prepare('x');
  assert.deepEqual(
    [result.sanitizer_version, result.rules_sha256],
    [10, PINNED_PROVENANCE_HASH],
  );
});

test('provenance: sanitizerProvenance() and createJudgeInput() report the same value, for the same options, and nothing else exports a hash', () => {
  for (const optionSet of [
    {},
    { maxChars: 100 },
    { maxRemovedShare: 0.5 },
    { settings: { scratchPrefix: 'run' } },
    {
      maxChars: 7,
      maxRemovedShare: 1,
      settings: { plugin: 'x' },
      literals: ['a-secret-value'],
    },
  ]) {
    const { literals, ...options } = optionSet;
    assert.deepEqual(
      sanitizerProvenance(optionSet),
      createJudgeInput(optionSet).provenance,
      JSON.stringify(options),
    );
    assert.equal(
      prepare('x', createJudgeInput(optionSet)).rules_sha256,
      sanitizerProvenance(optionSet).sanitizerRulesSha256,
    );
    assert.equal(
      sanitizerProvenance(optionSet).sanitizerRulesSha256,
      sha256(provenanceParts(optionSet)),
    );
  }
  assert.deepEqual(sanitizerProvenance(), defaultInput.provenance);
  assert.equal(sanitizer.RULES_HASH, undefined);
  assert.equal(sanitizer.sanitizerProvenance, undefined);
  assert.equal(
    sanitizer.createSanitizer().rulesHash,
    undefined,
    'the sanitizer has a spec, not a second hash',
  );
  for (const invalidOptions of [
    { maxChars: 0 },
    { maxRemovedShare: 0 },
    { maxRemovedShare: 1.5 },
    { maxRemovedShare: '0.2' },
  ])
    assert.throws(
      () => sanitizerProvenance(invalidOptions),
      TypeError,
      JSON.stringify(invalidOptions),
    );
});

test('provenance: the hash covers every rule and setting that changes the judge-facing text or eligibility', () => {
  const parts = provenanceParts();
  // The parts are the live source of truth, not copies that can drift.
  assert.deepEqual(parts.sanitizer.name_words, sanitizer.NAME_WORDS);
  assert.deepEqual(parts.sanitizer.skill_words, sanitizer.SKILL_WORDS);
  assert.deepEqual(parts.sanitizer.cue_words, sanitizer.CUE_WORDS);
  assert.deepEqual(parts.sanitizer.path_patterns, sanitizer.PATH_PATTERNS);
  assert.equal(parts.sanitizer.max_input_chars, sanitizer.MAX_INPUT_CHARS);
  assert.match(parts.sanitizer.request_guard, /request/);
  assert.deepEqual(parts.sanitizer.settings, sanitizer.DEFAULT_SETTINGS);
  assert.deepEqual(parts.redactor, {
    shapes: SHAPES.map(([pattern, replacement]) => [pattern.source, pattern.flags, replacement]),
    mask: MASK,
  });
  assert.deepEqual(
    parts.leak_scan.map((entry) => entry[0]),
    judgeInput.LEAK_TABLE.map((entry) => entry.id),
    'leak-scan patterns',
  );
  assert.deepEqual(
    [parts.max_chars, parts.max_removed_share],
    [MAX_ANSWER_CHARS, MAX_REMOVED_SHARE],
  );
  assert.deepEqual(Object.keys(parts).sort(), [
    'leak_scan',
    'leak_scan_wrapped',
    'max_chars',
    'max_removed_share',
    'redactor',
    'sanitizer',
  ]);

  // Change each leaf, one at a time, and the hash changes. A string, number or flag in any part is covered.
  const base = sha256(parts);
  const clone = () => JSON.parse(JSON.stringify(parts));
  let leaves = 0;
  const walk = (node, parentKeys) => {
    for (const [key, value] of Object.entries(node)) {
      if (value !== null && typeof value === 'object')
        walk(value, [...parentKeys, key]);
      else {
        const copy = clone();
        const holder = parentKeys.reduce(
          (object, parentKey) => object[parentKey],
          copy,
        );
        holder[key] =
          typeof value === 'string'
            ? `${value}x`
            : typeof value === 'number'
              ? value + 1
              : !value;
        assert.notEqual(
          sha256(copy),
          base,
          `changing ${[...parentKeys, key].join('.')} left the hash unchanged`,
        );
        leaves += 1;
      }
    }
  };
  walk(parts, []);
  assert.ok(leaves > 100, `only ${leaves} leaves were checked`);

  // Removing or reordering an entry changes it too.
  for (const key of [
    'sanitizer.name_words',
    'sanitizer.skill_words',
    'sanitizer.cue_words',
    'sanitizer.named_words',
    'sanitizer.narrator_words',
    'sanitizer.path_patterns',
    'redactor.shapes',
    'leak_scan',
    'sanitizer.settings.agentPatterns',
  ]) {
    const getList = (root) =>
      key.split('.').reduce((object, part) => object[part], root);
    const dropped = clone();
    getList(dropped).pop();
    const swapped = clone();
    getList(swapped).reverse();
    assert.notEqual(sha256(dropped), base, `${key}: removing an entry`);
    assert.notEqual(sha256(swapped), base, `${key}: reordering`);
  }
  assert.ok(
    !JSON.stringify(parts).includes('literal'),
    'no per-run secret value or field in the parts',
  );
});

// An answer the sanitizer emptied must not reach a judge, whatever is left.
test('removed share: recorded for every answer, and an answer above the limit is not eligible with the percent in the reason', () => {
  const content = 'a'.repeat(47);
  const narration = 'I loaded the skill.'; // 16 non-whitespace characters
  const over = prepare(`${narration} ${content}`);
  assert.deepEqual(
    [over.chars_in, over.removed_chars, over.removed_share],
    [63, 16, 16 / 63],
  );
  assert.deepEqual(
    [over.eligible, over.reason, over.text],
    [false, 'sanitizer removed 25.4% of the answer', content],
  );
  const exact = prepare(`${narration} ${content}a`);
  assert.deepEqual(
    [exact.removed_share, exact.eligible, exact.reason],
    [0.25, true, null],
    'exactly at the limit is allowed',
  );
  assert.deepEqual(exact.removed_by_rule, { 'skill-narration': 16 });
  const ordinary = prepare('A good tester needs one more skill: patience.');
  assert.deepEqual(
    [ordinary.removed_chars, ordinary.removed_share, ordinary.eligible],
    [0, 0, true],
  );
  assert.equal(MAX_REMOVED_SHARE, 0.25);
  assert.equal(defaultInput.maxRemovedShare, 0.25);
});

test('removed share: the limit is a setting; both arms are held to it', () => {
  const answer =
    'I loaded the skill. There is no such skill. Row 1 is the result of the run today.';
  const defaults = prepare(answer);
  assert.deepEqual(
    [defaults.eligible, defaults.reason],
    [
      false,
      `sanitizer removed ${+(defaults.removed_share * 100).toFixed(1)}% of the answer`,
    ],
  );
  const lenient = createJudgeInput({ maxRemovedShare: 0.9 });
  assert.deepEqual(
    [prepare(answer, lenient).eligible, prepare(answer, lenient).reason],
    [true, null],
  );
  const strict = createJudgeInput({ maxRemovedShare: 0.005 });
  assert.equal(
    prepare('I loaded the skill. ' + 'a'.repeat(2000), strict).eligible,
    false,
  );
  // A with-arm and a without-arm answer with the same content and narration of the same size get the same verdict.
  const withArm = prepare('I loaded the skill. ' + 'b'.repeat(40));
  const withoutArm = prepare('There is no such skill ' + 'b'.repeat(40));
  assert.notEqual(withArm.removed_chars, withoutArm.removed_chars);
  assert.equal(withArm.eligible, withoutArm.eligible);
  assert.equal(
    prepare('Skill loaded\n').reason,
    'sanitizing left no answer',
    'nothing left is reported as that, not as a share',
  );
});

// The leak scan uses the same narration pattern as the sanitizer.
test('leak scan: lookup narration is caught on text the sanitizer has not seen, and ordinary uses of the same words are clean', () => {
  for (const line of [
    'No skill set or skill library matches this request.',
    'I checked the skill registry and found nothing.',
  ])
    assert.deepEqual(collectLeakIds(scan(line)), ['skill-word'], line);
  for (const line of [
    'She has a broad skill set.',
    'Write a skill set for the role.',
    'The skill of the team is clear.',
    'A good tester needs one more skill: patience.',
    'Developers need skills in Go and Rust.',
    'Stay within the 3-skill limit.',
    '| Skill | Level |\n|---|---|\n| Go | 4 |',
  ]) {
    assert.deepEqual(scan(line), [], line);
  }
  // The sanitizer removes the narration, so a stored answer never reaches the scan with it.
  assert.deepEqual(
    [
      prepare('No skill set or skill library matches this request.\nRow 1')
        .text,
      prepare('No skill set or skill library matches this request.\nRow 1')
        .leaks,
    ],
    ['Row 1', []],
  );
  // A table row is left alone by the sanitizer and by the scan: a row is structured content.
  const row = prepare(
    '| Flow | Note |\n|---|---|\n| Login | The skill tool is not available |\n' +
      'x'.repeat(200),
  );
  assert.deepEqual([row.eligible, row.leaks], [true, []]);
});

// Probe inputs through createJudgeInput: [stored answer, skill, expected text, eligible].
const PLAN =
  'Row 1 of the plan covers login first, then the cart. Row 2 covers search and filters, and Row 3 covers the account settings page. Run the first two on every commit and the third every night, with one fresh data set for each run so the order of the tests never changes a result.';
const PROBES = [
  [
    'A good tester needs one more skill: patience.',
    SKILL,
    'A good tester needs one more skill: patience.',
    true,
  ],
  [
    'Developers need skills in Go and Rust.',
    SKILL,
    'Developers need skills in Go and Rust.',
    true,
  ],
  [
    'Stay within the 3-skill limit.',
    SKILL,
    'Stay within the 3-skill limit.',
    true,
  ],
  [
    '## Required Skills\nPython and Go.\n## Next',
    SKILL,
    '## Required Skills\nPython and Go.\n## Next',
    true,
  ],
  [
    '| Skill | Level |\n|---|---|\n| Python | 5 |\n| Go | 4 |',
    SKILL,
    '| Skill | Level |\n|---|---|\n| Python | 5 |\n| Go | 4 |',
    true,
  ],
  [
    'Use `skill` as the column name in the table.',
    SKILL,
    'Use `skill` as the column name in the table.',
    true,
  ],
  [
    "I loaded the skill's checklist and followed it.\n" + PLAN,
    SKILL,
    PLAN,
    true,
  ],
  ["Let me read the skill's instructions first.\n" + PLAN, SKILL, PLAN, true],
  ["Loading the skill's checklist...\n" + PLAN, SKILL, PLAN, true],
  [
    'Verification is the last step. Use **verification** early. `verification` too.',
    'verification',
    'Verification is the last step. Use **verification** early. `verification` too.',
    true,
  ],
  [
    '- Verification: run the tests\n- Review: read diffs',
    'verification',
    '- Verification: run the tests\n- Review: read diffs',
    true,
  ],
];
for (const [stored, skill, expected, eligible] of PROBES) {
  test(`probe ${JSON.stringify(stored.slice(0, 50))}`, () => {
    const result = defaultInput.prepare(stored, { skill });
    assert.deepEqual(
      [result.text, result.eligible, result.reason],
      [expected, eligible, null],
    );
  });
}

// A digest of the output for a fixed corpus. The hash covers the patterns; this covers the code that applies them. A
// change that moves behavior fails here even when no pattern changed. Update it, and bump SANITIZER_VERSION, on purpose.
test('behavior digest: a fixed corpus gives the same judge input', () => {
  const corpus = [
    ...RULE_CASES.flatMap((ruleCase) => [
      ...[].concat(ruleCase.hit),
      ...[].concat(ruleCase.keep),
    ]),
    ...ANSWERS.cases.map((answerCase) => answerCase.stored),
    ...Object.values(SKILL_CASES.drop).flat(),
    ...SKILL_CASES.drop_cost,
    ...SKILL_CASES.keep,
    ...SKILL_CASES.miss,
  ];
  const outputs = corpus.map((text) => {
    const result = defaultInput.prepare(text, { skill: SKILL });
    return [
      result.text,
      result.eligible,
      result.reason,
      result.removed_chars,
      result.leaks.map((leak) => leak.id),
    ];
  });
  assert.equal(
    sha256(outputs),
    '2097f00ab3a63a6aa19cdc8a25ff2490259c77590249381d023473b1b9803f4c',
  );
});

// ---- the boundary: what prepare takes, and what reaches a judge
test('prepare needs the skill as a string, and the stored answer as a string, null or undefined', () => {
  assert.throws(
    () => defaultInput.prepare('x'),
    /prepare: options\.skill must be a string/,
  );
  assert.throws(
    () => defaultInput.prepare('x', { skillName: SKILL }),
    /prepare: options\.skill must be a string/,
  );
  assert.throws(
    () => defaultInput.prepare('x', { skill: 5 }),
    /prepare: options\.skill must be a string/,
  );
  assert.equal(defaultInput.prepare('x', { skill: '' }).eligible, true);
  for (const stored of [{}, ['a'], 12])
    assert.throws(
      () => prepare(stored),
      /the stored answer must be a string/,
      JSON.stringify(stored),
    );
  assert.equal(prepare(null).reason, 'sanitizing left no answer');
});

test('scanLeaks needs the settings the text was sanitized with', () => {
  assert.throws(() => scanLeaks('x'), /options\.settings is required/);
});

test('an answer that ends inside an open code fence is not eligible', () => {
  for (const text of ['```\ncode\nRow 1', '~~~\ncode\n```\nRow 1'])
    assert.deepEqual(
      [prepare(text).eligible, prepare(text).reason],
      [false, 'unclosed code fence'],
      text,
    );
  assert.equal(prepare('```\ncode\n```\nRow 1').eligible, true);
});

test('SKILL.md is a skill word: dropped next to a cue word, kept alone, and not a leak by itself', () => {
  const inCode = prepare('```\ncat SKILL.md\n```\nRow 1');
  assert.deepEqual([inCode.eligible, inCode.leaks], [true, []]);
  assert.equal(prepare('Per SKILL.md, rank. Row 1.').text, 'Row 1.');
  assert.equal(
    prepare('The SKILL.md file lists the steps. Row 1.').text,
    'The SKILL.md file lists the steps. Row 1.',
  );
});

test('the skill name written with underscores is found by the leak scan', () => {
  assert.deepEqual(
    collectLeakIds(scan('Use e2e_test_strategy.', { skill: SKILL })),
    ['skill-name'],
  );
});

test('a skill named like a Claude Code bundled skill needs no alias: its name is neutralized in any letter case', () => {
  const result = defaultInput.prepare('Run Code-Review first. Rank.', {
    skill: 'code-review',
  });
  assert.deepEqual(
    [result.text, result.eligible],
    ['Run Code Review first. Rank.', true],
  );
});

test('a whitespace-only answer is not eligible, and a long clean answer is cut once, after redaction', () => {
  assert.deepEqual(
    [prepare('   \n ').eligible, prepare('   \n ').reason],
    [false, 'sanitizing left no answer'],
  );
  const long = prepare('word '.repeat(20000));
  assert.equal(long.redacted, false);
  assert.equal(long.truncated, true);
  assert.match(long.text, /\[truncated 50000 characters\]$/);
});

test('leaks: every match is counted, the sample is the first match, and the reason lists the ids', () => {
  const result = prepare('| tool_use a |\n| tool_result b |\nRow 1');
  assert.deepEqual(result.leaks, [
    { id: 'tool-marker', count: 2, sample: 'tool_use' },
  ]);
  assert.equal(
    result.reason,
    'narration remains after sanitizing: tool-marker',
  );
});

test('no secret reaches any field of the result, a leak sample included: the scan reads the redacted text', () => {
  const literal = 'handed-out-secret-1';
  const input = createJudgeInput({ literals: [literal] });
  for (const secret of [KEY, literal]) {
    const result = input.prepare(`tool_use ${secret}\nRow 1`, {
      skill: SKILL,
    });
    assert.deepEqual(collectLeakIds(result.leaks), ['tool-marker'], secret);
    assert.equal(JSON.stringify(result).includes(secret), false, secret);
  }
});

test('prepare uses its settings for the rules and for the scan', () => {
  const custom = createJudgeInput({
    settings: {
      plugin: 'acme',
      scratchPrefix: 'my.box',
      agentPatterns: ['agent-[a-z]+'],
    },
  });
  assert.equal(
    custom.prepare(
      'Use acme:foo-bar now. Ask agent-smith. See /tmp/my.box-subject-1/x here.\nRow 1',
      {
        skill: '',
      },
    ).text,
    'Use foo bar now. Ask agent smith. See x here.\nRow 1',
  );
  assert.deepEqual(
    collectLeakIds(
      scanLeaks('acme:foo and agent-smith and /my.box-subject-1', {
        settings: custom.settings,
      }),
    ),
    ['agent-id', 'harness-path', 'plugin-name'],
  );
  // The default scan does not know those names.
  assert.deepEqual(scan('acme:foo and agent-smith and /my.box-subject-1'), []);
});

test('ordinary sentences with "guidance" or "skills" and a weak cue word reach the judge, and narration in a table cell or a wrapped line does not', () => {
  const answer = [
    'Harden a new AWS account.',
    'Per AWS guidance, never create access keys for the root user.',
    'Using this guidance, set the bucket policy to deny non-TLS requests.',
    'The role requires skills in Terraform and Python.',
  ].join('\n');
  const kept = prepare(answer);
  assert.deepEqual(
    [kept.text, kept.eligible, kept.removed_chars],
    [answer, true, 0],
  );
  const table = prepare(
    `${answer}\n\n| Note | Detail |\n|---|---|\n| Source | No relevant skill was available, so I answered directly |`,
  );
  assert.deepEqual(
    [table.eligible, table.counts['skill-narration']],
    [true, 1],
  );
  assert.ok(table.text.endsWith('| Source |  |'), table.text);
  const wrapped = prepare(`${answer}\n\nI used the\nskill to answer this.`);
  assert.equal(wrapped.text.trim(), answer);
  assert.equal(wrapped.counts['skill-narration'], 1);
});
