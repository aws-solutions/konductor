#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * check-benchmark-regression.js — Compares per-attempt success rate against a
 * baseline using a bootstrap confidence interval on the rate delta, not a
 * raw point estimate. toolUse score is reported as an advisory secondary
 * signal only.
 *
 * Design notes:
 *  - Reads `attempts[]` (one entry per replicate — see --replicates on
 *    scripts/run-claude-subset.js) and computes a 95% bootstrap CI on the
 *    mean delta via ./stats.js (twoSampleBootstrapCI). A task is only
 *    flagged as a regression when the CI is entirely below zero
 *    (ciHigh < 0) — i.e. even the optimistic bound of the estimate shows a
 *    drop. A single noisy replicate cannot flip the verdict.
 *    The delta is always computed via the UNPAIRED two-sample bootstrap:
 *    replicates are independent runs with no index-to-index correspondence,
 *    so pairing by index would be methodologically wrong even when both
 *    sides happen to have the same N. When either side has fewer than 2
 *    replicates, a bootstrap resample of a single value is degenerate — it
 *    always redraws that same value, producing a zero-width CI centered
 *    exactly on the one observed delta, which would make ANY rate
 *    difference look like a statistically certain regression. CI-based
 *    gating is skipped (with a WARN) whenever N<2 on either side.
 *  - Refuses (exit 1, clear error) to compare a new run against a baseline
 *    recorded under a different `metadata.model`.
 *  - Reads `results[].attempts[].success` (primary, gating) and
 *    `results[].attempts[].metrics.scores.toolUse.score` (secondary,
 *    reported only) for both the new run and the baseline;
 *    scripts/run-claude-subset.js always writes this shape.
 *
 * Gating uses the per-attempt success rate as the PRIMARY signal (this is
 * what the runner and scripts/run-claude-subset.js use to decide
 * scenario-level pass/fail). The deterministic toolUse score is still
 * computed and printed per task as an advisory secondary signal — useful
 * for scenarios that DO declare required tools — but does not gate alone.
 *
 * Usage: node check-benchmark-regression.js <new-run.json> <baseline.json>
 * Exit 0: no regression (or no baseline / missing model metadata on legacy
 *         baselines, with a warning). Exit 1: regression detected, or model
 *         ID mismatch, or bad usage.
 */

'use strict';

const fs = require('fs');
const { twoSampleBootstrapCI, mean } = require('./stats.js');

