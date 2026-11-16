// SPDX-License-Identifier: Apache-2.0
// Tests for the request-only checklist writer (scripts/bench/lib/request-checklist.js): the writer sees the request
// text and the item count and nothing else, how a skill's name and rule references are stripped, how many items it
// asks for, that a reply is read only from a call that succeeded, retries, provider blocks, copies, credentials, the
// spend stop and the files it writes. Temp dirs and injected calls only: no process is started and no model is called.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = test;
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const checklist = require('../../../scripts/bench/lib/request-checklist');
const {
  CredentialError,
} = require('../../../scripts/bench/lib/aws-credentials');
const formats = require('../../../scripts/bench/lib/formats');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { SpendStopError } = require('../../../scripts/bench/lib/ledger');
const { createRedactor } = require('../../../scripts/bench/lib/redact');
const { checklistSha256 } = require('../../../scripts/bench/lib/provenance');
const { SystemicFailureError } = require('../../../scripts/bench/lib/retry');
const helpers = require('./helpers');
const { callCost } = require('../../../scripts/bench/lib/cost-profile');

const SKILL = 'plan-review';
const MODEL = 'writer-model';
const SKILL_MD_LINE =
  'Verbatim line of the SKILL.md body that must never reach the writer.';
const NOW = () => new Date('2026-11-10T00:00:00Z');
const config = helpers.exampleConfig();
const SIZES_FILE = path.join(
  helpers.FIXTURE_DIR,
  'checklist',
  'rules-checklist-sizes.json',
);
const BREW_LOG_TASKS = path.join(
  helpers.fixtureRoot(),
  'bench',
  'baselines',
  'brew-log',
  'tasks-b1.json',
);

const makeItems = (count, tag = 'item') =>
  Array.from(
    { length: count },
    (_, index) =>
      `The answer covers ${tag} number ${index + 1} of this request.`,
  );
const reply = (count, tag) => JSON.stringify({ items: makeItems(count, tag) });
const okResult = (text, extra = {}) => ({
  ok: true,
  text,
  usd: 0.01,
  ms: 3,
  error: null,
  ...extra,
});
const failedResult = (error, extra = {}) => ({
  ok: false,
  text: '',
  usd: 0.01,
  ms: 1,
  error,
  ...extra,
});
const makeTask = (index, prompt, itemCount = 6) => ({
  id: `keep-t-${index}`,
  prompt: prompt || `Request number ${index}: summarise the migration.`,
  rubric: makeItems(itemCount, 'RULES-ITEM'),
  title: 'TITLE-TEXT',
  target_section: 'SECTION-TEXT',
  why_skill_matters: SKILL_MD_LINE,
});
const makeSet = (tasks, extra = {}) => ({
  skill: 'keep-skill',
  batch: 'b1',
  tasks,
  ...extra,
});
const plan = (dir, sets, more = {}) =>
  checklist.planChecklists({
    sets,
    layout: createLayout({ root: dir }),
    model: MODEL,
    config,
    ...more,
  });

/** Runs writeChecklists with `call` and an in-memory write; returns what was written and logged. */
async function run(jobs, call, more = {}) {
  const written = {};
  const logs = [];
  const result = await checklist.writeChecklists({
    jobs,
    call,
    write: (file, record) => {
      written[file] = record;
    },
    model: MODEL,
    concurrency: 2,
    delayMs: () => 0,
    sleep: async () => {},
    now: NOW,
    log: (line) => logs.push(line),
    ...more,
  });
  return { result, written, logs };
}

// ---- the prompt file ---------------------------------------------------------------------------------------------

test('the writer prompt file is pinned by its bytes, and the license line never reaches the writer', () => {
  const file = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'scripts',
    'bench',
    'prompts',
    'checklist-prompt.request-only.v2.md',
  );
  assert.equal(checklist.WRITER_TEMPLATE_FILE, file);
  assert.equal(
    checklist.WRITER_PROMPT_SHA256,
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  );
  assert.equal(
    checklist.WRITER_PROMPT_SHA256,
    '734d309330f4a50eaa9d74a2966be4a6cd0751e49c97ac05a149657b36988321',
  );
  const prompt = checklist.buildPrompt({ request: 'R', itemCount: 6 });
  assert.ok(!prompt.includes('SPDX'));
  assert.ok(prompt.startsWith('You write the checklist'));
});

test('a prompt file with a missing, extra or stray placeholder is refused', () => {
  helpers.withTmp((dir) => {
    const load = (text) => {
      const file = path.join(dir, 'p.md');
      fs.writeFileSync(file, text);
      return () => checklist.loadTemplate(file, ['request', 'count']);
    };
    assert.doesNotThrow(load('{{request}} and {{count}}'));
    assert.throws(
      load('{{request}} only'),
      /exactly \{\{request\}\}, \{\{count\}\}/,
    );
    assert.throws(load('{{request}} {{count}} {{extra}}'), /exactly/);
    assert.throws(load('{{request}} {{count}} {{ bad'), /stray/);
  });
});

// ---- what the writer is given ------------------------------------------------------------------------------------

test('stripReferences removes the skill identifier, bench: names, SKILL.md paths and rule ids, and leaves ordinary words alone', () => {
  const stripped = checklist.stripReferences(
    'Use plan-review and bench:plan-review (see skills/plan-review/SKILL.md) on this. Rule r07 and plan-review-r12 apply. Also plan_review. Please do a plan review of the doc.',
    { skill: SKILL, ruleIds: ['custom-rule-id'] },
  );
  assert.ok(stripped.removed >= 6, `removed ${stripped.removed}`);
  for (const gone of [
    'plan-review',
    'plan_review',
    'bench:',
    'SKILL.md',
    'r07',
    'r12',
  ])
    assert.ok(
      !stripped.text.includes(gone),
      `${gone} is gone: ${stripped.text}`,
    );
  assert.match(
    stripped.text,
    /plan review of the doc/,
    'the spaced words are language, not a reference, and stay',
  );
  assert.ok(!/ {2}|\(\s*\)| [.,]/.test(stripped.text), 'the gaps are closed');
  const plain = checklist.stripReferences('A plain request.', { skill: SKILL });
  assert.deepEqual(plain, { text: 'A plain request.', removed: 0 });
  assert.ok(
    !checklist
      .stripReferences('uses custom-rule-id here', {
        skill: 'x-y',
        ruleIds: ['custom-rule-id'],
      })
      .text.includes('custom-rule-id'),
  );
  assert.ok(
    !checklist
      .stripReferences('see .claude/skills/other-skill/SKILL.md first', {
        skill: SKILL,
      })
      .text.includes('skills/'),
  );
  assert.equal(
    checklist.stripReferences('look in .claude/skills/other-skill for it', {
      skill: SKILL,
    }).text,
    'look in for it',
    'a skills folder path without SKILL.md is a reference too',
  );
  assert.deepEqual(
    checklist.findRequestProblems(stripped.text, { skill: SKILL }),
    [],
  );
  assert.ok(
    checklist.findRequestProblems('mentions plan-review', { skill: SKILL })
      .length,
  );
});

test('stripReferences leaves a request with no reference exactly as it is: indentation, double spaces and spaced punctuation', () => {
  const text = 'Fix this YAML:\n  key:  value\n    nested:   x ( see this ) .';
  const stripped = checklist.stripReferences(text, {
    skill: SKILL,
    ruleIds: [],
  });
  assert.equal(stripped.text, text);
  assert.equal(stripped.removed, 0);
});

