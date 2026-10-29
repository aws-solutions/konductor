// SPDX-License-Identifier: Apache-2.0
'use strict';

const { execFileSync } = require('node:child_process');

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

// An arm is a ref plus a condition. Vanilla has no ref: the agent CLI with nothing installed. An `oc-` arm is
// the same condition run through opencode instead of kiro-cli (runtime 'opencode').
function resolveArm(id, repo) {
  if (id.startsWith(OC_PREFIX)) {
    const base = resolveArm(id.slice(OC_PREFIX.length), repo);
    return { ...base, id, label: `${OC_PREFIX}${base.label}`, runtime: 'opencode', harness: base.vanilla ? 'none' : 'claude' };
  }
  if (id === 'vanilla') {
    return { id, label: id, ref: null, commitSha: null, harness: 'none', runtime: 'kiro-cli', agent: null, vanilla: true, warnings: [] };
  }
  const base = id === 'main'
    ? resolveMain(repo)
    : { id, label: id, ref: id, commitSha: gitSha(repo, id), warnings: [] };
  return { ...base, harness: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor', vanilla: false };
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

module.exports = { resolveArm, resolveMain, listArms, KNOWN_ARMS, MAIN_LABEL, OC_PREFIX };
