// SPDX-License-Identifier: Apache-2.0
// Tests for runner profiles and the subject flags (scripts/bench/lib/runner.js): load mode, tool grants, the
// profile digest and the Claude Code argument list. No process is started and no model is called.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const runner = require('../../../scripts/bench/lib/runner');
const runnerPath = require.resolve('../../../scripts/bench/lib/runner');
const { buildArms, removeArms } = require('../../../scripts/bench/lib/arms');
const { exampleConfig } = require('./helpers');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const {
  subjectSettings,
} = require('../../../scripts/bench/lib/subject-isolation');

const {
  specProblems,
  UNSAFE_BASH_COMMANDS,
  profile,
  profileIds,
  forSkill,
  toolsWithinGrant,
  subjectFlags,
  DEFAULT_MAX_BUDGET_USD,
  MAX_BUDGET_USD_LIMIT,
} = runner;

const FIXTURE_ROOT = path.join(
  __dirname,
  '..',
  '..',
  'fixtures',
  'bench',
  'repo',
);
const LAYOUT = createLayout({ root: FIXTURE_ROOT });
const SETTINGS = subjectSettings({
  userHome: path.join(os.tmpdir(), 'fixture-user-home'),
  repoRoot: FIXTURE_ROOT,
});
// A profile with file tools, shaped like a later file-tool profile. None ships; it exercises the wider-grant path.
const FILE_TOOLS = Object.freeze({
  id: 'file-tools',
  loadMode: 'natural',
  loadModeBySkill: { 'tidy-control': 'explicit' },
  tools: {
    default: ['Skill', 'Read', 'Glob', 'Grep', 'Write', 'Edit'],
    bySkill: {
      'web-skill': ['Skill', 'Read', 'Write', 'WebFetch'],
    },
  },
  allowedTools: {
    default: ['Write', 'Edit'],
    bySkill: { 'web-skill': ['Write', 'WebFetch'] },
  },
});
const flagsFor = (runnerFacts) =>
  subjectFlags({
    model: 'claude-sonnet-5-5',
    pluginDir: path.join(os.tmpdir(), 'plugin'),
    agentsJson: '{}',
    agent: 'k-developer',
    runner: runnerFacts,
    settings: SETTINGS,
  });
const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];
// A copy of runner.js that sees `replacements` (a map of module file name to exports) in place of the real
// modules it requires, so a test can change one input of the digest.
const loadRunnerWith = (replacements) => {
  const saved = new Map();
  const swap = (file, value) => {
    saved.set(file, require.cache[file]);
    if (value)
      require.cache[file] = {
        id: file,
        filename: file,
        loaded: true,
        exports: value,
      };
    else delete require.cache[file];
  };
  swap(runnerPath, null);
  for (const [name, exports] of Object.entries(replacements))
    swap(require.resolve(`../../../scripts/bench/lib/${name}`), exports);
  try {
    return require(runnerPath);
  } finally {
    for (const [file, entry] of saved)
      if (entry) require.cache[file] = entry;
      else delete require.cache[file];
  }
};

// ---- profiles -----------------------------------------------------------------------------------------------------

test('every shipped profile passes its own validation, and legacy is the default', () => {
  assert.deepEqual(profileIds(), ['legacy', 'natural']);
  assert.equal(runner.DEFAULT_PROFILE, 'legacy');
  for (const id of profileIds())
    assert.deepEqual(specProblems(profile(id)), [], id);
});

test('every shipped profile grants the Skill tool only', () => {
  for (const id of profileIds()) {
    const facts = forSkill('brew-log', id);
    assert.deepEqual(facts.tools, ['Skill'], id);
    assert.deepEqual(facts.allowedTools, [], id);
    assert.equal(facts.permissionMode, null, id);
  }
});