test('a one-word skill name is an ordinary word: only its bench: name is stripped', () => {
  const stripped = checklist.stripReferences(
    'Add verification steps, as bench:verification would. Not verification-under-test.',
    { skill: 'verification' },
  );
  assert.equal(stripped.removed, 1);
  assert.match(
    stripped.text,
    /^Add verification steps, as would\. Not verification-under-test\.$/,
  );
  assert.deepEqual(checklist.skillNameVariants('verification'), [
    'bench:verification',
  ]);
  assert.deepEqual(checklist.skillNameVariants(''), []);
  assert.deepEqual(checklist.skillNameVariants('code-review'), [
    'code-review',
    'code_review',
    'bench:code-review',
  ]);
});

test('requestOnlyInput reads the id, the prompt and the LENGTH of the rules checklist, and no other property of the task', () => {
  const reads = [];
  const rubric = new Proxy(makeItems(5, 'RULES-ITEM'), {
    get(target, key) {
      reads.push(`rubric.${String(key)}`);
      return target[key];
    },
  });
  const base = {
    id: 'plan-review-rules-1',
    prompt: 'Please review this plan.',
    rubric,
    title: 'T',
    target_section: 'Core Principle',
    why_skill_matters: SKILL_MD_LINE,
    scenario_hint: 'HINT',
    source_quote: 'QUOTE',
    rule_ids: ['plan-review-r01'],
  };
  const task = new Proxy(base, {
    get(target, key) {
      reads.push(String(key));
      return target[key];
    },
  });
  const input = checklist.requestOnlyInput(task, { skill: SKILL });
  const properties = new Set(reads);
  assert.deepEqual(
    [...properties].filter((name) => !name.startsWith('rubric.')).sort(),
    ['id', 'prompt', 'rubric'],
  );
  assert.deepEqual(
    [...properties].filter((name) => name.startsWith('rubric.')),
    ['rubric.length'],
    'only the length of the rules checklist is read',
  );
  assert.deepEqual(Object.keys(input).sort(), [
    'item_count',
    'removed',
    'request',
    'request_sha256',
    'task_id',
  ]);
  assert.equal(input.item_count, 5);
  assert.equal(input.request, 'Please review this plan.');
});

test('the prompt holds the request and the count and nothing else: no skill name, rule text, checklist item, title or SKILL.md line', () => {
  const task = {
    id: 'plan-review-rules-3',
    prompt:
      'Our team asked for a review of plan-review style plans. Is the rollout section ready?\nStep 1: provision. Step 2: cut over on 12 Nov.',
    rubric: makeItems(6, 'RULES-ITEM about plan-review-r04'),
    title: 'TITLE-TEXT',
    target_section: 'SECTION-TEXT',
    why_skill_matters: SKILL_MD_LINE,
  };
  const input = checklist.requestOnlyInput(task, {
    skill: SKILL,
    ruleIds: ['plan-review-r04'],
  });
  const prompt = checklist.buildPrompt({
    request: input.request,
    itemCount: input.item_count,
  });
  for (const leak of [
    'plan-review',
    'RULES-ITEM',
    'TITLE-TEXT',
    'SECTION-TEXT',
    SKILL_MD_LINE,
    'r04',
    'plan-review-rules-3',
  ])
    assert.ok(!prompt.includes(leak), `${leak} reached the prompt`);
  assert.ok(prompt.includes('Is the rollout section ready?'));
  assert.ok(prompt.includes('Step 2: cut over on 12 Nov.'));
  assert.ok(prompt.includes('Write exactly 6 checklist items.'));
  // The prompt is a function of the request and the count only.
  assert.equal(
    prompt,
    checklist.buildPrompt({ request: input.request, itemCount: 6 }),
  );
  assert.notEqual(
    prompt,
    checklist.buildPrompt({ request: input.request, itemCount: 7 }),
  );
  assert.equal(checklist.buildPrompt.length, 1, 'one options object');
  // A request that holds placeholder text is not expanded.
  assert.ok(
    checklist
      .buildPrompt({ request: 'literal {{count}} here', itemCount: 6 })
      .includes('literal {{count}} here'),
  );
  assert.throws(() => checklist.buildPrompt({ request: 'r' }), /itemCount/);
});

test('a request that is empty or still unsafe after stripping is refused, not handed to the writer', () => {
  assert.throws(
    () =>
      checklist.requestOnlyInput(
        { id: 'x-1', prompt: '', rubric: makeItems(5) },
        { skill: SKILL },
      ),
    /x-1: the request is empty/,
  );
  // A name inside a longer token is stripped at its boundaries, so what is left is clean.
  const out = checklist.requestOnlyInput(
    {
      id: 'x-2',
      prompt: 'See notes.plan-review.v2 for details.',
      rubric: makeItems(5),
    },
    { skill: SKILL },
  );
  assert.ok(!out.request.includes('plan-review'));
  // A rule id that only findRequestProblems knows (not stripped because it is not a whole token) is refused.
  assert.match(
    checklist.findRequestProblems('rule xr-9z here', { ruleIds: ['xr-9z'] })[0],
    /rule id xr-9z/,
  );
  assert.match(
    checklist.findRequestProblems('see bench:foo', {})[0],
    /bench: reference/,
  );
  assert.match(checklist.findRequestProblems('a SKILL.md', {})[0], /SKILL\.md/);
});

// ---- how many items ----------------------------------------------------------------------------------------------

test('the item count is the length of the rules checklist, inside the range the written tasks span', () => {
  const sizes = helpers.readJson(SIZES_FILE);
  const counts = Object.keys(sizes.counts_by_items).map(Number);
  assert.equal(
    sizes.tasks,
    Object.values(sizes.counts_by_items).reduce((sum, count) => sum + count, 0),
  );
  assert.equal(Math.min(...counts), checklist.ITEM_COUNT.min);
  assert.equal(Math.max(...counts), checklist.ITEM_COUNT.max);
  assert.deepEqual(checklist.ITEM_COUNT, { min: 5, max: 8 });
  for (const count of counts) {
    const input = checklist.requestOnlyInput(
      { id: 's-1', prompt: 'A request.', rubric: makeItems(count) },
      { skill: SKILL },
    );
    assert.equal(input.item_count, count);
    assert.match(
      checklist.buildPrompt({
        request: input.request,
        itemCount: input.item_count,
      }),
      new RegExp(`exactly ${count} checklist items`),
    );
  }
  for (const rubric of [undefined, makeItems(4), makeItems(9), 'six'])
    assert.throws(
      () =>
        checklist.requestOnlyInput(
          { id: 's-2', prompt: 'A request.', rubric },
          { skill: SKILL },
        ),
      /s-2: the rules checklist has .* items; a request-only checklist is written for 5 to 8/,
    );
  // The committed fixture tasks follow the same rule.
  const tasksFile = helpers.readJson(BREW_LOG_TASKS);
  helpers.withTmp((dir) => {
    const jobs = plan(dir, [
      { skill: 'brew-log', batch: 'b1', tasks: tasksFile.scenarios },
    ]);
    assert.equal(jobs.length, tasksFile.scenarios.length);
    jobs.forEach((job, index) => {
      assert.equal(job.state, 'pending');
      assert.equal(
        job.input.item_count,
        tasksFile.scenarios[index].rubric.length,
      );
    });
  });
});

