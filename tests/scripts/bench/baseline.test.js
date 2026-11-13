// SPDX-License-Identifier: Apache-2.0
// Tests for the committed fixture skill, the baseline loader and agent selection (scripts/bench/lib/baseline.js
// and skills.js). They read tests/fixtures/bench/ or copies of it, never run output.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const formats = require('../../../scripts/bench/lib/formats');
const provenance = require('../../../scripts/bench/lib/provenance');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const {
  loadBaseline,
  loadExclusions,
  exclusionsFor,
  knownTaskIds,
  unmatchedExclusions,
} = require('../../../scripts/bench/lib/baseline');
const {
  listSkills,
  declaringAgents,
  resolveAgent,
  AgentSpecError,
} = require('../../../scripts/bench/lib/skills');
const helpers = require('./helpers');

const SKILL = helpers.SKILL;

test('the fixture: every committed file passes its validator, the hashes chain, and it has a dropped, a style and a generic rule', () => {
  const layout = createLayout({ root: helpers.fixtureRoot() });
  const rules = formats.loadChecked('rules', layout.rulesFile(SKILL), {
    skill: SKILL,
    skillMd: fs.readFileSync(layout.skillMd(SKILL), 'utf8'),
  });
  const tasks = formats.loadChecked('tasks', layout.tasksFile(SKILL, 'b1'), {
    skill: SKILL,
    batch: 'b1',
    rules: rules.data,
  });
  formats.loadChecked('buckets', layout.bucketsFile(SKILL, 'b1'), {
    rules: rules.data,
    tasks: tasks.data,
  });
  formats.loadChecked('exclusions', layout.exclusionsFile);
  assert.deepEqual(
    rules.warnings,
    [],
    'there is a generic rule, so no guard warning',
  );
  assert.equal(tasks.data.scenarios.length, 5);
  assert.equal(
    rules.data.skill_md_sha256,
    provenance.fileSha256(layout.skillMd(SKILL)),
  );
  assert.equal(
    tasks.data.rules_sha256,
    provenance.fileSha256(layout.rulesFile(SKILL)),
  );
  assert.deepEqual(
    Object.values(helpers.readJson(layout.bucketsFile(SKILL, 'b1')).rules).map(
      (rule) => rule.kept,
    ),
    [true, true, true, true, true, false],
  );
  assert.deepEqual(
    [...new Set(rules.data.rules.map((rule) => rule.class))].sort(),
    ['generic', 'style', 'useful'],
  );
});

test('the fixture holds no secret-looking value, home path or 12-digit number', () => {
  const files = fs
    .readdirSync(helpers.FIXTURE_DIR, { recursive: true })
    .map((relativePath) => path.join(helpers.FIXTURE_DIR, relativePath))
    .filter((fullPath) => fs.statSync(fullPath).isFile());
  assert.ok(
    files.length >= 8,
    `expected the fixture files, found ${files.length}`,
  );
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      /(^|[^0-9A-Za-z])\d{12}([^0-9A-Za-z]|$)/,
      `${file}: 12-digit number`,
    );
    assert.doesNotMatch(
      text,
      /AKIA[0-9A-Z]{16}|\/Users\/|\/home\/[a-z]|BEGIN [A-Z ]*PRIVATE KEY/,
      `${file}: credential or home path`,
    );
  }
});

