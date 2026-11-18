// SPDX-License-Identifier: Apache-2.0
/**
 * The stub provider: a stand-in for the two command-line tools a run calls, so the whole loop (plan, next, the jobs,
 * the stored answers and judgments) can run with no model, no AWS call and no network.
 *
 *   claude     the subject. It answers from the request alone: the `with` arm loads the skill under test and gives a
 *              full answer, the `without` arm gives a short one. It reports the subject model it was given.
 *   opencode   the checklist writer and the judges. The writer returns the item count it is asked for. A judge marks
 *              every item MET for the full answer and only the first item MET for the short one.
 *
 * Only the process is replaced. Everything above it is the real code: arms, isolation settings, the trace readers,
 * the secret sweep, the judge input step, the reply parser and the spend ledger, which reserves every stub call and
 * settles it at the cost the stub reports. So a spend STOP, a resume and stale work behave as in a paid run. The
 * stub books made-up dollars, so a stub run keeps its own ledger in its run folder (stubLayout), never the shared
 * bench/out/ledger.jsonl whose totals count toward total_cap_usd of real runs.
 *
 * Stub data must never be mistaken for a measurement, so the two are kept apart by the run id. The stub provider is
 * allowed only in a run whose id is `stub` or starts with `stub-` (assertStubRun), and the live provider is refused
 * there (launch.js readProviderOption), because a live job reads stub answers, checklists and judgments as current.
 * Answer and judgment records also name the stub version (`stub`) where a CLI version goes; checklist records and
 * ledger rows carry no marker.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { DEFAULT_SETTINGS } = require('./sanitize');
const { sha256 } = require('./provenance');

const PROVIDERS = Object.freeze(['live', 'stub']);
const STUB_VERSION = 'stub';
const STUB_RUN = /^stub(-|$)/;
/** The run ids a live job refuses: any case, because a case-insensitive file system makes `STUB` the folder of `stub`. */
const STUB_RUN_ANY_CASE = /^stub(-|$)/i;
/** Credentials that only look like a short-lived session. They pass assertFresh and reach no AWS endpoint. */
const STUB_CREDENTIAL_LIFETIME_MS = 60 * 60 * 1000;
/** Token counts the stub reports for each call. */
const SUBJECT_USAGE = Object.freeze({ input_tokens: 1000, output_tokens: 200 });
const JUDGE_TOKENS = Object.freeze({ input: 1000, output: 100 });
/**
 * The cost in USD the stub reports for each call, the way Claude Code reports `total_cost_usd` and OpenCode a per-step
 * `cost`; the ledger charges it. A subject run costs far more than its estimate, so a low max_usd reaches a spend STOP
 * after a few runs.
 */
const SUBJECT_COST_USD = 1;
const JUDGE_STEP_COST_USD = 0.001;
/** The phrase the full answer carries. The stub judge scores an answer by it, so it must survive the sanitizer. */
const FULL_ANSWER_MARK = 'every point of the request is answered in order';

/** True when `runId` is `stub` or starts with `stub-`, in any letter case: the run ids that may hold stub data. */
const isStubRun = (runId) => STUB_RUN_ANY_CASE.test(String(runId));

/** Throws when `runId` may not hold stub data: the stub folder has one spelling, lower case. */
function assertStubRun(runId) {
  if (!STUB_RUN.test(String(runId)))
    throw new Error(
      `the stub provider writes made-up answers and judgments, so it runs only in a run whose id is "stub" or starts with "stub-" (got ${JSON.stringify(runId)}); pass --run stub-<name>`,
    );
}

/** The ledger file of a stub run: bench/out/<run-id>/ledger.jsonl. */
const STUB_LEDGER_NAME = 'ledger.jsonl';

/**
 * `layout` (layout.js) for a stub run: every path is the same except the spend ledger, which moves into the run
 * folder. Its limits are still enforced there, so a stub STOP and a resume work as in a paid run, but no stub dollar
 * reaches the shared ledger that real runs read. Throws when the run id may not hold stub data.
 */
