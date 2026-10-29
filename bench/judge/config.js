// SPDX-License-Identifier: Apache-2.0
'use strict';

// Defaults for the judge phase. Every value can be overridden by a bench.js flag.
const DEFAULTS = {
  concurrency: 2,
  timeoutSec: 300,
  limits: { maxFileChars: 6000, maxBundleChars: 24000 },
  // Judge-vs-human targets used by `calibrate score`.
  thresholds: { kappaMin: 0.6, agreementMin: 0.7, spearmanMin: 0.6 },
  // Cell flag when judges differ by more than this on a normalized 0..1 score.
  disagreeScore: 0.2,
};

const VERDICT_VALUE = { pass: 1, partial: 0.5, fail: 0 };

// The judge must not be a Claude model or share the subject model's family.
function modelFamily(id) {
  // Bedrock ids carry a routing prefix and a vendor: global.anthropic.claude-sonnet-5-5 is a claude model.
  const bare = String(id).toLowerCase().replace(/^(?:global|us|eu|au|jp|apac)\./, '').replace(/^anthropic\./, '');
  return bare.split(/[-_.\d]/)[0];
}

function checkJudgeModel(judge, subjectModel) {
  const fam = modelFamily(judge);
  if (fam === 'claude' || fam === 'anthropic') throw new Error(`judge "${judge}" is a Claude model; pick another provider`);
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

module.exports = { DEFAULTS, VERDICT_VALUE, MIN_PANEL_FAMILIES, modelFamily, families, checkJudgeModel, checkPanel };
