// SPDX-License-Identifier: Apache-2.0
/**
 * Safe relative paths
 *
 * One definition of "a path a benchmark task may name", shared by the task validator and the
 * check matcher. The module is pure: it inspects a string and does no I/O.
 *
 * A safe path is a forward-slash relative path inside a workspace. It is not empty, is not
 * absolute, has no drive prefix, contains no backslash, NUL or control character, and has no
 * empty, `.` or `..` segment. A trailing slash is rejected, so `src/` is written `src`.
 *
 * Stable API: `isSafeRelativePath`, `sensitivePathReason`, `isSkippedName`,
 * `unreadablePathReason`, `SKIPPED_DIRECTORIES`.
 *
 * Sensitive paths (findings I-8 and C-6). `sensitivePathReason` names the paths that hold
 * credentials or keys: dotenv files, cloud and SSH credential directories, private keys and
 * keystores, package registry and build tool tokens, service-account keys, shell histories and
 * infrastructure state. snapshot-loader.js refuses to load them.
 *
 * What the rule claims, and what it does not (C-6). It claims that a path whose name matches is
 * refused, whatever the file holds. It does not claim that a path whose name does not match is
 * safe: a denylist by name cannot be complete, because it cannot know that `notes.txt` holds a
 * password or that a provider it has never heard of names its key file `deploy.dat`. That gap is
 * not closed here. snapshot-loader.js bounds it by scanning file content for named credential
 * formats, for secret-looking assignments, for connection strings and for high-entropy tokens, and
 * it says in its own header which cases still get through. This module is the cheap first layer,
 * applied before a file is opened.
 *
 * The rule is applied to every segment of the path, ignores case and Unicode compatibility forms
 * (macOS and Windows filesystems ignore case), and ignores trailing dots and spaces, which
 * Windows drops. Public halves of key pairs (`id_rsa.pub`) and dotenv templates (`.env.example`)
 * are not sensitive. The loader lets a caller allow one exact path.
 *
 * Paths the loader never reads (finding I-A). The loader skips `.git` and `node_modules` at any
 * depth (SKIPPED_DIRECTORIES). A check that names such a path, or a path below one, can never see
 * what is there: `file_absent` would pass on a file that is on disk and `file_exists` could never
 * pass. `unreadablePathReason` names the rule so checks.js can reject such a path as a validation
 * error instead of accepting a check that cannot fail. The comparison uses the same fold as the
 * sensitive-path rule (case, compatibility forms, trailing dots and spaces), and the loader uses
 * this function to decide what to skip, so the two cannot drift apart.
 */

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const DRIVE_PREFIX = /^[A-Za-z]:/;

/** True when `value` is a string that names a location inside a workspace. */
function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (value.startsWith('/') || DRIVE_PREFIX.test(value)) return false;
  if (value.includes('\\') || CONTROL_CHARACTERS.test(value)) return false;
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

// I-8: a directory of any of these names holds credentials, so nothing under it is loaded.
const SENSITIVE_DIRECTORIES = Object.freeze([
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  '.azure',
  '.gcloud',
  '.docker',
  '.password-store',
  // C-6: Oracle Cloud and Terraform Cloud keep API keys and tokens in these. `.cargo` is not
  // listed here because a Cargo home also holds `config.toml`, which is not a secret; its
  // credentials files are listed by name below.
  '.oci',
  '.terraform.d',
]);

// I-8: two-segment locations, for tools that keep credentials under `.config`. C-6 added the
// config directories of other command line tools and Maven's per-user settings, which hold
// server passwords.
const SENSITIVE_DIRECTORY_PAIRS = Object.freeze([
  '.config/gcloud',
  '.config/gh',
  '.config/op',
  '.config/doctl',
  '.config/heroku',
  '.config/rclone',
  '.m2/settings.xml',
  '.m2/settings-security.xml',
]);

// I-8: file names that hold credentials wherever they sit.
const SENSITIVE_FILE_NAMES = new Set([
  'credentials',
  'credentials.json',
  'credentials.yml',
  'credentials.yaml',
  'credentials.csv',
  'accesskeys.csv',
  'rootkey.csv',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
  'secrets.toml',
  'secret.json',
  'client_secret.json',
  'client_secrets.json',
  'service-account.json',
  'service_account.json',
  'serviceaccount.json',
  'application_default_credentials.json',
  '.netrc',
  '_netrc',
  '.npmrc',
  '.pypirc',
  '.pgpass',
  '.my.cnf',
  '.htpasswd',
  '.git-credentials',
  '.dockercfg',
  '.boto',
  '.s3cfg',
  '.authinfo',
  '.authinfo.gpg',
  '.vault-token',
  '.envrc',
  'kubeconfig',
  'terraform.tfstate',
  'terraform.tfstate.backup',
  '.bash_history',
  '.zsh_history',
  '.sh_history',
  '.python_history',
  '.node_repl_history',
  '.psql_history',
  '.mysql_history',
  // C-6: Yarn Berry keeps `npmAuthToken` in these; Terraform CLI keeps registry tokens in them.
  '.yarnrc',
  '.yarnrc.yml',
  '.yarnrc.yaml',
  '.terraformrc',
  'terraform.rc',
  // C-6: Docker's flat secret file and the Kubernetes dockerconfigjson secret name.
  '.dockerconfigjson',
]);