test('specProblems refuses MCP tools, bare Bash, a Bash grant with no narrowing rule, and an allow rule outside tools', () => {
  const ok = {
    loadMode: 'natural',
    tools: { default: ['Skill', 'Read'] },
    allowedTools: { default: [] },
  };
  assert.deepEqual(specProblems(ok), []);
  const problems = (patch) => specProblems({ ...ok, ...patch }).join(' | ');
  assert.match(
    problems({ tools: { default: ['Skill', 'mcp__x__y'] } }),
    /MCP tools are never granted/,
  );
  assert.match(
    problems({ tools: { default: ['Skill', 'mcpServer'] } }),
    /MCP tools are never granted/,
  );
  assert.match(
    problems({
      tools: { default: ['Skill', 'Bash'] },
      allowedTools: { default: ['Bash'] },
    }),
    /never bare Bash/,
  );
  assert.match(
    problems({ tools: { default: ['Skill', 'Bash'] } }),
    /no Bash\(\.\.\.\) allow rule names a command/,
  );
  // A rule that allows every command is a bare grant in disguise.
  for (const rule of [
    'Bash(*)',
    'Bash(:*)',
    'Bash(**)',
    'Bash( )',
    'Bash(* *)',
    'Bash(*:*)',
  ])
    assert.match(
      problems({
        tools: { default: ['Skill', 'Bash'] },
        allowedTools: { default: [rule] },
      }),
      /allows every command; a Bash rule must name a command/,
      rule,
    );
  // A rule for another tool does not narrow Bash.
  assert.match(
    problems({
      tools: { default: ['Skill', 'Bash', 'Write'] },
      allowedTools: { default: ['Write'] },
    }),
    /no Bash\(\.\.\.\) allow rule names a command/,
  );
  assert.match(
    problems({
      tools: { default: ['Skill', 'bash'] },
      allowedTools: { default: ['bash'] },
    }),
    /never bare Bash/,
  );
  // The tool name is compared without case, so a lower-case grant needs the same rule.
  assert.match(
    problems({ tools: { default: ['Skill', 'bash'] } }),
    /no Bash\(\.\.\.\) allow rule names a command/,
  );
  assert.match(
    problems({
      tools: { default: ['Skill', 'BASH'] },
      allowedTools: { default: ['BASH(*)'] },
    }),
    /allows every command/,
  );
  assert.deepEqual(
    problems({
      tools: { default: ['Skill', 'bash'] },
      allowedTools: { default: ['bash(git status:*)'] },
    }),
    '',
  );
  assert.match(
    problems({ allowedTools: { default: ['Write'] } }),
    /not in tools/,
  );
  assert.match(problems({ tools: { default: ['Read'] } }), /Skill is required/);
  assert.match(problems({ loadMode: 'sometimes' }), /loadMode must be one of/);
  assert.deepEqual(
    specProblems({
      ...ok,
      tools: { default: ['Skill', 'Bash'] },
      allowedTools: { default: ['Bash(git diff:*)'] },
    }),
    [],
  );
});

test('specProblems checks the per-skill lists the same way as the default', () => {
  const spec = {
    loadMode: 'explicit',
    tools: { default: ['Skill'], bySkill: { 'web-skill': ['Read'] } },
    allowedTools: { bySkill: { 'other-skill': ['Write'] } },
  };
  const text = specProblems(spec).join(' | ');
  assert.match(text, /tools\.web-skill: Skill is required/);
  assert.match(
    text,
    /allowedTools\.other-skill: Write names a tool that is not in tools\.other-skill/,
  );
});