function stubLayout(layout) {
  assertStubRun(layout.runId);
  return Object.freeze({
    ...layout,
    ledgerFile: path.join(layout.runDir, STUB_LEDGER_NAME),
  });
}

const argAfter = (args, flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1];
};

/**
 * The installed name of the skill under test: the one skill folder the `with` plugin has and its `without` sibling
 * does not (arms.js builds both side by side). Null for the `without` arm.
 */
function skillUnderTest(pluginDir) {
  if (path.basename(pluginDir) !== 'with') return null;
  const list = (dir) => fs.readdirSync(path.join(dir, 'skills')).sort();
  const without = new Set(list(path.join(path.dirname(pluginDir), 'without')));
  const extra = list(pluginDir).filter((name) => !without.has(name));
  if (extra.length !== 1)
    throw new Error(
      `stub subject: expected one skill that only the with arm has, found ${extra.length}`,
    );
  return extra[0];
}

/** The text the stub subject answers with: a full answer for the `with` arm, a short one for `without`. */
function subjectAnswer(request, arm) {
  const tag = sha256(request).slice(0, 8);
  return arm === 'with'
    ? `Reply ${tag}: ${FULL_ANSWER_MARK}, with the figures it gives and a short check at the end.`
    : `Reply ${tag}: a short general reply to the request.`;
}

