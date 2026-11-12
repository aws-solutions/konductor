// SPDX-License-Identifier: Apache-2.0
// Tests for the repair call of the request-only checklist writer (scripts/bench/lib/request-checklist.js): a reply
// that fails ONLY on item length gets exactly one follow-up call that carries the same request, the writer's own
// rejected reply and a fixed note (prompts/checklist-repair.request-only.v1.md); the repaired reply is checked by the
// same validator and the 12 and 400 limits are unchanged. Also the spend side: the repair counts in the projection's
// worst case. Pinned to tests/fixtures/bench/checklist/repair-fixture.json. Injected calls and temp dirs only: no
// process is started and no model is called.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const checklist = require('../../../scripts/bench/lib/request-checklist');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const { SpendStopError } = require('../../../scripts/bench/lib/ledger');
const helpers = require('./helpers');

const FIXTURE = helpers.readJson(
  path.join(helpers.FIXTURE_DIR, 'checklist', 'repair-fixture.json'),
);
const SKILL = FIXTURE.skill;
const MODEL = 'writer-model';
const NOTE =
  'Rewrite only the listed items to 12-400 characters each, keeping their meaning. Return the full list in the same format.';
const NOW = () => new Date('2026-11-10T00:00:00Z');
const config = helpers.exampleConfig();
const PROMPTS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'scripts',
  'bench',
  'prompts',
);

const reply = (items) => JSON.stringify({ items });
const okResult = (text, extra = {}) => ({
  ok: true,
  text,
  usd: 0.01,
  ms: 3,
  error: null,
  ...extra,
});
const fileSha = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const plan = (dir, tasks = [FIXTURE.task], more = {}) =>
  checklist.planChecklists({
    sets: [{ skill: SKILL, batch: FIXTURE.batch, tasks, ...more }],
    layout: createLayout({ root: dir }),
    model: MODEL,
    config,
  });

/** Runs the writer over `jobs` with `replies` (a list, or a function of the call count and the call) and returns what was called and written. */
async function run(jobs, replies, more = {}) {
  const written = {};
  const logs = [];
  const seen = [];
  let index = 0;
  const call = async (job, attempt, prompt, meta) => {
    seen.push({ attempt, prompt, repair: !!(meta && meta.repair) });
    return typeof replies === 'function'
      ? replies(seen.length, seen.at(-1))
      : replies[index++];
  };
  const result = await checklist.writeChecklists({
    jobs,
    call,
    write: (file, record) => {
      written[file] = record;
    },
    model: MODEL,
    concurrency: 1,
    delayMs: () => 0,
    sleep: async () => {},
    now: NOW,
    log: (line) => logs.push(line),
    ...more,
  });
  return { result, written, logs, seen };
}

const withJobs = (callback, tasks, more) =>
  helpers.withTmpAsync((dir) => callback(plan(dir, tasks, more), dir));

// ---- the fixture and the prompt file -----------------------------------------------------------------------------

test('the fixture holds what the tests need: one overlong item, one short item, and the limits are the unchanged 12 and 400', () => {
  assert.deepEqual(checklist.ITEM_CHARS, { min: 12, max: 400 });
  assert.deepEqual(
    FIXTURE.first_reply_items.map((item) => item.length > 400),
    [false, false, false, true, false, false],
  );
  assert.equal(FIXTURE.first_reply_items[3].length, 412);
  assert.ok(
    FIXTURE.repaired_items.every(
      (item) => item.length >= 12 && item.length <= 400,
    ),
  );
  assert.ok(FIXTURE.still_long_items[3].length > 400);
  assert.equal(FIXTURE.too_short_items[1].length, 9);
  assert.deepEqual(
    checklist.itemProblems(FIXTURE.repaired_items, { itemCount: 6 }),
    [],
  );
});