function loadRun(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/** Extract the ordered list of per-attempt toolUse scores for one result entry.
 * Secondary/advisory signal only — see the module header for why this alone
 * is not gating-safe for scenarios with no required tools. */
function toolUseScores(result) {
  const attempts = result?.attempts || [];
  return attempts
    .map((a) => a?.metrics?.scores?.toolUse?.score)
    .filter((s) => typeof s === 'number' && !Number.isNaN(s));
}

/** Extract the ordered list of per-attempt success values (1 = success,
 * 0 = failure) for one result entry. `success` is the gating-safe boolean
 * scripts/run-claude-subset.js writes per attempt (`success: result.success`,
 * itself computed by tests/judges/claude-code-agent-runner.js's `success`
 * field: required tools covered with nothing unexpected, additionally gated
 * on `skillContentUsed` when a scenario defines `expectedSkillMarkers`).
 * This is the PRIMARY regression signal. */
function successRates(result) {
  const attempts = result?.attempts || [];
  return attempts
    .map((a) => (typeof a?.success === 'boolean' ? (a.success ? 1 : 0) : undefined))
    .filter((s) => typeof s === 'number');
}

/**
 * 95% CI on the mean delta (new - baseline).
 *
 * Always uses the unpaired two-sample bootstrap -- replicates are
 * independent runs, not a matched sequence, so index-based pairing is not
 * statistically valid regardless of whether the two sides have equal N.
 *
 * Guards N<2 on either side: with a single replicate, resampling degenerates
 * to redrawing that one value every time, so the CI collapses to a single
 * point equal to that one observed delta. When that happens, skip CI-based
 * gating (return an unbounded interval so this task is never flagged) and
 * warn.
 */
function deltaCI(newScores, baseScores) {
  if (newScores.length < 2 || baseScores.length < 2) {
    console.log(
      `WARN: insufficient replicates (new=${newScores.length}, base=${baseScores.length})` +
        ' — CI-based gating requires N>=2 on both sides; skipping (not gating this task)',
    );
    return { mean: mean(newScores) - mean(baseScores), ciLow: -Infinity, ciHigh: Infinity, nResamples: 0 };
  }
  return twoSampleBootstrapCI(newScores, baseScores);
}

/**
 * Pure comparison core: given parsed newRun/baseline JSON objects, returns
 * the per-task verdicts and any warnings, with no filesystem I/O and no
 * process.exit — so tests can exercise the actual gating logic (including a
 * fixture where the gate fires) without spawning the CLI.
 *
 * Returns `{ modelMismatch }` (with `newModel`/`baselineModel`) when the two
 * runs were recorded under different `metadata.model` values — callers
 * should refuse the comparison in that case. Otherwise returns
 * `{ modelMismatch: null, warnings, okLines, regressions }`.
 */
function compareRuns(newRun, baseline) {
  const newModel = newRun?.metadata?.model || null;
  const baselineModel = baseline?.metadata?.model || null;

  if (newModel && baselineModel && newModel !== baselineModel) {
    return { modelMismatch: { newModel, baselineModel } };
  }

  const warnings = [];
  if (!newModel || !baselineModel) {
    warnings.push(
      `WARN: model ID missing on ${!newModel ? 'new run' : 'baseline'} — cannot verify model ` +
        `version match for this comparison. Regenerate to backfill metadata.model.`,
    );
  }

  const newResults = new Map((newRun.results || []).map((r) => [r.taskId, r]));
  const baselineResults = new Map((baseline.results || []).map((r) => [r.taskId, r]));

  const regressions = [];
  const okLines = [];

  for (const [taskId, baselineResult] of baselineResults) {
    const newResult = newResults.get(taskId);
    if (!newResult) {
      warnings.push(`WARN: ${taskId} missing from new run — skipping`);
      continue;
    }

    const baseSuccess = successRates(baselineResult);
    const newSuccess = successRates(newResult);
    if (baseSuccess.length === 0 || newSuccess.length === 0) {
      warnings.push(`WARN: ${taskId} has no attempts[].success — skipping`);
      continue;
    }

    // Primary, gating signal: per-attempt success rate.
    const successCi = deltaCI(newSuccess, baseSuccess);
    const isRegression = successCi.ciHigh < 0; // even the optimistic bound of the delta CI is negative

    // Secondary, advisory signal: deterministic toolUse score. Reported for
    // visibility (useful for scenarios that DO declare required tools) but
    // does not gate on its own — see module header.
    const baseTool = toolUseScores(baselineResult);
    const newTool = toolUseScores(newResult);
    const toolAdvisory =
      baseTool.length >= 2 && newTool.length >= 2
        ? (() => {
            const toolCi = deltaCI(newTool, baseTool);
            return `toolUse(advisory) meanDelta=${toolCi.mean.toFixed(3)} 95% CI=[${toolCi.ciLow.toFixed(3)}, ${toolCi.ciHigh.toFixed(3)}]`;
          })()
        : 'toolUse(advisory)=insufficient replicates for a CI';

    const summary =
      `${taskId}: successRate baseline=[${baseSuccess.join(',')}] new=[${newSuccess.join(',')}] ` +
      `meanDelta=${successCi.mean.toFixed(3)} 95% CI=[${successCi.ciLow.toFixed(3)}, ${successCi.ciHigh.toFixed(3)}] | ${toolAdvisory}`;

    if (isRegression) {
      regressions.push(`  REGRESSION ${summary}`);
    } else {
      okLines.push(`  OK ${summary}`);
    }
  }

  return { modelMismatch: null, warnings, okLines, regressions };
}

function main(argv) {
  const [newRunPath, baselinePath] = argv;

  if (!newRunPath || !baselinePath) {
    console.error('Usage: check-benchmark-regression.js <new-run.json> <baseline.json>');
    process.exit(1);
  }
  if (!fs.existsSync(newRunPath)) {
    console.error(`ERROR: new run file not found: ${newRunPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(baselinePath)) {
    console.log(`INFO: No baseline at ${baselinePath} — skipping regression check (first run)`);
    process.exit(0);
  }

  const newRun = loadRun(newRunPath);
  const baseline = loadRun(baselinePath);

  const result = compareRuns(newRun, baseline);

  if (result.modelMismatch) {
    const { newModel, baselineModel } = result.modelMismatch;
    console.error(
      `ERROR: model ID mismatch — new run used "${newModel}", baseline was recorded with ` +
        `"${baselineModel}". Refusing to compare: any score movement here could be a model ` +
        `version change rather than a real regression. Regenerate the baseline after ` +
        `confirming the new model's scores are expected.`,
    );
    process.exit(1);
  }

  result.warnings.forEach((w) => console.log(w));
  result.okLines.forEach((l) => console.log(l));

  if (result.regressions.length > 0) {
    console.log(
      '\nREGRESSIONS DETECTED (95% bootstrap CI of the per-attempt success-rate delta is ' +
        'entirely below zero — gating uses the CI, not a single point estimate):',
    );
    result.regressions.forEach((l) => console.log(l));
    process.exit(1);
  }

  console.log(
    '\nAll scenarios within success-rate CI-based threshold (toolUse score is reported as an ' +
      'advisory secondary signal only).',
  );
  process.exit(0);
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { toolUseScores, successRates, deltaCI, compareRuns, main };
