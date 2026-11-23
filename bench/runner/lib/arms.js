// SPDX-License-Identifier: Apache-2.0
'use strict';

const path = require('node:path');
const { execFileSync } = require('node:child_process');
const source = require('./arm-source.js');
const { DESCRIPTORS } = require('./harness/descriptors.js');
const { AGENT_NAME: PLANT_AGENT } = require('./plant/agent-file.js');

const MAIN_LABEL = 'main-unreleased';
// Runtimes other than kiro-cli are selected by an arm-id prefix; the prefixes live in the harness descriptors.
const PREFIXED = DESCRIPTORS.filter((d) => d.armPrefix);
const prefixOf = (runtime) => DESCRIPTORS.find((d) => d.id === runtime).armPrefix;
const OC_PREFIX = prefixOf('opencode');
const CC_PREFIX = prefixOf('claude-code');
const prefixedRuntime = (spec) => PREFIXED.find((d) => spec.startsWith(d.armPrefix));
// The plant arms (FR-9) by external id, with the arm name the gateway and result.json use. Kiro CLI, or Strands under
// `st-`. A `-hooked` arm is Strands only: its agent may carry tool hooks, so its trials are kept apart (design 15.3).
const PLANT_ARMS = Object.freeze({ 'plant-policy': 'policy', 'plant-allowall': 'allow-all' });
const HOOKED_PLANT_ARMS = Object.freeze({ 'plant-policy-hooked': 'policy', 'plant-allowall-hooked': 'allow-all' });
const isPlantArm = (spec) => Object.hasOwn(PLANT_ARMS, spec);
const isHookedPlantArm = (spec) => Object.hasOwn(HOOKED_PLANT_ARMS, spec);
// The runtimes whose descriptor says how to mount the plant (`plant`, DEBT D-111): Kiro CLI, Claude Code and Strands.
const PLANT_RUNTIMES = DESCRIPTORS.filter((d) => d.plant);
const plantRuntimeNames = PLANT_RUNTIMES.map((d) => (d.armPrefix ? `${d.proseName} (${d.armPrefix})` : d.proseName));
const PLANT_ONLY = `plant arms run on ${plantRuntimeNames.slice(0, -1).join(', ')} or ${plantRuntimeNames.at(-1)} only`;
const STRANDS_PREFIX = prefixOf('strands');
const STRANDS_PLANT_ONLY = 'Strands arms are plant arms only (st-plant-policy, st-plant-allowall, st-plant-policy-hooked, st-plant-allowall-hooked)';
/** Every plant arm id a result can carry: the plain ids under each plant runtime's prefix, and the hooked ids under `st-`. */
const PLANT_ARM_IDS = Object.freeze(PLANT_RUNTIMES.flatMap((d) => [...Object.keys(PLANT_ARMS), ...(d.id === 'strands' ? Object.keys(HOOKED_PLANT_ARMS) : [])].map((a) => `${d.armPrefix}${a}`)));
const isPlantArmId = (armId) => PLANT_ARM_IDS.includes(armId);

/**
 * The parsed Strands arm for `rest` (an arm spec with its `st-` prefix removed). Only the plant arms exist; a hooked
 * arm carries `hooks: "own-arm"`, a plain one `hooks: "refuse"` (a counted suite refuses tool hooks on it).
 */
function parseStrandsArm(rest) {
  if (isPlantArm(rest)) return { kind: 'plant', name: `${STRANDS_PREFIX}${rest}`, plantArm: PLANT_ARMS[rest], hooks: 'refuse' };
  if (isHookedPlantArm(rest)) return { kind: 'plant', name: `${STRANDS_PREFIX}${rest}`, plantArm: HOOKED_PLANT_ARMS[rest], hooks: 'own-arm' };
  throw new Error(`arm "${STRANDS_PREFIX}${rest}": ${STRANDS_PLANT_ONLY}`);
}