test('specProblems refuses malformed fields', () => {
  const ok = { loadMode: 'explicit', tools: { default: ['Skill'] } };
  const problems = (patch) => specProblems({ ...ok, ...patch }).join(' | ');
  assert.deepEqual(specProblems(null), ['runner spec must be an object']);
  assert.match(problems({ tools: undefined }), /tools is required/);
  assert.match(problems({ tools: ['Skill'] }), /tools must be an object/);
  assert.match(
    problems({ tools: { default: 'Skill' } }),
    /tools\.default must be a list of strings/,
  );
  assert.match(
    problems({ tools: { default: ['Skill'], other: [] } }),
    /tools\.other: unknown field/,
  );
  assert.match(
    problems({ tools: { default: ['Skill'], bySkill: [] } }),
    /tools\.bySkill must be an object/,
  );
  assert.match(
    problems({ tools: { default: ['Skill'], bySkill: { '../x': ['Skill'] } } }),
    /"\.\.\/x" is not a skill name/,
  );
  assert.match(
    problems({ tools: { default: ['Skill', 'Read File'] } }),
    /not a plain built-in tool name/,
  );
  assert.match(
    problems({ allowedTools: { default: ['Write)('] } }),
    /not a tool name or Tool\(specifier\)/,
  );
  assert.match(
    problems({ loadModeBySkill: { s: 'later' } }),
    /loadModeBySkill\.s must be one of/,
  );
  assert.match(
    problems({ loadModeBySkill: [] }),
    /loadModeBySkill must be an object/,
  );
  for (const budget of [
    0,
    -1,
    Number.NaN,
    Infinity,
    -Infinity,
    '1',
    MAX_BUDGET_USD_LIMIT + 0.01,
    1e21,
    1e-7,
  ])
    assert.match(
      problems({ maxBudgetUsd: budget }),
      /maxBudgetUsd must be a positive number of at most 10 USD/,
      String(budget),
    );
  for (const budget of [0.01, 0.75, 1.5, MAX_BUDGET_USD_LIMIT])
    assert.deepEqual(problems({ maxBudgetUsd: budget }), '', String(budget));
  for (const id of ['a\nb', '', {}, 7, '../x', '--x'])
    assert.match(
      problems({ id }),
      /id must be a safe name/,
      JSON.stringify(id),
    );
  assert.deepEqual(problems({ id: 'other-name' }), '');
  assert.match(problems({ settings: {} }), /settings: unknown runner field/);
});

test('profile: unknown names and chains longer than one level are refused; extends merges one level', () => {
  assert.throws(
    () => profile('natural-tools'),
    /unknown runner profile "natural-tools"; known: legacy, natural/,
  );
  assert.throws(() => profile('__proto__'), /unknown runner profile/);
  const table = {
    base: {
      loadMode: 'explicit',
      tools: { default: ['Skill'] },
      maxBudgetUsd: 2,
    },
    child: { extends: 'base', loadMode: 'natural' },
    grandchild: { extends: 'child' },
    broken: { extends: 'base', tools: { default: ['Read'] } },
  };
  const child = profile('child', table);
  assert.equal(child.id, 'child');
  assert.equal(child.loadMode, 'natural');
  assert.equal(child.maxBudgetUsd, 2);
  assert.ok(!('extends' in child));
  assert.throws(
    () => profile('grandchild', table),
    /child extends another runner; only one level/,
  );
  assert.throws(
    () => profile('broken', table),
    /runner broken: tools\.default: Skill is required/,
  );
});

// ---- forSkill -----------------------------------------------------------------------------------------------------