// [name, damage to a copy of the fixture, expected]. Expected: rulesStale, the batch's stale flag, or regexes for `problems`.
const CASES = [
  ['an untouched fixture is ready', () => {}, {}],
  [
    'a changed SKILL.md makes the rules stale, not invalid',
    (layout) => fs.appendFileSync(layout.skillMd(SKILL), '\nA new line.\n'),
    { rulesStale: true },
  ],
  [
    'a SKILL.md without the old quotes is stale, not invalid',
    (layout) =>
      helpers.write(
        layout.skillMd(SKILL),
        '# Rewritten\n\nNothing of the old rules remains.\n',
      ),
    { rulesStale: true },
  ],
  [
    'a changed rules file makes the batch stale',
    (layout) => fs.appendFileSync(layout.rulesFile(SKILL), '\n'),
    { stale: true },
  ],
  [
    'a quote that is not in an unchanged SKILL.md is a problem',
    (layout) =>
      helpers.update(
        layout.rulesFile(SKILL),
        (rulesDocument) =>
          (rulesDocument.rules[0].source_quote = 'Not in SKILL.md.'),
      ),
    {
      problems: [
        /rules\.json: rules\[0\]\.source_quote: does not appear in SKILL\.md/,
      ],
    },
  ],
  [
    'invalid and missing files are listed by file name',
    (layout) => (
      helpers.update(layout.tasksFile(SKILL, 'b1'), (tasksDocument) =>
        tasksDocument.scenarios.pop(),
      ),
      fs.unlinkSync(layout.bucketsFile(SKILL, 'b1'))
    ),
    {
      problems: [
        /tasks-b1\.json: scenarios: needs at least 5 entries, got 4/,
        /tasks-b1\.buckets\.json: file is missing/,
      ],
    },
  ],
  [
    'a sidecar that disagrees with its task file is a problem',
    (layout) =>
      helpers.update(
        layout.bucketsFile(SKILL, 'b1'),
        (bucketsDocument) =>
          delete bucketsDocument.scenarios['brew-log-rules-2']['5'],
      ),
    { problems: [/brew-log-rules-2: has 4 items, the rubric has 5/] },
  ],
  [
    'rules with no task file at all is a problem that names the skill',
    (layout) => {
      fs.unlinkSync(layout.tasksFile(SKILL, 'b1'));
      fs.unlinkSync(layout.bucketsFile(SKILL, 'b1'));
    },
    {
      problems: [
        /tasks-<batch>\.json: no task file for skill "brew-log"; rules\.json is there but there are no tasks to run/,
      ],
    },
  ],
  [
    'a prompt that names the skill is a problem',
    (layout) =>
      helpers.update(
        layout.tasksFile(SKILL, 'b1'),
        (tasksDocument) =>
          (tasksDocument.scenarios[0].prompt += ' Use the brew-log skill.'),
      ),
    { problems: [/names "brew-log"/] },
  ],
];
for (const [
  name,
  damage,
  { rulesStale = false, stale = false, problems = [] },
] of CASES) {
  test(`loadBaseline: ${name}`, () => {
    helpers.withFixtureCopy((dir, layout) => {
      damage(layout);
      const baseline = loadBaseline(layout, SKILL);
      assert.deepEqual(
        [baseline.hasBaseline, baseline.rulesStale],
        [true, rulesStale],
      );
      for (const pattern of problems)
        assert.match(baseline.problems.join('\n'), pattern);
      if (!problems.length)
        assert.deepEqual(
          [
            baseline.problems,
            baseline.batches.map((batchEntry) => [
              batchEntry.batch,
              batchEntry.stale,
              batchEntry.tasks.scenarios.length,
            ]),
          ],
          [[], [['b1', stale, 5]]],
        );
    });
  });
}

test('loadBaseline: a skill with no baseline folder says so; listSkills finds the folders with a SKILL.md', () => {
  const layout = createLayout({ root: helpers.fixtureRoot() });
  const baseline = loadBaseline(layout, 'pantry-note');
  assert.deepEqual(
    [baseline.hasBaseline, baseline.problems, listSkills(layout.skillsDir)],
    [false, [], ['brew-log', 'pantry-note']],
  );
});

test('exclusions: loaded from the committed file, empty when absent, invalid when wrong; ids split by batch', () => {
  helpers.withFixtureCopy((dir, layout) => {
    const exclusions = loadExclusions(layout);
    const taskIds = [
      'brew-log-rules-1',
      'brew-log-rules-2',
      'brew-log-rules-3',
    ];
    assert.deepEqual(
      [...exclusionsFor(exclusions, 'b1', taskIds).excluded],
      ['brew-log-rules-3'],
    );
    assert.equal(
      exclusionsFor(exclusions, 'b2', taskIds).excluded.size,
      0,
      'a decision applies only to the batch it sits under',
    );
    const known = knownTaskIds(layout);
    assert.deepEqual(unmatchedExclusions(exclusions, 'b1', known), [
      'brew-log-rules-9',
    ]);
    assert.deepEqual(unmatchedExclusions(exclusions, 'b2', known), []);
    fs.unlinkSync(layout.exclusionsFile);
    assert.deepEqual(loadExclusions(layout), {
      format_version: 1,
      batches: {},
    });
    helpers.write(
      layout.exclusionsFile,
      helpers.edit(helpers.goodExclusions(), 'batches.b1.scenarios.0.scales', [
        'items',
      ]),
    );
    assert.throws(() => loadExclusions(layout), formats.FormatError);
  });
});