test('readReply accepts only one JSON object whose only field is "items", with the exact number of distinct items of 12 to 400 characters', () => {
  const read = (text, itemCount = 6) =>
    checklist.readReply(text, { itemCount });
  for (const count of [5, 7, 9]) {
    const wrong = read(reply(count));
    assert.deepEqual(
      wrong.problems,
      [`${count} items, want exactly 6`],
      `${count} items for a count of 6`,
    );
  }
  const good = read(reply(6));
  assert.deepEqual(good.problems, []);
  assert.equal(good.items.length, 6);
  assert.deepEqual(
    read('```json\n' + reply(6) + '\n```').problems,
    [],
    'one fence around the whole reply is read',
  );
  assert.deepEqual(
    read(
      JSON.stringify({
        items: makeItems(6).map((item) => `  ${item.replace(/ /g, '\n ')}  `),
      }),
    ).items,
    makeItems(6),
    'spacing is collapsed',
  );
  // A fenced reply whose items hold three backticks is read like the same reply without the fence.
  const withBackticks = [
    ...makeItems(5),
    'Quote the call as ``` in the answer',
  ];
  assert.deepEqual(
    read('```json\n' + JSON.stringify({ items: withBackticks }) + '\n```'),
    read(JSON.stringify({ items: withBackticks })),
  );
  assert.deepEqual(
    read('```json\n' + JSON.stringify({ items: withBackticks }) + '\n```')
      .problems,
    [],
  );
  // A repeated "items" key is refused whichever copy is the right one, escaped or fenced or not.
  const itemsJson = JSON.stringify(makeItems(6));
  const wrongJson = JSON.stringify(makeItems(5));
  for (const text of [
    `{"items":${itemsJson},"items":${itemsJson}}`,
    `{"items":${wrongJson},"items":${itemsJson}}`,
    `{"items":${itemsJson},"items":${wrongJson}}`,
    `{"items":${wrongJson},"\\u0069tems":${itemsJson}}`,
    '```json\n' + `{"items":${wrongJson},"items":${itemsJson}}` + '\n```',
  ]) {
    const result = read(text);
    assert.equal(result.items, null, text);
    assert.deepEqual(result.problems, ['the reply repeats the "items" field']);
  }
  for (const text of [
    '',
    'not json at all',
    '[]',
    '{"rubric":[]}',
    JSON.stringify({ items: makeItems(6), note: 'x' }),
    'Here: ' + reply(6),
    '```\n' + reply(6) + '\n```\n```\n{}\n```',
  ]) {
    const result = read(text);
    assert.equal(result.items, null, text);
    assert.equal(result.problems.length, 1, text);
  }
  assert.match(
    read(JSON.stringify({ items: ['x'.repeat(30), 5] })).problems[0],
    /every item must be a string/,
  );
  assert.match(read(reply(5)).problems[0], /5 items, want exactly 6/);
  assert.match(
    read(JSON.stringify({ items: ['too short', ...makeItems(5)] })).problems[0],
    /item 1 has 9 characters, want 12 to 400/,
  );
  assert.match(
    read(JSON.stringify({ items: ['x'.repeat(401), ...makeItems(5)] }))
      .problems[0],
    /item 1 has 401 characters/,
  );
  assert.deepEqual(
    read(
      JSON.stringify({
        items: ['x'.repeat(400), 'y'.repeat(12), ...makeItems(4)],
      }),
    ).problems,
    [],
    '12 and 400 are inside the limit',
  );
  assert.match(
    read(
      JSON.stringify({
        items: [...makeItems(5), makeItems(1)[0].toUpperCase()],
      }),
    ).problems[0],
    /item 6 repeats an earlier item/,
  );
});

// ---- the plan ----------------------------------------------------------------------------------------------------

test('planChecklists: pending, copy (same request and count, one call), done, and blocked; a changed prompt, model or count makes a file stale', () => {
  helpers.withTmp((dir) => {
    const tasks = [
      makeTask(1),
      makeTask(2),
      makeTask(3, makeTask(1).prompt),
      makeTask(4, makeTask(1).prompt, 7),
    ];
    let jobs = plan(dir, [makeSet(tasks)]);
    assert.deepEqual(
      jobs.map((job) => job.state),
      ['pending', 'pending', 'copy', 'pending'],
    );
    assert.equal(jobs[2].copy_of, 'keep-t-1');
    assert.equal(
      jobs[3].copy_of,
      null,
      'the same request with another item count needs its own call',
    );
    assert.equal(
      jobs[0].file,
      createLayout({ root: dir }).checklistFile('keep-skill', 'b1', 'keep-t-1'),
    );
    const projection = checklist.projection(jobs);
    assert.deepEqual(
      [
        projection.total,
        projection.pending,
        projection.copies,
        projection.calls,
        projection.max_calls,
      ],
      [4, 3, 1, 3, 3 * (3 + 1)],
    );
    const pending = jobs.filter((job) => job.state === 'pending');
    const pendingUsd = pending.reduce((sum, job) => sum + job.est.usd, 0);
    const repairUsd = pending.reduce((sum, job) => sum + job.est_repair.usd, 0);
    assert.ok(projection.projected_usd > 0);
    assert.equal(projection.projected_usd, Number(pendingUsd.toFixed(4)));
    assert.equal(
      projection.worst_case_usd,
      Number((pendingUsd * 3 + repairUsd).toFixed(4)),
      'every attempt of every pending call, and its repair call',
    );
    assert.equal(checklist.remainingOf(jobs), 4);

    const record = checklist.checklistRecord({
      job: jobs[0],
      items: makeItems(6),
      model: MODEL,
      now: NOW,
    });
    checklist.writeChecklistFile(jobs[0].file, record);
    jobs = plan(dir, [makeSet(tasks)]);
    assert.deepEqual(
      jobs.map((job) => job.state),
      ['done', 'pending', 'copy', 'pending'],
      "the third has the first one's request: a copy of its file, no new call",
    );
    assert.equal(checklist.remainingOf(jobs), 3);
    assert.equal(checklist.projection(jobs).done, 1);

    const restate = (change) => {
      fs.writeFileSync(jobs[0].file, JSON.stringify({ ...record, ...change }));
      return plan(dir, [makeSet(tasks)])[0].state;
    };
    assert.equal(
      restate({ prompt_sha256: '0'.repeat(64) }),
      'pending',
      'another writer prompt',
    );
    assert.equal(
      restate({ writer_model: 'some-other-model' }),
      'pending',
      'another writer model',
    );
    assert.equal(
      restate({ request_sha256: '1'.repeat(64) }),
      'pending',
      'a stored request that is not the one its own digest names',
    );
    assert.equal(
      restate({ checklist_version: checklist.CHECKLIST_VERSION + 1 }),
      'pending',
      'another version',
    );
    assert.equal(
      restate({ item_count: 5, items: makeItems(5) }),
      'pending',
      'another item count',
    );
    assert.equal(
      restate({ item_count: 5 }),
      'pending',
      'a record of another item count, even with the right number of items',
    );
    assert.equal(
      restate({ items: makeItems(5) }),
      'pending',
      'items that are not the ones the record hashes',
    );
    assert.equal(
      restate({ task_id: 'keep-t-9' }),
      'pending',
      'a file of another task',
    );
    assert.equal(restate({}), 'done');
    // A file that is consistent in itself but was made for an earlier wording of the request is out of date.
    const edited = plan(dir, [
      makeSet([
        { ...tasks[0], prompt: `${tasks[0].prompt} Also cover the rollback.` },
        ...tasks.slice(1),
      ]),
    ]);
    assert.equal(edited[0].state, 'pending', 'the request was edited');
    // Items that fail the checks stay out of date even when the digests of the record match them.
    const shortItems = Array.from({ length: 6 }, () => 'x');
    const weak = checklist.checklistRecord({
      job: jobs[0],
      items: shortItems,
      model: MODEL,
      now: NOW,
    });
    fs.writeFileSync(jobs[0].file, JSON.stringify(weak));
    assert.equal(
      plan(dir, [makeSet(tasks)])[0].state,
      'pending',
      'six items of one character, with matching digests',
    );
    fs.writeFileSync(jobs[0].file, JSON.stringify(record));
    // A request that is not clean is blocked and priced at nothing.
    const blocked = plan(dir, [makeSet([{ ...makeTask(9), prompt: '' }])]);
    assert.equal(blocked[0].state, 'blocked');
    assert.match(blocked[0].problem, /keep-t-9: the request is empty/);
    assert.equal(blocked[0].est, null);
    assert.equal(checklist.projection(blocked).blocked, 1);
  });
});

