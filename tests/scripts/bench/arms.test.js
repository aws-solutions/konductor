// SPDX-License-Identifier: Apache-2.0
// Tests for the arms builder (scripts/bench/lib/arms.js). They run against the committed fixture repo
// (tests/fixtures/bench/repo) or a skills folder made in a temp dir. No process is started and no model is called.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const arms = require('../../../scripts/bench/lib/arms');
const {
  createLayout,
  CONTROL_SKILLS,
} = require('../../../scripts/bench/lib/layout');
const { AgentSpecError } = require('../../../scripts/bench/lib/skills');
const { sha256, treeSha256 } = require('../../../scripts/bench/lib/provenance');
const helpers = require('./helpers');

const {
  buildArms,
  removeArms,
  stripSkillReferences,
  stripSkillReferencesReport,
  stripDescriptionReport,
  assertOnlyTargetDiffers,
  loadInstruction,
  loadAgentSpec,
  ANSWER_STYLE_RULE,
  ARM_BLINDING_VERSION,
} = arms;

const FIXTURE_ROOT = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'bench',
  'repo',
);
const LAYOUT = createLayout({ root: FIXTURE_ROOT });
const DIRS = { skillsDir: LAYOUT.skillsDir, agentsDir: LAYOUT.agentsDir };
const FIXTURE_SKILLS = ['brew-log', 'pantry-note'];
/** A name layout.js lists as a control skill: isControlSkill accepts no other. */
const [CONTROL] = CONTROL_SKILLS;
const mode = (file) => fs.statSync(file).mode & 0o777;
const parseAgent = (text, agent) => JSON.parse(text)[agent];
/** True when `text` names `skill` (also as bench:<skill>) at a name boundary, in any letter case. */
const mentions = (text, skill) =>
  new RegExp(`(?<![\\w-])(?:bench:)?${skill}(?![\\w-])`, 'i').test(text);

/** buildArms on the fixture repo; the scratch folder is removed after `check` runs. */
function withArms(skill, options, check) {
  const built = buildArms(skill, { ...DIRS, ...options });
  try {
    return check(built);
  } finally {
    removeArms(built);
  }
}

/** A repo in a temp dir: skills/<name>/SKILL.md for each skill and one agent that declares `declared`. */
function makeRepo(
  dir,
  {
    skills,
    declared = skills,
    prompt,
    agent = 'k-developer',
    description = 'Fixture agent.',
  },
) {
  for (const skill of skills) {
    fs.mkdirSync(path.join(dir, 'skills', skill), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'skills', skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: Fixture skill ${skill}.\n---\n\n# ${skill}\n`,
    );
  }
  fs.mkdirSync(path.join(dir, 'agents'), { recursive: true });
  helpers.write(path.join(dir, 'agents', `${agent}.agent-spec.json`), {
    name: agent,
    config: {
      description,
      systemPrompt:
        prompt ??
        declared.map((skill) => `- **${skill}**: a skill.`).join('\n'),
    },
    dependencies: { skills: { skillNames: declared } },
  });
  return {
    skillsDir: path.join(dir, 'skills'),
    agentsDir: path.join(dir, 'agents'),
    tmpRoot: dir,
  };
}

// ---- loadInstruction and the answer-style rule --------------------------------------------------------------------

test('loadInstruction names the plugin-qualified skill and the Skill tool', () => {
  const text = loadInstruction('brew-log');
  assert.match(text, /`bench:brew-log`/);
  assert.match(text, /Skill tool/);
  assert.match(loadInstruction('brew-log', 'other'), /`other:brew-log`/);
});

