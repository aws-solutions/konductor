// SPDX-License-Identifier: Apache-2.0
// Tests for the subject child's environment, private home and deny rules (scripts/bench/lib/subject-isolation.js),
// and the no-model isolation check of the whole launch setup. No process is started and no model is called; the
// credential values below are made-up strings.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isolation = require('../../../scripts/bench/lib/subject-isolation');
const { forSkill, subjectFlags } = require('../../../scripts/bench/lib/runner');
const { REPO_ROOT } = require('../../../scripts/bench/lib/layout');
const helpers = require('./helpers');

const { SUBJECT_ENV_NAMES, subjectEnv, createPrivateHome, subjectSettings } =
  isolation;

const CREDENTIALS = Object.freeze({
  accessKeyId: 'ASIA' + 'EXAMPLEFIXTURE01',
  secretAccessKey: 'fixture-secret-' + 'value',
  sessionToken: 'fixture-session-' + 'token',
});
const mode = (file) => fs.statSync(file).mode & 0o777;
// A stand-in for the real home folder, so no test depends on the machine's own one.
const userHomeIn = (dir) => {
  const home = path.join(dir, 'user-home');
  fs.mkdirSync(home);
  return home;
};

// ---- subjectEnv ---------------------------------------------------------------------------------------------------

test('subjectEnv holds exactly the allowlisted variables', () =>
  helpers.withTmp((dir) => {
    const home = createPrivateHome(dir);
    const env = subjectEnv({
      credentials: CREDENTIALS,
      region: 'us-west-2',
      home,
      pathValue: '/usr/bin:/bin',
      userHome: userHomeIn(dir),
    });
    assert.deepEqual(Object.keys(env).sort(), [...SUBJECT_ENV_NAMES].sort());
    assert.deepEqual(env, {
      AWS_ACCESS_KEY_ID: CREDENTIALS.accessKeyId,
      AWS_SECRET_ACCESS_KEY: CREDENTIALS.secretAccessKey,
      AWS_SESSION_TOKEN: CREDENTIALS.sessionToken,
      AWS_REGION: 'us-west-2',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      PATH: '/usr/bin:/bin',
      HOME: home,
    });
  }));