test('the estimate of a writer call is the p90 of its model in the cost profile, the figure plan uses', () => {
  const opus = config.models.judges.anthropic;
  // A model with an entry: its p90.
  assert.deepEqual(checklist.estimateCall(config, opus), {
    usd: callCost(config, 'writer', opus).p90,
  });
  assert.equal(checklist.estimateCall(config, opus).usd, 0.03746);
  // A model with no entry: estimate_usd_per_call.writer x 1.5.
  const writer = 0.5;
  assert.equal(
    checklist.estimateCall(
      helpers.exampleConfig({ estimate_usd_per_call: { writer } }),
      MODEL,
    ).usd,
    writer * 1.5,
  );
  helpers.withTmp((dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    assert.deepEqual(jobs[0].est, {
      usd: config.estimate_usd_per_call.writer * 1.5,
    });
  });
});

// ---- running -----------------------------------------------------------------------------------------------------

test('writeChecklists writes one file per request with the fields the judge side needs; two tasks with one request cost one call', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [
      makeSet([makeTask(1), makeTask(2), makeTask(3, makeTask(1).prompt)]),
    ]);
    const prompts = [];
    const { result, written, logs } = await run(
      jobs,
      async (job, attempt, prompt) => {
        prompts.push(prompt);
        return okResult(reply(6, job.task_id));
      },
    );
    assert.equal(prompts.length, 2);
    assert.deepEqual(result.written.sort(), ['keep-t-1', 'keep-t-2']);
    assert.deepEqual(result.copied, ['keep-t-3']);
    assert.deepEqual([result.failed, result.refused], [[], []]);
    assert.equal(result.usd, 0.02);
    const record = written[jobs[0].file];
    assert.deepEqual(Object.keys(record), [
      'kind',
      'checklist_version',
      'prompt_sha256',
      'writer_model',
      'request_sha256',
      'items_sha256',
      'skill',
      'batch',
      'task_id',
      'item_count',
      'request',
      'items',
      'attempt',
      'usd',
      'ms',
      'created_at',
    ]);
    assert.equal(record.kind, checklist.CHECKLIST_KIND);
    assert.equal(record.prompt_sha256, checklist.WRITER_PROMPT_SHA256);
    assert.equal(record.writer_model, MODEL);
    assert.equal(record.request_sha256, jobs[0].input.request_sha256);
    assert.equal(
      record.request,
      jobs[0].input.request,
      'the exact request the writer saw is on record',
    );
    assert.deepEqual(record.items, makeItems(6, 'keep-t-1'));
    assert.equal(
      record.items_sha256,
      checklistSha256(record.items),
      'the digest of the items the judge side scores against',
    );
    assert.deepEqual(
      [record.attempt, record.usd, record.ms, record.created_at],
      [1, 0.01, 3, '2026-11-10T00:00:00.000Z'],
    );
    const copy = written[jobs[2].file];
    assert.equal(copy.copied_from, 'keep-t-1');
    assert.deepEqual(copy.items, record.items);
    assert.deepEqual(
      [copy.usd, copy.attempt, copy.task_id],
      [0, null, 'keep-t-3'],
    );
    assert.ok(logs.some((line) => /keep-t-3: copied from keep-t-1/.test(line)));
  });
});

test('a copy whose source is already on disk is written from that file, with no call', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const tasks = [makeTask(1), makeTask(2, makeTask(1).prompt)];
    const first = plan(dir, [makeSet(tasks)]);
    checklist.writeChecklistFile(
      first[0].file,
      checklist.checklistRecord({
        job: first[0],
        items: makeItems(6, 'disk'),
        model: MODEL,
      }),
    );
    const jobs = plan(dir, [makeSet(tasks)]);
    assert.deepEqual(
      jobs.map((job) => job.state),
      ['done', 'copy'],
    );
    const { result, written } = await run(jobs, async () => {
      throw new Error('must not be called');
    });
    assert.deepEqual(result.copied, ['keep-t-2']);
    assert.deepEqual(written[jobs[1].file].items, makeItems(6, 'disk'));
  });
});

test('a failed call is never parsed, even when its text is shaped like a good reply', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    let calls = 0;
    const { result, written } = await run(jobs, async () => {
      calls += 1;
      return failedResult('throttled', { text: reply(6) });
    });
    assert.equal(calls, 3, 'retried to the limit');
    assert.deepEqual(result.written, []);
    assert.deepEqual(result.failed, [
      { task_id: 'keep-t-1', reason: 'throttled' },
    ]);
    assert.deepEqual(written, {}, 'nothing written for a failed call');
    assert.equal(result.usd, 0.03, 'every failed call is counted');
  });
});

test('a reply that fails the checks is retried with a growing pause; the good reply is written once', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const replies = [
      okResult('I cannot do that'),
      okResult(reply(4)),
      okResult(reply(6)),
    ];
    const pauses = [];
    let index = 0;
    const { result, written } = await run(jobs, async () => replies[index++], {
      delayMs: (attempt) => attempt * 10,
      sleep: async (ms) => pauses.push(ms),
    });
    assert.equal(index, 3);
    assert.deepEqual(pauses, [20, 30], 'no pause before the first call');
    assert.deepEqual(result.written, ['keep-t-1']);
    const record = Object.values(written)[0];
    assert.equal(record.attempt, 3);
    assert.equal(
      record.usd,
      0.03,
      'the rejected replies are in the cost of the checklist',
    );
  });
});

test('three rejected replies fail the task with the reason, and do not count as a backend failure', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [
      makeSet([1, 2, 3, 4, 5].map((index) => makeTask(index))),
    ]);
    const { result } = await run(jobs, async () => okResult(reply(4)), {
      concurrency: 1,
    });
    assert.equal(
      result.failed.length,
      5,
      'no systemic stop: the provider answered',
    );
    assert.match(
      result.failed[0].reason,
      /^reply rejected: 4 items, want exactly 6/,
    );
  });
});

test('a provider block is confirmed by one more call, then the task is refused for a person to record', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    let calls = 0;
    const { result, logs } = await run(jobs, async () => {
      calls += 1;
      return failedResult('The provider blocked the response');
    });
    assert.equal(calls, 2, 'the block, then one call to confirm it');
    assert.deepEqual(result.failed, []);
    assert.equal(result.refused.length, 1);
    assert.equal(result.refused[0].task_id, 'keep-t-1');
    assert.match(result.refused[0].reason, /blocked the reply 2 times/);
    assert.ok(logs.some((line) => /keep-t-1: NOT written/.test(line)));
    // A block that a retry does not repeat is not a refusal.
    const sequence = [
      failedResult('The provider blocked the response'),
      okResult(reply(6)),
    ];
    let index = 0;
    const second = await run(jobs, async () => sequence[index++]);
    assert.deepEqual(second.result.written, ['keep-t-1']);
    // Blocks never trip the systemic stop.
    const many = plan(dir, [makeSet([1, 2, 3, 4, 5].map((n) => makeTask(n)))]);
    const blocked = await run(
      many,
      async () => failedResult('content filtering policy'),
      { concurrency: 1 },
    );
    assert.equal(blocked.result.refused.length, 5);
  });
});

test('a failure the provider says can never work is not retried and does not count as a backend failure', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [
      makeSet([1, 2, 3, 4, 5].map((index) => makeTask(index))),
    ]);
    let calls = 0;
    const { result } = await run(
      jobs,
      async () => {
        calls += 1;
        return failedResult('ValidationException: the model id is invalid');
      },
      { concurrency: 1 },
    );
    assert.equal(calls, 5, 'one call per task');
    assert.equal(result.failed.length, 5);
  });
});