test('the answer-style rule is one fixed text that names no skill and forbids narrating tools, skills and instructions', () => {
  assert.match(
    ANSWER_STYLE_RULE,
    /tools, skills, plugins, loaded instructions/,
  );
  assert.match(ANSWER_STYLE_RULE, /^\n\n## Answer style\n\n/);
  for (const skill of [...FIXTURE_SKILLS, 'code-review', 'debug', 'bench'])
    assert.ok(!ANSWER_STYLE_RULE.toLowerCase().includes(skill), skill);
  assert.ok(
    Number.isInteger(ARM_BLINDING_VERSION) && ARM_BLINDING_VERSION >= 1,
  );
  assert.equal(ARM_BLINDING_VERSION, 1, 'a bump is a deliberate change');
});

// Both texts are part of every arm's agent definition, so a change to either changes every `agents_json_sha256`.
// A change that makes new answers not comparable with stored ones also bumps ARM_BLINDING_VERSION.
test('the answer-style rule and the load instruction are pinned', () => {
  assert.equal(
    sha256(ANSWER_STYLE_RULE),
    'b6da21b67b6021accf95560e318d2263ddb78bfe3a3a016bb565d3cf00931e86',
  );
  assert.equal(
    sha256(loadInstruction('brew-log')),
    '8574e59b6035565f99c48137a39f0231a2ca5b4fd90d025fa26a4c9ce1667aa8',
  );
  assert.equal(
    sha256(loadInstruction('brew-log', 'other')),
    '36bbca1a4a1076897428bb0faaa6d12e4bcb3c3b146da4c4ee2709b20f5f934b',
  );
});

test('the plugin name and scratch prefix are the ones the sanitizer removes', () => {
  const { DEFAULT_SETTINGS } = require('../../../scripts/bench/lib/sanitize');
  assert.equal(arms.PLUGIN, DEFAULT_SETTINGS.plugin);
  assert.equal(arms.SCRATCH_PREFIX, `${DEFAULT_SETTINGS.scratchPrefix}-arms-`);
});

// ---- stripSkillReferences ------------------------------------------------------------------------------------------

const PROMPT = [
  '# QA Agent',
  '',
  '## Skills Available',
  '',
  '- **test-coverage-analysis**: Analyzes gaps.',
  '- **e2e-test-strategy**: Generates a matrix. Use after coverage analysis.',
  '- **security-test-generation**: Generates security plans.',
  '- **e2e-test-strategy-extra**: another skill with a longer name.',
  '',
  '## Recommended Workflow',
  '',
  '1. `test-coverage-analysis` -> identifies gaps',
  '2. `e2e-test-strategy` -> plans tests',
  '3. `cypress-test-implementation` -> implements tests',
  '',
  '`security-test-generation` and `ui-text-validation` can run independently at any time.',
  'Run `ui-text-validation`, `security-test-generation` any time. Also pre-security-test-generation is untouched.',
].join('\n');

test('stripSkillReferences removes every reference, keeps longer names, keeps list sentences readable, renumbers steps', () => {
  const stripped = stripSkillReferences(PROMPT, 'e2e-test-strategy');
  assert.ok(!/(?<![\w-])e2e-test-strategy(?![\w-])/.test(stripped));
  assert.ok(
    stripped.includes('e2e-test-strategy-extra'),
    'a longer name stays',
  );
  assert.ok(
    stripped.includes('1. `test-coverage-analysis`') &&
      stripped.includes('2. `cypress-test-implementation`'),
    'steps after a removed step are renumbered',
  );
  assert.ok(
    stripped.includes('- **test-coverage-analysis**') &&
      stripped.includes('- **security-test-generation**'),
    'other skills stay',
  );
  const other = stripSkillReferences(PROMPT, 'security-test-generation');
  assert.ok(!/(?<![\w-])security-test-generation(?![\w-])/.test(other));
  assert.ok(
    other.includes('`ui-text-validation` can run independently at any time.'),
    'a leading list entry is cut out of its sentence',
  );
  assert.ok(
    other.includes('Run `ui-text-validation` any time.'),
    'a trailing list entry is cut out of its sentence',
  );
  assert.ok(
    other.includes('pre-security-test-generation'),
    'a longer name that contains the slug stays',
  );
  assert.equal(
    stripSkillReferences('nothing here', 'e2e-test-strategy'),
    'nothing here',
  );
  assert.equal(
    stripSkillReferences(PROMPT, 'git-workflow'),
    PROMPT,
    'a skill the prompt never mentions leaves it unchanged',
  );
  assert.ok(
    !/e2e-test-strategy/i.test(
      stripSkillReferences(
        '`bench:e2e-test-strategy` and **E2E-Test-Strategy** go',
        'e2e-test-strategy',
      ),
    ),
    'plugin-qualified and upper-case forms go too',
  );
});

test('stripSkillReferences renumbers only inside the numbered block that lost an item', () => {
  const text = [
    '1. a',
    '2. `x` step',
    '3. c',
    '',
    'prose',
    '1. d',
    '2. e',
  ].join('\n');
  assert.equal(
    stripSkillReferences(text, 'x'),
    ['1. a', '2. c', '', 'prose', '1. d', '2. e'].join('\n'),
  );
});

test('stripSkillReferences is deterministic and idempotent', () => {
  const once = stripSkillReferences(PROMPT, 'e2e-test-strategy');
  assert.equal(stripSkillReferences(PROMPT, 'e2e-test-strategy'), once);
  assert.equal(
    stripSkillReferences(once, 'e2e-test-strategy'),
    once,
    'idempotent',
  );
});

test('stripSkillReferences treats the slug as text, not as a pattern', () => {
  assert.equal(
    stripSkillReferences('use `a.b` here\nkeep `axb`', 'a.b'),
    'keep `axb`',
  );
});

test('stripSkillReferences cuts a list entry out of its sentence in each form it can take', () => {
  const cases = [
    ['a leading entry with "or"', '`x` or `b` apply', 'x', '`b` apply'],
    [
      'a leading entry in a bullet',
      '- `x` and `b` can run',
      'x',
      '- `b` can run',
    ],
    [
      'a leading entry in a numbered item',
      '1. `x` and `b` can run',
      'x',
      '1. `b` can run',
    ],
    ['a leading entry before a comma', '`x`, `b` can run', 'x', '`b` can run'],
    ['a space before the comma', '`x` , `b` can run', 'x', '`b` can run'],
    ['a trailing entry with "or"', 'Run `b` or `x`.', 'x', 'Run `b`.'],
    ['a trailing entry with "and"', 'Run `b` and `x`.', 'x', 'Run `b`.'],
    ['a trailing entry after a comma', 'Run `b`, `x`.', 'x', 'Run `b`.'],
    ['a bold leading entry', '**x** and `b` can run', 'x', '`b` can run'],
    [
      'a plugin-qualified leading entry',
      '`bench:x` and `b` can run',
      'x',
      '`b` can run',
    ],
    [
      'a trailing entry before a closing bracket',
      'Run (`b` or `x`)',
      'x',
      'Run (`b`)',
    ],
  ];
  for (const [label, input, skill, expected] of cases)
    assert.equal(stripSkillReferences(input, skill), expected, label);
});

test('stripSkillReferences drops a line when a trailing entry is not followed by a word break', () => {
  assert.equal(
    stripSkillReferences('keep\nRun `b` and `x`?\nkeep too', 'x'),
    'keep\nkeep too',
  );
});

test('stripSkillReferences renumbers by the number of steps removed so far', () => {
  assert.equal(
    stripSkillReferences('1. a\n2. `x` one\n3. `x` two\n4. d\n5. e', 'x'),
    '1. a\n2. d\n3. e',
  );
});

test('stripSkillReferences does not take an underscore or hyphen neighbour for the skill', () => {
  assert.equal(
    stripSkillReferences(
      'see my_a-b here\nsee a-b_x here\nuse a-b here',
      'a-b',
    ),
    'see my_a-b here\nsee a-b_x here',
  );
});

test('stripSkillReferences keeps a numbered step whole when its text wraps, and removes the lines under a dropped item', () => {
  assert.equal(
    stripSkillReferences('1. a\n2. `x` step\n3. c\n   wrapped text\n4. d', 'x'),
    '1. a\n2. c\n   wrapped text\n3. d',
  );
  assert.equal(
    stripSkillReferences('1. a\n2. `x` step\n   - detail\n3. c', 'x'),
    '1. a\n2. c',
  );
  assert.equal(
    stripSkillReferences(
      '- **x**: Writes a log entry for a brew,\n  covering time.\n- **b**: other',
      'x',
    ),
    '- **b**: other',
  );
  assert.equal(
    stripSkillReferences(
      'bash "<DIR>/cmux-dispatch.sh" \\\n  --agent k \\\n  --cwd c\nkeep',
      'cmux-dispatch',
    ),
    'keep',
  );
  assert.equal(
    stripSkillReferences('- `x` item\n- other\n', 'x'),
    '- other\n',
    'a line at the same indent is not part of the dropped item',
  );
});

test('stripSkillReferences renumbers only the items at the indent of the numbered block', () => {
  assert.equal(
    stripSkillReferences('1. a\n   1. `x` sub\n   2. s2\n2. b', 'x'),
    '1. a\n   2. s2\n2. b',
  );
  assert.equal(
    stripSkillReferences('1. a\n2. `x` b\n3. c\n   1. s\n   2. t', 'x'),
    '1. a\n2. c\n   1. s\n   2. t',
    'a nested list keeps its numbers',
  );
  assert.equal(
    stripSkillReferences('  1. a\n  2. `x` b\n1. d\n2. `x` e\n3. f', 'x'),
    '  1. a\n1. d\n2. f',
    'a block at a shallower indent counts on its own',
  );
});

test('stripSkillReferences stops renumbering at a blank line', () => {
  assert.equal(
    stripSkillReferences('1. `x` a\n2. b\n\n3. c', 'x'),
    '1. b\n\n3. c',
  );
});

test('stripSkillReferences drops the section under a dropped heading, up to the next heading of the same or a higher level', () => {
  assert.equal(
    stripSkillReferences(
      '### `x`\n\nUse this when you need the log.\n\n### b',
      'x',
    ),
    '### b',
  );
  assert.deepEqual(
    stripSkillReferencesReport(
      '### `x`\n\nUse this when you need the log.\n\n### b',
      'x',
    ).dropped,
    ['### `x`', 'Use this when you need the log.'],
    'blank lines are not listed',
  );
  assert.equal(
    stripSkillReferences(
      '# top\n## `x`\n\ntext\n\n### sub\n\nmore\n\n## next',
      'x',
    ),
    '# top\n## next',
  );
  assert.equal(
    stripSkillReferences(
      '## `x`\n\n```bash\n# a comment, not a heading\nrun\n```\n\ntail\n\n## next',
      'x',
    ),
    '## next',
    'a # line inside a code fence does not end the section',
  );
});

test('stripSkillReferences treats a single-word name as a reference only in markup, qualified, or next to the word skill', () => {
  const dropped = [
    '- **verification**: runs checks',
    'Use `verification` before you finish',
    'Load bench:verification first',
    'Use the verification skill here',
    'Use the skill verification here',
    'Use the Verification Skill here',
  ];
  for (const line of dropped)
    assert.equal(
      stripSkillReferences(`keep\n${line}\nkeep too`, 'verification'),
      'keep\nkeep too',
      line,
    );
  const kept = [
    'If verification fails, re-delegate',
    '## Verification Protocol',
    'verification and review matter',
    'Do not skip verification, or review',
  ];
  for (const line of kept)
    assert.equal(
      stripSkillReferences(`keep\n${line}\nkeep too`, 'verification'),
      `keep\n${line}\nkeep too`,
      line,
    );
  assert.equal(
    stripSkillReferences('keep\nIf verification-free, go\n', 'verification'),
    'keep\nIf verification-free, go\n',
    'a longer name stays',
  );
});

test('a name with a hyphen or underscore is a reference wherever it appears', () => {
  assert.equal(
    stripSkillReferences(
      'keep\nrun test-coverage now\nkeep too',
      'test-coverage',
    ),
    'keep\nkeep too',
  );
  assert.equal(
    stripSkillReferences(
      'keep\nrun test_coverage now\nkeep too',
      'test_coverage',
    ),
    'keep\nkeep too',
  );
});

test('stripSkillReferencesReport lists the lines it dropped and the lines that still mention the name as a word', () => {
  const text = [
    '1. Ask about teams, timelines, and constraints',
    '2. `constraints` -> apply the rules',
    '   - detail under the step',
    '3. Done',
    '- **constraints**: Hard rules.',
  ].join('\n');
  const report = stripSkillReferencesReport(text, 'constraints');
  assert.equal(
    report.text,
    '1. Ask about teams, timelines, and constraints\n2. Done',
  );
  assert.deepEqual(report.dropped, [
    '2. `constraints` -> apply the rules',
    '   - detail under the step',
    '- **constraints**: Hard rules.',
  ]);
  assert.deepEqual(report.loose, [
    '1. Ask about teams, timelines, and constraints',
  ]);
  assert.equal(stripSkillReferences(text, 'constraints'), report.text);
  assert.deepEqual(stripSkillReferencesReport('nothing here', 'x'), {
    text: 'nothing here',
    dropped: [],
    loose: [],
  });
  assert.equal(
    stripSkillReferences('constraints and timelines matter', 'constraints'),
    'constraints and timelines matter',
    'a line that only uses the word is not cut',
  );
});

// ---- loadAgentSpec -------------------------------------------------------------------------------------------------

test('loadAgentSpec reads the declared skills, description and system prompt', () => {
  const spec = loadAgentSpec(LAYOUT.agentsDir, 'k-developer');
  assert.deepEqual(spec.skillNames, FIXTURE_SKILLS);
  assert.match(spec.description, /^Kitchen helper agent/);
  assert.match(spec.prompt, /^# Kitchen helper/);
});

test('loadAgentSpec refuses a spec it cannot use, naming the file', () => {
  const cases = [
    ['{ not json', /k-bad\.agent-spec\.json: cannot be read as JSON/],
    ['[]', /k-bad\.agent-spec\.json: must be an object/],
    [{ config: { description: 'd' } }, /config\.systemPrompt: must be text/],
    [
      { config: { description: 'd', systemPrompt: '  ' } },
      /config\.systemPrompt/,
    ],
    [{ config: { systemPrompt: 'p' } }, /config\.description: must be text/],
    [
      {
        config: { description: 'd', systemPrompt: 'p' },
        dependencies: { skills: { skillNames: ['../x'] } },
      },
      /skillNames: must be a list of skill names/,
    ],
    [
      {
        config: { description: 'd', systemPrompt: 'p' },
        dependencies: { skills: { skillNames: 'brew-log' } },
      },
      /skillNames: must be a list of skill names/,
    ],
    [
      {
        config: { description: 'd', systemPrompt: 'p' },
        dependencies: { skills: { skillNames: ['a', 'a'] } },
      },
      /skillNames: lists a skill twice/,
    ],
  ];
  helpers.withTmp((dir) => {
    for (const [content, pattern] of cases) {
      helpers.write(path.join(dir, 'k-bad.agent-spec.json'), content);
      assert.throws(
        () => loadAgentSpec(dir, 'k-bad'),
        (error) =>
          error instanceof AgentSpecError && pattern.test(error.message),
        String(pattern),
      );
    }
    assert.throws(() => loadAgentSpec(dir, 'k-missing'), { code: 'ENOENT' });
    assert.throws(() => loadAgentSpec(dir, '../k-bad'), TypeError);
  });
});

// ---- buildArms on the fixture repo ---------------------------------------------------------------------------------

test('WITHOUT arm names no target skill; both arms share the style rule; only WITH has the load instruction', () => {
  for (const agent of ['k-developer', 'k-architect']) {
    const declared = loadAgentSpec(LAYOUT.agentsDir, agent);
    for (const skill of declared.skillNames) {
      withArms(skill, { agent, explicitInstruction: true }, (built) => {
        const without = parseAgent(built.agentsJson.without, agent);
        const withArm = parseAgent(built.agentsJson.with, agent);
        assert.ok(
          !mentions(without.prompt, skill),
          `${agent}/${skill}: WITHOUT prompt names the skill`,
        );
        assert.ok(
          !mentions(without.description, skill),
          `${agent}/${skill}: WITHOUT description names the skill`,
        );
        assert.ok(
          !without.prompt.split('\n').some((line) => mentions(line, skill)),
          `${agent}/${skill}: no WITHOUT line names the skill`,
        );
        assert.ok(mentions(withArm.prompt, skill));
        assert.ok(without.prompt.endsWith(ANSWER_STYLE_RULE));
        assert.ok(
          withArm.prompt.endsWith(ANSWER_STYLE_RULE + loadInstruction(skill)),
        );
        assert.equal(withArm.prompt.split(ANSWER_STYLE_RULE).length, 2);
        assert.equal(without.prompt.split(ANSWER_STYLE_RULE).length, 2);
        assert.ok(
          !without.prompt.includes('Skill loading') &&
            !without.prompt.includes('benchmark harness'),
        );
        // The prompts differ only by the removed skill lines and by the load instruction.
        assert.equal(
          without.prompt,
          stripSkillReferences(declared.prompt, skill) + ANSWER_STYLE_RULE,
        );
        assert.equal(
          withArm.prompt,
          declared.prompt + ANSWER_STYLE_RULE + loadInstruction(skill),
        );
        assert.equal(withArm.description, declared.description);
        for (const other of declared.skillNames.filter(
          (name) => name !== skill,
        ))
          assert.equal(
            mentions(without.prompt, other),
            mentions(declared.prompt, other),
            `${agent}/${skill}: WITHOUT must not lose mentions of ${other}`,
          );
      });
    }
  }
});

test('the fixture WITHOUT prompt for brew-log keeps the rest of every list and renumbers the workflow', () => {
  withArms('brew-log', { agent: 'k-developer' }, (built) => {
    const { prompt, description } = parseAgent(
      built.agentsJson.without,
      'k-developer',
    );
    assert.equal(
      prompt,
      [
        '# Kitchen helper',
        '',
        'You help a home cook keep short kitchen records.',
        '',
        '## Skills Available',
        '',
        '- **pantry-note**: Writes a note about what is on a pantry shelf.',
        '- **brew-log-archive**: another skill with a longer name.',
        '',
        '## Recommended Workflow',
        '',
        '1. `pantry-note` -> check what is on the shelf',
        '2. Tidy the counter',
        '',
        '`pantry-note` can run at any time.',
        'Run `pantry-note` any time. A pre-brew-log check is fine too.',
      ].join('\n') + ANSWER_STYLE_RULE,
    );
    assert.equal(
      description,
      'Kitchen helper agent. Pantry notes with pantry-note.',
      'the clause that names the skill goes and the rest of the line stays',
    );
  });
});

test('buildArms reports what it removed from the WITHOUT prompt and description', () => {
  withArms('brew-log', { agent: 'k-developer' }, (built) => {
    assert.deepEqual(built.stripped.description, {
      dropped: ['Writes brew logs with brew-log'],
      loose: [],
    });
    assert.deepEqual(built.stripped.prompt.dropped, [
      '- **brew-log**: Writes a short log entry for a tea or coffee brew.',
      '2. `brew-log` -> record the brew',
    ]);
    assert.deepEqual(built.stripped.prompt.loose, []);
  });
});

test('without an explicit instruction the WITH prompt is the agent prompt plus the style rule', () => {
  withArms('brew-log', { agent: 'k-developer' }, (built) => {
    const spec = loadAgentSpec(LAYOUT.agentsDir, 'k-developer');
    const withArm = parseAgent(built.agentsJson.with, 'k-developer');
    assert.equal(withArm.prompt, spec.prompt + ANSWER_STYLE_RULE);
    assert.equal(built.explicitInstruction, false);
  });
  withArms(
    'brew-log',
    { agent: 'k-developer', explicitInstruction: true },
    (explicit) => {
      withArms('brew-log', { agent: 'k-developer' }, (plain) => {
        assert.equal(
          explicit.agentsJson.without,
          plain.agentsJson.without,
          'the WITHOUT arm never changes',
        );
        assert.notEqual(explicit.agentsJson.with, plain.agentsJson.with);
      });
    },
  );
});

test('the arms hold the same skills except the target, as plugin folders with private modes', () => {
  withArms('brew-log', { agent: 'k-developer' }, (built) => {
    assert.deepEqual(built.skillNames, FIXTURE_SKILLS);
    assert.deepEqual(built.withoutNames, ['pantry-note']);
    assert.deepEqual(
      fs.readdirSync(path.join(built.withDir, 'skills')).sort(),
      FIXTURE_SKILLS,
    );
    assert.deepEqual(fs.readdirSync(path.join(built.withoutDir, 'skills')), [
      'pantry-note',
    ]);
    for (const dir of [built.withDir, built.withoutDir]) {
      assert.deepEqual(
        helpers.readJson(path.join(dir, '.claude-plugin', 'plugin.json')),
        {
          name: 'bench',
          version: '0.0.1',
          description: 'ablation arm',
        },
      );
    }
    assert.equal(
      fs.readFileSync(
        path.join(built.withDir, 'skills', 'brew-log', 'SKILL.md'),
        'utf8',
      ),
      fs.readFileSync(
        path.join(LAYOUT.skillsDir, 'brew-log', 'SKILL.md'),
        'utf8',
      ),
      'a skill is copied byte for byte',
    );
    assert.equal(mode(built.root), 0o700);
    for (const dir of [built.withDir, built.withoutDir])
      for (const folder of [
        dir,
        path.join(dir, '.claude-plugin'),
        path.join(dir, 'skills'),
        path.join(dir, 'skills', 'pantry-note'),
      ])
        assert.equal(mode(folder), 0o700, folder);
    assert.equal(mode(path.join(built.withDir, 'skills', 'brew-log')), 0o700);
    assert.ok(path.basename(built.root).startsWith('bench-arms-brew-log-'));
    assert.equal(
      path.dirname(built.root),
      os.tmpdir(),
      'the system temp folder by default',
    );
    assert.equal(built.plugin, 'bench');
    assert.equal(built.agent, 'k-developer');
  });
});

test('the fixture skills folder is never changed', () => {
  const before = treeSha256(FIXTURE_ROOT);
  withArms(
    'brew-log',
    { agent: 'k-developer', explicitInstruction: true },
    () => {},
  );
  assert.equal(treeSha256(FIXTURE_ROOT), before);
});

test('manifests hash the agent definition and plugin tree, the same for the same input and different per arm', () => {
  withArms('brew-log', { agent: 'k-developer' }, (first) => {
    withArms('brew-log', { agent: 'k-developer' }, (second) => {
      assert.deepEqual(
        first.manifests,
        second.manifests,
        'no path or time in a manifest',
      );
      assert.notEqual(first.root, second.root);
    });
    const { manifests } = first;
    assert.deepEqual(Object.keys(manifests.with).sort(), [
      'agent',
      'agents_json_sha256',
      'arm',
      'plugin_tree_sha256',
    ]);
    assert.equal(manifests.with.arm, 'with');
    assert.equal(manifests.without.arm, 'without');
    assert.notEqual(
      manifests.with.plugin_tree_sha256,
      manifests.without.plugin_tree_sha256,
    );
    assert.notEqual(
      manifests.with.agents_json_sha256,
      manifests.without.agents_json_sha256,
    );
    assert.equal(manifests.with.plugin_tree_sha256, treeSha256(first.withDir));
  });
  withArms(
    'brew-log',
    { agent: 'k-developer', explicitInstruction: true },
    (explicit) => {
      withArms('brew-log', { agent: 'k-developer' }, (plain) => {
        assert.notEqual(
          explicit.manifests.with.agents_json_sha256,
          plain.manifests.with.agents_json_sha256,
        );
        assert.deepEqual(explicit.manifests.without, plain.manifests.without);
      });
    },
  );
});

// ---- bundled names, control skills, refusals -----------------------------------------------------------------------

test('a skill named like a Claude Code bundled skill is installed under its own name, in the WITH arm only, and loaded as bench:<skill>', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, {
      skills: ['code-review', 'brew-log'],
      prompt: '- **code-review**: reviews code.\n- **brew-log**: logs a brew.',
    });
    const built = buildArms('code-review', {
      ...options,
      agent: 'k-developer',
      explicitInstruction: true,
    });
    try {
      assert.deepEqual(
        fs.readdirSync(path.join(built.withDir, 'skills')).sort(),
        ['brew-log', 'code-review'],
      );
      assert.deepEqual(fs.readdirSync(path.join(built.withoutDir, 'skills')), [
        'brew-log',
      ]);
      assert.equal(built.plugin, 'bench');
      assert.equal(
        fs.readFileSync(
          path.join(built.withDir, 'skills', 'code-review', 'SKILL.md'),
          'utf8',
        ),
        fs.readFileSync(
          path.join(dir, 'skills', 'code-review', 'SKILL.md'),
          'utf8',
        ),
        'the skill is copied as it is',
      );
      const withArm = parseAgent(built.agentsJson.with, 'k-developer');
      assert.ok(withArm.prompt.endsWith(loadInstruction('code-review')));
      assert.match(loadInstruction('code-review'), /`bench:code-review`/);
      const without = parseAgent(built.agentsJson.without, 'k-developer');
      assert.ok(!mentions(without.prompt, 'code-review'));
    } finally {
      removeArms(built);
    }
  });
});