test('forSkill with no profile is legacy: explicit load, Skill only, default permission mode', () => {
  const facts = forSkill('brew-log');
  assert.equal(facts.id, 'legacy');
  assert.equal(facts.loadMode, 'explicit');
  assert.equal(facts.explicitInstruction, true);
  assert.deepEqual(facts.tools, ['Skill']);
  assert.equal(facts.permissionMode, null);
  assert.equal(facts.maxBudgetUsd, DEFAULT_MAX_BUDGET_USD);
  assert.match(facts.profileSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(facts.info, {
    id: 'legacy',
    load_mode: 'explicit',
    tools: ['Skill'],
    allowed_tools: [],
    permission_mode: null,
    max_budget_usd: DEFAULT_MAX_BUDGET_USD,
    profile_sha256: facts.profileSha256,
  });
});

test('forSkill natural: no load instruction, the same Skill-only grant', () => {
  const facts = forSkill('brew-log', 'natural');
  assert.equal(facts.loadMode, 'natural');
  assert.equal(facts.explicitInstruction, false);
  assert.deepEqual(facts.tools, ['Skill']);
  assert.equal(facts.permissionMode, null);
});

test('the budget cap default and limit are pinned, and a profile cap reaches the flags', () => {
  assert.equal(DEFAULT_MAX_BUDGET_USD, 0.75);
  assert.equal(MAX_BUDGET_USD_LIMIT, 10);
  const capped = {
    loadMode: 'explicit',
    tools: { default: ['Skill'] },
    maxBudgetUsd: 1.5,
  };
  assert.equal(forSkill('brew-log', capped).maxBudgetUsd, 1.5);
  assert.equal(
    valueAfter(flagsFor(forSkill('brew-log', capped)), '--max-budget-usd'),
    '1.5',
  );
});

test('forSkill with a wider grant: per-skill tools, per-skill load mode, dontAsk', () => {
  const plain = forSkill('brew-log', FILE_TOOLS);
  assert.deepEqual(plain.tools, FILE_TOOLS.tools.default);
  assert.deepEqual(plain.allowedTools, ['Write', 'Edit']);
  assert.equal(plain.permissionMode, 'dontAsk');
  assert.equal(plain.explicitInstruction, false);
  const web = forSkill('web-skill', FILE_TOOLS);
  assert.deepEqual(web.info.tools, ['Read', 'Skill', 'WebFetch', 'Write']);
  assert.deepEqual(web.allowedTools, ['Write', 'WebFetch']);
  const control = forSkill('tidy-control', FILE_TOOLS);
  assert.equal(control.loadMode, 'explicit');
  assert.equal(control.explicitInstruction, true);
  assert.deepEqual(
    control.tools,
    plain.tools,
    'a load mode override keeps the grant',
  );
});

test('forSkill reads a per-skill list only from the table, never from Object.prototype', () => {
  const facts = forSkill('constructor', FILE_TOOLS);
  assert.deepEqual(facts.tools, FILE_TOOLS.tools.default);
  assert.deepEqual(facts.allowedTools, FILE_TOOLS.allowedTools.default);
  assert.equal(facts.loadMode, 'natural');
  const explicit = { ...FILE_TOOLS, loadMode: 'explicit' };
  assert.equal(forSkill('toString', explicit).loadMode, 'explicit');
});

test('forSkill: an allow rule alone makes the permission mode dontAsk, and the flags carry it', () => {
  const ruleOnly = {
    loadMode: 'explicit',
    tools: { default: ['Skill'] },
    allowedTools: { default: ['Skill(brew-log)'] },
  };
  const facts = forSkill('brew-log', ruleOnly);
  assert.equal(facts.permissionMode, 'dontAsk');
  const args = flagsFor(facts);
  assert.equal(valueAfter(args, '--permission-mode'), 'dontAsk');
  assert.equal(valueAfter(args, '--allowedTools'), 'Skill(brew-log)');
  assert.notEqual(
    facts.profileSha256,
    forSkill('brew-log').profileSha256,
    'a Skill-only grant with and without a rule',
  );
});

test('forSkill refuses an unsafe skill name and a bad spec', () => {
  assert.throws(() => forSkill('../x'), /skill must be a safe name/);
  assert.throws(
    () =>
      forSkill('brew-log', {
        loadMode: 'explicit',
        tools: { default: ['Read'] },
      }),
    /Skill is required/,
  );
  assert.throws(() => forSkill('brew-log', 'nope'), /unknown runner profile/);
});

test('profileSha256: the same behavior agrees, any change in mode, grant or budget differs, the name does not count', () => {
  const legacy = forSkill('brew-log').profileSha256;
  assert.equal(
    forSkill('pantry-note').profileSha256,
    legacy,
    'same profile, another skill',
  );
  assert.notEqual(
    forSkill('brew-log', 'natural').profileSha256,
    legacy,
    'load mode',
  );
  assert.notEqual(
    forSkill('brew-log', FILE_TOOLS).profileSha256,
    legacy,
    'grant',
  );
  assert.notEqual(
    forSkill('web-skill', FILE_TOOLS).profileSha256,
    forSkill('brew-log', FILE_TOOLS).profileSha256,
    'per-skill grant',
  );
  const budget = {
    loadMode: 'explicit',
    tools: { default: ['Skill'] },
    maxBudgetUsd: 1.5,
  };
  assert.notEqual(forSkill('brew-log', budget).profileSha256, legacy, 'budget');
  const renamed = {
    id: 'other-name',
    loadMode: 'explicit',
    tools: { default: ['Skill'] },
  };
  assert.equal(
    forSkill('brew-log', renamed).profileSha256,
    legacy,
    'the id is not hashed',
  );
  const noRule = {
    loadMode: 'natural',
    tools: { default: ['Skill', 'Read', 'Write'] },
    allowedTools: { default: [] },
  };
  const withRule = { ...noRule, allowedTools: { default: ['Write'] } };
  assert.equal(forSkill('brew-log', noRule).permissionMode, 'dontAsk');
  assert.equal(forSkill('brew-log', withRule).permissionMode, 'dontAsk');
  assert.notEqual(
    forSkill('brew-log', withRule).profileSha256,
    forSkill('brew-log', noRule).profileSha256,
    'allow rules alone',
  );
  const reordered = {
    ...FILE_TOOLS,
    tools: {
      ...FILE_TOOLS.tools,
      default: [...FILE_TOOLS.tools.default].reverse(),
    },
  };
  assert.equal(
    forSkill('brew-log', reordered).profileSha256,
    forSkill('brew-log', FILE_TOOLS).profileSha256,
    'tool order does not count',
  );
});

test('toolsWithinGrant: the reported tools must be inside the grant and include Skill', () => {
  const wide = forSkill('brew-log', FILE_TOOLS);
  assert.ok(toolsWithinGrant(['Skill', 'Read', 'Write'], wide));
  assert.ok(
    !toolsWithinGrant(['Skill', 'Bash'], wide),
    'a tool outside the grant',
  );
  assert.ok(!toolsWithinGrant(['Read'], wide), 'no Skill');
  assert.ok(!toolsWithinGrant(null, wide), 'no list');
  assert.ok(!toolsWithinGrant(['Skill', 'mcp__a__b'], wide), 'an MCP tool');
  const legacy = forSkill('brew-log');
  assert.ok(toolsWithinGrant(['Skill'], legacy), 'legacy: Skill alone');
  assert.ok(
    !toolsWithinGrant(['Skill', 'Read'], legacy),
    'legacy: Read is beyond Skill',
  );
  assert.ok(!toolsWithinGrant([], legacy), 'an empty list has no Skill');
});

// ---- subjectFlags -------------------------------------------------------------------------------------------------

test('subjectFlags legacy: --tools Skill, no MCP, no setting sources, no permission flags, no skill deny', () => {
  const args = flagsFor(forSkill('brew-log'));
  assert.equal(valueAfter(args, '--tools'), 'Skill');
  assert.equal(valueAfter(args, '--model'), 'claude-sonnet-5-5');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(valueAfter(args, '--setting-sources'), '');
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(
    valueAfter(args, '--max-budget-usd'),
    String(DEFAULT_MAX_BUDGET_USD),
  );
  for (const flag of [
    '--permission-mode',
    '--allowedTools',
    '--mcp-config',
    '--dangerously-skip-permissions',
    '--add-dir',
  ])
    assert.ok(!args.includes(flag), flag);
  assert.ok(!args.join(' ').includes('bypassPermissions'));
  assert.deepEqual(JSON.parse(valueAfter(args, '--settings')), SETTINGS);
  assert.ok(!args.includes('--disallowedTools'));
  assert.deepEqual(args.slice(-6), [
    '--plugin-dir',
    path.join(os.tmpdir(), 'plugin'),
    '--agents',
    '{}',
    '--agent',
    'k-developer',
  ]);
  assert.deepEqual(args.slice(0, 6), [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
  ]);
});

test('subjectFlags never denies a skill: no --disallowedTools flag and no Skill(...) deny rule, in either arm and every profile', () => {
  const denyFlags = ['--disallowedTools', '--disallowed-tools'];
  for (const [label, profileOrId] of [
    ['legacy', 'legacy'],
    ['natural', 'natural'],
    ['file tools', FILE_TOOLS],
  ])
    for (const [arm, pluginDir] of [
      ['with', path.join(os.tmpdir(), 'plugin', 'with')],
      ['without', path.join(os.tmpdir(), 'plugin', 'without')],
    ]) {
      const args = subjectFlags({
        model: 'claude-sonnet-5-5',
        pluginDir,
        agentsJson: '{}',
        agent: 'k-developer',
        runner: forSkill('code-review', profileOrId),
        settings: SETTINGS,
      });
      const where = `${label} ${arm}`;
      for (const flag of denyFlags) assert.ok(!args.includes(flag), where);
      assert.ok(
        args.every((arg) => !arg.startsWith('Skill(')),
        `${where}: no Skill(...) rule among the flags`,
      );
      // The isolation settings hold the only deny list; it names no skill.
      const { deny } = JSON.parse(valueAfter(args, '--settings')).permissions;
      assert.ok(
        deny.every((rule) => !rule.startsWith('Skill')),
        `${where}: the isolation settings deny no skill`,
      );
    }
});

test('subjectFlags with a wider grant adds dontAsk and the allow rules, and still no MCP or Bash', () => {
  const args = flagsFor(forSkill('brew-log', FILE_TOOLS));
  assert.equal(valueAfter(args, '--tools'), 'Skill,Read,Glob,Grep,Write,Edit');
  assert.equal(valueAfter(args, '--permission-mode'), 'dontAsk');
  assert.deepEqual(
    args.slice(args.indexOf('--allowedTools') + 1, args.indexOf('--settings')),
    ['Write', 'Edit'],
  );
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(!args.includes('--mcp-config'));
  assert.ok(!args.join(' ').includes('Bash'));
});

test('subjectFlags refuses arguments that could become another flag or point at a relative folder', () => {
  const good = {
    model: 'claude-sonnet-5-5',
    pluginDir: path.join(os.tmpdir(), 'plugin'),
    agentsJson: '{}',
    agent: 'k-developer',
    runner: forSkill('brew-log'),
    settings: SETTINGS,
  };
  const refused = (patch, pattern) =>
    assert.throws(() => subjectFlags({ ...good, ...patch }), pattern);
  refused(
    { model: '--dangerously-skip-permissions' },
    /model must be a non-empty string that does not start with "-"/,
  );
  refused({ model: '' }, /model must be/);
  refused({ pluginDir: 'plugin' }, /pluginDir must be an absolute path/);
  refused({ agentsJson: '' }, /agentsJson must be/);
  refused({ agent: '-x' }, /agent must be a safe name/);
  refused({ runner: {} }, /runner must come from forSkill/);
  refused({ settings: null }, /settings must come from subjectSettings/);
  assert.throws(() => subjectFlags(), /model must be/);
});

// ---- wiring -------------------------------------------------------------------------------------------------------

test('the runner_profile setting names a shipped profile', () => {
  assert.equal(exampleConfig().runner_profile, 'legacy');
  const natural = exampleConfig({ runner_profile: 'natural' });
  assert.equal(
    forSkill('brew-log', natural.runner_profile).loadMode,
    'natural',
  );
});

test('the load mode decides whether the with arm gets the load instruction', () => {
  for (const [id, expected] of [
    ['legacy', true],
    ['natural', false],
  ]) {
    const facts = forSkill('brew-log', id);
    const built = buildArms('brew-log', {
      skillsDir: LAYOUT.skillsDir,
      agentsDir: LAYOUT.agentsDir,
      agent: 'k-developer',
      explicitInstruction: facts.explicitInstruction,
    });
    try {
      const prompt = (arm) =>
        JSON.parse(built.agentsJson[arm])['k-developer'].prompt;
      assert.equal(
        /Skill loading \(benchmark harness\)/.test(prompt('with')),
        expected,
        id,
      );
      assert.ok(
        !/Skill loading \(benchmark harness\)/.test(prompt('without')),
        id,
      );
    } finally {
      removeArms(built);
    }
  }
});

test('profileSha256 is pinned, so a change to what it hashes shows as a deliberate edit', () => {
  assert.equal(
    forSkill('brew-log', 'legacy').profileSha256,
    'a88083f9b57eee664f9869e02b3d6c77dee3aaf690df36e4d6258296c310fad7',
  );
  assert.equal(
    forSkill('brew-log', 'natural').profileSha256,
    '210886ec8c8c1e3961b1154b78f8a4c95dacd9c8e32b30ff6727c34ec9abdf5e',
  );
});

test('profileSha256 covers the isolation deny rules', () => {
  const real = forSkill('brew-log').profileSha256;
  const isolation = require('../../../scripts/bench/lib/subject-isolation');
  // The stand-in holds the real values, so the digest is the real one until a test changes one input.
  assert.equal(
    loadRunnerWith({
      'subject-isolation': { ...isolation },
    }).forSkill('brew-log').profileSha256,
    real,
  );
  assert.notEqual(
    loadRunnerWith({
      'subject-isolation': {
        ...isolation,
        subjectSettings: (options) => {
          const settings = isolation.subjectSettings(options);
          return {
            permissions: {
              ...settings.permissions,
              deny: [...settings.permissions.deny, 'Read(~/.one-more/**)'],
            },
          };
        },
      },
    }).forSkill('brew-log').profileSha256,
    real,
    'one more deny rule',
  );
});

test('the digest does not depend on this machine: the deny rules in it use fixed paths', () => {
  const digest = forSkill('brew-log').profileSha256;
  const saved = process.env.HOME;
  process.env.HOME = path.join(os.tmpdir(), 'another-home');
  try {
    assert.equal(forSkill('brew-log').profileSha256, digest);
  } finally {
    process.env.HOME = saved;
  }
});

test('specProblems refuses a Bash rule whose command is a shell, an interpreter or a network tool', () => {
  const problems = (rule) =>
    specProblems({
      loadMode: 'natural',
      tools: { default: ['Skill', 'Bash'] },
      allowedTools: { default: [rule] },
    });
  assert.deepEqual(
    [...UNSAFE_BASH_COMMANDS],
    [
      'sh',
      'bash',
      'zsh',
      'node',
      'python',
      'python3',
      'perl',
      'ruby',
      'curl',
      'wget',
      'env',
      'xargs',
      'eval',
      'exec',
    ],
  );
  assert.ok(Object.isFrozen(UNSAFE_BASH_COMMANDS));
  for (const command of UNSAFE_BASH_COMMANDS)
    for (const rule of [
      `Bash(${command}:*)`,
      `Bash(${command} -c:*)`,
      `Bash(${command} some-file)`,
      `Bash(${command.toUpperCase()}:*)`,
      `Bash( ${command} :*)`,
      `Bash(/usr/bin/${command}:*)`,
      `bash(${command}:*)`,
    ])
      assert.match(
        problems(rule).join(' | '),
        new RegExp(
          `allowedTools\\.default: .* starts with ${command}, which can run any program or reach the network`,
        ),
        rule,
      );
  // The two the guard is asked about first.
  assert.equal(problems('Bash(sh:*)').length, 1);
  assert.equal(problems('Bash(curl:*)').length, 1);
  // A version suffix is the same command.
  for (const rule of [
    'Bash(python3.12:*)',
    'Bash(python2:*)',
    'Bash(node18:*)',
    'Bash(perl5.38:*)',
    'Bash(ruby3.2 x.rb)',
  ])
    assert.equal(problems(rule).length, 1, rule);
  // Another command that merely starts with the same letters, or has the word later, is allowed.
  for (const rule of [
    'Bash(git diff:*)',
    'Bash(git status)',
    'Bash(shasum:*)',
    'Bash(shellcheck:*)',
    'Bash(nodemon:*)',
    'Bash(pythonista:*)',
    'Bash(rubocop:*)',
    'Bash(ls -la:*)',
    'Bash(grep sh:*)',
  ])
    assert.deepEqual(problems(rule), [], rule);
  // One unsafe rule among good ones is still refused, and the other rule is not blamed.
  const mixed = specProblems({
    loadMode: 'natural',
    tools: { default: ['Skill', 'Bash'] },
    allowedTools: { default: ['Bash(git diff:*)', 'Bash(sh:*)'] },
  });
  assert.equal(mixed.length, 1);
  assert.match(mixed[0], /Bash\(sh:\*\) starts with sh/);
  // The same check applies per skill.
  assert.match(
    specProblems({
      loadMode: 'natural',
      tools: {
        default: ['Skill'],
        bySkill: { 'web-skill': ['Skill', 'Bash'] },
      },
      allowedTools: { bySkill: { 'web-skill': ['Bash(curl:*)'] } },
    }).join(' | '),
    /allowedTools\.web-skill: Bash\(curl:\*\) starts with curl/,
  );
});