test('the repair note lives in a versioned prompt file next to the writer prompt, and its sha is the pinned file digest', () => {
  const file = path.join(PROMPTS, 'checklist-repair.request-only.v1.md');
  assert.equal(checklist.REPAIR_TEMPLATE_FILE, file);
  assert.equal(checklist.REPAIR_PROMPT_SHA256, fileSha(file));
  assert.equal(
    checklist.REPAIR_PROMPT_SHA256,
    'b059b13f00383a8fb919b857905f6a05893e685638696f3679d7d3402ee272fb',
  );
  assert.ok(
    fs.readFileSync(file, 'utf8').includes(NOTE),
    'the fixed note is in the file, word for word',
  );
  assert.notEqual(
    checklist.REPAIR_PROMPT_SHA256,
    checklist.WRITER_PROMPT_SHA256,
  );
  // The repair note is a separate file, so it does not change the writer prompt's hash.
  assert.equal(
    checklist.WRITER_PROMPT_SHA256,
    '734d309330f4a50eaa9d74a2966be4a6cd0751e49c97ac05a149657b36988321',
  );
});

// ---- when a repair is made ---------------------------------------------------------------------------------------

test('lengthFailures: only length faults qualify, over 400 or under 12, and it names the items', () => {
  const failures = (list, itemCount = 6) =>
    checklist.lengthFailures(list, { itemCount });
  const first = FIXTURE.first_reply_items;
  assert.deepEqual(failures(first), {
    lengthOnly: true,
    bad: [{ index: 3, length: 412 }],
  });
  assert.deepEqual(failures(FIXTURE.too_short_items), {
    lengthOnly: true,
    bad: [{ index: 1, length: 9 }],
  });
  assert.equal(
    failures(FIXTURE.repaired_items).lengthOnly,
    false,
    'nothing to repair',
  );
  assert.equal(
    failures(FIXTURE.wrong_count_items).lengthOnly,
    false,
    'the count is wrong',
  );
  assert.equal(
    failures(FIXTURE.duplicate_items).lengthOnly,
    false,
    'a repeated item',
  );
  assert.equal(
    failures([...first.slice(0, 5), first[0]]).lengthOnly,
    false,
    'a repeat next to a length fault is not length only',
  );
  const withFourth = (item) => [...first.slice(0, 3), item, ...first.slice(4)];
  assert.equal(
    failures(withFourth('x'.repeat(401))).lengthOnly,
    true,
    '401 is over the limit',
  );
  assert.equal(
    failures(withFourth('x'.repeat(400))).lengthOnly,
    false,
    '400 is fine',
  );
  assert.equal(
    failures(withFourth('x'.repeat(12))).lengthOnly,
    false,
    '12 is fine',
  );
  assert.equal(
    failures(withFourth('x'.repeat(11))).lengthOnly,
    true,
    '11 is under the limit',
  );
});