test('a control skill the agent does not declare is added to the WITH arm only', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, { skills: ['brew-log'] });
    const controlSkillsDir = path.join(dir, 'controls');
    fs.mkdirSync(path.join(controlSkillsDir, CONTROL), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(controlSkillsDir, CONTROL, 'SKILL.md'),
      `---\nname: ${CONTROL}\n---\n`,
    );
    assert.equal(arms.isControlSkill(CONTROL, controlSkillsDir), true);
    assert.equal(arms.isControlSkill('brew-log', controlSkillsDir), false);
    fs.rmSync(path.join(controlSkillsDir, CONTROL, 'SKILL.md'));
    assert.equal(
      arms.isControlSkill(CONTROL, controlSkillsDir),
      false,
      'a folder without SKILL.md is not a control skill',
    );
    fs.writeFileSync(
      path.join(controlSkillsDir, CONTROL, 'SKILL.md'),
      `---\nname: ${CONTROL}\n---\n`,
    );
    const built = buildArms(CONTROL, {
      ...options,
      controlSkillsDir,
      agent: 'k-developer',
    });
    try {
      assert.deepEqual(built.skillNames, ['brew-log', CONTROL]);
      assert.deepEqual(built.withoutNames, ['brew-log']);
      assert.deepEqual(
        fs.readdirSync(path.join(built.withDir, 'skills')).sort(),
        ['brew-log', CONTROL],
      );
    } finally {
      removeArms(built);
    }
  });
});