test('a call that throws before it starts is not retried; a fatal throw stops the job', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    let calls = 0;
    const { result } = await run(jobs, async () => {
      calls += 1;
      throw new RangeError('refusing to run: the judge prompt is too long');
    });
    assert.equal(calls, 1);
    assert.equal(result.failed.length, 1, 'the task is listed once');
    assert.match(
      result.failed[0].reason,
      /^the call could not be made: refusing to run/,
    );
    await assert.rejects(
      run(jobs, async () => {
        throw new SpendStopError('over the cap', 'max_usd');
      }),
      (error) => error instanceof SpendStopError,
    );
    await assert.rejects(
      run(jobs, async () => {
        throw new CredentialError('credentials expire in 1 minute');
      }),
      (error) => error instanceof CredentialError,
    );
  });
});

test('a fatal stop carries what was written and spent before it', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(0), makeTask(1), makeTask(2)])]);
    let calls = 0;
    await assert.rejects(
      run(
        jobs,
        async (job) => {
          calls += 1;
          if (calls === 1) return okResult(reply(job.input.item_count));
          throw new SpendStopError('over the cap', 'max_usd');
        },
        { concurrency: 1 },
      ),
      (error) =>
        error instanceof SpendStopError &&
        error.partial.usd === 0.01 &&
        error.partial.written.length === 1 &&
        error.partial.written[0] === jobs[0].task_id &&
        error.partial.copied.length === 0,
    );
  });
});

test('a credential error in a failed call or a thrown error stops the job and writes nothing for that call', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1), makeTask(2)])]);
    const written = {};
    await assert.rejects(
      run(
        jobs,
        async () =>
          failedResult(
            'ExpiredToken: the security token included in the request is expired',
          ),
        {
          concurrency: 1,
          write: (file, record) => {
            written[file] = record;
          },
        },
      ),
      (error) =>
        error.fatal === true &&
        error.kind === 'credential' &&
        /^AWS credentials missing or expired/.test(error.message),
    );
    assert.deepEqual(written, {});
    await assert.rejects(
      run(jobs, async () => {
        throw new Error('Unable to locate credentials');
      }),
      (error) => error.fatal === true && error.kind === 'credential',
    );
  });
});

test('the class of a failure is read from the whole error text, not from the part kept for the log', async () => {
  const noise = 'warning: something noisy happened. '.repeat(20);
  const countCalls = async (message) => {
    let calls = 0;
    await helpers.withTmpAsync(async (dir) => {
      const jobs = plan(dir, [makeSet([makeTask(1)])]);
      try {
        await run(jobs, async () => {
          calls += 1;
          return failedResult(message);
        });
      } catch (error) {
        assert.equal(error.kind, 'credential', 'only a credential stops');
      }
    });
    return calls;
  };
  for (const marker of [
    'ExpiredToken: the security token included in the request is expired',
    'AccessDeniedException: not allowed',
    'provider blocked the response',
  ]) {
    const plain = await countCalls(marker);
    const late = await countCalls(noise + marker);
    assert.equal(late, plain, `the marker after 700 characters: ${marker}`);
  }
  assert.equal(
    await countCalls(`${noise}ExpiredToken: expired`),
    1,
    'a late credential error stops at the first call',
  );
  assert.ok(
    (await countCalls(`${noise}AccessDeniedException: no`)) <
      (await countCalls(`${noise}timeout`)),
    'a late permanent error is not retried like a timeout',
  );
});

test('four tasks in a row whose every call fails stop the job as systemic; finished files are kept', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const tasks = [0, 1, 2, 3, 4, 5].map((index) => makeTask(index));
    const jobs = plan(dir, [makeSet(tasks)]);
    const written = {};
    let calls = 0;
    await assert.rejects(
      run(
        jobs,
        async (job) => {
          calls += 1;
          return job.task_id === 'keep-t-0'
            ? okResult(reply(6))
            : failedResult('timeout');
        },
        {
          concurrency: 1,
          write: (file, record) => {
            written[file] = record;
          },
        },
      ),
      (error) => error instanceof SystemicFailureError && error.fatal === true,
    );
    assert.equal(calls, 1 + 4 * 3, 'no task starts after the fourth');
    assert.deepEqual(
      Object.values(written).map((record) => record.task_id),
      ['keep-t-0'],
    );
    // A task that got any reply resets the streak.
    const mixed = await run(
      plan(dir, [makeSet(tasks.slice(1))]),
      async (job, attempt) =>
        job.task_id === 'keep-t-3' && attempt === 1
          ? okResult('not json')
          : failedResult('timeout'),
      { concurrency: 1 },
    );
    assert.equal(mixed.result.failed.length, 5);
  });
});

test('a copy whose source got no checklist is reported, not written', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [
      makeSet([makeTask(1), makeTask(2, makeTask(1).prompt)]),
    ]);
    const { result, written } = await run(jobs, async () =>
      failedResult('timeout'),
    );
    assert.deepEqual(
      result.failed.map((entry) => entry.task_id),
      ['keep-t-1', 'keep-t-2'],
    );
    assert.match(
      result.failed[1].reason,
      /copies \(keep-t-1\) has no checklist/,
    );
    assert.deepEqual(written, {});
  });
});

test('a write that fails is reported for its task and the other tasks go on', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1), makeTask(2)])]);
    const { result } = await run(jobs, async () => okResult(reply(6)), {
      concurrency: 1,
      write: (file) => {
        if (file.endsWith('keep-t-1.json'))
          throw new Error('EACCES: permission denied');
      },
    });
    assert.deepEqual(result.written, ['keep-t-2']);
    assert.deepEqual(result.failed, [
      { task_id: 'keep-t-1', reason: 'EACCES: permission denied' },
    ]);
  });
});

test('a copy whose write fails is reported, and the other copies are still written', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const prompt = makeTask(1).prompt;
    const jobs = plan(dir, [
      makeSet([makeTask(1), makeTask(2, prompt), makeTask(3, prompt)]),
    ]);
    const { result } = await run(jobs, async () => okResult(reply(6)), {
      write: (file) => {
        if (file.endsWith('keep-t-2.json'))
          throw new Error('ENOSPC: no space left on device');
      },
    });
    assert.deepEqual(result.written, ['keep-t-1']);
    assert.deepEqual(result.copied, ['keep-t-3']);
    assert.deepEqual(result.failed, [
      { task_id: 'keep-t-2', reason: 'ENOSPC: no space left on device' },
    ]);
  });
});

// A value with no secret shape: only a redactor that was given the exact value removes it.
const BARE_SECRET = 'bareValueOnlyTheRunKnows123456';

