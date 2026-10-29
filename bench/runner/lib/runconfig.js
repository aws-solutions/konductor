// SPDX-License-Identifier: Apache-2.0
'use strict';

// Facts recorded in run-config.json so a result can be reproduced and audited.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const sandbox = require('./sandbox.js');
const { ALLOW, KIRO_KEEP, NEVER_PASS } = require('./env.js');
const { builtinStartup } = require('./skills.js');

function git(repo, args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// Hash over relative paths and bytes of the given directories (tasks, fixtures, suites).
function hashTree(root, dirs) {
  const h = crypto.createHash('sha256');
  const visit = (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) {
      for (const n of fs.readdirSync(abs).sort()) visit(path.join(abs, n), `${rel}/${n}`);
    } else {
      h.update(rel).update('\0').update(fs.readFileSync(abs)).update('\0');
    }
  };
  for (const d of dirs) visit(path.join(root, d), d);
  return h.digest('hex');
}

function availableEngines() {
  let help;
  try {
    help = execFileSync('kiro-cli', ['chat', '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  const m = help.match(/--agent-engine[\s\S]*?\[possible values: ([^\]]+)\]/);
  return m ? m[1].split(',').map((x) => x.trim()) : null;
}

function benchGit(repo) {
  return {
    benchCommit: git(repo, ['rev-parse', 'HEAD']),
    benchDirty: (git(repo, ['status', '--porcelain', '--', 'bench']) || '').length > 0,
  };
}

function toolVersions() {
  return {
    node: process.version,
    rustc: sandbox.versionOf('rustc'),
    cargo: sandbox.versionOf('cargo'),
    kiroCli: sandbox.kiroCliVersion(),
    git: sandbox.versionOf('git'),
  };
}

function armRecords(arms, prepared, errors) {
  return arms.map((a) => ({
    id: a.id,
    label: a.label,
    ref: a.ref,
    commitSha: a.commitSha,
    originMainSha: a.originMainSha ?? undefined,
    localMainSha: a.localMainSha ?? undefined,
    behindOrigin: a.behindOrigin ?? undefined,
    warnings: a.warnings,
    mcpSha256: prepared.get(a.id)?.mcpSha256 ?? null,
    modelRewrittenAgents: prepared.get(a.id)?.rewrittenAgents ?? null,
    startupResources: a.vanilla ? builtinStartup(a.runtime ?? 'kiro-cli') : prepared.get(a.id)?.skillInfo?.startup ?? null,
    sopNameSource: prepared.get(a.id)?.skillInfo?.catalog?.sopSource ?? null,
    prepareError: errors.get(a.id) ?? null,
  }));
}

function envPolicy(baseEnv, envKeep) {
  return {
    allowlist: ALLOW,
    kiroPassed: [...KIRO_KEEP, ...envKeep],
    neverPassed: NEVER_PASS.map(String),
    mandatoryMcpsUnset: true,
    mandatoryMcpsInInvokingShell: Object.keys(baseEnv).some((k) => /^[A-Z]+_KIRO_MANDATORY_MCPS$/.test(k)),
    konductorTelemetry: 'off (konductor arms only)',
  };
}

module.exports = { hashTree, availableEngines, benchGit, toolVersions, armRecords, envPolicy };