test('a folder in the control skills folder that is not a control skill is ignored, never installed in place of a skill', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, { skills: ['brew-log'] });
    const controlSkillsDir = path.join(dir, 'controls');
    fs.mkdirSync(path.join(controlSkillsDir, 'brew-log'), { recursive: true });
    fs.writeFileSync(
      path.join(controlSkillsDir, 'brew-log', 'SKILL.md'),
      '---\nname: brew-log\n---\nA stray copy.\n',
    );
    assert.equal(arms.isControlSkill('brew-log', controlSkillsDir), false);
    assert.equal(
      arms.skillSourceDir('brew-log', {
        skillsDir: options.skillsDir,
        controlSkillsDir,
      }),
      path.join(options.skillsDir, 'brew-log'),
    );
    const built = buildArms('brew-log', {
      ...options,
      controlSkillsDir,
      agent: 'k-developer',
    });
    try {
      assert.doesNotMatch(
        fs.readFileSync(
          path.join(built.withDir, 'skills', 'brew-log', 'SKILL.md'),
          'utf8',
        ),
        /A stray copy/,
      );
    } finally {
      removeArms(built);
    }
    // A name that is not a skill of the agent and not a control is refused, whatever the folder holds.
    fs.mkdirSync(path.join(controlSkillsDir, 'tidy'));
    fs.writeFileSync(
      path.join(controlSkillsDir, 'tidy', 'SKILL.md'),
      '---\nname: tidy\n---\n',
    );
    assert.throws(
      () =>
        buildArms('tidy', {
          ...options,
          controlSkillsDir,
          agent: 'k-developer',
        }),
      /tidy is not declared by k-developer/,
    );
  });
});