test('a run redactor cleans the reason of a thrown error, a write error, a failed copy, a pool error and the items in the log', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const runRedactor = createRedactor({ literals: [BARE_SECRET] });
    const notSecret = (list) =>
      list.every((text) => !String(text).includes(BARE_SECRET));
    const jobs = plan(dir, [makeSet([makeTask(1), makeTask(2)])]);
    const thrown = await run(
      jobs,
      async () => {
        throw new Error(`spawn failed with ${BARE_SECRET}`);
      },
      { redact: runRedactor },
    );
    assert.ok(notSecret(thrown.result.failed.map((entry) => entry.reason)));
    assert.ok(notSecret(thrown.logs));
    const unsaved = await run(
      jobs.slice(0, 1),
      async () =>
        okResult(
          JSON.stringify({
            items: [
              ...makeItems(5),
              `The answer quotes ${BARE_SECRET} in an item.`,
            ],
          }),
        ),
      {
        write: () => {
          throw new Error(`EIO while writing ${BARE_SECRET}`);
        },
        redact: runRedactor,
      },
    );
    assert.equal(unsaved.result.failed.length, 1);
    assert.ok(notSecret(unsaved.result.failed.map((entry) => entry.reason)));
    assert.ok(notSecret(unsaved.logs), 'the items of the paid reply too');
    assert.ok(
      unsaved.logs.some((line) => line.includes('could not be saved')),
      'the log line is still there',
    );
    // A copy that cannot be written, and an error that the pool caught.
    const pair = plan(dir, [
      makeSet([makeTask(1, 'Shared request'), makeTask(2, 'Shared request')]),
    ]);
    const copyFail = await run(pair, async () => okResult(reply(6)), {
      write: (file, record) => {
        if (record.copied_from) throw new Error(`EIO ${BARE_SECRET}`);
      },
      redact: runRedactor,
    });
    assert.equal(copyFail.result.failed.length, 1);
    assert.ok(notSecret(copyFail.result.failed.map((entry) => entry.reason)));
    let logCalls = 0;
    const poolError = await run(
      jobs.slice(0, 1),
      async () => okResult(reply(6)),
      {
        log: () => {
          logCalls += 1;
          throw new Error(`log broke ${BARE_SECRET}`);
        },
        redact: runRedactor,
      },
    );
    assert.ok(logCalls > 0);
    assert.equal(poolError.result.failed.length, 1);
    assert.ok(notSecret(poolError.result.failed.map((entry) => entry.reason)));
  });
});

test('a run redactor cleans the reason of a failure that a call returned', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const runRedactor = createRedactor({ literals: [BARE_SECRET] });
    const jobs = plan(dir, [makeSet([makeTask(1), makeTask(2)])]);
    const returned = await run(
      jobs,
      async () => failedResult(`throttled for ${BARE_SECRET}`),
      { attempts: 1, redact: runRedactor },
    );
    assert.equal(returned.result.failed.length, 2);
    for (const text of [
      ...returned.result.failed.map((entry) => entry.reason),
      ...returned.logs,
    ])
      assert.ok(!text.includes(BARE_SECRET), text);
  });
});

test('error text in a reason and a log line is redacted', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const key = ['AKIA', 'IOSFODNN7EXAMPLF'].join('');
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const { result, logs } = await run(
      jobs,
      async () => failedResult(`throttled for ${key}`),
      { attempts: 1 },
    );
    assert.ok(!result.failed[0].reason.includes(key));
    assert.ok(!logs.join('\n').includes(key));
  });
});

// ---- the call and the files --------------------------------------------------------------------------------------

test('a try whose reply reached the output limit and could not be used is counted in cut_off, once per try', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const replies = [
      failedResult('reply cut off at the output limit of 9000 tokens', {
        cutOff: true,
      }),
      okResult('{"items": [', { cutOff: true }),
      okResult(reply(6)),
    ];
    let index = 0;
    const { result } = await run(jobs, async () => replies[index++]);
    assert.deepEqual(result.written, ['keep-t-1']);
    assert.equal(result.cut_off, 2);
  });
});

test('cut_off does not count a reply that used the whole limit and passed the checks, or a failure that was not a cut off', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const replies = [
      failedResult('throttled'),
      okResult('not a checklist'),
      okResult(reply(6), { cutOff: true }),
    ];
    let index = 0;
    const { result } = await run(jobs, async () => replies[index++]);
    assert.deepEqual(result.written, ['keep-t-1']);
    assert.equal(result.cut_off, 0);
  });
});

test('every try of a task cut off at the limit fails the task, and each try of each task is counted', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1), makeTask(2)])]);
    const { result } = await run(jobs, async () =>
      failedResult('reply cut off at the output limit', { cutOff: true }),
    );
    assert.equal(result.failed.length, 2);
    assert.deepEqual(result.written, []);
    assert.equal(result.cut_off, 6, 'two tasks of three tries each');
  });
});

test('createWriterCall makes one judgeCall with the writer model, the job label and the judge timeout, and books what the ledger books', async () => {
  const seen = [];
  const ledger = { reserve: () => {} };
  const guard = { assertFresh: () => {} };
  // The keys the job exported, passed on to the writer process.
  const FRESH_KEYS = {
    accessKeyId: 'fixture-key',
    secretAccessKey: 'fixture-secret',
    sessionToken: 'fixture-token',
  };
  const reply = (fields) => ({
    ok: true,
    text: 'T',
    usage: { input_tokens: 1 },
    reportedUsd: null,
    ms: 1,
    error: null,
    stderr: '',
    ...fields,
  });
  const results = [
    reply({ reportedUsd: 0.05, ms: 7 }),
    reply({
      ok: false,
      text: 'x',
      usage: null,
      ms: 2,
      error: 'timeout',
      stderr: 'slow',
    }),
    reply({}),
    reply({ reportedUsd: 0.04 }),
    reply({ reportedUsd: Number.NaN }),
    reply({ reportedUsd: -0.01 }),
    reply({ reportedUsd: 0 }),
    reply({ reportedUsd: 0, usage: { input_tokens: 0 } }),
    reply({ ok: false, text: '' }),
    reply({ ok: false, cutOff: true, error: 'reply cut off' }),
    reply({ cutOff: true }),
    reply({ cutOff: 'yes' }),
  ];
  const call = checklist.createWriterCall({
    judgeCall: async (options) => {
      seen.push(options);
      return results[seen.length - 1];
    },
    ledger,
    config,
    model: MODEL,
    credentialGuard: guard,
    credentials: FRESH_KEYS,
  });
  const job = { skill: 'keep-skill', batch: 'b1', task_id: 'keep-t-1' };
  assert.deepEqual(await call(job, 2, 'PROMPT'), {
    ok: true,
    text: 'T',
    usd: 0.05,
    ms: 7,
    error: null,
    cutOff: false,
  });
  assert.deepEqual(seen[0], {
    ledger,
    config,
    modelId: MODEL,
    prompt: 'PROMPT',
    label: 'checklist keep-skill/b1/keep-t-1 #2',
    timeoutMs: config.judge_timeout_ms,
    callKind: 'writer',
    credentialGuard: guard,
    credentials: FRESH_KEYS,
  });
  // A writer call with no usable cost is charged the writer mean, never the judge one. The writer model has no
  // profile entry here, so its mean is estimate_usd_per_call.writer.
  const reserved = config.estimate_usd_per_call.writer;
  assert.equal(reserved, 0.01375);
  assert.notEqual(reserved, config.estimate_usd_per_call.judge);
  const failed = await call(job, 1, 'PROMPT');
  assert.deepEqual(
    [failed.ok, failed.usd, failed.error],
    [false, reserved, 'timeout | slow'],
  );
  assert.equal(
    (await call(job, 1, 'P')).usd,
    reserved,
    'nothing reported: charged the mean',
  );
  assert.equal((await call(job, 1, 'P')).usd, 0.04, 'the reported cost');
  assert.equal((await call(job, 1, 'P')).usd, reserved, 'NaN: the mean');
  assert.equal((await call(job, 1, 'P')).usd, reserved, 'below 0: the mean');
  assert.equal(
    (await call(job, 1, 'P')).usd,
    reserved,
    '0 while the usage shows tokens: the mean',
  );
  assert.equal(
    (await call(job, 1, 'P')).usd,
    0,
    '0 with no tokens is a reported cost',
  );
  assert.equal(
    (await call(job, 1, 'P')).error,
    'call failed',
    'a failed call always carries an error',
  );
  assert.equal(
    (await call(job, 1, 'P')).cutOff,
    true,
    'a failed call that hit the limit',
  );
  assert.equal(
    (await call(job, 1, 'P')).cutOff,
    true,
    'a reply that used the whole limit',
  );
  assert.equal((await call(job, 1, 'P')).cutOff, false, 'only true counts');
});

