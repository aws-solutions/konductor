#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The release custodian's tool for a plant release: make the signing key, pin its public half, sign a bundle, verify it
// with the runner's own intake. It sits beside release-guard.js, outside bench.js, because only the custodian runs it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { intakeRelease, discardRelease, oddFileReason } = require('../../runner/lib/plant/intake.js');
const { AGENT_ENGINES } = require('../../runner/lib/harness/runtime.js');
const { keyIdOf, sha256Hex, ReleaseRefused, MANIFEST_FILE, SIGNATURE_FILE } = require('../../runner/lib/plant/manifest.js');

const PINNED_KEYS_FILE = path.join(__dirname, '../../runner/lib/plant/pinned-keys.json');
const PRIVATE_KEY_FILE = 'private.pem';
const PUBLIC_KEY_FILE = 'public.pem';
const ANALYSIS_PLAN = 'analysis-plan.md';
const REFUSAL_RULE = 'refusal-rule.json';
const TASK_FILE = /^tasks\/([^/]+)\.json$/;
const EXCLUSION_POLICY = 'plant-failure-v1';
// Fields sign computes itself; the --fields file may not set them.
const COMPUTED_FIELDS = ['manifestVersion', 'release', 'keyId', 'files', 'maxParallel', 'analysisPlanSha256', 'exclusionPolicy'];

/** A problem with how the tool was used or with its input files; the command prints it and exits 2. */
class ToolError extends Error {}

/** The flags of `args` as `{name: value}`. Throws ToolError for a flag not in `allowed`, a flag with no value, or a stray word. */
function parseFlags(args, allowed) {
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.includes(name)) throw new ToolError(`unknown or misplaced argument ${args[i]}; allowed: ${allowed.map((a) => `--${a}`).join(' ')}`);
    if (args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new ToolError(`--${name} needs a value`);
    flags[name] = args[i + 1];
  }
  return flags;
}

/** Throws ToolError naming every flag in `required` that `flags` lacks. */
function requireFlags(flags, required) {
  const missing = required.filter((name) => !flags[name]);
  if (missing.length) throw new ToolError(`missing: ${missing.map((m) => `--${m}`).join(', ')}`);
}