test('the default control skills folder is scripts/bench/skills', () => {
  assert.equal(
    arms.CONTROL_SKILLS_DIR,
    path.resolve(__dirname, '..', '..', '..', 'scripts', 'bench', 'skills'),
  );
});

test('a skill the agent does not declare, or that has no SKILL.md, is refused before anything is written', (t) => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, {
      skills: ['brew-log'],
      declared: ['brew-log', 'ghost'],
    });
    const made = t.mock.method(fs, 'mkdtempSync');
    assert.throws(
      () => buildArms('pantry-note', { ...options, agent: 'k-developer' }),
      /pantry-note is not declared by k-developer/,
    );
    assert.throws(
      () => buildArms('brew-log', { ...options, agent: 'k-developer' }),
      /skill ghost has no SKILL\.md/,
    );
    assert.equal(made.mock.callCount(), 0, 'the scratch folder is never made');
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.startsWith('bench-arms-')),
      [],
    );
  });
});

test('a symbolic link inside a skill is refused and leaves no scratch folder', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, { skills: ['brew-log'] });
    fs.writeFileSync(path.join(dir, 'outside.txt'), 'not part of the skill');
    fs.symlinkSync(
      path.join(dir, 'outside.txt'),
      path.join(dir, 'skills', 'brew-log', 'notes.txt'),
    );
    assert.throws(
      () => buildArms('brew-log', { ...options, agent: 'k-developer' }),
      /notes\.txt: only plain files and folders can be installed in an arm/,
    );
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.startsWith('bench-arms-')),
      [],
    );
  });
});

test('a nested folder inside a skill is copied', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, { skills: ['brew-log'] });
    fs.mkdirSync(path.join(dir, 'skills', 'brew-log', 'refs'));
    fs.writeFileSync(
      path.join(dir, 'skills', 'brew-log', 'refs', 'cups.md'),
      'cups',
    );
    const built = buildArms('brew-log', { ...options, agent: 'k-developer' });
    try {
      assert.equal(
        path.dirname(built.root),
        dir,
        'tmpRoot sets where the scratch folder goes',
      );
      assert.equal(
        fs.readFileSync(
          path.join(built.withDir, 'skills', 'brew-log', 'refs', 'cups.md'),
          'utf8',
        ),
        'cups',
      );
      assert.equal(
        mode(path.join(built.withDir, 'skills', 'brew-log', 'refs')),
        0o700,
        'a copied subfolder is private too',
      );
    } finally {
      removeArms(built);
    }
  });
});

