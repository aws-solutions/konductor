// SPDX-License-Identifier: Apache-2.0
'use strict';

// The pre-registered protocol (plan section 7): the rules every FULL verdict follows, fixed before any run.
// PREREG.json carries a copy; `prereg check` refuses a lock whose copy differs from this file, and the statistics
// module reads its draws, seed, margin and verdict words from here, so the lock and the code cannot drift apart.

const BOOTSTRAP = { draws: 10000, seed: 20261119, confidence: 0.95 };
const MARGIN = 5;

const PROTOCOL = {
  tuning: 'DEV only. Any skill or task change after the DEV run is a new commit and a new study.',
  primaryOutcome: 'quality 0 to 100 under the section 5 scoring, held-out tasks only',
  statistic: {
    name: 'mean paired difference (konductor minus vanilla) per task, averaged over held-out tasks',
    interval: '95% two-level bootstrap: tasks, then runs within each task',
    draws: BOOTSTRAP.draws,
    seed: BOOTSTRAP.seed,
  },
  margin: MARGIN,
  verdictWords: {
    'beats by the margin': `lower bound L over +${MARGIN}`,
    beats: 'L over 0',
    'loses by the margin': `upper bound U under -${MARGIN}`,
    loses: 'U under 0',
    ties: `L over -${MARGIN} and U under +${MARGIN}`,
    unsettled: 'none of the above',
  },
  verdictOrder: ['beats by the margin', 'beats', 'loses by the margin', 'loses', 'ties', 'unsettled'],
  secondary: [
    'konductor vs konductor-noskills (the skills\' share)',
    'konductor-noskills vs vanilla (the rules\' share)',
    'per phase and per role, with Holm correction',
    'cost and time ratios',
  ],
  reps: { perArmPerTask: 3, perSideOnEffectTasks: 5 },
  limits: 'soft limit per task; runs past it are scored at the soft limit and reported both with and without; the hard limit kills',
  ranking: 'tasks, phases and roles best to worst by paired difference, with intervals; ranks inside overlapping intervals are not ordered',
  stopRules: { batchSpendOverEstimateFactor: 2, harnessFaultRate: 0.05 },
  model: 'one model; every claim says so',
  // D-122: the owner's yes to locking these batches although fewer than 1 in 3 of their tasks come from a second author family.
  singleFamilyBatches: {
    decided: 'owner yes, 2026-11-24 (bench/DEBT.md D-122)',
    batches: ['t1', 't4', 't5', 't7', 't8', 't10', 't11', 't12'],
    rule: 'these batches lock with fewer than 1 in 3 second-family tasks; the report keeps their single-family and hand-edited tasks shown apart',
  },
};

module.exports = { BOOTSTRAP, MARGIN, PROTOCOL };