/** The git work tree root that holds `dir` (which need not exist yet), found by walking up to a `.git`; null when none does. */
function enclosingRepo(dir) {
  let cur = path.resolve(dir);
  while (!fs.existsSync(cur)) cur = path.dirname(cur);
  cur = fs.realpathSync(cur);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

const isPrivatePem = (text) => /PRIVATE KEY/.test(text);

/** The base64 SPKI DER of the Ed25519 public key in `text` (a PEM, or the base64 DER). Throws ToolError for private material or any other key. */
function publicKeyDerOf(text) {
  if (isPrivatePem(text)) throw new ToolError('that is a private key; give the public key only, and never paste or commit the private one');
  const trimmed = text.trim();
  let key;
  try {
    key = crypto.createPublicKey(trimmed.startsWith('-----') ? trimmed : { key: Buffer.from(trimmed, 'base64'), format: 'der', type: 'spki' });
  } catch { throw new ToolError('that is not a public key (a PEM, or base64 SPKI DER)'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new ToolError(`release keys are Ed25519; this one is ${key.asymmetricKeyType}`);
  return key.export({ type: 'spki', format: 'der' }).toString('base64');
}

/** The pinned entry for a base64 SPKI DER public key, ready to add to the list. */
const pinnedEntryOf = (publicKey) => ({ keyId: keyIdOf(publicKey), publicKey, status: 'active' });

/** Makes the key pair in `dir` (mode 700), the private PEM mode 600. Refuses a dir inside a git repo and an existing key. Returns the entry. */
function keygen(dir) {
  const repo = enclosingRepo(dir);
  if (repo) throw new ToolError(`${dir} is inside the git repo ${repo}; keep the private key outside every repo, for example ~/.plant-release-key`);
  const privatePath = path.join(dir, PRIVATE_KEY_FILE);
  if (fs.existsSync(privatePath)) throw new ToolError(`${privatePath} already exists; keygen never overwrites a key`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(path.join(dir, PUBLIC_KEY_FILE), publicPem, { mode: 0o644 });
  return pinnedEntryOf(publicKeyDerOf(publicPem));
}

/** The list in the pinned-keys file `file`. */
const readKeys = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Writes `keys` to the pinned-keys file `file`, one entry per line. */
function writeKeys(file, keys) {
  fs.writeFileSync(file, keys.length ? `[\n${keys.map((k) => `  ${JSON.stringify(k)}`).join(',\n')}\n]\n` : '[]\n');
}

/** Adds the public key `source` (a file, or the PEM or base64 itself) as active to pinned-keys `file`. Returns the entry. */
function pin(source, file) {
  const text = fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : source;
  const entry = pinnedEntryOf(publicKeyDerOf(text));
  const keys = readKeys(file);
  if (keys.some((k) => k.keyId === entry.keyId)) throw new ToolError(`key ${entry.keyId} is already pinned`);
  writeKeys(file, [...keys, entry]);
  return entry;
}

/** Marks the pinned key `keyId` revoked in pinned-keys `file`. Throws ToolError when it is not pinned. */
function revoke(keyId, file) {
  const keys = readKeys(file);
  const key = keys.find((k) => k.keyId === keyId);
  if (!key) throw new ToolError(`key ${keyId} is not pinned`);
  key.status = 'revoked';
  writeKeys(file, keys);
}

/** The Ed25519 private key in file `keyFile`. Throws ToolError when it is group or world readable, not a private PEM, or not Ed25519. */
function readPrivateKey(keyFile) {
  if (fs.statSync(keyFile).mode & 0o077) throw new ToolError(`${keyFile} is readable by others; run chmod 600 on it`);
  let key;
  try { key = crypto.createPrivateKey(fs.readFileSync(keyFile)); } catch { throw new ToolError(`${keyFile} is not a private key PEM`); }
  if (key.asymmetricKeyType !== 'ed25519') throw new ToolError(`release keys are Ed25519; ${keyFile} is ${key.asymmetricKeyType}`);
  return key;
}

/** Every file path under `dir`, relative with `/`, sorted. Throws ReleaseRefused on a link or other odd file, as intake does. */
function listRelease(dir, rel = '') {
  const found = [];
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    const relPath = rel ? `${rel}/${name}` : name;
    const st = fs.lstatSync(path.join(dir, relPath));
    const why = oddFileReason(st);
    if (why) throw new ReleaseRefused(`release file ${relPath} is ${why}`);
    if (st.isDirectory()) found.push(...listRelease(dir, relPath));
    else found.push(relPath);
  }
  return found;
}

/** The owner-only fields from the JSON file `file`. Throws ToolError for bad JSON or a field that sign computes itself. */
function readFields(file) {
  let fields;
  try { fields = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new ToolError(`${file}: ${e.message}`); }
  const computed = COMPUTED_FIELDS.filter((f) => f in fields);
  if (computed.length) throw new ToolError(`${file} may not set ${computed.join(', ')}; sign computes those`);
  return fields;
}

/** What the release needs that is not there: a list of plain-words problems, empty when nothing is missing. */
function missingFor({ releaseId, fields, paths }) {
  const missing = [];
  if (!releaseId) missing.push('--release-id (the release name, for example plant-r1)');
  for (const need of [REFUSAL_RULE, ANALYSIS_PLAN]) if (!paths.includes(need)) missing.push(`${need} in the release`);
  const kiro = fields.versions?.kiroCli;
  if (!kiro?.version || !kiro?.sha256 || !AGENT_ENGINES.includes(kiro?.engine)) missing.push(`versions.kiroCli {version, sha256, engine} in the --fields file (engine ${AGENT_ENGINES.join(' or ')})`);
  const taskIds = paths.map((p) => TASK_FILE.exec(p)?.[1]).filter(Boolean);
  if (!taskIds.length) missing.push('tasks/<id>.json in the release');
  const unseeded = taskIds.filter((id) => !Number.isInteger(fields.seeds?.[id]));
  if (unseeded.length) missing.push(`an integer seeds entry in the --fields file for: ${unseeded.join(', ')}`);
  return missing;
}

/**
 * Writes manifest.json and manifest.json.sig into release `dir`. `releaseId` names the release, `keyFile` is the private
 * key, `fieldsFile` holds the owner-only fields (seeds, versions.kiroCli, and any of model, window, armOrderSeed,
 * heldBackSha256, analysisCodeSha256, formats). Every other file under `dir` is listed. Returns `{keyId, sha256}`.
 */
function sign({ dir, keyFile, releaseId, fieldsFile }) {
  const key = readPrivateKey(keyFile);
  const fields = fieldsFile ? readFields(fieldsFile) : {};
  const paths = listRelease(dir).filter((p) => p !== MANIFEST_FILE && p !== SIGNATURE_FILE);
  const missing = missingFor({ releaseId, fields, paths });
  if (missing.length) throw new ToolError(`cannot sign; missing:\n  ${missing.join('\n  ')}`);
  const hashOf = (rel) => sha256Hex(fs.readFileSync(path.join(dir, rel)));
  const keyId = keyIdOf(crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64'));
  const manifest = {
    manifestVersion: 1, formats: {}, release: releaseId, keyId, ...fields,
    files: paths.map((p) => ({ path: p, sha256: hashOf(p) })), maxParallel: 1,
    analysisPlanSha256: hashOf(ANALYSIS_PLAN), exclusionPolicy: EXCLUSION_POLICY,
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, MANIFEST_FILE), bytes);
  fs.writeFileSync(path.join(dir, SIGNATURE_FILE), crypto.sign(null, bytes, key).toString('base64'));
  return { keyId, sha256: sha256Hex(bytes) };
}

/** Runs the runner's own intake on release `dir` against pinned-keys `file`, on a throwaway copy. Returns `{release, keyId, manifestSha256}`; throws ReleaseRefused. */
function verify(dir, file) {
  const manifestPath = path.join(dir, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) throw new ReleaseRefused(`release needs ${MANIFEST_FILE} and ${SIGNATURE_FILE}`);
  const privateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kplant-verify-'));
  try {
    const expectedSha256 = sha256Hex(fs.readFileSync(manifestPath));
    const checked = intakeRelease({ dir, expectedSha256, privateRoot, keys: readKeys(file) });
    const result = { release: checked.manifest.release, keyId: checked.keyId, manifestSha256: checked.manifestSha256 };
    discardRelease(checked.root);
    return result;
  } finally {
    fs.rmSync(privateRoot, { recursive: true, force: true });
  }
}

const USAGE = [
  'usage: plant-release.js keygen --out DIR',
  '       plant-release.js pin --public KEYFILE_OR_PEM [--keys FILE]',
  '       plant-release.js revoke --key-id ID [--keys FILE]',
  '       plant-release.js sign --release DIR --key KEYFILE --release-id ID --fields FILE',
  '       plant-release.js verify --release DIR [--keys FILE]',
  '--keys FILE names a pinned-keys file other than the runner\'s own (for a dry run).', '',
].join('\n');

/** The command lines for each subcommand: `{name: (flags, out) => exit code}`. */
const COMMANDS = {
  keygen(args, out) {
    const flags = parseFlags(args, ['out']);
    requireFlags(flags, ['out']);
    const entry = keygen(flags.out);
    out.write(`private key: ${path.join(flags.out, PRIVATE_KEY_FILE)} (keep it outside every repo; never commit or paste it)\n`
      + `public key:  ${entry.publicKey}\nkey id:      ${entry.keyId}\n`
      + `pinned entry: ${JSON.stringify(entry)}\nto pin it:   plant-release.js pin --public ${path.join(flags.out, PUBLIC_KEY_FILE)}\n`);
    return 0;
  },
  pin(args, out) {
    const flags = parseFlags(args, ['public', 'keys']);
    requireFlags(flags, ['public']);
    const entry = pin(flags.public, flags.keys ?? PINNED_KEYS_FILE);
    out.write(`pinned key ${entry.keyId} as active\n`);
    return 0;
  },
  revoke(args, out) {
    const flags = parseFlags(args, ['key-id', 'keys']);
    requireFlags(flags, ['key-id']);
    revoke(flags['key-id'], flags.keys ?? PINNED_KEYS_FILE);
    out.write(`revoked key ${flags['key-id']}\n`);
    return 0;
  },
  sign(args, out) {
    const flags = parseFlags(args, ['release', 'key', 'release-id', 'fields']);
    requireFlags(flags, ['release', 'key']);
    const done = sign({ dir: flags.release, keyFile: flags.key, releaseId: flags['release-id'], fieldsFile: flags.fields });
    out.write(`signed ${flags.release}\nkey id: ${done.keyId}\nmanifest SHA-256 (--plant-release-sha256): ${done.sha256}\n`);
    return 0;
  },
  verify(args, out) {
    const flags = parseFlags(args, ['release', 'keys']);
    requireFlags(flags, ['release']);
    const done = verify(flags.release, flags.keys ?? PINNED_KEYS_FILE);
    out.write(`verified: release ${done.release}, key ${done.keyId}, manifest SHA-256 ${done.manifestSha256}\n`);
    return 0;
  },
};

/** Runs the command in `argv`; returns the exit code (0 done, 1 the release is refused, 2 usage or a bad input). */
function main(argv, out = process.stdout, err = process.stderr) {
  const [command, ...rest] = argv;
  if (!Object.hasOwn(COMMANDS, command)) {
    err.write(USAGE);
    return 2;
  }
  try {
    return COMMANDS[command](rest, out);
  } catch (e) {
    if (!(e instanceof ReleaseRefused || e instanceof ToolError)) throw e;
    err.write(`plant release: ${e instanceof ReleaseRefused ? 'refused: ' : ''}${e.message}\n`);
    return e instanceof ReleaseRefused ? 1 : 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, keygen, pin, revoke, sign, verify, enclosingRepo, PINNED_KEYS_FILE, ToolError };