// Batch names are shared by every skill, so "unmatched" is decided against the tasks of all skills with a baseline.
test("unmatched exclusions: a record for another skill's task is not unmatched; one that names no task anywhere is", () => {
  helpers.withFixtureCopy((dir, layout) => {
    const addSkillBaseline = (
      skill,
      taskIdsOrRawText,
      file = 'tasks-b1.json',
    ) => {
      fs.mkdirSync(layout.baselineDir(skill), { recursive: true });
      helpers.write(
        path.join(layout.baselineDir(skill), file),
        typeof taskIdsOrRawText === 'string'
          ? taskIdsOrRawText
          : { scenarios: taskIdsOrRawText.map((id) => ({ id })) },
      );
    };
    addSkillBaseline('other-skill', [
      'other-skill-rules-1',
      'other-skill-rules-2',
    ]);
    addSkillBaseline('other-skill', ['other-skill-rules-7'], 'tasks-b2.json');
    addSkillBaseline('broken-skill', '{ not json');
    addSkillBaseline('empty-skill', 'null');
    fs.mkdirSync(layout.baselinesDir, { recursive: true });
    fs.mkdirSync(path.join(layout.baselinesDir, '-bad name'), {
      recursive: true,
    });
    helpers.write(layout.manifestFile, {});

    const known = knownTaskIds(layout);
    assert.deepEqual([...known.keys()].sort(), ['b1', 'b2']);
    assert.deepEqual([...known.get('b1')].sort(), [
      'brew-log-rules-1',
      'brew-log-rules-2',
      'brew-log-rules-3',
      'brew-log-rules-4',
      'brew-log-rules-5',
      'other-skill-rules-1',
      'other-skill-rules-2',
    ]);
    assert.deepEqual([...known.get('b2')], ['other-skill-rules-7']);

    const exclusions = helpers.edit(
      helpers.goodExclusions(),
      'batches.b1.scenarios',
      ['brew-log-rules-3', 'other-skill-rules-2', 'nobody-rules-1'].map(
        (id) => ({
          id,
          scales: ['outcome'],
          reason: 'the writer exceeded the item limit twice',
          date: '2026-01-16',
        }),
      ),
    );
    assert.deepEqual(unmatchedExclusions(exclusions, 'b1', known), [
      'nobody-rules-1',
    ]);
    assert.deepEqual(
      unmatchedExclusions(
        { batches: { b2: exclusions.batches.b1 } },
        'b2',
        known,
      ),
      ['brew-log-rules-3', 'other-skill-rules-2', 'nobody-rules-1'],
      'ids are looked up in the same batch only',
    );
    assert.deepEqual(
      unmatchedExclusions(exclusions, 'constructor', known),
      [],
      'a batch name that is an Object.prototype name has no records',
    );
    assert.deepEqual(unmatchedExclusions(exclusions, 'b9', new Map()), []);
    assert.equal(
      knownTaskIds(createLayout({ root: path.join(dir, 'absent') })).size,
      0,
      'no baselines folder, no known tasks',
    );
  });
});

test('agent selection: the only declarer, then k-developer, then the first by name', () => {
  helpers.withTmp((dir) => {
    const writeAgentSpec = (name, skillNames) =>
      helpers.write(path.join(dir, `${name}.agent-spec.json`), {
        dependencies: { skills: { skillNames } },
      });
    writeAgentSpec('k-zeta', ['alone', 'tie', 'tie-no-dev']);
    writeAgentSpec('k-alpha', ['tie-no-dev']);
    writeAgentSpec('k-developer', ['tie']);
    writeAgentSpec('k-beta', ['tie-no-dev']);
    helpers.write(path.join(dir, 'empty.agent-spec.json'), {});
    helpers.write(path.join(dir, 'notes.txt'), 'ignored');
    const pickAgent = (skill) => resolveAgent(skill, { agentsDir: dir });
    assert.equal(pickAgent('alone').agent, 'k-zeta');
    assert.deepEqual(
      [pickAgent('tie').agent, pickAgent('tie-no-dev').agent],
      ['k-developer', 'k-alpha'],
    );
    assert.match(pickAgent('tie').why, /2 declare it/);
    assert.match(pickAgent('tie-no-dev').why, /first by name/);
    assert.deepEqual(pickAgent('nobody'), {
      agent: null,
      why: 'no agent declares it',
    });
    // resolveAgent reads only the agent specs: an agentFor option is ignored.
    assert.deepEqual(
      resolveAgent('tie', { agentsDir: dir, agentFor: { tie: 'k-zeta' } }),
      { agent: 'k-developer', why: '2 declare it, k-developer preferred' },
    );
    assert.deepEqual(declaringAgents('tie-no-dev', dir), [
      'k-alpha',
      'k-beta',
      'k-zeta',
    ]);
    assert.deepEqual(declaringAgents('alone', path.join(dir, 'absent')), []);
  });
});