/** A Claude Code stream-json trace for one stub subject run. */
function subjectTrace({ model, installedSkill, text }) {
  const events = [
    {
      type: 'system',
      subtype: 'init',
      tools: ['Skill'],
      claude_code_version: STUB_VERSION,
    },
  ];
  if (installedSkill)
    events.push(
      {
        type: 'assistant',
        message: {
          model,
          content: [
            {
              type: 'tool_use',
              id: 'toolu_stub_skill',
              name: 'Skill',
              input: { skill: `${DEFAULT_SETTINGS.plugin}:${installedSkill}` },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_stub_skill',
              is_error: false,
              content: 'loaded',
            },
          ],
        },
      },
    );
  events.push(
    {
      type: 'assistant',
      message: { model, content: [{ type: 'text', text }] },
    },
    {
      type: 'result',
      result: text,
      is_error: false,
      usage: SUBJECT_USAGE,
      total_cost_usd: SUBJECT_COST_USD,
      modelUsage: { [model]: {} },
    },
  );
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

/** The stub `claude`: reads the request from the stream-json message on stdin. */
function runSubject(args, options) {
  const pluginDir = argAfter(args, '--plugin-dir');
  const model = argAfter(args, '--model');
  const request = JSON.parse(options.stdin).message.content[0].text;
  const arm = path.basename(pluginDir);
  return subjectTrace({
    model,
    installedSkill: skillUnderTest(pluginDir),
    text: subjectAnswer(request, arm),
  });
}

/** An OpenCode JSON trace with one text reply and its token counts. */
const openCodeTrace = (text) =>
  `${[
    { type: 'step_start', part: { type: 'step-start' } },
    { type: 'text', part: { type: 'text', text } },
    {
      type: 'step_finish',
      part: {
        type: 'step-finish',
        tokens: JUDGE_TOKENS,
        cost: JUDGE_STEP_COST_USD,
      },
    },
  ]
    .map((event) => JSON.stringify({ ...event, sessionID: 'ses_stub' }))
    .join('\n')}\n`;

/** The one ANSWER block of a judge prompt, between marker lines that carry the same id. */
const ANSWER_BLOCK =
  /<<<ANSWER id=([A-Za-z0-9_-]+)>>>\n([\s\S]*?)\n<<<END_ANSWER id=\1>>>/;

/** The labels of one answer: all MET for the full answer, else only the first item. */
const labelsFor = (answer, count) =>
  Array.from({ length: count }, (_, index) =>
    answer.includes(FULL_ANSWER_MARK) || index === 0 ? 'MET' : 'MISSING',
  );

/** The stub writer's or judge's reply to `prompt`. */
function replyTo(prompt) {
  const asked = /^Write (?:exactly )?(\d+) checklist items\.$/m.exec(prompt);
  if (asked && prompt.includes('=== END OF REQUEST ==='))
    return JSON.stringify({
      items: Array.from(
        { length: Number(asked[1]) },
        (_, index) =>
          `The answer covers requested point number ${index + 1} of this task.`,
      ),
    });
  const checklist = /=== CHECKLIST[^\n]*\n([\s\S]*?)\n\n<<<ANSWER id=/.exec(
    prompt,
  );
  const answer = ANSWER_BLOCK.exec(prompt);
  if (!checklist || !answer)
    throw new Error(
      'stub opencode: the prompt is neither a writer nor a judge prompt',
    );
  const count = checklist[1].split('\n').filter(Boolean).length;
  return JSON.stringify({
    items: labelsFor(answer[2], count),
    reason: 'stub judge',
  });
}

/** The `opencode run --help` text the stub prints: the shape of current OpenCode versions, with no --standalone. */
const STUB_RUN_HELP =
  'opencode run [message..]\n\nOptions:\n  --format  output format\n  --auto    approve permissions\n  -m        model\n';

/** The stub `opencode`: `run ... <prompt>` replies; `run --help` prints its options; `--version` the stub version. */
function runOpenCode(args) {
  if (args[0] === '--version') return `${STUB_VERSION}\n`;
  if (args[0] !== 'run')
    throw new Error(
      `stub opencode: unexpected command ${JSON.stringify(args[0])}`,
    );
  if (args.length === 2 && args[1] === '--help') return STUB_RUN_HELP;
  if (args.includes('--standalone'))
    throw new Error('stub opencode: this version has no --standalone');
  return openCodeTrace(replyTo(args[args.length - 1]));
}

/**
 * A stand-in for proc.run that answers `claude` and `opencode` like the real tools and refuses anything else, so a
 * stub run can never start a real process.
 */
async function stubProcess(command, args, options = {}) {
  const name = path.basename(String(command));
  let stdout;
  if (name === 'claude') stdout = runSubject(args, options);
  else if (name === 'opencode') stdout = runOpenCode(args);
  else
    throw new Error(
      `the stub provider runs no ${JSON.stringify(name)} process`,
    );
  return {
    code: 0,
    stdout,
    stderr: '',
    ms: 1,
    timedOut: false,
    overflow: false,
  };
}

/** Stub credentials that expire an hour after `now()`. */
const stubCredentials = (now) => async () => ({
  accessKeyId: 'ASIA' + 'STUBPROVIDER0000',
  secretAccessKey: 'stub-provider-' + 'secret-value',
  sessionToken: 'stub-provider-' + 'session-token',
  expiration: new Date(now() + STUB_CREDENTIAL_LIFETIME_MS).toISOString(),
});

/**
 * The options job.js passes to each job for the stub provider: { pairsOptions, checklistOptions, judgeOptions }.
 * `now` is the clock (tests fix it). Retries do not pause, because a stub call never fails for a passing reason.
 */
function stubJobOptions({ now = Date.now } = {}) {
  const getCredentials = stubCredentials(now);
  const judgeCall = (args) =>
    require('./opencode').judgeCall({ ...args, run: stubProcess });
  return {
    pairsOptions: {
      skillsVersion: STUB_VERSION,
      subject: {
        run: stubProcess,
        getCredentials,
        now,
        sleep: async () => {},
        retryBaseMs: 0,
      },
    },
    checklistOptions: {
      judgeCall,
      getCredentials,
      now,
      writer: { sleep: async () => {}, delayMs: () => 0 },
    },
    judgeOptions: {
      judgeCall,
      getCredentials,
      readVersion: async () => STUB_VERSION,
      now,
      retry: { sleep: async () => {}, baseMs: 0 },
    },
  };
}

module.exports = {
  PROVIDERS,
  STUB_VERSION,
  FULL_ANSWER_MARK,
  SUBJECT_COST_USD,
  isStubRun,
  assertStubRun,
  stubLayout,
  subjectAnswer,
  replyTo,
  stubProcess,
  stubJobOptions,
};
