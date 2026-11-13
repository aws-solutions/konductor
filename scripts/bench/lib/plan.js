// SPDX-License-Identifier: Apache-2.0
/**
 * `plan`: what a run of the selected skills would do, from files on disk.
 *
 * Offline by construction: it reads the repository and bench/out and writes nothing. It makes no
 * network call, no model call and no AWS call. It lists the stages, marks each done or pending by
 * which output files exist, and prices each pending call by its kind and model from the cost profile (cost-profile.js):
 * a mean, the estimated cost, and a p90, the upper estimate. The p90 total is the figure checked against `max_usd`.
 * A model with no measured cost is priced at `estimate_usd_per_call`, and one warning names those models.
 *
 * Per task: 2 subject runs (with, without); per seat, 1 judge call for each answer (each answer is judged
 * on its own) for reading B (the rules checklist, every task) and the same for reading A (the request-only
 * checklist, every task not excluded); 1 checklist-writer call per task read by A.
 *
 * Skill statuses: ready | rules stale | tasks stale | no baseline | no agent | invalid baseline |
 * invalid agent spec. Only the first three are planned. A skill with problems shows all of them,
 * whether or not an agent was found. Reading B is left out of the plan for a stale skill
 * or batch, because it waits for a refreshed baseline; reading A still runs. When none of the selected skills is
 * planned and no skill has a problem to report, the plan is refused with one line that names each skill and its status.
 *
 * Not in the offline plan, and said so in its output: the credential check, the Bedrock model list
 * and the spend ledger total. They belong to stage 1 of a run and to the ledger.
 * A done call here means its output file exists; whether that file is stale is checked where
 * the file's format is defined.
 */
'use strict';

const fs = require('fs');
const { ARMS, LayoutError } = require('./layout');
const { seatsOf, rubricWriterModel } = require('./config');
const {
  callCost,
  defaultProfile,
  COST_SOURCES,
  ESTIMATE_P90_FACTOR,
} = require('./cost-profile');
const { FormatError } = require('./formats');
const {
  loadBaseline,
  loadExclusions,
  exclusionsFor,
  knownTaskIds,
  unmatchedExclusions,
} = require('./baseline');
const { resolveAgent, AgentSpecError } = require('./skills');

const createTally = () => ({ done: 0, total: 0 });
const createCallTallies = () => ({
  subject: createTally(),
  judgeB: createTally(),
  writer: createTally(),
  judgeA: createTally(),
});
/** Pending calls of each kind by model id: { subject: { <model>: n }, judgeB: ..., writer: ..., judgeA: ... }. */
const createPendingByModel = () =>
  Object.fromEntries(
    Object.keys(createCallTallies()).map((kind) => [kind, {}]),
  );
/** Floating-point slack when a projected cost is compared with a limit: a cost equal to the limit is within it. */
const MONEY_EPSILON = 1e-9;
const CENT_DECIMALS = 2;
const MAX_MONEY_DECIMALS = 9;
const roundTo = (amount, decimals) => {
  const scale = 10 ** decimals;
  return Math.round(amount * scale + MONEY_EPSILON) / scale;
};
const roundToCents = (amount) => roundTo(amount, CENT_DECIMALS);
const formatMoney = (amount, decimals = CENT_DECIMALS) =>
  `$${roundTo(amount, decimals).toFixed(decimals)}`;
/**
 * A projected cost and a limit, written to cents unless that would make two different amounts look
 * equal ("$2.52, above max_usd $2.52"). Then both get as many decimals as it takes to tell them apart.
 */
function formatMoneyPair(projected, limit) {
  let decimals = CENT_DECIMALS;
  while (
    decimals < MAX_MONEY_DECIMALS &&
    Math.abs(projected - limit) > MONEY_EPSILON &&
    formatMoney(projected, decimals) === formatMoney(limit, decimals)
  )
    decimals += 1;
  return [formatMoney(projected, decimals), formatMoney(limit, decimals)];
}
/** An amount that is above 0 but rounds to $0.00 gets as many decimals as it takes to show it is not 0. */
function formatMoneyShown(amount) {
  let decimals = CENT_DECIMALS;
  while (
    decimals < MAX_MONEY_DECIMALS &&
    amount > 0 &&
    roundTo(amount, decimals) === 0
  )
    decimals += 1;
  return formatMoney(amount, decimals);
}
const CALL_LABEL = {
  subject: 'subject',
  judgeB: 'judge',
  writer: 'writer',
  judgeA: 'judge',
};
/**
 * The cost of a skill's whole baseline work, as a margin: about twice the upper estimate (p90) of one skill read over
 * two batches of 8 tasks with the 3 default judge seats, rounded up to a multiple of 5.
 */