test('bookedUsd charges the mean of a known call kind and model and refuses any other kind or no model', () => {
  const unreported = { reportedUsd: undefined, usage: null };
  const opus = config.models.judges.anthropic;
  const terra = config.models.judges.openai;
  assert.equal(
    checklist.bookedUsd(unreported, config, 'writer', opus),
    callCost(config, 'writer', opus).mean,
  );
  assert.equal(
    checklist.bookedUsd(unreported, config, 'judge', opus),
    callCost(config, 'judge', opus).mean,
  );
  // A model with no profile entry is charged estimate_usd_per_call for its kind.
  assert.equal(
    checklist.bookedUsd(unreported, config, 'writer', MODEL),
    config.estimate_usd_per_call.writer,
  );
  // A model whose CLI reports low is charged at least its mean.
  assert.equal(
    checklist.bookedUsd(
      { reportedUsd: 0.0009, usage: null },
      config,
      'judge',
      terra,
    ),
    0.01336,
  );
  assert.equal(
    checklist.bookedUsd(
      { reportedUsd: 0.0009, usage: null },
      config,
      'judge',
      opus,
    ),
    0.0009,
  );
  for (const callKind of ['Writer', 'rubric', null, 1])
    assert.throws(
      () => checklist.bookedUsd(unreported, config, callKind, opus),
      (error) =>
        error instanceof TypeError &&
        error.message ===
          `bookedUsd: callKind must be one of judge, writer, got ${JSON.stringify(callKind)}`,
      String(callKind),
    );
  for (const model of [undefined, ''])
    assert.throws(
      () => checklist.bookedUsd(unreported, config, 'judge', model),
      /bookedUsd: model must be a non-empty model id/,
    );
});

test('bookedUsd books 0 for a call that ended before a model step, and prices from the profile the call used', async () => {
  const opus = config.models.judges.anthropic;
  assert.equal(
    checklist.bookedUsd(
      { reportedUsd: null, usage: null, modelStarted: false },
      config,
      'judge',
      opus,
    ),
    0,
  );
  const costProfile = {
    entries: [
      { kind: 'writer', model: opus, mean: 0.7, median: 0.7, p90: 0.9 },
    ],
  };
  const unreported = { reportedUsd: undefined, usage: null };
  assert.equal(
    checklist.bookedUsd(unreported, config, 'writer', opus, costProfile),
    0.7,
  );
  // The writer call passes the same profile to judgeCall and books from it.
  const seen = [];
  const call = checklist.createWriterCall({
    judgeCall: async (options) => {
      seen.push(options);
      return { ok: false, text: '', ...unreported, error: 'x', stderr: '' };
    },
    ledger: { reserve: () => {} },
    config,
    model: opus,
    costProfile,
  });
  const booked = await call(
    { skill: 'keep-skill', batch: 'b1', task_id: 'keep-t-1' },
    1,
    'PROMPT',
  );
  assert.equal(seen[0].costProfile, costProfile);
  assert.equal(booked.usd, 0.7);
});

test('readChecklistFile returns null for a file that is absent, not JSON, or not exactly a checklist record', () => {
  helpers.withTmp((dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const record = checklist.checklistRecord({
      job: jobs[0],
      items: makeItems(6),
      model: MODEL,
      now: NOW,
    });
    const file = path.join(dir, 'c.json');
    assert.equal(checklist.readChecklistFile(file), null);
    fs.writeFileSync(file, '{ not json');
    assert.equal(checklist.readChecklistFile(file), null);
    fs.writeFileSync(file, JSON.stringify(record));
    assert.deepEqual(checklist.readChecklistFile(file), record);
    for (const [field, value] of [
      ['kind', 'answer'],
      ['items', []],
      ['items', ['ok item text', 3]],
      ['usd', -1],
      ['prompt_sha256', 'abc'],
      ['items_sha256', 'abc'],
      ['items_sha256', undefined],
      ['task_id', undefined],
      ['extra', 1],
      ['copied_from', ''],
    ]) {
      fs.writeFileSync(
        file,
        JSON.stringify(helpers.edit(record, field, value)),
      );
      assert.equal(
        checklist.readChecklistFile(file),
        null,
        `${field}: ${JSON.stringify(value)}`,
      );
    }
    fs.writeFileSync(
      file,
      JSON.stringify({ ...record, copied_from: 'keep-t-0' }),
    );
    assert.equal(checklist.readChecklistFile(file).copied_from, 'keep-t-0');
  });
});

test('writeChecklistFile writes 0600 in 0700 folders and keeps the file it replaces as superseded', () => {
  helpers.withTmp((dir) => {
    const previous = process.umask(0o022);
    try {
      const file = path.join(
        dir,
        'out',
        'checklists',
        'keep-skill',
        'b1',
        'keep-t-1.json',
      );
      checklist.writeChecklistFile(file, { version: 1 });
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      checklist.writeChecklistFile(
        file,
        { version: 2 },
        { now: () => Date.parse('2026-11-10T00:00:00Z') },
      );
      assert.deepEqual(helpers.readJson(file), { version: 2 });
      assert.deepEqual(fs.readdirSync(path.dirname(file)).sort(), [
        'keep-t-1.json',
        'keep-t-1.json.superseded-2026-11-10T00-00-00-000Z',
      ]);
      assert.deepEqual(
        helpers.readJson(`${file}.superseded-2026-11-10T00-00-00-000Z`),
        { version: 1 },
      );
    } finally {
      process.umask(previous);
    }
  });
});

test('writeChecklistFile moves a finished temporary file into place, leaves no temporary file when that fails, and refuses an existing temporary name', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'out', 'keep-t-1.json');
    const original = fs.renameSync;
    const renames = [];
    let failTemporary = false;
    // Only the move of the temporary file is watched or failed: setting an old file aside is a rename too.
    const rename = mock.method(fs, 'renameSync', (from, to) => {
      if (String(from).includes('.tmp-')) {
        renames.push([from, to]);
        if (failTemporary)
          throw Object.assign(new Error('EXDEV: cross-device link'), {
            code: 'EXDEV',
          });
      }
      return original(from, to);
    });
    try {
      checklist.writeChecklistFile(file, { version: 1 });
      assert.equal(renames.length, 1, 'one rename of the temporary file');
      assert.equal(renames[0][1], file);
      assert.ok(renames[0][0].startsWith(`${file}.tmp-`));
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ['keep-t-1.json']);

      failTemporary = true;
      assert.throws(
        () => checklist.writeChecklistFile(file, { version: 2 }),
        /EXDEV/,
      );
      const names = fs.readdirSync(path.dirname(file));
      assert.ok(
        !names.some((name) => name.includes('.tmp-')),
        `no temporary file is left: ${names}`,
      );
      assert.ok(
        !fs.existsSync(file),
        'the new record is not at the final path until the rename succeeds',
      );
      assert.equal(
        names.filter((name) => name.includes('.superseded-')).length,
        1,
        'the older file was set aside and is kept',
      );
    } finally {
      rename.mock.restore();
    }
    // The temporary file is created exclusively: a name that is taken is an error, not an overwrite.
    const taken = path.join(dir, 'out', 'keep-t-2.json');
    const bytes = mock.method(crypto, 'randomBytes', () =>
      Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]),
    );
    try {
      fs.writeFileSync(`${taken}.tmp-${process.pid}-aabbccdd`, 'someone else');
      assert.throws(
        () => checklist.writeChecklistFile(taken, { version: 1 }),
        (error) => error.code === 'EEXIST',
      );
    } finally {
      bytes.mock.restore();
    }
  });
});