test('subjectEnv passes nothing from the parent environment except PATH', () =>
  helpers.withTmp((dir) => {
    const planted = {
      AWS_PROFILE: 'parent-profile',
      AWS_CONFIG_FILE: path.join(dir, 'config'),
      AWS_SHARED_CREDENTIALS_FILE: path.join(dir, 'credentials'),
      AWS_DEFAULT_PROFILE: 'parent-profile',
      NPM_TOKEN: 'registry-token',
      GITHUB_TOKEN: 'host-token',
      ANTHROPIC_API_KEY: 'api-key',
      NODE_OPTIONS: '--require ./x.js',
    };
    const saved = {};
    for (const [name, value] of Object.entries(planted)) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    try {
      const env = subjectEnv({
        credentials: CREDENTIALS,
        region: 'eu-central-1',
        home: createPrivateHome(dir),
        userHome: userHomeIn(dir),
      });
      for (const name of Object.keys(planted)) assert.ok(!(name in env), name);
      for (const value of Object.values(planted))
        assert.ok(!Object.values(env).includes(value), value);
      assert.equal(env.PATH, process.env.PATH);
    } finally {
      for (const [name, value] of Object.entries(saved))
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  }));

test('subjectEnv refuses the real home folder, a folder above it, and a relative home', () =>
  helpers.withTmp((dir) => {
    const userHome = userHomeIn(dir);
    const base = { credentials: CREDENTIALS, region: 'us-west-2', userHome };
    assert.throws(
      () => subjectEnv({ ...base, home: userHome }),
      /home must be a private folder/,
    );
    assert.throws(
      () => subjectEnv({ ...base, home: `${userHome}${path.sep}` }),
      /home must be a private folder/,
    );
    assert.throws(
      () => subjectEnv({ ...base, home: dir }),
      /home must be a private folder/,
    );
    assert.throws(
      () => subjectEnv({ ...base, home: 'home' }),
      /home must be an absolute path/,
    );
    assert.throws(
      () => subjectEnv({ ...base, home: undefined }),
      /home must be an absolute path/,
    );
    // The default real home is os.homedir().
    assert.throws(
      () =>
        subjectEnv({
          credentials: CREDENTIALS,
          region: 'us-west-2',
          home: os.homedir(),
        }),
      /home must be a private folder/,
    );
  }));

test('subjectEnv refuses a home that reaches the real home through a link', () =>
  helpers.withTmp((dir) => {
    const parent = path.join(dir, 'parent');
    fs.mkdirSync(parent);
    const userHome = path.join(parent, 'user-home');
    fs.mkdirSync(userHome);
    const base = { credentials: CREDENTIALS, region: 'us-west-2' };
    const refused = (home, userHomeValue = userHome) =>
      assert.throws(
        () => subjectEnv({ ...base, home, userHome: userHomeValue }),
        /home must be a private folder/,
        home,
      );
    // A link to the real home folder.
    const linkToHome = path.join(dir, 'link-to-home');
    fs.symlinkSync(userHome, linkToHome);
    refused(linkToHome);
    // A link to a folder above the real home folder.
    const linkToParent = path.join(dir, 'link-to-parent');
    fs.symlinkSync(parent, linkToParent);
    refused(linkToParent);
    // The same real home folder, spelled through a link on each side.
    refused(path.join(linkToParent, 'user-home'));
    refused(userHome, path.join(linkToParent, 'user-home'));
    // A folder that does not exist yet is compared by its nearest existing parent.
    refused(
      path.join(linkToParent, 'missing-home'),
      path.join(parent, 'missing-home'),
    );
    refused(
      path.join(linkToParent, 'missing', 'deeper', 'home'),
      path.join(parent, 'missing', 'deeper', 'home'),
    );
    // The missing names keep their order: this missing folder is above the real home folder.
    refused(path.join(linkToParent, 'a'), path.join(parent, 'a', 'b', 'c'));
    // A link loop is an error, not a path that is quietly accepted.
    const loopA = path.join(dir, 'loop-a');
    const loopB = path.join(dir, 'loop-b');
    fs.symlinkSync(loopB, loopA);
    fs.symlinkSync(loopA, loopB);
    assert.throws(
      () => subjectEnv({ ...base, home: loopA, userHome }),
      /ELOOP/,
    );
    // A private folder next to the real home folder is accepted, also through a link.
    const privateHome = path.join(dir, 'private');
    fs.mkdirSync(privateHome);
    const linkToPrivate = path.join(dir, 'link-to-private');
    fs.symlinkSync(privateHome, linkToPrivate);
    for (const home of [privateHome, linkToPrivate, path.join(dir, 'gone')])
      assert.equal(subjectEnv({ ...base, home, userHome }).HOME, home);
    // A parent that is a regular file is not a folder: the path is read as it is and accepted as a private folder.
    const file = path.join(dir, 'a-file');
    fs.writeFileSync(file, '');
    const underFile = path.join(file, 'home');
    assert.equal(
      subjectEnv({ ...base, home: underFile, userHome }).HOME,
      underFile,
    );
    // A real home folder that cannot exist (it is under a file) is not compared as a folder above or at the home.
    assert.equal(
      subjectEnv({ ...base, home: privateHome, userHome: path.join(file, 'u') })
        .HOME,
      privateHome,
    );
  }));

test('subjectEnv refuses missing or malformed credentials, region and PATH', () =>
  helpers.withTmp((dir) => {
    const base = {
      credentials: CREDENTIALS,
      region: 'us-west-2',
      home: createPrivateHome(dir),
      userHome: userHomeIn(dir),
    };
    const refused = (patch, pattern) =>
      assert.throws(() => subjectEnv({ ...base, ...patch }), pattern);
    refused({ credentials: undefined }, /credentials must be/);
    for (const field of ['accessKeyId', 'secretAccessKey', 'sessionToken']) {
      refused(
        { credentials: { ...CREDENTIALS, [field]: '' } },
        new RegExp(`credentials\\.${field} must be`),
      );
      refused(
        { credentials: { ...CREDENTIALS, [field]: '  ' } },
        new RegExp(`credentials\\.${field} must be`),
      );
      refused(
        { credentials: { ...CREDENTIALS, [field]: 'a\nb' } },
        /no control characters/,
      );
      // An error message never repeats the value it refused.
      const secret = `${CREDENTIALS[field]}\n`;
      assert.throws(
        () =>
          subjectEnv({
            ...base,
            credentials: { ...CREDENTIALS, [field]: secret },
          }),
        (error) =>
          /no control characters/.test(error.message) &&
          !error.message.includes(CREDENTIALS[field]),
      );
      refused(
        { credentials: { ...CREDENTIALS, [field]: undefined } },
        new RegExp(`credentials\\.${field} must be`),
      );
    }
    for (const region of [
      '',
      'us_west_2',
      'US-WEST-2',
      'us-west-2\n',
      undefined,
    ])
      refused({ region }, /region must be an AWS region/);
    refused({ pathValue: '' }, /pathValue must be/);
    assert.throws(
      () => subjectEnv({ ...base, pathValue: '/secret-bin:/bin\n' }),
      (error) =>
        /pathValue must be/.test(error.message) &&
        !error.message.includes('secret-bin'),
    );
    assert.throws(() => subjectEnv(), /credentials must be/);
  }));

// ---- createPrivateHome --------------------------------------------------------------------------------------------

test('createPrivateHome makes a fresh 0700 folder inside the scratch folder', () =>
  helpers.withTmp((dir) => {
    const home = createPrivateHome(dir);
    assert.equal(home, path.join(dir, 'home'));
    assert.equal(mode(home), 0o700);
    assert.deepEqual(fs.readdirSync(home), []);
    assert.throws(
      () => createPrivateHome(dir),
      /EEXIST/,
      'a home left from an earlier run is never reused',
    );
  }));

test('createPrivateHome keeps 0700 under a restrictive umask', () =>
  helpers.withTmp((dir) => {
    // mkdir with mode 0700 under a umask of 0277 makes a 0500 folder; only the chmod after it gives 0700.
    const previous = process.umask(0o277);
    try {
      assert.equal(mode(createPrivateHome(dir)), 0o700);
    } finally {
      process.umask(previous);
    }
  }));

test('createPrivateHome refuses a relative path, a missing folder, a file and a link', () =>
  helpers.withTmp((dir) => {
    assert.throws(
      () => createPrivateHome('scratch'),
      /scratchDir must be an absolute path/,
    );
    assert.throws(() => createPrivateHome(path.join(dir, 'missing')), /ENOENT/);
    const file = path.join(dir, 'file');
    fs.writeFileSync(file, '');
    assert.throws(() => createPrivateHome(file), /is not a plain folder/);
    const real = path.join(dir, 'real');
    fs.mkdirSync(real);
    const link = path.join(dir, 'link');
    fs.symlinkSync(real, link);
    assert.throws(() => createPrivateHome(link), /is not a plain folder/);
    assert.deepEqual(fs.readdirSync(real), []);
  }));

// ---- subjectSettings ----------------------------------------------------------------------------------------------

test('subjectSettings denies reads and edits of the credential folders and files and the repository root', () => {
  const userHome = path.join(os.tmpdir(), 'fixture-user-home');
  const repoRoot = path.join(os.tmpdir(), 'fixture-repo');
  const { permissions } = subjectSettings({ userHome, repoRoot });
  const folders = [
    '.aws',
    '.ssh',
    '.config',
    '.gnupg',
    '.docker',
    '.kube',
    '.claude',
  ];
  const files = ['.netrc', '.npmrc', '.git-credentials'];
  assert.deepEqual(isolation.DENIED_HOME_FOLDERS, folders);
  assert.deepEqual(isolation.DENIED_HOME_FILES, files);
  const expectedTargets = [
    ...folders.map((folder) => `~/${folder}/**`),
    ...files.map((file) => `~/${file}`),
    ...folders.map((folder) => `/${path.join(userHome, folder)}/**`),
    ...files.map((file) => `/${path.join(userHome, file)}`),
    `/${repoRoot}/**`,
  ];
  const expected = ['Read', 'Edit'].flatMap((kind) =>
    expectedTargets.map((target) => `${kind}(${target})`),
  );
  assert.deepEqual(permissions.deny, expected);
  assert.ok(
    permissions.deny.every((rule) => !rule.includes('///')),
    'absolute paths start with exactly //',
  );
  assert.equal(permissions.blockReadsOutsideWorkingDirectories, true);
  assert.equal(permissions.blockWritesOutsideWorkingDirectories, true);
  assert.deepEqual(Object.keys(subjectSettings()), ['permissions']);
});

test('subjectSettings defaults to the real home folder and this checkout', () => {
  const { deny } = subjectSettings().permissions;
  assert.ok(deny.includes(`Read(/${path.join(os.homedir(), '.aws')}/**)`));
  assert.ok(deny.includes(`Read(/${REPO_ROOT}/**)`));
  assert.ok(deny.includes(`Edit(/${REPO_ROOT}/**)`));
});

test('subjectSettings refuses a path with a character that has a meaning in a rule', () => {
  for (const character of ['(', ')', '*', '?', '[', ']', '{', '}']) {
    const bad = path.join(os.tmpdir(), `a${character}b`);
    assert.throws(
      () => subjectSettings({ userHome: bad }),
      (error) =>
        error instanceof TypeError &&
        error.message.startsWith(
          `userHome must not contain ${JSON.stringify(character)}`,
        ),
      character,
    );
    assert.throws(
      () => subjectSettings({ repoRoot: bad }),
      new RegExp(`repoRoot must not contain "\\${character}"`),
      character,
    );
  }
  assert.ok(
    subjectSettings({
      userHome: path.join(os.tmpdir(), 'my home-1.2_x'),
      repoRoot: path.join(os.tmpdir(), 'repo@work'),
    }),
  );
});

test('subjectSettings refuses relative paths', () => {
  assert.throws(
    () => subjectSettings({ userHome: 'home' }),
    /userHome must be an absolute path/,
  );
  assert.throws(
    () => subjectSettings({ repoRoot: 'repo' }),
    /repoRoot must be an absolute path/,
  );
});

// ---- the launch setup as a whole ----------------------------------------------------------------------------------

test('isolation: flags, settings and environment of a legacy subject run hold the expected values', () =>
  helpers.withTmp((dir) => {
    const userHome = userHomeIn(dir);
    const scratch = path.join(dir, 'run');
    fs.mkdirSync(scratch, { mode: 0o700 });
    const home = createPrivateHome(scratch);
    const env = subjectEnv({
      credentials: CREDENTIALS,
      region: 'us-west-2',
      home,
      userHome,
    });
    const args = subjectFlags({
      model: 'claude-sonnet-5-5',
      pluginDir: path.join(scratch, 'with'),
      agentsJson: '{}',
      agent: 'k-developer',
      runner: forSkill('brew-log'),
      settings: subjectSettings({ userHome, repoRoot: REPO_ROOT }),
    });
    // Only the Skill tool, no MCP server, no settings file.
    assert.equal(args.filter((arg) => arg === '--tools').length, 1);
    assert.equal(args[args.indexOf('--tools') + 1], 'Skill');
    assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(
      !args.some(
        (arg) => /mcp-config$/.test(arg) && arg !== '--strict-mcp-config',
      ),
    );
    assert.equal(args[args.indexOf('--setting-sources') + 1], '');
    // A private HOME and an allowlisted environment only.
    assert.equal(env.HOME, home);
    assert.notEqual(env.HOME, userHome);
    assert.equal(mode(env.HOME), 0o700);
    assert.ok(
      Object.keys(env).every((name) => SUBJECT_ENV_NAMES.includes(name)),
    );
    for (const name of [
      'AWS_PROFILE',
      'AWS_CONFIG_FILE',
      'AWS_SHARED_CREDENTIALS_FILE',
    ])
      assert.ok(!(name in env), name);
    // The deny rules for the credential folders and the repository root reach the child.
    const settings = JSON.parse(args[args.indexOf('--settings') + 1]);
    for (const folder of ['.aws', '.ssh', '.config']) {
      assert.ok(
        settings.permissions.deny.includes(`Read(~/${folder}/**)`),
        folder,
      );
      assert.ok(
        settings.permissions.deny.includes(
          `Read(/${path.join(userHome, folder)}/**)`,
        ),
        folder,
      );
    }
    assert.ok(settings.permissions.deny.includes(`Read(/${REPO_ROOT}/**)`));
    assert.ok(settings.permissions.deny.includes(`Edit(/${REPO_ROOT}/**)`));
    // No credential value is on the command line.
    for (const value of Object.values(CREDENTIALS))
      assert.ok(
        !args.some((arg) => arg.includes(value)),
        'credential in the flags',
      );
  }));