// A spec that cannot be read must not quietly declare nothing: the plan would pick another agent, or say "no agent", and exit 0.
const BOM = '\uFEFF';
const GOOD_SPEC = JSON.stringify({
  dependencies: { skills: { skillNames: ['alone'] } },
});
const BAD_SPECS = [
  [
    'text that is not JSON',
    '{ not json',
    /broken\.agent-spec\.json: cannot be read as JSON/,
  ],
  [
    'a key used twice',
    '{ "name": "a", "name": "b" }',
    /broken\.agent-spec\.json: has the key "name" twice/,
  ],
  [
    'a top level that is not an object',
    '[]',
    /broken\.agent-spec\.json: must be an object/,
  ],
  [
    'skillNames that is not a list of names',
    '{ "dependencies": { "skills": { "skillNames": "alone" } } }',
    /broken\.agent-spec\.json: dependencies\.skills\.skillNames: must be a list of skill names/,
  ],
  [
    'skillNames with a non-text entry',
    '{ "dependencies": { "skills": { "skillNames": ["alone", 7] } } }',
    /broken\.agent-spec\.json: dependencies\.skills\.skillNames: must be a list of skill names/,
  ],
];
for (const [name, text, expectedMessage] of BAD_SPECS) {
  test(`agent selection: a spec with ${name} is an error that names the file, not a spec that declares nothing`, () => {
    helpers.withTmp((dir) => {
      helpers.write(path.join(dir, 'k-good.agent-spec.json'), GOOD_SPEC);
      helpers.write(path.join(dir, 'broken.agent-spec.json'), text);
      for (const pick of [
        () => declaringAgents('alone', dir),
        () => resolveAgent('alone', { agentsDir: dir }),
      ])
        assert.throws(
          pick,
          (error) =>
            error instanceof AgentSpecError &&
            error.file === path.join(dir, 'broken.agent-spec.json') &&
            expectedMessage.test(error.message),
        );
    });
  });
}

test('agent selection: specs are read in name order whatever order the folder is listed in, so the same broken spec is always the one reported', (t) => {
  helpers.withTmp((dir) => {
    for (const name of ['k-zeta', 'k-alpha', 'k-mid'])
      helpers.write(path.join(dir, `${name}.agent-spec.json`), '{ not json');
    // ext4 lists in hash order and APFS in name order, so list them in the order that would pick the wrong spec.
    const listing = t.mock.method(fs, 'readdirSync', () => [
      'k-zeta.agent-spec.json',
      'k-mid.agent-spec.json',
      'k-alpha.agent-spec.json',
    ]);
    try {
      assert.throws(
        () => declaringAgents('alone', dir),
        (error) =>
          error instanceof AgentSpecError &&
          error.file === path.join(dir, 'k-alpha.agent-spec.json'),
      );
    } finally {
      listing.mock.restore(); // the cleanup of the temp folder must not see the fake listing
    }
  });
  // The result is sorted by agent name, not by file name ("a-b.agent-spec.json" sorts before "a.agent-spec.json").
  helpers.withTmp((dir) => {
    for (const name of ['a', 'a-b'])
      helpers.write(path.join(dir, `${name}.agent-spec.json`), GOOD_SPEC);
    assert.deepEqual(declaringAgents('alone', dir), ['a', 'a-b']);
  });
});

test('agent selection: a spec that starts with a byte order mark still declares its skills', () => {
  helpers.withTmp((dir) => {
    helpers.write(path.join(dir, 'k-marked.agent-spec.json'), BOM + GOOD_SPEC);
    assert.deepEqual(declaringAgents('alone', dir), ['k-marked']);
  });
});

test('agent selection: a spec that cannot be read is the system error, so the driver exits 74 and not 0', () => {
  helpers.withTmp((dir) => {
    // A folder where a spec should be a file fails the same way an unreadable file does, and needs no permissions.
    const folder = path.join(dir, 'k-folder.agent-spec.json');
    fs.mkdirSync(folder);
    assert.throws(
      () => declaringAgents('alone', dir),
      (error) =>
        !(error instanceof AgentSpecError) &&
        error.code === 'EISDIR' &&
        error.path === folder,
    );
  });
});