const BUDGET_PER_SKILL_USD = 35;

/** The statuses of a skill that `plan` counts calls for. Every other status is a skill that cannot run. */
const PLANNED_STATUSES = new Set(['ready', 'rules stale', 'tasks stale']);

/**
 * What every helper below reads or fills: the layout, settings and cost profile, and the lists the plan collects as
 * it goes.
 */
const createContext = (layout, config, costProfile) => ({
  layout,
  config,
  costProfile,
  seats: seatsOf(config),
  problems: [],
  calls: createCallTallies(),
  pendingByModel: createPendingByModel(),
  noHistory: new Set(),
  batchesPlanned: new Set(),
  exclusions: { batches: {} },
});

/** bench/exclusions.json. A file that breaks its format is a problem of the plan, and no task is then excluded. */
function readExclusions({ layout, problems }) {
  try {
    return loadExclusions(layout);
  } catch (error) {
    if (!(error instanceof FormatError)) throw error;
    problems.push(
      ...error.errors.map((message) => `exclusions.json: ${message}`),
    );
    return { batches: {} };
  }
}

/** The agent for `skill`. A spec that cannot be used adds its message to `skillProblems` and no agent is chosen. */
function selectAgent({ layout }, skill, skillProblems) {
  try {
    return resolveAgent(skill, { agentsDir: layout.agentsDir });
  } catch (error) {
    if (!(error instanceof AgentSpecError)) throw error;
    skillProblems.push(error.message);
    return { agent: null, why: '' };
  }
}

const statusOfBaseline = (baseline) =>
  baseline.rulesStale
    ? 'rules stale'
    : baseline.batches.some((batchEntry) => batchEntry.stale)
      ? 'tasks stale'
      : 'ready';

/**
 * A function that counts one expected output file in `tallies`: always a total, and done when the file exists. A
 * pending call is also counted in `pendingByModel` under the model it would be made with.
 */
const createCounter = (tallies, pendingByModel) => (kind, file, model) => {
  tallies[kind].total += 1;
  if (fs.existsSync(file)) tallies[kind].done += 1;
  else pendingByModel[kind][model] = (pendingByModel[kind][model] || 0) + 1;
};

/** Counts the calls of one task: two subject runs, a judge call per seat and answer for each reading, one checklist. */
function countTaskCalls(
  { layout, seats, config },
  { skill, batch, id },
  { readB, readA },
  countCall,
) {
  for (const arm of ARMS)
    countCall(
      'subject',
      layout.answerFile(skill, batch, id, arm),
      config.models.subject,
    );
  // Each answer is judged on its own: one call per seat and arm.
  for (const seat of seats) {
    const judgeModel = config.models.judges[seat];
    for (const arm of ARMS) {
      if (readB)
        countCall(
          'judgeB',
          layout.judgmentFile('items', skill, batch, id, seat, arm),
          judgeModel,
        );
      if (readA)
        countCall(
          'judgeA',
          layout.judgmentFile('outcome', skill, batch, id, seat, arm),
          judgeModel,
        );
    }
  }
  if (readA)
    countCall(
      'writer',
      layout.checklistFile(skill, batch, id),
      rubricWriterModel(config),
    );
}

/** Counts the calls of one batch and returns the batch's row. Reading B waits when the rules or the batch are stale. */
function planBatch(context, skill, baseline, batchEntry, countCall) {
  const { batch } = batchEntry;
  const taskIds = batchEntry.tasks.scenarios.map((scenario) => scenario.id);
  const { excluded } = exclusionsFor(context.exclusions, batch, taskIds);
  const readB = !baseline.rulesStale && !batchEntry.stale;
  for (const id of taskIds)
    countTaskCalls(
      context,
      { skill, batch, id },
      { readB, readA: !excluded.has(id) },
      countCall,
    );
  return {
    batch,
    tasks: taskIds.length,
    tasks_a: taskIds.length - excluded.size,
    read_b: readB,
    excluded: [...excluded].sort(),
  };
}