test('a reply that fails only on item length gets exactly one repair call, and the repaired reply is written with repaired: true', () =>
  withJobs(async (jobs) => {
    const { result, written, seen, logs } = await run(jobs, [
      okResult(reply(FIXTURE.first_reply_items)),
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    assert.equal(seen.length, 2, 'the first call and one repair, nothing else');
    assert.deepEqual(
      seen.map((entry) => entry.repair),
      [false, true],
    );
    assert.deepEqual(result.written, [FIXTURE.task.id]);
    assert.deepEqual(result.failed, []);
    const record = written[jobs[0].file];
    assert.deepEqual(record.items, FIXTURE.repaired_items);
    assert.equal(record.repaired, true);
    assert.equal(record.repair_prompt_sha256, checklist.REPAIR_PROMPT_SHA256);
    assert.match(
      record.repair_original_rejection,
      /item 4 has 412 characters, want 12 to 400/,
    );
    // The record is a normal current checklist: the writer prompt sha, the request sha and the version are the usual ones.
    assert.equal(record.prompt_sha256, checklist.WRITER_PROMPT_SHA256);
    assert.ok(checklist.checklistCurrent(record, jobs[0].input, MODEL));
    assert.equal(record.attempt, 1);
    assert.equal(
      record.usd,
      0.02,
      'both calls are in the cost of the checklist',
    );
    assert.equal(result.usd, 0.02);
    assert.ok(logs.some((line) => /repaired after: item 4 has 412/.test(line)));
  }));

test('a reply with an item under 12 characters is repaired too', () =>
  withJobs(async (jobs) => {
    const { written, seen } = await run(jobs, [
      okResult(reply(FIXTURE.too_short_items)),
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    assert.equal(seen.length, 2);
    assert.match(
      written[jobs[0].file].repair_original_rejection,
      /item 2 has 9 characters/,
    );
  }));

test('a checklist that was right the first time carries no repair fields', () =>
  withJobs(async (jobs) => {
    const { written, seen } = await run(jobs, [
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    assert.equal(seen.length, 1);
    const record = written[jobs[0].file];
    for (const key of [
      'repaired',
      'repair_prompt_sha256',
      'repair_original_rejection',
    ])
      assert.ok(!(key in record), key);
  }));

test('a repair that is still invalid is not written; the repair is made once per checklist, so later fresh attempts get none', () =>
  withJobs(async (jobs) => {
    const one = await run(
      jobs,
      [
        okResult(reply(FIXTURE.first_reply_items)),
        okResult(reply(FIXTURE.still_long_items)),
      ],
      { attempts: 1 },
    );
    assert.equal(one.seen.length, 2);
    assert.deepEqual(one.written, {}, 'nothing written');
    assert.deepEqual(
      one.result.failed.map((entry) => entry.task_id),
      [FIXTURE.task.id],
    );
    assert.match(
      one.result.failed[0].reason,
      /reply rejected: item 4 has 412.*; repair rejected: item 4 has/,
    );
    assert.match(one.logs.join('\n'), /NOT written.*repair rejected/);
    // With the default attempts: 3 fresh calls plus one repair, never a second repair.
    const all = await run(jobs, (count, entry) =>
      okResult(
        reply(
          entry.repair ? FIXTURE.still_long_items : FIXTURE.first_reply_items,
        ),
      ),
    );
    assert.equal(all.seen.length, 3 + 1);
    assert.equal(all.seen.filter((entry) => entry.repair).length, 1);
    assert.deepEqual(all.written, {});
    assert.match(
      all.result.failed[0].reason,
      /repair rejected/,
      'the reason still says why the repair did not help',
    );
  }));

test('a failed repair call is never parsed (its text field may look like a reply), and the job goes on with its fresh attempts', () =>
  withJobs(async (jobs) => {
    const out = await run(jobs, [
      okResult(reply(FIXTURE.first_reply_items)),
      {
        ok: false,
        text: reply(FIXTURE.repaired_items),
        usd: 0.01,
        ms: 1,
        error: 'throttled',
      },
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    assert.deepEqual(
      out.seen.map((entry) => entry.repair),
      [false, true, false],
    );
    const record = out.written[jobs[0].file];
    assert.deepEqual(record.items, FIXTURE.repaired_items);
    assert.ok(
      !record.repaired,
      'written from the fresh attempt, not the failed repair',
    );
    assert.equal(record.attempt, 2);
    assert.equal(record.usd, 0.03);
  }));

test('a repair call that throws before it starts is not fatal; the fresh attempts go on', () =>
  withJobs(async (jobs) => {
    const out = await run(jobs, (count, entry) => {
      if (entry.repair) throw new RangeError('refusing to run: too long');
      return okResult(
        reply(count === 1 ? FIXTURE.first_reply_items : FIXTURE.repaired_items),
      );
    });
    assert.deepEqual(
      out.seen.map((entry) => entry.repair),
      [false, true, false],
    );
    assert.deepEqual(out.result.written, [FIXTURE.task.id]);
  }));

test('a second length-only reply after a fresh attempt is not repaired again', () =>
  withJobs(async (jobs) => {
    const out = await run(jobs, (count, entry) =>
      count === 1
        ? okResult(reply(FIXTURE.first_reply_items))
        : entry.repair
          ? okResult('not json')
          : okResult(reply(FIXTURE.first_reply_items)),
    );
    assert.equal(out.seen.filter((entry) => entry.repair).length, 1);
    assert.equal(out.seen.length, 4);
  }));

test('a failure that is not only about length gets no repair: wrong count, a repeat, not JSON, a non-string item, a failed call', async () => {
  for (const [name, text] of [
    ['wrong count', reply(FIXTURE.wrong_count_items)],
    ['repeated item', reply(FIXTURE.duplicate_items)],
    ['not JSON', 'I cannot do that'],
    ['non-string item', JSON.stringify({ items: [1, 2, 3, 4, 5, 6] })],
    [
      'overlong plus repeat',
      reply([
        ...FIXTURE.first_reply_items.slice(0, 5),
        FIXTURE.first_reply_items[0],
      ]),
    ],
  ]) {
    await withJobs(async (jobs) => {
      const out = await run(jobs, () => okResult(text), { attempts: 2 });
      assert.equal(
        out.seen.length,
        2,
        `${name}: two fresh attempts, no repair`,
      );
      assert.ok(
        out.seen.every((entry) => !entry.repair),
        name,
      );
      assert.deepEqual(out.written, {}, name);
    });
  }
  await withJobs(async (jobs) => {
    const failed = await run(
      jobs,
      () => ({
        ok: false,
        text: reply(FIXTURE.first_reply_items),
        usd: 0,
        ms: 1,
        error: 'timeout',
      }),
      { attempts: 2 },
    );
    assert.ok(
      failed.seen.every((entry) => !entry.repair),
      'a failed call has no reply to repair',
    );
  });
});

// ---- what the repair call is given -------------------------------------------------------------------------------

test("the repair prompt holds the same request, the writer's own rejected reply, the listed items and the fixed note, and nothing from the skill", () =>
  withJobs(async (jobs) => {
    const out = await run(jobs, [
      okResult(reply(FIXTURE.first_reply_items)),
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    const [first, repair] = out.seen.map((entry) => entry.prompt);
    assert.ok(
      repair.startsWith(first),
      'the first part is the unchanged writer prompt, with the same request',
    );
    assert.ok(repair.includes(jobs[0].input.request));
    assert.ok(
      repair.includes(JSON.stringify({ items: FIXTURE.first_reply_items })),
      "the writer's own rejected reply",
    );
    assert.ok(
      repair.includes('- item 4 has 412 characters'),
      'the listed item',
    );
    assert.ok(
      repair.trimEnd().endsWith(NOTE),
      'the fixed note closes the prompt',
    );
    assert.ok(!repair.includes('SPDX'), 'the license line is not sent');
    // Nothing of the task beyond its request: not its rules checklist, title, section, why_skill_matters or the skill name.
    for (const secret of [
      ...FIXTURE.task.rubric,
      FIXTURE.task.title,
      FIXTURE.task.target_section,
      FIXTURE.task.why_skill_matters,
      SKILL,
      'SKILL.md',
      'bench:',
    ])
      assert.ok(
        !repair.includes(secret),
        `the repair prompt does not hold ${JSON.stringify(secret)}`,
      );
    assert.deepEqual(
      checklist.findRequestProblems(repair, { skill: SKILL }),
      [],
      'the same blocked checks, run over the whole repair prompt, find nothing',
    );
    assert.equal(
      repair,
      checklist.buildRepairPrompt({
        request: jobs[0].input.request,
        itemCount: jobs[0].input.item_count,
        items: FIXTURE.first_reply_items,
        bad: [{ index: 3, length: 412 }],
      }),
    );
  }));

test('the repair prompt is built only from the request, the item count, the previous items and which of them were rejected', () => {
  const plain = checklist.buildRepairPrompt({
    request: 'R',
    itemCount: 6,
    items: ['a'.repeat(450)],
    bad: [{ index: 0, length: 450 }],
  });
  assert.ok(plain.includes('exactly 6'));
  assert.ok(plain.includes('=== REQUEST ===\nR\n=== END OF REQUEST ==='));
  assert.ok(plain.includes('- item 1 has 450 characters'));
  // Single pass: text of a placeholder inside the request or an item is not expanded.
  const tricky = checklist.buildRepairPrompt({
    request: 'Use {{previous} and {{listed}}',
    itemCount: 6,
    items: ['{{prompt}}'],
    bad: [{ index: 0, length: 450 }],
  });
  assert.ok(tricky.includes('Use {{previous} and {{listed}}'));
  assert.ok(tricky.includes('{{prompt}}'));
  assert.equal(checklist.buildRepairPrompt.length, 1, 'one options object');
});

test('the leak check applies to the repair prompt: a rejected reply that names the skill or a rule id is not sent back', async () => {
  await withJobs(async (jobs) => {
    const out = await run(
      jobs,
      () => okResult(reply(FIXTURE.skill_named_items)),
      { attempts: 2 },
    );
    assert.ok(
      out.seen.every((entry) => !entry.repair),
      'no repair call carried the skill name',
    );
    assert.ok(
      out.seen.every((entry) => !entry.prompt.includes(SKILL)),
      'no prompt of any call names the skill',
    );
    assert.deepEqual(out.written, {});
    assert.match(
      out.result.failed[0].reason,
      /not repaired \(the repair prompt still names the skill/,
    );
  });
  await withJobs(
    async (jobs) => {
      const items = FIXTURE.first_reply_items.map((item, index) =>
        index === 3 ? `${item} custom-rule-77` : item,
      );
      const out = await run(jobs, () => okResult(reply(items)), {
        attempts: 1,
      });
      assert.equal(
        out.seen.length,
        1,
        'a rule id in the rejected reply stops the repair',
      );
      assert.match(
        out.result.failed[0].reason,
        /not repaired \(the repair prompt still holds the rule id custom-rule-77\)/,
      );
    },
    [FIXTURE.task],
    { ruleIds: ['custom-rule-77'] },
  );
});

test('a blocked request is never planned for a call, so there is nothing to repair', () =>
  helpers.withTmpAsync(async (dir) => {
    // The stripper removes these references, so the request is clean and planned.
    const cleaned = plan(dir, [
      {
        ...FIXTURE.task,
        prompt: `${FIXTURE.task.prompt} See bench:${SKILL} and SKILL.md.`,
      },
    ]);
    assert.equal(cleaned[0].state, 'pending');
    assert.ok(cleaned[0].est_repair.usd > 0);
    const blocked = plan(dir, [{ ...FIXTURE.task, prompt: '' }]);
    assert.equal(blocked[0].state, 'blocked');
    assert.equal(blocked[0].est_repair, null);
  }));

// ---- credentials, blocks and the spend stop ----------------------------------------------------------------------

test('a credential error or a spend stop on the repair call stops the run and writes nothing', async () => {
  await withJobs(async (jobs) => {
    await assert.rejects(
      run(jobs, [
        okResult(reply(FIXTURE.first_reply_items)),
        {
          ok: false,
          text: '',
          usd: 0,
          ms: 1,
          error:
            'ExpiredToken: the security token included in the request is expired',
        },
      ]),
      (error) => error.fatal === true && error.kind === 'credential',
    );
    await assert.rejects(
      run(jobs, (count, entry) => {
        if (entry.repair) throw new SpendStopError('over the cap', 'max_usd');
        return okResult(reply(FIXTURE.first_reply_items));
      }),
      (error) => error instanceof SpendStopError,
    );
  });
});

test('a provider block of the repair call counts toward the refusal, and a confirmed block refuses the task', () =>
  withJobs(async (jobs) => {
    const out = await run(jobs, (count, entry) =>
      entry.repair || count > 2
        ? {
            ok: false,
            text: '',
            usd: 0.01,
            ms: 1,
            error: 'The provider blocked the response',
          }
        : okResult(reply(FIXTURE.first_reply_items)),
    );
    assert.deepEqual(
      out.seen.map((entry) => entry.repair),
      [false, true, false],
    );
    assert.deepEqual(out.result.failed, []);
    assert.equal(out.result.refused.length, 1);
    assert.match(out.result.refused[0].reason, /blocked the reply 2 times/);
  }));

test('a provider block, a length-only reply and a blocked repair refuse the task: the repair block is the second block, and no fourth call is made', () =>
  withJobs(async (jobs) => {
    const blocked = {
      ok: false,
      text: '',
      usd: 0.01,
      ms: 1,
      error: 'The provider blocked the response',
    };
    const out = await run(jobs, [
      blocked,
      okResult(reply(FIXTURE.first_reply_items)),
      blocked,
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    assert.deepEqual(
      out.seen.map((entry) => entry.repair),
      [false, false, true],
      'a blocked repair ends the task: no fourth call',
    );
    assert.deepEqual(out.result.failed, []);
    assert.equal(out.result.refused.length, 1, 'refused, not failed');
    assert.deepEqual(out.written, {});
  }));

test('the repair call is passed the repair marker with the attempt it follows, and the ledger label says so', async () => {
  await withJobs(async (jobs) => {
    const out = await run(jobs, [
      okResult(reply(FIXTURE.first_reply_items)),
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    assert.deepEqual(
      out.seen.map((entry) => [entry.attempt, entry.repair]),
      [
        [1, false],
        [1, true],
      ],
    );
  });
  const labels = [];
  const call = checklist.createWriterCall({
    judgeCall: async (options) => {
      labels.push(options.label);
      return {
        ok: true,
        text: 'T',
        usage: null,
        reportedUsd: null,
        ms: 1,
        error: null,
        stderr: '',
      };
    },
    ledger: {},
    config,
    model: MODEL,
  });
  const job = { skill: SKILL, batch: 'b1', task_id: FIXTURE.task.id };
  await call(job, 2, 'P', { repair: true });
  await call(job, 2, 'P', undefined);
  assert.deepEqual(labels, [
    `checklist ${SKILL}/b1/${FIXTURE.task.id} #2 repair`,
    `checklist ${SKILL}/b1/${FIXTURE.task.id} #2`,
  ]);
});

// ---- the projection ----------------------------------------------------------------------------------------------

test('projection worst case: every attempt of every pending call plus one repair call each; copies and done checklists add nothing', () =>
  helpers.withTmpAsync(async (dir) => {
    const second = {
      ...FIXTURE.task,
      id: 'fixture-skill-rules-4',
      prompt: `${FIXTURE.task.prompt} Also say who is on call.`,
    };
    const copy = { ...FIXTURE.task, id: 'fixture-skill-rules-5' };
    const jobs = plan(dir, [FIXTURE.task, second, copy]);
    assert.deepEqual(
      jobs.map((job) => job.state),
      ['pending', 'pending', 'copy'],
    );
    const projection = checklist.projection(jobs);
    const projected = jobs[0].est.usd + jobs[1].est.usd;
    const repair = jobs[0].est_repair.usd + jobs[1].est_repair.usd;
    assert.equal(
      projection.projected_usd,
      Number(projected.toFixed(4)),
      'the expected cost has no repair in it',
    );
    assert.equal(projection.repair_usd, Number(repair.toFixed(4)));
    assert.equal(
      projection.worst_case_usd,
      Number((projected * 3 + repair).toFixed(4)),
    );
    assert.equal(
      projection.max_calls,
      2 * (3 + 1),
      'worst case: one extra call per checklist',
    );
    assert.equal(projection.calls, 2);
    assert.equal(jobs[2].est_repair, null);
    assert.ok(projection.worst_case_usd > Number((projected * 3).toFixed(4)));
  }));

test('the repair call is projected like the first call, at the writer model p90 (estimate_usd_per_call.writer x 1.5 with no entry)', () =>
  helpers.withTmpAsync(async (dir) => {
    const writer = 0.25;
    const jobs = checklist.planChecklists({
      sets: [{ skill: SKILL, batch: FIXTURE.batch, tasks: [FIXTURE.task] }],
      layout: createLayout({ root: dir }),
      model: MODEL,
      config: helpers.exampleConfig({ estimate_usd_per_call: { writer } }),
    });
    assert.deepEqual(jobs[0].est, { usd: writer * 1.5 });
    assert.deepEqual(jobs[0].est_repair, { usd: writer * 1.5 });
  }));

// ---- checklists on disk ------------------------------------------------------------------------------------------

test('checklists on disk stay valid: a file without repair fields is current, and so is a repaired one; planning never rewrites a file', () =>
  helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir);
    const file = jobs[0].file;
    checklist.writeChecklistFile(
      file,
      checklist.checklistRecord({
        job: jobs[0],
        items: FIXTURE.repaired_items,
        model: MODEL,
        now: NOW,
      }),
    );
    const before = fileSha(file);
    assert.equal(plan(dir)[0].state, 'done');
    assert.equal(fileSha(file), before, 'planning never rewrites a file');
    const repaired = checklist.checklistRecord({
      job: jobs[0],
      items: FIXTURE.repaired_items,
      model: MODEL,
      repair: { reason: 'item 4 has 412 characters, want 12 to 400' },
      now: NOW,
    });
    assert.equal(repaired.repaired, true);
    fs.writeFileSync(file, JSON.stringify(repaired));
    assert.deepEqual(checklist.readChecklistFile(file), repaired);
    assert.equal(plan(dir)[0].state, 'done');
    assert.equal(
      checklist.CHECKLIST_VERSION,
      2,
      'the repair keys are optional, so they do not change the version',
    );
    for (const [field, value] of [
      ['repaired', false],
      ['repair_prompt_sha256', 'x'],
      ['repair_original_rejection', ''],
    ]) {
      fs.writeFileSync(
        file,
        JSON.stringify(helpers.edit(repaired, field, value)),
      );
      assert.equal(checklist.readChecklistFile(file), null, field);
    }
  }));

test('a repaired checklist written through writeChecklistFile is the only file of its task', () =>
  helpers.withTmpAsync(async (dir) => {
    const jobs = plan(dir);
    const { result } = await run(
      jobs,
      [
        okResult(reply(FIXTURE.first_reply_items)),
        okResult(reply(FIXTURE.repaired_items)),
      ],
      { write: checklist.writeChecklistFile },
    );
    assert.deepEqual(result.written, [FIXTURE.task.id]);
    const record = helpers.readJson(jobs[0].file);
    assert.equal(record.repaired, true);
    assert.deepEqual(fs.readdirSync(path.dirname(jobs[0].file)), [
      `${FIXTURE.task.id}.json`,
    ]);
  }));

test('findRequestProblems names the text it checked', () => {
  assert.deepEqual(
    checklist.findRequestProblems('See SKILL.md and bench:x', {
      subject: 'the repair prompt',
    }),
    [
      'the repair prompt still mentions SKILL.md',
      'the repair prompt still holds a bench: reference',
    ],
  );
  assert.deepEqual(
    checklist.findRequestProblems('', { subject: 'the repair prompt' }),
    ['the repair prompt is empty'],
  );
  assert.deepEqual(checklist.findRequestProblems('See SKILL.md'), [
    'the request still mentions SKILL.md',
  ]);
});

test('the repair prompt file states the item limits of the writer', () => {
  const text = fs.readFileSync(checklist.REPAIR_TEMPLATE_FILE, 'utf8');
  assert.ok(
    text.includes(`${checklist.ITEM_CHARS.min}-${checklist.ITEM_CHARS.max}`),
    'the range in the note is the range the replies are checked against',
  );
});

test('a copy of a repaired checklist names its source and holds no repair keys', () =>
  helpers.withTmpAsync(async (dir) => {
    const copy = { ...FIXTURE.task, id: 'fixture-skill-rules-5' };
    const jobs = plan(dir, [FIXTURE.task, copy]);
    assert.deepEqual(
      jobs.map((job) => job.state),
      ['pending', 'copy'],
    );
    const { result, written } = await run(jobs, [
      okResult(reply(FIXTURE.first_reply_items)),
      okResult(reply(FIXTURE.repaired_items)),
    ]);
    assert.deepEqual(result.copied, [copy.id]);
    assert.equal(written[jobs[0].file].repaired, true);
    const copied = written[jobs[1].file];
    assert.equal(copied.copied_from, FIXTURE.task.id);
    assert.deepEqual(copied.items, FIXTURE.repaired_items);
    for (const key of [
      'repaired',
      'repair_prompt_sha256',
      'repair_original_rejection',
    ])
      assert.ok(!(key in copied), key);
  }));