/** Whether arm spec `s` names a plant arm, under any number of runtime prefixes (`st-` arms are all plant arms). */
function namesPlantArm(s) {
  const n = prefixedRuntime(s);
  if (!n) return isPlantArm(s) || isHookedPlantArm(s);
  return n.id === 'strands' || namesPlantArm(s.slice(n.armPrefix.length));
}

/**
 * Throws when `spec` puts a plant arm under a runtime prefix that cannot run it: one with no plant mount (oc-), a prefix
 * inside a prefix, or a hooked arm outside Strands.
 */
function refusePrefixedPlant(spec, d) {
  const rest = spec.slice(d.armPrefix.length);
  if (!namesPlantArm(rest)) return;
  if (!d.plant || prefixedRuntime(rest)) throw new Error(`arm "${spec}": ${PLANT_ONLY}`);
  if (isHookedPlantArm(rest) && d.id !== 'strands') throw new Error(`arm "${spec}": hooked plant arms run on Strands only (${STRANDS_PREFIX}${rest})`);
}
const KNOWN_ARMS = ['vanilla', 'v1.0.0', 'v1.1.0', 'v1.2.0', 'main', 'oc-vanilla', 'oc-v1.2.0', 'oc-main', 'cc-vanilla', 'cc-main'];

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
 * optionally prefixed `oc-` for the opencode runtime or `cc-` for Claude Code. A bare ref without a name is refused so a label always
 * says what it is.
 */
