// SPDX-License-Identifier: Apache-2.0
/**
 * Safe relative path unit tests
 *
 * Run: node --test bench/test/safe-path.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { isSafeRelativePath, sensitivePathReason } = require('../lib/safe-path');

test('accepts plain relative paths', () => {
  for (const ok of ['a', 'a.txt', 'src/index.js', 'docs/a/b/c.md', '.hidden', 'dir/.hidden', 'a..b', 'a b/c']) {
    assert.equal(isSafeRelativePath(ok), true, ok);
  }
});

test('rejects non-strings and the empty string', () => {
  for (const bad of [undefined, null, 0, 1, true, {}, [], ['a'], () => 'a', '']) {
    assert.equal(isSafeRelativePath(bad), false, String(bad));
  }
});

test('rejects absolute paths and drive prefixes', () => {
  for (const bad of ['/etc/passwd', '/', 'C:/x', 'c:x', 'Z:\\x']) {
    assert.equal(isSafeRelativePath(bad), false, bad);
  }
});

test('rejects parent, current and empty segments', () => {
  for (const bad of ['..', '../a', 'a/..', 'a/../b', '.', './a', 'a/./b', 'a//b', 'a/', 'src/']) {
    assert.equal(isSafeRelativePath(bad), false, bad);
  }
});

test('rejects backslashes and control characters', () => {
  for (const bad of ['a\\b', 'a\0b', 'a\nb', 'a\tb', 'a\u007fb']) {
    assert.equal(isSafeRelativePath(bad), false, JSON.stringify(bad));
  }
});

// --- I-8: sensitive paths ----------------------------------------------------------------------

test('I-8: credential locations, key files and dotenv files are sensitive, at any depth', () => {
  for (const name of [
    '.env',
    '.env.local',
    '.env.production',
    'app/.env',
    'prod.env',
    '.aws/credentials',
    '.aws/config',
    'home/.ssh/known_hosts',
    '.ssh/id_ed25519',
    'id_rsa',
    'keys/id_ecdsa_sk',
    'server.pem',
    'tls/private.key',
    'store.p12',
    'release.keystore',
    '.netrc',
    '.pypirc',
    '.git-credentials',
    '.kube/config',
    '.docker/config.json',
    '.config/gcloud/credentials.db',
    'terraform.tfstate',
    'prod.tfvars',
    '.bash_history',
    'credentials',
    'secrets.yaml',
  ]) {
    assert.equal(typeof sensitivePathReason(name), 'string', name);
  }
});

test('I-8: the reason names the rule and never repeats content, and a plain name has none', () => {
  assert.match(sensitivePathReason('.env'), /dotenv/);
  assert.match(sensitivePathReason('a/.aws/credentials'), /\.aws, a credentials location/);
  assert.match(sensitivePathReason('id_rsa'), /SSH private key/);
  assert.equal(sensitivePathReason('README.md'), null);
  assert.equal(sensitivePathReason('src/environment.js'), null);
});

test('I-8: the rule folds case, compatibility forms and trailing dots and spaces', () => {
  for (const name of ['.ENV', 'ID_RSA', '.AWS/x', 'a/.Ssh/b', '\uff49\uff44_rsa', '.env.', '.env  ', 'KEY.PEM']) {
    assert.equal(typeof sensitivePathReason(name), 'string', JSON.stringify(name));
  }
});

test('I-8: public keys and dotenv templates are allowed', () => {
  for (const name of ['id_rsa.pub', 'id_ed25519.pub', '.env.example', '.env.sample', '.env.template', '.env.dist', 'docs/.ENV.EXAMPLE']) {
    assert.equal(sensitivePathReason(name), null, name);
  }
});

test('I-8: a value that is not a path gives no reason', () => {
  for (const bad of [undefined, null, 0, {}, [], '']) assert.equal(sensitivePathReason(bad), null, String(bad));
});

// --- C-6: credential names the first denylist did not list -------------------------------------

test('C-6: Cargo, INI and Yarn credential files, cloud service-account keys and kubeconfigs are sensitive', () => {
  for (const name of [
    '.cargo/credentials.toml',
    '.cargo/credentials',
    'credentials.ini',
    'credentials.toml',
    'credentials.conf',
    'config/credentials.properties',
    'gcp-credentials.json',
    'my_secrets.yaml',
    '.yarnrc.yml',
    '.yarnrc',
    '.terraformrc',
    'gcp-key.json',
    'key.json',
    'prod_key.json',
    'service-account-prod.json',
    'sa-key.json',
    'ops.kubeconfig',
    '.oci/config',
    '.terraform.d/credentials.tfrc.json',
    '.config/doctl/config.yaml',
    '.m2/settings.xml',
  ]) {
    assert.equal(typeof sensitivePathReason(name), 'string', name);
  }
});

test('C-6: documentation about credentials and ordinary key names are not sensitive by name', () => {
  // The name rule claims only that a matching name is refused. A name that does not match is not
  // claimed safe; the content scan in snapshot-loader.js is the layer that reads these.
  for (const name of ['credentials.md', 'secrets.md', 'docs/credentials-guide.md', 'src/keyboard.js', 'monkey.json', 'turkey.json', 'config.toml', '.cargo/config.toml']) {
    assert.equal(sensitivePathReason(name), null, name);
  }
});

// --- I-A: names the loader never reads ---------------------------------------------------------

const { isSkippedName, unreadablePathReason, SKIPPED_DIRECTORIES } = require('../lib/safe-path');

test('I-A: the skipped names are .git and node_modules, matched at any depth, ignoring case and trailing dots', () => {
  assert.deepEqual([...SKIPPED_DIRECTORIES], ['.git', 'node_modules']);
  for (const name of ['.git', '.GIT', 'node_modules', 'Node_Modules', '.git.', 'node_modules ', '\uff4eode_modules']) {
    assert.equal(isSkippedName(name), true, JSON.stringify(name));
  }
  for (const name of ['.github', '.gitignore', 'git', 'node_module', 'my_node_modules', 'src', '', 'a/.git']) {
    assert.equal(isSkippedName(name), false, JSON.stringify(name));
  }
  for (const bad of [undefined, null, 0, {}, []]) assert.equal(isSkippedName(bad), false, String(bad));
});

test('I-A: a path through a skipped name is unreadable, with a reason that names the name and never a path', () => {
  for (const unreadable of ['src/node_modules/evil.js', 'src/.git/hook', '.git', 'node_modules', 'a/b/.GIT/c', 'x/Node_Modules']) {
    const reason = unreadablePathReason(unreadable);
    assert.equal(typeof reason, 'string', unreadable);
    assert.match(reason, /which the snapshot loader skips at any depth/, unreadable);
  }
  for (const readable of ['src/a.js', '.github/workflows/ci.yml', '.gitignore', 'docs/node_modules_guide.md', 'a/b']) {
    assert.equal(unreadablePathReason(readable), null, readable);
  }
  for (const bad of [undefined, null, 0, {}, [], '']) assert.equal(unreadablePathReason(bad), null, String(bad));
});
