// SPDX-License-Identifier: Apache-2.0
'use strict';

// Defaults for the judge phase. Every value can be overridden by a bench.js flag.
const DEFAULTS = {
  concurrency: 2,
  timeoutSec: 300,
  // A cut keeps the head of a file and drops the tail, so later sections never reach the judges and quotes from them
  // become "not found" downgrades. 16000 cut 52 of 84 long deliverables in one study; 60000 leaves room for them.
  limits: { maxFileChars: 60000, maxBundleChars: 150000 },
  // Judge-vs-human targets used by `calibrate score`.
  thresholds: { kappaMin: 0.6, agreementMin: 0.7, spearmanMin: 0.6 },
  // Cell flag when judges differ by more than this on a normalized 0..1 score.
  disagreeScore: 0.2,
};

const VERDICT_VALUE = { pass: 1, partial: 0.5, fail: 0 };

// rubric grades each criterion; pairwise picks a winner; graded gives each response of the pair a 1 to 5 grade.
const MODES = ['rubric', 'pairwise', 'graded'];

// The judge must not be a Claude model or share the subject model's family.
function modelFamily(id) {
  // A provider path (anthropic/claude-x, openrouter/anthropic/claude-x) and a Bedrock routing prefix and vendor
  // (global.anthropic.claude-sonnet-5-5) come before the model name.
  const name = String(id).toLowerCase().split('/').pop();
  const bare = name.replace(/^(?:global|us|eu|au|jp|apac)\./, '').replace(/^anthropic\./, '');
  return bare.split(/[-_.\d]/)[0];
}

// A Claude model by name anywhere in the id, whatever the prefix or family string came out as.
const namesClaude = (id) => /(^|[^a-z])(claude|anthropic)(?![a-z])/.test(String(id).toLowerCase());

function checkJudgeModel(judge, subjectModel) {
  const fam = modelFamily(judge);
  if (fam === 'claude' || fam === 'anthropic' || namesClaude(judge)) throw new Error(`judge "${judge}" is a Claude model; pick another provider`);
  if (judge === 'auto') throw new Error('judge must be pinned, not "auto"');
  if (subjectModel && modelFamily(subjectModel) === fam) {
    throw new Error(`judge "${judge}" is in the same family as the subject model "${subjectModel}"`);
  }
}

const MIN_PANEL_FAMILIES = 3;

function families(judges) {
  return [...new Set(judges.map(modelFamily))];
}

// A panel is only independent if no two judges share a model family. `minFamilies` is the
// smallest panel the caller accepts (the judge command uses MIN_PANEL_FAMILIES unless overridden).
function checkPanel(judges, { minFamilies = 1 } = {}) {
  const seen = new Map();
  for (const j of judges) {
    const fam = modelFamily(j);
    if (seen.has(fam)) throw new Error(`judges "${seen.get(fam)}" and "${j}" are both ${fam} models; a panel needs one judge per family`);
    seen.set(fam, j);
  }
  if (seen.size < minFamilies) {
    throw new Error(`the judge panel has ${seen.size} model family(ies) (${judges.join(', ') || 'none'}); at least ${minFamilies} are required. Add judges or pass --allow-small-panel.`);
  }
}

/**
 * The bundle limits for one task: an explicit flag value (`explicit.maxFileChars` / `maxBundleChars` true) wins, then the
 * task's own `bundleLimits`, then the default or flag value in `limits`.
 */
function effectiveLimits(task, limits, explicit = {}) {
  const own = task?.bundleLimits ?? {};
  const pick = (k) => (explicit[k] || own[k] === undefined ? limits[k] : own[k]);
  return { maxFileChars: pick('maxFileChars'), maxBundleChars: pick('maxBundleChars') };
}

// The kiro backend passes the prompt as one argv string, which Linux caps near 128 KiB; opencode reads it from stdin.
function maxPromptBytes(backendName) {
  return backendName === 'opencode' ? 400000 : 120000;
}

module.exports = { effectiveLimits, maxPromptBytes, DEFAULTS, VERDICT_VALUE, MODES, MIN_PANEL_FAMILIES, modelFamily, families, checkJudgeModel, checkPanel };