function parseArmSpec(spec) {
  const d = prefixedRuntime(spec);
  if (d) refusePrefixedPlant(spec, d);
  if (d?.id === 'strands') return { ...parseStrandsArm(spec.slice(d.armPrefix.length)), st: true };
  if (d) return { ...parseArmSpec(spec.slice(d.armPrefix.length)), [d.armPrefix.slice(0, -1)]: true };
  if (spec === 'vanilla') return { kind: 'vanilla', name: 'vanilla' };
  if (isPlantArm(spec)) return { kind: 'plant', name: spec, plantArm: PLANT_ARMS[spec] };
  if (isHookedPlantArm(spec)) throw new Error(`arm "${spec}": hooked plant arms run on Strands only (${STRANDS_PREFIX}${spec})`);
  const eq = spec.indexOf('=');
  if (eq === -1) {
    if (spec === 'main') return { kind: 'main', name: 'main' };
    if (TAG_NAME_RE.test(spec)) return { kind: 'git', name: spec, ref: spec, bare: true };
    throw new Error(`arm "${spec}" is not a known arm (vanilla, main, vX.Y.Z). To benchmark a git ref use name=ref, for example pr-95=${/^[\w./-]+$/.test(spec) ? spec : '<ref>'}; for a working tree use name=dir:<path>`);
  }
  const name = spec.slice(0, eq);
  const ref = spec.slice(eq + 1);
  if (name === 'vanilla' || name === 'main' || isPlantArm(name) || isHookedPlantArm(name)) throw new Error(`arm name "${name}" is reserved`);
  if (TAG_NAME_RE.test(name)) {
    if (ref !== name) throw new Error(`arm name "${name}" is reserved for the release tag of that name (use ${name} or ${name}=${name}); pick another name for ref "${ref}"`);
    return { kind: 'git', name, ref, bare: true };
  }
  if (!NAME_RE.test(name)) throw new Error(`arm name "${name}" is invalid: use [a-z0-9][a-z0-9._-]{0,40}`);
  if (!ref) throw new Error(`arm "${name}" needs a ref after "=" (name=<git ref> or name=dir:<path>)`);
  // A vanilla A/A repeat (vanilla-b=vanilla): the same empty install under another id, so two vanilla replicate sets measure
  // run-to-run noise. "vanilla" is never read as a git ref here.
  if (ref === 'vanilla') return { kind: 'vanilla', name, repeatOf: 'vanilla' };
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
  const d = prefixedRuntime(spec);
  if (d) refusePrefixedPlant(spec, d);
  if (d?.id === 'strands') {
    const parsed = parseStrandsArm(spec.slice(d.armPrefix.length));
    return { id: parsed.name, label: parsed.name, ref: null, commitSha: null, source: null, dirty: null, contentHash: null, armKind: 'plant', runtime: 'strands', agent: null, vanilla: true, plant: { arm: parsed.plantArm, hooks: parsed.hooks }, warnings: [] };
  }
  if (d) {
    const base = resolveArm(spec.slice(d.armPrefix.length), repo);
    const named = { ...base, id: `${d.armPrefix}${base.id}`, label: `${d.armPrefix}${base.label}`, runtime: d.id };
    // A plant arm under cc- keeps the plant arm kind and has no agent: Claude Code gets the shim by --mcp-config.
    if (base.plant) return { ...named, agent: null };
    return { ...named, armKind: base.vanilla ? 'none' : 'claude' };
  }
  const parsed = parseArmSpec(spec);
  if (parsed.kind === 'vanilla') {
    return { id: parsed.name, label: parsed.name, ...(parsed.repeatOf ? { repeatOf: parsed.repeatOf } : {}), ref: null, commitSha: null, source: null, dirty: null, contentHash: null, armKind: 'none', runtime: 'kiro-cli', agent: null, vanilla: true, warnings: [] };
  }
  // A plant arm installs nothing of konductor, so it takes the vanilla install path; `plant` marks the gateway run.
  if (parsed.kind === 'plant') {
    return { id: parsed.name, label: parsed.name, ref: null, commitSha: null, source: null, dirty: null, contentHash: null, armKind: 'plant', runtime: 'kiro-cli', agent: PLANT_AGENT, vanilla: true, plant: { arm: parsed.plantArm }, warnings: [] };
  }
  const base = parsed.kind === 'main' ? resolveMain(repo) : parsed.kind === 'dir' ? { ...dirArm(parsed, repo), source: 'dir' } : gitArm(parsed, repo);
  return { ...withProvenance(base, repo), armKind: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor', vanilla: false };
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
    const cc = id.startsWith(CC_PREFIX);
    const base = oc ? id.slice(OC_PREFIX.length) : cc ? id.slice(CC_PREFIX.length) : id;
    const vanilla = base === 'vanilla';
    return {
      id,
      condition: cc
        ? (vanilla ? 'Claude Code on Bedrock, empty config dir, no agent' : 'Claude Code, --agent konductor (claude harness install)')
        : oc
        ? (vanilla ? 'opencode on Bedrock, empty config, no agent' : 'opencode, --agent konductor (claude harness content translated)')
        : (vanilla ? 'kiro-cli, empty ~/.kiro, no --agent' : '--agent konductor'),
      ref: base === 'vanilla' ? null : base,
      note: base === 'main' ? `local origin/main (no fetch), labelled ${oc ? OC_PREFIX : cc ? CC_PREFIX : ''}${MAIN_LABEL}@<sha>` : '',
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
  '  name=vanilla        a vanilla A/A repeat (vanilla-b=vanilla): the vanilla condition under another id, for a noise floor',
  '  plant-policy | plant-allowall    plant arms on a simulated plant (kiro-cli; never with oc-)',
  '  cc-plant-policy | cc-plant-allowall    the same on Claude Code, with the plant shim as its only MCP server',
  '  st-plant-policy | st-plant-allowall    the same on a Strands agent with forwarding plant tools (kind B);',
  '                      st-plant-policy-hooked | st-plant-allowall-hooked keep an agent with tool hooks apart',
  '  name: [a-z0-9][a-z0-9._-]{0,40}; vanilla, main, vX.Y.Z and the plant arm names are reserved. A bare ref (feat/x) is refused.',
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

module.exports = { resolveArm, resolveArms, parseArmSpec, resolveMain, listArms, formatArmRows, ARM_SYNTAX, KNOWN_ARMS, PLANT_ARMS, HOOKED_PLANT_ARMS, PLANT_ARM_IDS, isPlantArmId, MAIN_LABEL, OC_PREFIX, CC_PREFIX, STRANDS_PREFIX };
