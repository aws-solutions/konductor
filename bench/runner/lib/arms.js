// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = require('./arm-source.js');

const MAIN_LABEL = 'main-unreleased';
const OC_PREFIX = 'oc-';
const KNOWN_ARMS = ['vanilla', 'v1.0.0', 'v1.1.0', 'v1.2.0', 'main', 'oc-vanilla', 'oc-v1.2.0', 'oc-main'];

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitSha(repo, ref) {
  return git(repo, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

function tryGitSha(repo, ref) {
  try { return gitSha(repo, ref); } catch { return null; }
}

// `main` is the unreleased upstream main as the local remote-tracking ref knows it.
// Nothing is fetched. Without origin/main it falls back to the local branch and says so.
function resolveMain(repo) {
  const originSha = tryGitSha(repo, 'refs/remotes/origin/main');
  const localSha = tryGitSha(repo, 'refs/heads/main');
  const commitSha = originSha || localSha;
  if (!commitSha) throw new Error('neither origin/main nor local main exists');
  const behindOrigin = originSha && localSha ? Number(git(repo, ['rev-list', '--count', `${localSha}..${originSha}`])) : null;
  const warnings = originSha ? [] : ['origin/main not found locally; using local main (not upstream)'];
  return {
    id: 'main',
    label: `${MAIN_LABEL}@${commitSha.slice(0, 7)}`,
    ref: originSha ? 'origin/main' : 'main',
    commitSha,
    originMainSha: originSha,
    localMainSha: localSha,
    behindOrigin,
    warnings,
  };
}

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,40}$/;
// A release-tag-shaped name stays a bare tag arm (v1.2.0) and cannot be pointed at another ref.
const TAG_NAME_RE = /^v\d+\.\d+\.\d+$/;

/**
 * Arm spec grammar: `vanilla` | `main` | `vX.Y.Z` (a release tag) | `name=<git ref>` | `name=dir:<path>`,
 * optionally prefixed `oc-` for the opencode runtime. A bare ref without a name is refused so a label always
 * says what it is.
 */
function parseArmSpec(spec) {
  if (spec.startsWith(OC_PREFIX)) return { ...parseArmSpec(spec.slice(OC_PREFIX.length)), oc: true };
  if (spec === 'vanilla') return { kind: 'vanilla', name: 'vanilla' };
  const eq = spec.indexOf('=');
  if (eq === -1) {
    if (spec === 'main') return { kind: 'main', name: 'main' };
    if (TAG_NAME_RE.test(spec)) return { kind: 'git', name: spec, ref: spec, bare: true };
    throw new Error(`arm "${spec}" is not a known arm (vanilla, main, vX.Y.Z). To benchmark a git ref use name=ref, for example pr-95=${/^[\w./-]+$/.test(spec) ? spec : '<ref>'}; for a working tree use name=dir:<path>`);
  }
  const name = spec.slice(0, eq);
  const ref = spec.slice(eq + 1);
  if (name === 'vanilla' || name === 'main') throw new Error(`arm name "${name}" is reserved`);
  if (TAG_NAME_RE.test(name)) {
    if (ref !== name) throw new Error(`arm name "${name}" is reserved for the release tag of that name (use ${name} or ${name}=${name}); pick another name for ref "${ref}"`);
    return { kind: 'git', name, ref, bare: true };
  }
  if (!NAME_RE.test(name)) throw new Error(`arm name "${name}" is invalid: use [a-z0-9][a-z0-9._-]{0,40}`);
  if (!ref) throw new Error(`arm "${name}" needs a ref after "=" (name=<git ref> or name=dir:<path>)`);
  if (ref.startsWith('dir:')) {
    const p = ref.slice(4);
    if (!p) throw new Error(`arm "${name}" needs a path after "dir:"`);
    return { kind: 'dir', name, path: p };
  }
  return { kind: 'git', name, ref };
}

function gitArm(parsed, repo) {
  const { sha, refResolved } = source.resolveRef(repo, parsed.ref);
  return {
    id: parsed.name,
    label: parsed.bare ? parsed.name : `${parsed.name}@${sha.slice(0, 7)}`,
    ref: parsed.ref,
    refResolved,
    commitSha: sha,
    warnings: [],
  };
}

function dirArm(parsed, repo) {
  const dir = path.resolve(parsed.path);
  const d = source.describeDir(repo, dir);
  return {
    id: parsed.name,
    label: `${parsed.name}@${d.contentHash.slice(0, 12)}`,
    ref: `dir:${dir}`,
    refResolved: null,
    commitSha: null,
    dir,
    ...d,
  };
}

// Fields every non-vanilla arm carries, whatever its source (they are copied into run-config and result.json).
function withProvenance(base, repo) {
  if (base.source === 'dir') return { ...base, cacheKey: base.contentHash.slice(0, 12) };
  return {
    source: 'git',
    dirty: false,
    contentHash: source.treeOf(repo, base.commitSha),
    baseSha: null,
    ...source.distanceFromMain(repo, base.commitSha),
    cacheKey: base.commitSha.slice(0, 12),
    ...base,
  };
}

// An arm is a ref plus a condition. Vanilla has no ref: the agent CLI with nothing installed. An `oc-` arm is
// the same condition run through opencode instead of kiro-cli (runtime 'opencode').
function resolveArm(spec, repo) {
  const parsed = parseArmSpec(spec);
  if (parsed.oc) {
    const base = resolveArm(spec.slice(OC_PREFIX.length), repo);
    return { ...base, id: `${OC_PREFIX}${base.id}`, label: `${OC_PREFIX}${base.label}`, runtime: 'opencode', harness: base.vanilla ? 'none' : 'claude' };
  }
  if (parsed.kind === 'vanilla') {
    return { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, source: null, dirty: null, contentHash: null, harness: 'none', runtime: 'kiro-cli', agent: null, vanilla: true, warnings: [] };
  }
  const base = parsed.kind === 'main' ? resolveMain(repo) : parsed.kind === 'dir' ? { ...dirArm(parsed, repo), source: 'dir' } : gitArm(parsed, repo);
  return { ...withProvenance(base, repo), harness: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor', vanilla: false };
}

// Resolves a list of specs and refuses duplicate arm ids (the id names a directory in the run output).
function resolveArms(specs, repo) {
  const arms = specs.map((s) => resolveArm(s, repo));
  const seen = new Set();
  for (const a of arms) {
    if (seen.has(a.id)) throw new Error(`arm "${a.id}" is given twice; arm names must be unique within a run`);
    seen.add(a.id);
  }
  return arms;
}

function listArms() {
  return KNOWN_ARMS.map((id) => {
    const oc = id.startsWith(OC_PREFIX);
    const base = oc ? id.slice(OC_PREFIX.length) : id;
    const vanilla = base === 'vanilla';
    return {
      id,
      condition: oc
        ? (vanilla ? 'opencode on Bedrock, empty config, no agent' : 'opencode, --agent konductor (claude harness content translated)')
        : (vanilla ? 'kiro-cli, empty ~/.kiro, no --agent' : '--agent konductor'),
      ref: base === 'vanilla' ? null : base,
      note: base === 'main' ? `local origin/main (no fetch), labelled ${oc ? OC_PREFIX : ''}${MAIN_LABEL}@<sha>` : '',
    };
  });
}

const ARM_SYNTAX = [
  'Arm syntax for --arms (comma separated):',
  '  vanilla | v1.0.0 | v1.1.0 | v1.2.0 | main      built-in arms (main = local origin/main, no fetch)',
  '  name=<git ref>      a branch, tag, remote-tracking ref (origin/feat/x), refs/pull/<n>/head or a commit SHA,',
  '                      resolved in --repo-root without fetching; built from `git archive`, a dirty tree never leaks',
  '  name=dir:<path>     a working-tree directory (a worktree or checkout), snapshot of tracked and untracked',
  '                      files that are not ignored; label name@<hash12>, recorded as dirty',
  '  name: [a-z0-9][a-z0-9._-]{0,40}; vanilla, main and vX.Y.Z are reserved. A bare ref (feat/x) is refused.',
  '  A ref that is not local is never fetched; run `git fetch origin pull/<n>/head:pr-<n>` yourself, then pr-<n>=pr-<n>.',
].join('\n');

const cell = (v) => (v === null || v === undefined ? '-' : String(v));

// One line per resolved arm for `list-arms --arms`.
function formatArmRows(arms) {
  const rows = [['arm', 'source', 'ref', 'commit', 'vs origin/main', 'state']];
  for (const a of arms) {
    const dist = a.commitsAhead === null || a.commitsAhead === undefined
      ? '-'
      : `${a.commitsAhead} ahead, ${a.filesChanged ? `${a.filesChanged.count} files` : 'files n/a'}`;
    rows.push([
      a.label,
      cell(a.source),
      cell(a.ref),
      a.vanilla ? '-' : a.source === 'dir' ? `dir:${a.contentHash.slice(0, 10)}${a.baseSha ? ` base ${a.baseSha.slice(0, 10)}` : ''}` : a.commitSha.slice(0, 10),
      dist,
      a.vanilla ? '-' : a.dirty ? 'dirty' : 'clean',
    ]);
  }
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  return rows.map((r) => r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd()).join('\n');
}

module.exports = { resolveArm, resolveArms, parseArmSpec, resolveMain, listArms, formatArmRows, ARM_SYNTAX, KNOWN_ARMS, MAIN_LABEL, OC_PREFIX };
