// SPDX-License-Identifier: Apache-2.0
/**
 * The environment, home folder and settings of a Claude Code subject run. Nothing here starts a process, reads
 * a credential file or reaches the network; the subject runner calls these right before each launch.
 *
 * No credential files (subjectEnv, createPrivateHome). The child's environment is built from nothing, never
 * from the parent's: it holds the three short-lived values the parent exported for this launch, the variables
 * that point Claude Code at Bedrock and turn off its other traffic, the region, PATH, the launch's canary
 * (BENCH_CANARY_TOKEN, a random value the secret sweep watches for), and a HOME that is a fresh
 * private folder inside the run's scratch area. So AWS_PROFILE, AWS_CONFIG_FILE, AWS_SHARED_CREDENTIALS_FILE, a
 * package registry or source host token left in the parent shell, and the real home folder (with ~/.aws and its
 * SSO token cache) never reach the child, by name or by inheritance.
 *
 * Deny rules (subjectSettings). The settings passed with --settings deny reads and edits of the credential and
 * tool-settings folders and files of a home folder (DENIED_HOME_FOLDERS, DENIED_HOME_FILES) and of the repository
 * root, both under the child's HOME and at the real paths, and keep file tools inside the working directory. This
 * is not an OS sandbox: with `Skill` as the only tool the child has nothing to read with anyway. The rules matter
 * for a later profile that grants file tools.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { REPO_ROOT } = require('./layout');
const { CANARY_ENV, redact } = require('./redact');

/** Every variable a subject child gets. Nothing else is passed. */
const SUBJECT_ENV_NAMES = Object.freeze([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'PATH',
  'HOME',
  CANARY_ENV,
]);
/** Folders under a home folder (a path of one or more names) that hold credentials or tool settings. */
const DENIED_HOME_FOLDERS = Object.freeze([
  '.aws',
  '.ssh',
  '.config',
  '.gnupg',
  '.docker',
  '.kube',
  '.claude',
  '.m2',
  '.cargo',
  '.azure',
  '.local/share',
]);
/** Files directly under a home folder that hold credentials. */
const DENIED_HOME_FILES = Object.freeze([
  '.netrc',
  '.npmrc',
  '.git-credentials',
  '.claude.json',
  '.pypirc',
  '.pgpass',
]);
/** The Claude Code tool kinds a permission rule names: Read covers reading tools, Edit covers writing tools. */
const DENIED_TOOL_KINDS = Object.freeze(['Read', 'Edit']);
const PRIVATE_HOME_NAME = 'home';

const REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
// A value with a control character could split a line in a log or change how a variable is read.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function requireValue(description, value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    CONTROL_CHARACTER.test(value)
  )
    throw new TypeError(
      `${description} must be a non-empty string with no control characters`,
    );
  return value;
}

// A character with a meaning in a permission rule's path pattern.
const RULE_PATH_SPECIAL = /[()*?[\]{}]/;

/**
 * `target` as an absolute path with every link resolved. A path that does not exist yet gets its nearest existing
 * parent resolved and the missing names appended.
 */
function resolveLinks(target) {
  const missing = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...missing.reverse());
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      // The file system root always exists, so this loop ends there at the latest.
      missing.push(path.basename(current));
      current = path.dirname(current);
    }
  }
}