test('buildArms refuses unsafe names and missing options', () => {
  assert.throws(
    () => buildArms('../brew-log', { ...DIRS, agent: 'k-developer' }),
    TypeError,
  );
  assert.throws(
    () => buildArms('brew-log', { ...DIRS, agent: '../k-developer' }),
    TypeError,
  );
  assert.throws(
    () => buildArms('brew-log', { ...DIRS }),
    /agent must be a safe name/,
  );
  assert.throws(
    () => buildArms('brew-log', { agent: 'k-developer' }),
    /needs skillsDir and agentsDir/,
  );
  assert.throws(
    () =>
      buildArms('brew-log', {
        ...DIRS,
        agent: 'k-developer',
        explicitInstruction: 'yes',
      }),
    /explicitInstruction must be true or false/,
  );
});

test('removeArms deletes the scratch folder and refuses any other folder', () => {
  const built = buildArms('brew-log', { ...DIRS, agent: 'k-developer' });
  removeArms(built);
  assert.equal(fs.existsSync(built.root), false);
  helpers.withTmp((dir) => {
    assert.throws(
      () => removeArms({ root: dir }),
      /not an arms scratch folder/,
    );
    assert.ok(fs.existsSync(dir));
  });
  assert.throws(
    () => removeArms({ root: 'bench-arms-relative' }),
    /not an arms scratch folder/,
  );
  assert.throws(() => removeArms(null), /not an arms scratch folder: null/);
});

// ---- links, the scratch marker, relative tmpRoot, front matter, the arm check ----------------------------------------

const noScratchFolder = (dir) =>
  assert.deepEqual(
    fs.readdirSync(dir).filter((name) => name.startsWith('bench-arms-')),
    [],
  );

test('a skill folder that is a symbolic link is refused, as a declared skill or as the target, and leaves no scratch folder', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, {
      skills: ['ok'],
      declared: ['evil', 'ok'],
    });
    fs.mkdirSync(path.join(dir, 'real'));
    fs.writeFileSync(
      path.join(dir, 'real', 'SKILL.md'),
      '---\nname: evil\n---\n',
    );
    fs.writeFileSync(path.join(dir, 'real', 'credentials'), 'secret');
    fs.symlinkSync(
      path.join(dir, 'real'),
      path.join(options.skillsDir, 'evil'),
    );
    for (const target of ['ok', 'evil'])
      assert.throws(
        () => buildArms(target, { ...options, agent: 'k-developer' }),
        /evil: a skill folder must be a plain folder, not a link/,
        target,
      );
    noScratchFolder(dir);
  });
});

test('a control skill folder that is a symbolic link is refused', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, { skills: ['brew-log'] });
    const controlSkillsDir = path.join(dir, 'controls');
    fs.mkdirSync(path.join(dir, 'real'));
    fs.writeFileSync(
      path.join(dir, 'real', 'SKILL.md'),
      `---\nname: ${CONTROL}\n---\n`,
    );
    fs.mkdirSync(controlSkillsDir);
    fs.symlinkSync(
      path.join(dir, 'real'),
      path.join(controlSkillsDir, CONTROL),
    );
    assert.throws(
      () =>
        buildArms(CONTROL, {
          ...options,
          controlSkillsDir,
          agent: 'k-developer',
        }),
      new RegExp(
        `${CONTROL}: a skill folder must be a plain folder, not a link`,
      ),
    );
    noScratchFolder(dir);
  });
});

test('a relative tmpRoot gives an absolute scratch folder that removeArms accepts', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, { skills: ['brew-log'] });
    const relative = path.relative(process.cwd(), dir);
    assert.ok(!path.isAbsolute(relative));
    const built = buildArms('brew-log', {
      ...options,
      tmpRoot: relative,
      agent: 'k-developer',
    });
    assert.ok(path.isAbsolute(built.root));
    assert.equal(path.dirname(built.root), dir);
    removeArms(built);
    assert.equal(fs.existsSync(built.root), false);
  });
});

test('removeArms deletes only a folder that holds the marker buildArms writes', () => {
  helpers.withTmp((dir) => {
    const lookAlike = path.join(dir, 'bench-arms-my-notes');
    fs.mkdirSync(lookAlike);
    fs.writeFileSync(path.join(lookAlike, 'notes.txt'), 'mine');
    assert.throws(
      () => removeArms({ root: lookAlike }),
      /not an arms scratch folder/,
    );
    assert.ok(fs.existsSync(path.join(lookAlike, 'notes.txt')));

    // The name rule is checked on its own: a folder that holds the marker but is not named like a scratch folder stays.
    const marked = path.join(dir, 'not-an-arms-folder');
    fs.mkdirSync(marked);
    fs.writeFileSync(path.join(marked, '.bench-arms'), '');
    fs.writeFileSync(path.join(marked, 'keep.txt'), 'mine');
    assert.throws(
      () => removeArms({ root: marked }),
      /not an arms scratch folder/,
    );
    assert.ok(fs.existsSync(path.join(marked, 'keep.txt')));
    const built = buildArms('brew-log', { ...DIRS, agent: 'k-developer' });
    assert.ok(fs.lstatSync(path.join(built.root, '.bench-arms')).isFile());
    assert.equal(
      treeSha256(built.withDir),
      built.manifests.with.plugin_tree_sha256,
      'the marker is outside both arms',
    );
    const link = path.join(dir, 'bench-arms-link');
    fs.symlinkSync(built.root, link);
    assert.throws(
      () => removeArms({ root: link }),
      /not an arms scratch folder/,
    );
    assert.ok(fs.existsSync(built.root), 'a link to a scratch folder stays');
    fs.unlinkSync(link);
    removeArms(built);
    assert.equal(fs.existsSync(built.root), false);
    assert.doesNotThrow(() => removeArms(built), 'already gone is fine');

    const unmarked = buildArms('brew-log', { ...DIRS, agent: 'k-developer' });
    fs.rmSync(path.join(unmarked.root, '.bench-arms'));
    assert.throws(
      () => removeArms(unmarked),
      /not an arms scratch folder/,
      'no marker',
    );
    fs.mkdirSync(path.join(unmarked.root, '.bench-arms'));
    assert.throws(
      () => removeArms(unmarked),
      /not an arms scratch folder/,
      'a folder named like the marker is not the marker',
    );
    assert.ok(fs.existsSync(unmarked.root));
    fs.rmSync(unmarked.root, { recursive: true, force: true });
  });
});

