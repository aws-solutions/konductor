// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads and checks a plant release manifest: Ed25519 signature with a key pinned here, never one read from the bundle.

const crypto = require('node:crypto');

const MANIFEST_FILE = 'manifest.json';
const SIGNATURE_FILE = 'manifest.json.sig';
const MANIFEST_VERSION = 1;
const HEX64 = /^[0-9a-f]{64}$/;
// shortcut: no release key exists yet, so every real intake is refused; step 8 adds the custodian's key here.
const PINNED_KEYS = Object.freeze([]);

class ReleaseRefused extends Error {}

const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** The key id of an Ed25519 public key given as base64 SPKI DER: the SHA-256 of the DER bytes, in hex. */
const keyIdOf = (publicKeyB64) => sha256Hex(Buffer.from(publicKeyB64, 'base64'));

/** The pinned entry of `keys` (`[{publicKey, status}]`) whose key id is `keyId`. Throws ReleaseRefused if none or revoked. */
function pinnedKey(keyId, keys) {
  const key = keys.find((k) => keyIdOf(k.publicKey) === keyId);
  if (!key) throw new ReleaseRefused(`release key ${keyId} is not pinned in this runner`);
  if (key.status !== 'active') throw new ReleaseRefused(`release key ${keyId} is ${key.status}`);
  return key;
}

/** Throws ReleaseRefused unless `signatureText` (base64) is a valid Ed25519 signature of `manifestBytes` by `key`. */
function verifySignature(manifestBytes, signatureText, key) {
  const publicKey = crypto.createPublicKey({ key: Buffer.from(key.publicKey, 'base64'), format: 'der', type: 'spki' });
  const signature = Buffer.from(String(signatureText).trim(), 'base64');
  if (!crypto.verify(null, manifestBytes, publicKey, signature)) throw new ReleaseRefused('manifest signature does not verify');
}

/** Throws ReleaseRefused unless `rel` is a plain relative path: no root, no `..`, `.` or empty part, no backslash. */
function checkRelPath(rel) {
  const parts = typeof rel === 'string' ? rel.split('/') : [];
  if (!parts.length || rel.includes('\\') || parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new ReleaseRefused(`manifest path ${JSON.stringify(rel)} is not a plain relative path`);
  }
}

/** Throws ReleaseRefused unless `files` is `[{path, sha256}]` sorted by path, with no duplicate and no manifest file. */
function checkFileList(files) {
  if (!Array.isArray(files) || !files.length) throw new ReleaseRefused('manifest files must be a non-empty list');
  files.forEach((f, i) => {
    checkRelPath(f?.path);
    if (!HEX64.test(f.sha256 ?? '')) throw new ReleaseRefused(`manifest entry ${f.path} has no sha256`);
    if (f.path === MANIFEST_FILE || f.path === SIGNATURE_FILE) throw new ReleaseRefused(`manifest lists ${f.path} itself`);
    if (i > 0 && !(files[i - 1].path < f.path)) throw new ReleaseRefused(`manifest files are not sorted and unique at ${f.path}`);
  });
}

/** The parsed manifest after its version, identity, file list and parallelism are checked. Throws ReleaseRefused. */
function readManifest(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch { throw new ReleaseRefused('manifest.json is not JSON'); }
  if (manifest?.manifestVersion !== MANIFEST_VERSION) throw new ReleaseRefused(`manifestVersion ${manifest?.manifestVersion} is unknown; this runner reads ${MANIFEST_VERSION}`);
  if (typeof manifest.release !== 'string' || !manifest.release || manifest.release.length > 256) throw new ReleaseRefused('manifest release id is missing');
  if (!HEX64.test(manifest.keyId ?? '')) throw new ReleaseRefused('manifest keyId is missing');
  checkFileList(manifest.files);
  if (manifest.maxParallel !== 1) throw new ReleaseRefused(`manifest maxParallel is ${manifest.maxParallel}; Phase 1 releases freeze it at 1`);
  return manifest;
}

/**
 * The checked manifest of one release: `{manifest, manifestSha256, keyId}`.
 * `manifestBytes` and `signatureText` are read from the runner-private copy; `expectedSha256` is the
 * --plant-release-sha256 value; `keys` is the pinned key list (tests pass their own). Throws ReleaseRefused.
 */
function checkManifest({ manifestBytes, signatureText, expectedSha256, keys = PINNED_KEYS }) {
  const manifestSha256 = sha256Hex(manifestBytes);
  if (manifestSha256 !== expectedSha256) throw new ReleaseRefused(`manifest SHA-256 ${manifestSha256} is not the expected ${expectedSha256}`);
  const manifest = readManifest(manifestBytes);
  verifySignature(manifestBytes, signatureText, pinnedKey(manifest.keyId, keys));
  return { manifest, manifestSha256, keyId: manifest.keyId };
}

module.exports = { checkManifest, readManifest, keyIdOf, sha256Hex, ReleaseRefused, PINNED_KEYS, MANIFEST_FILE, SIGNATURE_FILE };