/** True when `inner` is `outer` or a path below it, after links are resolved. */
const isSameOrInside = (inner, outer) => {
  const relative = path.relative(resolveLinks(outer), resolveLinks(inner));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

/**
 * The environment of one subject child, built from nothing.
 *   credentials  { accessKeyId, secretAccessKey, sessionToken }: the values exported for this launch
 *   region       AWS region, such as us-west-2
 *   home         the private home folder (createPrivateHome); refused when it is or holds the real home
 *   canary       this launch's canary (redact.js newCanary), set as BENCH_CANARY_TOKEN. The secret sweep stops the
 *                run when the value shows up in a stored file, so it must be exactly one value the redactor
 *                knows as a canary.
 *   pathValue    PATH for the child (default: the parent's PATH)
 *   userHome     the real home folder (default os.homedir()), only to refuse it as `home`
 */
function subjectEnv({
  credentials,
  region,
  home,
  canary,
  pathValue = process.env.PATH,
  userHome = os.homedir(),
} = {}) {
  if (!credentials || typeof credentials !== 'object')
    throw new TypeError(
      'credentials must be { accessKeyId, secretAccessKey, sessionToken }',
    );
  const accessKeyId = requireValue(
    'credentials.accessKeyId',
    credentials.accessKeyId,
  );
  const secretAccessKey = requireValue(
    'credentials.secretAccessKey',
    credentials.secretAccessKey,
  );
  const sessionToken = requireValue(
    'credentials.sessionToken',
    credentials.sessionToken,
  );
  if (typeof region !== 'string' || !REGION.test(region))
    throw new TypeError(
      `region must be an AWS region such as us-west-2, got ${JSON.stringify(region)}`,
    );
  if (typeof home !== 'string' || !path.isAbsolute(home))
    throw new TypeError('home must be an absolute path');
  // A HOME that is the real home folder, or a folder above it, would hand the child ~/.aws by name.
  if (isSameOrInside(userHome, home))
    throw new Error(
      'home must be a private folder, not the real home folder or a folder that holds it',
    );
  requireValue('pathValue', pathValue);
  // The whole value must be one canary: a value the sweep would not recognize could leak without a stop.
  if (typeof canary !== 'string' || redact(canary) !== '[REDACTED_CANARY]')
    throw new TypeError('canary must be one value from newCanary()');
  const env = {
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    AWS_SESSION_TOKEN: sessionToken,
    AWS_REGION: region,
    CLAUDE_CODE_USE_BEDROCK: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    PATH: pathValue,
    HOME: home,
    [CANARY_ENV]: canary,
  };
  return env;
}

/**
 * Makes the child's private home folder, `<scratchDir>/home`, mode 0700, and returns its path. `scratchDir` must
 * be an existing absolute folder (not a link to one). The home folder must not exist yet, so a home left from an
 * earlier run is never reused.
 */
function createPrivateHome(scratchDir) {
  if (typeof scratchDir !== 'string' || !path.isAbsolute(scratchDir))
    throw new TypeError('scratchDir must be an absolute path');
  const stat = fs.lstatSync(scratchDir);
  if (!stat.isDirectory())
    throw new Error(`${scratchDir} is not a plain folder`);
  const home = path.join(scratchDir, PRIVATE_HOME_NAME);
  fs.mkdirSync(home, { mode: 0o700 });
  // mkdir applies the umask; chmod makes the mode exact.
  fs.chmodSync(home, 0o700);
  return home;
}

/** A Claude Code permission path for an absolute path: `//` marks a path from the file system root. */
function absoluteRulePath(target) {
  const resolved = path.resolve(target).split(path.sep).join('/');
  return resolved.startsWith('/') ? `/${resolved}` : `//${resolved}`;
}

/**
 * The --settings object of a subject run. Deny rules name the DENIED_HOME_FOLDERS and DENIED_HOME_FILES (as `~/`
 * paths, which Claude Code resolves against the child's HOME, and at the real home folder) and the repository
 * root, for both reading and editing tools. The two `block...OutsideWorkingDirectories` keys keep file tools in
 * the working directory. The live isolation test (opt in with BENCH_LIVE_ISOLATION=1, with the subject runner)
 * ran against Claude Code 2.1.322: the CLI accepted these settings and reported Skill as its only tool. That run
 * grants Skill alone, so it does not exercise a file tool; check that a deny rule blocks a read, and that the two
 * keys confine a file tool, before a profile grants file tools. A path with a character that has a meaning in a rule (`()*?[]{}`) is refused,
 * because the rule would match something else.
 *   userHome  the real home folder (default os.homedir())
 *   repoRoot  the repository root (default: this checkout)
 */
function subjectSettings({
  userHome = os.homedir(),
  repoRoot = REPO_ROOT,
} = {}) {
  for (const [description, value] of [
    ['userHome', userHome],
    ['repoRoot', repoRoot],
  ]) {
    if (typeof value !== 'string' || !path.isAbsolute(value))
      throw new TypeError(`${description} must be an absolute path`);
    const special = RULE_PATH_SPECIAL.exec(value);
    if (special)
      throw new TypeError(
        `${description} must not contain "${special[0]}": a permission rule would match another path`,
      );
  }
  const targets = [
    ...DENIED_HOME_FOLDERS.map((folder) => `~/${folder}/**`),
    ...DENIED_HOME_FILES.map((file) => `~/${file}`),
    ...DENIED_HOME_FOLDERS.map(
      (folder) => `${absoluteRulePath(path.join(userHome, folder))}/**`,
    ),
    ...DENIED_HOME_FILES.map((file) =>
      absoluteRulePath(path.join(userHome, file)),
    ),
    `${absoluteRulePath(repoRoot)}/**`,
  ];
  const deny = [];
  for (const kind of DENIED_TOOL_KINDS)
    for (const target of targets) deny.push(`${kind}(${target})`);
  return {
    permissions: {
      deny,
      blockReadsOutsideWorkingDirectories: true,
      blockWritesOutsideWorkingDirectories: true,
    },
  };
}

module.exports = {
  SUBJECT_ENV_NAMES,
  DENIED_HOME_FOLDERS,
  DENIED_HOME_FILES,
  DENIED_TOOL_KINDS,
  subjectEnv,
  createPrivateHome,
  subjectSettings,
};