test('assertOnlyTargetDiffers passes for the two arms buildArms made and fails for every other shape', () => {
  const failing = [
    [
      'a skill only the without arm holds',
      (built) =>
        fs.mkdirSync(path.join(built.withoutDir, 'skills', 'extra-skill')),
    ],
    [
      'the target in the without arm',
      (built) =>
        fs.cpSync(
          path.join(built.withDir, 'skills', 'brew-log'),
          path.join(built.withoutDir, 'skills', 'brew-log'),
          { recursive: true },
        ),
    ],
    [
      'the target missing from the with arm',
      (built) =>
        fs.rmSync(path.join(built.withDir, 'skills', 'brew-log'), {
          recursive: true,
        }),
    ],
    [
      'a shared skill missing from the without arm',
      (built) =>
        fs.rmSync(path.join(built.withoutDir, 'skills', 'pantry-note'), {
          recursive: true,
        }),
    ],
    [
      'a shared skill with other bytes',
      (built) =>
        fs.appendFileSync(
          path.join(built.withoutDir, 'skills', 'pantry-note', 'SKILL.md'),
          'x',
        ),
    ],
    [
      'a shared skill with another execute bit',
      (built) =>
        fs.chmodSync(
          path.join(built.withoutDir, 'skills', 'pantry-note', 'SKILL.md'),
          0o755,
        ),
    ],
  ];
  withArms('brew-log', { agent: 'k-developer' }, (built) =>
    assert.doesNotThrow(() =>
      assertOnlyTargetDiffers(built.withDir, built.withoutDir, 'brew-log'),
    ),
  );
  for (const [label, damage] of failing)
    withArms('brew-log', { agent: 'k-developer' }, (built) => {
      damage(built);
      assert.throws(
        () =>
          assertOnlyTargetDiffers(built.withDir, built.withoutDir, 'brew-log'),
        /arm construction check failed/,
        label,
      );
    });
  withArms('brew-log', { agent: 'k-developer' }, (built) =>
    assert.throws(
      () =>
        assertOnlyTargetDiffers(built.withDir, built.withoutDir, 'pantry-note'),
      /arm construction check failed/,
      'the wrong target',
    ),
  );
});

test('buildArms refuses arms that differ by more than the target skill, and removes the scratch folder', (t) => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, { skills: ['brew-log', 'pantry-note'] });
    const copy = fs.copyFileSync;
    t.mock.method(fs, 'copyFileSync', (from, to, ...rest) => {
      copy(from, to, ...rest);
      if (to.includes(`${path.sep}without${path.sep}`))
        fs.appendFileSync(to, 'damage');
    });
    assert.throws(
      () => buildArms('brew-log', { ...options, agent: 'k-developer' }),
      /arm construction check failed: pantry-note differs between the arms/,
    );
    noScratchFolder(dir);
  });
});

test('stripSkillReferences: where a numbered block, a dropped item and a dropped section end', () => {
  for (const [label, input, skill, expected] of [
    [
      'a prose line without a blank line ends the numbered block, so the item after it is not renumbered',
      '1. a\n2. `x` step\nprose\n3. c',
      'x',
      '1. a\nprose\n3. c',
    ],
    [
      'a blank line ends the lines that belong to a dropped item',
      '- `x` item\n  wrapped\n\nplain\n- b',
      'x',
      '\nplain\n- b',
    ],
    [
      'a line that starts like a decimal is not a numbered item, so it is not renumbered',
      '1. a\n2. `x` step\n1.5 half\n3. c',
      'x',
      '1. a\n1.5 half\n3. c',
    ],
    [
      'a line that starts with # and no space is not a heading, so it does not end a dropped section',
      '## Tools for `x`\nline\n#hashtag text\n## Other\nkept',
      'x',
      '## Other\nkept',
    ],
    [
      'a heading of the same level ends a dropped section',
      '## Tools for `x`\nline\n## Other\nkept',
      'x',
      '## Other\nkept',
    ],
  ])
    assert.equal(stripSkillReferences(input, skill), expected, label);
});

test('stripSkillReferences: forms it does not follow are pinned, so a change to them is deliberate', () => {
  // A wrapped line that is not indented under a dropped bullet stays, and so does an indented paragraph after a
  // blank line below a dropped item. Neither occurs in the 159 agent and skill pairs of the real specs.
  assert.equal(
    stripSkillReferences('- **x**: a,\ncovering time.\n- **b**', 'x'),
    'covering time.\n- **b**',
  );
  assert.equal(
    stripSkillReferences('- `x` item\n\n  indented after blank\n- b', 'x'),
    '\n  indented after blank\n- b',
  );
});

test('buildArms lists the lines that use a one-word skill name as an ordinary word', () => {
  helpers.withTmp((dir) => {
    const options = makeRepo(dir, {
      skills: ['verification', 'pantry-note'],
      prompt:
        '- **pantry-note**: a skill.\nAlways run a verification before you answer.\nUse `verification` for the checks.',
    });
    const built = buildArms('verification', {
      ...options,
      agent: 'k-developer',
    });
    try {
      assert.deepEqual(built.stripped.prompt.dropped, [
        'Use `verification` for the checks.',
      ]);
      assert.deepEqual(built.stripped.prompt.loose, [
        'Always run a verification before you answer.',
      ]);
    } finally {
      removeArms(built);
    }
  });
});

test('skillSourceDir refuses a skill name that is not a safe name', () => {
  for (const bad of ['../x', 'a/b', '', '.hidden', 'x'.repeat(200), 'a b'])
    assert.throws(
      () => arms.skillSourceDir(bad, DIRS),
      TypeError,
      JSON.stringify(bad),
    );
});

// ---- A description that names the skill keeps what does not ---------------------------------------------------------

test('stripDescriptionReport cuts the clause that names the skill, not the whole description', () => {
  const strip = (text, skill = 'brew-log') =>
    stripDescriptionReport(text, skill);
  // The one-line fixture description: the first clause goes, the second stays, capitalized.
  assert.deepEqual(
    strip('Writes brew logs with brew-log and pantry notes with pantry-note.'),
    {
      text: 'Pantry notes with pantry-note.',
      dropped: ['Writes brew logs with brew-log'],
      loose: [],
    },
  );
  // The last clause goes: the sentence keeps its closing mark.
  assert.equal(
    strip(
      'Writes brew logs with brew-log and pantry notes with pantry-note.',
      'pantry-note',
    ).text,
    'Writes brew logs with brew-log.',
  );
  // Other sentences stay; a sentence with nothing left goes with its whitespace.
  assert.equal(
    strip('Kitchen helper. Runs brew-log. Does the dishes!').text,
    'Kitchen helper. Does the dishes!',
  );
  assert.equal(strip('Runs brew-log. Kitchen helper.').text, 'Kitchen helper.');
  // Commas and "and" around a cut clause do not double up.
  assert.equal(
    strip('Plans, then runs brew-log, and tidies up.').text,
    'Plans, and tidies up.',
  );
  assert.equal(strip('A, B, and runs brew-log.').text, 'A, B.');
  assert.equal(strip('Runs brew-log; plans the day!').text, 'Plans the day!');
  // "or" and "but" end a clause too, and a comma before the word is not part of the removed text.
  assert.equal(strip('Does X with brew-log or Y. Does Z.').text, 'Y. Does Z.');
  assert.equal(strip('Runs brew-log but not the rest.').text, 'Not the rest.');
  assert.deepEqual(strip('A, B with brew-log, and C.'), {
    text: 'A, and C.',
    dropped: ['B with brew-log'],
    loose: [],
  });
  // A sentence that began in lower case stays in lower case; a trailing comma goes with the cut last clause.
  assert.equal(strip('runs brew-log and writes notes.').text, 'writes notes.');
  assert.equal(strip('A, B, runs brew-log.').text, 'A, B.');
  assert.deepEqual(strip('  Runs brew-log and x.').dropped, ['Runs brew-log']);
  // A clause that is kept and still uses a spaced name as plain words is listed as loose.
  assert.deepEqual(
    stripDescriptionReport(
      'Use Test Coverage Analysis, and do a test coverage analysis.',
      'test-coverage-analysis',
    ),
    {
      text: 'Do a test coverage analysis.',
      dropped: ['Use Test Coverage Analysis'],
      loose: ['Do a test coverage analysis.'],
    },
  );
  // Nothing left, nothing to cut, and a description with no name are told apart.
  assert.equal(strip('Runs brew-log.').text, '');
  assert.deepEqual(strip('Kitchen helper.'), {
    text: 'Kitchen helper.',
    dropped: [],
    loose: [],
  });
  assert.equal(strip('').text, '');
  assert.deepEqual(
    strip('Checks for a pre-brew-log step.'),
    { text: 'Checks for a pre-brew-log step.', dropped: [], loose: [] },
    'a longer name stays',
  );
  assert.equal(
    strip('Use bench:brew-log first, then relax.').text,
    'Then relax.',
    'plugin-qualified',
  );
});