/**
 * Fills `row` for one skill and counts its calls in `skillCalls`. A skill that cannot be planned gets a status
 * and no batches. A LayoutError from a name that is not a path segment is left for planSkill.
 */
function describeSkill(context, row, skillCalls, skillPending) {
  const { skill } = row;
  const baseline = loadBaseline(context.layout, skill);
  if (!baseline.hasBaseline) {
    row.status = 'no baseline';
    return;
  }
  // Every problem of the skill is collected before the status is chosen, so a skill that also has no
  // agent still lists them.
  const skillProblems = [...baseline.problems];
  const { agent, why } = selectAgent(context, skill, skillProblems);
  Object.assign(row, { agent, agent_why: why, warnings: baseline.warnings });
  if (skillProblems.length) {
    context.problems.push(
      ...skillProblems.map((message) => `${skill}: ${message}`),
    );
    row.status = baseline.problems.length
      ? 'invalid baseline'
      : 'invalid agent spec';
    row.problems = skillProblems;
    return;
  }
  if (!agent) {
    row.status = 'no agent';
    return;
  }
  row.status = statusOfBaseline(baseline);
  const countCall = createCounter(skillCalls, skillPending);
  for (const batchEntry of baseline.batches)
    row.batches.push(
      planBatch(context, skill, baseline, batchEntry, countCall),
    );
}

/** One skill's row. Its calls are added to the plan only when the skill was planned in full. */
function planSkill(context, skill) {
  const row = {
    skill,
    status: '',
    agent: null,
    agent_why: '',
    batches: [],
    problems: [],
    warnings: [],
  };
  const skillCalls = createCallTallies();
  const skillPending = createPendingByModel();
  try {
    describeSkill(context, row, skillCalls, skillPending);
  } catch (error) {
    // A name the layout cannot turn into a path is a problem with this skill's files, not a crash.
    if (!(error instanceof LayoutError)) throw error;
    context.problems.push(`${skill}: ${error.message}`);
    return Object.assign(row, {
      status: 'invalid baseline',
      problems: [error.message],
      batches: [],
    });
  }
  if (PLANNED_STATUSES.has(row.status)) {
    for (const kind of Object.keys(context.calls)) {
      context.calls[kind].total += skillCalls[kind].total;
      context.calls[kind].done += skillCalls[kind].done;
      for (const [model, count] of Object.entries(skillPending[kind]))
        context.pendingByModel[kind][model] =
          (context.pendingByModel[kind][model] || 0) + count;
    }
    row.batches.forEach((batchEntry) =>
      context.batchesPlanned.add(batchEntry.batch),
    );
  }
  return row;
}

/** Warnings for exclusion records that name no task. Batch names are shared by every skill, so a record is unmatched only when no skill with a baseline has that task. */
function warnAboutUnmatchedExclusions({ layout, exclusions, batchesPlanned }) {
  const known = knownTaskIds(layout);
  return [...batchesPlanned]
    .sort()
    .flatMap((batch) =>
      unmatchedExclusions(exclusions, batch, known).map(
        (id) =>
          `exclusions.json: batch ${batch}: "${id}" names no task of any skill with a baseline, so it excludes nothing`,
      ),
    );
}

/**
 * The mean and p90 cost of the pending calls of `kinds`, each priced by its kind and model (cost-profile.js). A model
 * priced at estimate_usd_per_call, because the profile has no entry for it, is added to `noHistory`.
 */
function pricePending(
  { config, costProfile, pendingByModel, noHistory },
  kinds,
) {
  const cost = { mean: 0, p90: 0 };
  for (const kind of kinds)
    for (const [model, count] of Object.entries(pendingByModel[kind])) {
      const price = callCost(config, CALL_LABEL[kind], model, costProfile);
      cost.mean += count * price.mean;
      cost.p90 += count * price.p90;
      if (price.source === COST_SOURCES.estimate)
        noHistory.add(`${CALL_LABEL[kind]} ${model}`);
    }
  return cost;
}
const sumCalls = (calls, kinds) =>
  kinds.reduce(
    (sums, kind) => ({
      done: sums.done + calls[kind].done,
      total: sums.total + calls[kind].total,
    }),
    { done: 0, total: 0 },
  );