test('a task that writes resets the systemic streak: 3 failing tasks, one that writes and one more failing do not stop the job', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [
      makeSet([0, 1, 2, 3, 4].map((index) => makeTask(index))),
    ]);
    const { result } = await run(
      jobs,
      async (job) =>
        job.task_id === 'keep-t-3'
          ? okResult(reply(6))
          : failedResult('timeout'),
      { concurrency: 1 },
    );
    assert.deepEqual(result.written, ['keep-t-3']);
    assert.equal(result.failed.length, 4);
  });
});

test('one provider block after other failures is a failed task to retry, not a refusal', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const calls = [
      failedResult('timeout'),
      failedResult('timeout'),
      failedResult('The provider blocked the response'),
    ];
    let index = 0;
    const { result } = await run(jobs, async () => calls[index++]);
    assert.equal(index, 3);
    assert.deepEqual(result.refused, [], 'one unconfirmed block is no refusal');
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].reason, /blocked/);
  });
});

test('planChecklists strips a rule id and the bench: name of another skill, trims the request, and hashes the stripped text', () => {
  helpers.withTmp((dir) => {
    const prompt =
      '\n\nBefore the cutover, check bench:other-skill and see custom-rule-id-7 against the plan.\n\n';
    const jobs = plan(dir, [
      makeSet([makeTask(1, prompt)], { ruleIds: ['custom-rule-id-7'] }),
    ]);
    assert.equal(jobs[0].state, 'pending', jobs[0].problem);
    const { request, request_sha256: digest } = jobs[0].input;
    assert.ok(!request.includes('bench:'));
    assert.ok(!request.includes('custom-rule-id-7'));
    const sha = (text) =>
      crypto.createHash('sha256').update(text).digest('hex');
    assert.equal(digest, sha(request), 'the digest is of the stripped text');
    assert.notEqual(digest, sha(prompt));
    // The prompt holds the request without the blank lines around it.
    assert.ok(
      checklist
        .buildPrompt({ request: '\n\nText of the request\n\n', itemCount: 6 })
        .includes(
          '=== REQUEST ===\nText of the request\n=== END OF REQUEST ===',
        ),
    );
  });
});

test('stripReferences removes the parentheses that held only a reference and leaves other parentheses alone', () => {
  const strip = (text) => checklist.stripReferences(text, { skill: SKILL });
  assert.deepEqual(
    strip('Check the plan (bench:plan-review) now, and ( plan-review ) too.'),
    { text: 'Check the plan now, and too.', removed: 2 },
  );
  assert.deepEqual(
    strip(
      'Run parse() and then check_all() for bench:brew-log now. Items (a) stay.',
    ),
    {
      text: 'Run parse() and then check_all() for now. Items (a) stay.',
      removed: 1,
    },
    'the () of a function name stays',
  );
  assert.deepEqual(
    strip('A request that holds (see notes bench:plan-review) as an aside.'),
    { text: 'A request that holds (see notes) as an aside.', removed: 1 },
    'parentheses with other text in them keep that text',
  );
});

test('writeChecklists runs `concurrency` tasks at once', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [
      makeSet([1, 2, 3, 4, 5, 6].map((index) => makeTask(index))),
    ]);
    let active = 0;
    let widest = 0;
    const { result } = await run(
      jobs,
      async () => {
        active += 1;
        widest = Math.max(widest, active);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        return okResult(reply(6));
      },
      { concurrency: 3 },
    );
    assert.equal(result.written.length, 6);
    assert.equal(widest, 3);
  });
});

test('the message of a call that throws before it starts is redacted in the reason and the log', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const key = ['AKIA', 'IOSFODNN7EXAMPLF'].join('');
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const { result, logs } = await run(jobs, async () => {
      throw new RangeError(`refusing to run: unsafe value ${key}`);
    });
    assert.match(result.failed[0].reason, /^the call could not be made/);
    assert.ok(!result.failed[0].reason.includes(key));
    assert.ok(!logs.join('\n').includes(key));
  });
});

test('the writer and the task file format hold the same item limits at every boundary', () => {
  const rubricErrors = (rubric) =>
    formats
      .validateTasks(
        helpers.edit(helpers.goodTasks(), 'scenarios.0.rubric', rubric),
      )
      .errors.filter((error) => /rubric/.test(error));
  for (let count = 3; count <= 10; count += 1) {
    const rubric = makeItems(count);
    let writerAccepts = true;
    try {
      checklist.requestOnlyInput(
        { id: 'n-1', prompt: 'A request.', rubric },
        { skill: SKILL },
      );
    } catch {
      writerAccepts = false;
    }
    assert.equal(
      rubricErrors(rubric).length === 0,
      writerAccepts,
      `${count} items`,
    );
  }
  for (const length of [10, 11, 12, 13, 399, 400, 401, 402]) {
    const items = ['x'.repeat(length), ...makeItems(5)];
    assert.equal(
      rubricErrors(items).length === 0,
      checklist.itemProblems(items, { itemCount: 6 }).length === 0,
      `${length} characters`,
    );
  }
});

test('a checklist whose stored request or items were edited is no longer current', () => {
  helpers.withTmp((dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    const record = checklist.checklistRecord({
      job: jobs[0],
      items: makeItems(6),
      model: MODEL,
      now: NOW,
    });
    const stateWith = (change) => {
      fs.mkdirSync(path.dirname(jobs[0].file), { recursive: true });
      fs.writeFileSync(jobs[0].file, JSON.stringify({ ...record, ...change }));
      return plan(dir, [makeSet([makeTask(1)])])[0].state;
    };
    assert.equal(stateWith({}), 'done');
    assert.equal(
      stateWith({ request: `${record.request} And add a rollback step.` }),
      'pending',
      'the stored request no longer matches request_sha256',
    );
    assert.equal(
      stateWith({ items: makeItems(6, 'edited') }),
      'pending',
      'edited items that still pass the checks no longer match items_sha256',
    );
    assert.equal(
      stateWith({ items_sha256: checklistSha256(makeItems(6, 'edited')) }),
      'pending',
      'a digest of other items',
    );
  });
});

test('a write that fails once is tried once more; one that fails twice puts the paid items in the log and fails the task', async () => {
  await helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    let attempts = 0;
    const once = await run(jobs, async () => okResult(reply(6)), {
      write: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('EIO: input/output error');
      },
    });
    assert.equal(attempts, 2);
    assert.deepEqual(once.result.written, ['keep-t-1']);
    assert.deepEqual(once.result.failed, []);

    attempts = 0;
    const twice = await run(jobs, async () => okResult(reply(6, 'paid')), {
      write: () => {
        attempts += 1;
        throw new Error('EIO: input/output error');
      },
    });
    assert.equal(attempts, 2, 'one more try, then the task fails');
    assert.deepEqual(twice.result.written, []);
    assert.deepEqual(twice.result.failed, [
      { task_id: 'keep-t-1', reason: 'EIO: input/output error' },
    ]);
    assert.ok(
      twice.logs.some((line) =>
        line.includes(
          `could not be saved; its items: ${JSON.stringify(makeItems(6, 'paid'))}`,
        ),
      ),
      'the paid reply is in the log',
    );
  });
});

test('readChecklistFile throws an error that is not "absent" or "not JSON", so a plan does not pay for a checklist it could not read', () => {
  helpers.withTmp((dir) => {
    const jobs = plan(dir, [makeSet([makeTask(1)])]);
    assert.equal(
      checklist.readChecklistFile(path.join(dir, 'none.json')),
      null,
    );
    // A folder where the file should be is a read error, not a missing file.
    fs.mkdirSync(jobs[0].file, { recursive: true });
    assert.throws(
      () => checklist.readChecklistFile(jobs[0].file),
      (error) => error.code === 'EISDIR',
    );
    assert.throws(
      () => plan(dir, [makeSet([makeTask(1)])]),
      (error) => error.code === 'EISDIR',
    );
  });
});