test('a one-line description that names the skill is cut, not emptied, and the without arm keeps the rest', () => {
  helpers.withTmp((dir) => {
    const repo = makeRepo(dir, {
      skills: ['brew-log', 'pantry-note'],
      description:
        'Writes brew logs with brew-log and pantry notes with pantry-note.',
    });
    const built = buildArms('brew-log', { ...repo, agent: 'k-developer' });
    try {
      const without = parseAgent(built.agentsJson.without, 'k-developer');
      const withArm = parseAgent(built.agentsJson.with, 'k-developer');
      assert.equal(without.description, 'Pantry notes with pantry-note.');
      assert.equal(
        withArm.description,
        'Writes brew logs with brew-log and pantry notes with pantry-note.',
      );
      assert.deepEqual(built.stripped.description.dropped, [
        'Writes brew logs with brew-log',
      ]);
    } finally {
      removeArms(built);
    }
  });
});

test('a description that names the skill in every clause is refused, naming the agent and the file, and leaves no scratch folder', () => {
  helpers.withTmp((dir) => {
    const repo = makeRepo(dir, {
      skills: ['brew-log'],
      description: 'Writes brew logs with brew-log. Runs brew-log daily.',
    });
    assert.throws(
      () => buildArms('brew-log', { ...repo, agent: 'k-developer' }),
      (error) =>
        error instanceof AgentSpecError &&
        /k-developer\.agent-spec\.json/.test(error.message) &&
        /config\.description/.test(error.message) &&
        /without arm of k-developer would have no description/.test(
          error.message,
        ),
    );
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.startsWith('bench-arms-')),
      [],
    );
  });
});

test('an empty description is allowed, and stays empty in both arms', () => {
  helpers.withTmp((dir) => {
    const repo = makeRepo(dir, {
      skills: ['brew-log', 'pantry-note'],
      description: '',
    });
    const built = buildArms('brew-log', { ...repo, agent: 'k-developer' });
    try {
      for (const arm of ['with', 'without'])
        assert.equal(
          parseAgent(built.agentsJson[arm], 'k-developer').description,
          '',
        );
    } finally {
      removeArms(built);
    }
  });
});

// ---- Blinding finds the spaced and Title Case forms of a several-word name -------------------------------------------

test('a several-word name is also found spaced, in Title Case or capitals, and in any mix of separators', () => {
  const skill = 'test-coverage-analysis';
  const dropped = [
    '- **Test Coverage Analysis**: finds gaps',
    'Use `test coverage analysis` before you finish',
    'Use the test coverage analysis skill here',
    'Use the skill test coverage analysis here',
    'Run a Test Coverage Analysis of the diff',
    'Run the TEST COVERAGE ANALYSIS',
    'Run the E2E Test Coverage Analysis',
    'Load bench:test coverage analysis first',
    'run test_coverage_analysis now',
    'run Test_Coverage_Analysis now',
    'run test-coverage-analysis now',
    'run test-coverage_analysis now',
  ];
  for (const line of dropped)
    assert.equal(
      stripSkillReferences(`keep\n${line}\nkeep too`, skill),
      'keep\nkeep too',
      line,
    );
  // A plain lowercase phrase is an everyday phrase: kept, and listed as loose.
  const plain = 'Please run a test coverage analysis of the diff.';
  assert.deepEqual(
    stripSkillReferencesReport(`keep\n${plain}\nkeep too`, skill),
    { text: `keep\n${plain}\nkeep too`, dropped: [], loose: [plain] },
  );
  // A longer name or a name with another word between stays.
  for (const line of [
    'a pre-test-coverage-analysis step',
    'test coverage analysis-tool',
    'Test Coverage and Analysis',
    'Test Coverage Analyses',
  ])
    assert.deepEqual(
      stripSkillReferencesReport(`keep\n${line}\nkeep too`, skill).dropped,
      [],
      line,
    );
  // The section under a dropped Title Case heading goes with it.
  assert.equal(
    stripSkillReferences(
      '# Tools\n## Test Coverage Analysis\ndetails\n## Other\nstays',
      skill,
    ),
    '# Tools\n## Other\nstays',
  );
});

test('a spaced name is cut out of a list entry like the slug is, and listed as loose when kept', () => {
  assert.equal(
    stripSkillReferences(
      '`Test Coverage Analysis` and `lint` can run.',
      'test-coverage-analysis',
    ),
    '`lint` can run.',
  );
  assert.equal(
    stripDescriptionReport(
      'Finds gaps with Test Coverage Analysis and writes plans.',
      'test-coverage-analysis',
    ).text,
    'Writes plans.',
  );
  const loose = stripDescriptionReport(
    'Does a test coverage analysis of the code.',
    'test-coverage-analysis',
  );
  assert.deepEqual(loose.dropped, []);
  assert.deepEqual(loose.loose, ['Does a test coverage analysis of the code.']);
});

test('buildArms lists a prompt line that uses a several-word name as plain words in stripped.loose', () => {
  helpers.withTmp((dir) => {
    const repo = makeRepo(dir, {
      skills: ['test-coverage-analysis', 'lint'],
      prompt:
        '- **test-coverage-analysis**: finds gaps\n- **lint**: lints\nPlease run a test coverage analysis of the diff.\nOpen the Test Coverage Analysis heading.',
    });
    const built = buildArms('test-coverage-analysis', {
      ...repo,
      agent: 'k-developer',
    });
    try {
      const without = parseAgent(built.agentsJson.without, 'k-developer');
      assert.equal(
        without.prompt,
        '- **lint**: lints\nPlease run a test coverage analysis of the diff.' +
          ANSWER_STYLE_RULE,
      );
      assert.deepEqual(built.stripped.prompt.dropped, [
        '- **test-coverage-analysis**: finds gaps',
        'Open the Test Coverage Analysis heading.',
      ]);
      assert.deepEqual(built.stripped.prompt.loose, [
        'Please run a test coverage analysis of the diff.',
      ]);
    } finally {
      removeArms(built);
    }
  });
});