const buildStage = (context, id, name, kinds) => {
  const { calls } = context;
  const { done, total } = sumCalls(calls, kinds);
  const cost = pricePending(context, kinds);
  return {
    id,
    name,
    state: !total ? 'n/a' : done === total ? 'done' : 'pending',
    done,
    total,
    usd: cost.mean,
    usd_p90: cost.p90,
    calls: Object.fromEntries(kinds.map((kind) => [kind, { ...calls[kind] }])),
  };
};

/** The four stages of a run with their state and pending cost. Stages 1 and 4 have no calls to count. */
function buildStages(context) {
  const { layout } = context;
  return [
    {
      id: 1,
      name: 'prep',
      state: 'pending',
      done: null,
      total: null,
      usd: 0,
      usd_p90: 0,
      calls: {},
      note: 'runs at the start of every run, leaves no file',
    },
    buildStage(context, 2, 'rules reading', ['subject', 'judgeB']),
    buildStage(context, 3, 'request-only reading', ['writer', 'judgeA']),
    {
      id: 4,
      name: 'report',
      state: fs.existsSync(layout.reportJson) ? 'done' : 'pending',
      done: null,
      total: null,
      usd: 0,
      usd_p90: 0,
      calls: {},
    },
  ];
}

/** Why a plan with no skill to run is refused, in one line: each selected skill with the status that keeps it out. */
const describeNothingRunnable = (rows) =>
  `no selected skill can be run: ${rows.map((row) => `${row.skill} (${row.status})`).join(', ')}`;

/**
 * Everything that refuses the plan: the problems collected on the way, then (only when nothing else
 * refuses it) a selection with no skill to run, then an upper estimate (p90) above max_usd.
 */
function buildRefusals({ problems, config }, rows, pendingP90Usd, isWithinMax) {
  const refused = [...problems];
  if (!refused.length && !rows.some((row) => PLANNED_STATUSES.has(row.status)))
    refused.push(describeNothingRunnable(rows));
  if (!isWithinMax) {
    const [projected, limitText] = formatMoneyPair(
      pendingP90Usd,
      config.max_usd,
    );
    // A limit above 0 that rounds to $0.00 is shown with the decimals it needs, so it does not read as no limit.
    const limit =
      limitText === formatMoney(0)
        ? formatMoneyShown(config.max_usd)
        : limitText;
    refused.push(
      `the plan's upper estimate (p90) is ${projected}, above max_usd ${limit}; raise max_usd (it cannot pass total_cap_usd ${formatMoney(config.total_cap_usd)})`,
    );
  }
  return refused;
}

/** The one warning for pending calls priced at estimate_usd_per_call, naming each kind and model, or null. */
const describeNoHistory = (noHistory) =>
  noHistory.size
    ? `cost: no measured cost for ${[...noHistory].sort().join(', ')}; priced at estimate_usd_per_call, with a p90 of that x ${ESTIMATE_P90_FACTOR}`
    : null;

/**
 * The plan for `skills`. `costProfile` is cost-profile.js loadProfile(...); the committed profile unless a caller
 * (a test) passes another.
 */
function buildPlan({ layout, config, skills, costProfile = defaultProfile() }) {
  const context = createContext(layout, config, costProfile);
  context.exclusions = readExclusions(context);
  const rows = skills.map((skill) => planSkill(context, skill));
  const warnings = warnAboutUnmatchedExclusions(context);
  const stages = buildStages(context);
  const pendingUsd = stages.reduce((total, stage) => total + stage.usd, 0);
  const pendingP90Usd = stages.reduce(
    (total, stage) => total + stage.usd_p90,
    0,
  );
  const isWithinMax = pendingP90Usd <= config.max_usd + MONEY_EPSILON;
  const refused = buildRefusals(context, rows, pendingP90Usd, isWithinMax);
  const noHistoryWarning = describeNoHistory(context.noHistory);
  return {
    run_id: layout.runId,
    max_usd: config.max_usd,
    seats: context.seats,
    skills: rows,
    stages: stages.map((stage) => ({
      ...stage,
      usd: roundToCents(stage.usd),
      usd_p90: roundToCents(stage.usd_p90),
    })),
    pending_usd: roundToCents(pendingUsd),
    pending_usd_unrounded: pendingUsd,
    pending_usd_p90: roundToCents(pendingP90Usd),
    pending_usd_p90_unrounded: pendingP90Usd,
    worst_case_usd: roundToCents(pendingP90Usd),
    within_max: isWithinMax,
    warnings: [
      ...rows.flatMap((row) =>
        row.warnings.map((warning) => `${row.skill}: ${warning}`),
      ),
      ...warnings,
      ...(noHistoryWarning ? [noHistoryWarning] : []),
    ],
    refused,
    ok: refused.length === 0,
  };
}