// C-6: names matched by shape. `credentials.toml` (Cargo), `credentials.ini`, `gcp-key.json` and
// `my_secrets.yaml` are all real names for credential files, and a fixed list cannot enumerate
// them. A bare `credentials.md` or `secrets.md` stays allowed: documentation about credentials
// is not one, and the content scan still reads it.
const SENSITIVE_NAME_PATTERNS = Object.freeze([
  {
    pattern: /(?:^|[-_.])(?:credentials?|secrets?)\.(?:toml|ini|conf|cfg|xml|properties|txt|json|ya?ml|csv)$/,
    reason: 'its name marks it as a credentials or secrets file',
  },
  {
    pattern: /(?:^|[-_.])key\.json$|service[-_]?account[^/]*\.json$|(?:^|[-_.])sa[-_.]key[^/]*\.json$/,
    reason: 'its name marks it as a cloud service-account key',
  },
  { pattern: /\.kubeconfig$/, reason: 'its name marks it as a Kubernetes client configuration' },
]);

// I-8: file extensions of private keys, keystores and infrastructure variables and state.
const SENSITIVE_EXTENSIONS = Object.freeze([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.p8',
  '.jks',
  '.keystore',
  '.ppk',
  '.kdbx',
  '.gpg',
  '.pgp',
  '.tfvars',
  '.tfstate',
]);

// I-8: a dotenv file with one of these last suffixes is a template and holds no values.
const DOTENV_TEMPLATE_SUFFIXES = Object.freeze(['example', 'sample', 'template', 'dist']);
const PRIVATE_KEY_NAME = /^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?(?:[-_.].*)?$/;

/** I-8: one path segment in the form the rules compare. */
function foldedSegment(segment) {
  return segment.normalize('NFKC').toLowerCase().replace(/[. ]+$/, '');
}

function dotenvReason(name) {
  if (name === '.env') return 'a dotenv file';
  if (name.startsWith('.env.') && !DOTENV_TEMPLATE_SUFFIXES.includes(name.split('.').pop())) return 'a dotenv file';
  if (name.endsWith('.env') && name.length > '.env'.length) return 'a dotenv file';
  return null;
}

/**
 * I-8: why the loader must not read `relativePath`, or null when its name is not sensitive. The
 * answer depends on the name alone and never on file content. A non-string gives null, because
 * `isSafeRelativePath` is the gate for what is a path at all.
 */
function sensitivePathReason(relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '') return null;
  const segments = relativePath.split('/').map(foldedSegment);
  for (const segment of segments) {
    if (SENSITIVE_DIRECTORIES.includes(segment)) return `it is under or named ${segment}, a credentials location`;
  }
  for (let i = 0; i + 1 < segments.length; i += 1) {
    const pair = `${segments[i]}/${segments[i + 1]}`;
    if (SENSITIVE_DIRECTORY_PAIRS.includes(pair)) return `it is under ${pair}, a credentials location`;
  }
  const name = segments[segments.length - 1];
  const dotenv = dotenvReason(name);
  if (dotenv !== null) return `its name marks it as ${dotenv}`;
  if (SENSITIVE_FILE_NAMES.has(name)) return `its name (${name}) marks it as a credentials, token or state file`;
  if (PRIVATE_KEY_NAME.test(name) && !name.endsWith('.pub')) return 'its name marks it as an SSH private key';
  const extension = SENSITIVE_EXTENSIONS.find((suffix) => name.endsWith(suffix));
  if (extension !== undefined) return `its extension (${extension}) marks it as a key, keystore or secrets file`;
  // C-6: names recognised by shape, after the exact names so the more specific reason wins.
  const shaped = SENSITIVE_NAME_PATTERNS.find(({ pattern }) => pattern.test(name));
  if (shaped !== undefined) return shaped.reason;
  return null;
}

/**
 * I-A: the entries the loader skips at any depth, whatever their type. `.git` is a directory in a
 * clone and a one-line file in a worktree or submodule; `node_modules` holds installed code, not
 * the subject's work. Listed here, and not in snapshot-loader.js, so that checks.js and the loader
 * read one definition.
 */
const SKIPPED_DIRECTORIES = Object.freeze(['.git', 'node_modules']);

/** I-A: whether a single path segment names an entry the loader skips. Folds like the sensitive rule. */
function isSkippedName(segment) {
  return typeof segment === 'string' && SKIPPED_DIRECTORIES.includes(foldedSegment(segment));
}

/**
 * I-A: why the loader will never read `relativePath`, or null when it can. A path is unreadable when
 * any of its segments is a skipped name: the file is never in a snapshot, so a check on it cannot
 * observe it. A non-string gives null; `isSafeRelativePath` is the gate for what is a path at all.
 */
function unreadablePathReason(relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '') return null;
  const hidden = relativePath.split('/').find(isSkippedName);
  return hidden === undefined
    ? null
    : `it is under or named ${foldedSegment(hidden)}, which the snapshot loader skips at any depth, so no check can see what is there`;
}

module.exports = { isSafeRelativePath, sensitivePathReason, isSkippedName, unreadablePathReason, SKIPPED_DIRECTORIES };