function renderPlan(plan) {
  const lines = [
    'Skill benchmark plan (offline: no network, no model call, nothing spent)',
  ];
  lines.push(
    `run: ${plan.run_id} | max_usd: ${formatMoneyShown(plan.max_usd)} | judge seats: ${plan.seats.join(', ')}`,
    '',
    'Skills',
  );
  const skillWidth = Math.max(
    ...plan.skills.map((skillRow) => skillRow.skill.length),
  );
  const statusWidth = Math.max(
    ...plan.skills.map((skillRow) => skillRow.status.length),
  );
  for (const skillRow of plan.skills) {
    const agent = skillRow.agent
      ? `agent ${skillRow.agent} (${skillRow.agent_why})`
      : '';
    lines.push(
      `  ${skillRow.skill.padEnd(skillWidth)}  ${skillRow.status.padEnd(statusWidth)}  ${agent}`.trimEnd(),
    );
    for (const batchEntry of skillRow.batches) {
      const readingA = `${batchEntry.tasks_a} in the request-only reading${batchEntry.tasks_a === batchEntry.tasks ? '' : `, ${batchEntry.tasks - batchEntry.tasks_a} excluded`}`;
      lines.push(
        `  ${''.padEnd(skillWidth)}  ${''.padEnd(statusWidth)}  batch ${batchEntry.batch}: ${batchEntry.tasks} tasks, ${readingA}${batchEntry.read_b ? '' : ', B waits for a baseline refresh'}`,
      );
    }
  }
  lines.push('', 'Stages');
  const nameWidth = Math.max(...plan.stages.map((stage) => stage.name.length));
  const stateWidth = Math.max(
    ...plan.stages.map((stage) => stage.state.length),
  );
  for (const stage of plan.stages) {
    const kinds = Object.entries(stage.calls).map(
      ([kind, tally]) => `${tally.total} ${CALL_LABEL[kind]}`,
    );
    const detail =
      stage.total === null
        ? stage.note || ''
        : `${stage.done}/${stage.total} calls done${kinds.length ? ` (${kinds.join(', ')})` : ''}`;
    lines.push(
      `  ${stage.id}  ${stage.name.padEnd(nameWidth)}  ${stage.state.padEnd(stateWidth)}  ${formatMoney(stage.usd).padStart(7)}  ${detail}`.trimEnd(),
    );
  }
  const [pendingText, maxText] = formatMoneyPair(
    plan.pending_usd_p90_unrounded,
    plan.max_usd,
  );
  // A limit above 0 that rounds to $0.00 is shown with the decimals it needs, so it does not read as no limit.
  const maxShown =
    maxText === formatMoney(0) ? formatMoneyShown(plan.max_usd) : maxText;
  lines.push(
    '',
    `Estimated cost (mean) of pending work: ${formatMoney(plan.pending_usd)}`,
    `Upper estimate (p90) of pending work: ${pendingText} of max_usd ${maxShown}: ${plan.within_max ? 'within the limit' : 'OVER the limit'}`,
  );
  lines.push(
    `The per-call costs were measured on earlier runs and can differ on this one. Budget about $${BUDGET_PER_SKILL_USD} per skill.`,
  );
  lines.push(
    'Not checked offline: AWS credentials, Bedrock model availability and the spend ledger. Stage 1 of a run checks them.',
  );
  if (plan.warnings.length)
    lines.push(
      '',
      'Warnings',
      ...plan.warnings.map((message) => `  ${message}`),
    );
  if (plan.refused.length)
    lines.push('', 'Refused', ...plan.refused.map((message) => `  ${message}`));
  return `${lines.join('\n')}\n`;
}

module.exports = { buildPlan, renderPlan };
