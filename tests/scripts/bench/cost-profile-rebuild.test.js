// SPDX-License-Identifier: Apache-2.0
// Tests for the cost profile rebuild (scripts/bench/lib/cost-profile-rebuild.js) and the `bench.js cost-profile`
// command. The ledgers are temp files; nothing is spent and no network or model call is made.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { main } = require('../../../scripts/bench/bench');
const {
  MIN_CALLS,
  rebuildProfile,
} = require('../../../scripts/bench/lib/cost-profile-rebuild');
const {
  defaultProfile,
  loadProfile,
} = require('../../../scripts/bench/lib/cost-profile');
const helpers = require('./helpers');

const TERRA = 'us.openai.gpt-6.1-terra';
const TODAY = '2026-11-13';

/** A reserve and a settle row for one call. */
function callRows(
  id,
  { kind, model, usd, source = 'reported', status = 'ok', onSettle = true },
) {
  const reserve = {
    type: 'reserve',
    id,
    ts: '2026-11-12T09:00:00Z',
    run: 'r',
    label: id,
    usd: 1,
    expires: '2999-01-01T00:00:00Z',
    kind,
    model,
  };
  const settle = {
    type: 'settle',
    id,
    ts: '2026-11-12T09:00:01Z',
    run: 'r',
    label: id,
    usd,
    status,
    ...(onSettle ? { kind, model } : {}),
    ...(source === null ? {} : { cost_source: source }),
  };
  return [reserve, settle];
}

/** `count` calls of one kind and model, costing 0.01, 0.02, ... USD. */
const series = (prefix, count, fields) =>
  Array.from({ length: count }, (_, index) =>
    callRows(`${prefix}${index}`, { ...fields, usd: (index + 1) / 100 }),
  ).flat();

test('rebuildProfile: groups counted calls by kind and model; 20 or more replace the entry, fewer keep it', () => {
  helpers.withTmp((dir) => {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    const current = defaultProfile();
    helpers.writeLedger(ledgerFile, [
      // 20 subject calls of the default subject model: a new entry.
      ...series('s', 20, { kind: 'subject', model: 'claude-sonnet-5-5' }),
      // 19 judge calls of a GPT model: too few, the current entry is kept.
      ...series('g', 19, { kind: 'judge', model: TERRA }),
      // Left out: charged at the estimate, cancelled (no cost source), no kind anywhere.
      ...callRows('e', {
        kind: 'subject',
        model: 'claude-sonnet-5-5',
        usd: 9,
        source: 'estimate',
      }),
      ...callRows('c', {
        kind: 'subject',
        model: 'claude-sonnet-5-5',
        usd: 0,
        source: null,
        status: 'cancelled',
      }),
      ...callRows('n', { kind: undefined, model: 'claude-sonnet-5-5', usd: 9 }),
      // 21 writer calls of a model the profile does not know, 1 failed; the settle rows carry no kind or model, so
      // they come from the reserve rows. A floor row is left out: it holds the mean, not what the CLI reported.
      ...series('w', 20, {
        kind: 'writer',
        model: 'new-writer',
        onSettle: false,
      }),
      ...callRows('wf', {
        kind: 'writer',
        model: 'new-writer',
        usd: 0.21,
        status: 'failed',
        onSettle: false,
      }),
      ...callRows('wl', {
        kind: 'writer',
        model: 'new-writer',
        usd: 9,
        source: 'floor',
      }),
    ]);
    const { profile, rebuilt, kept } = rebuildProfile({
      ledgerFile,
      current,
      today: TODAY,
    });
    assert.deepEqual(rebuilt, [
      'subject claude-sonnet-5-5',
      'writer new-writer',
    ]);
    assert.deepEqual(kept, [
      `judge us.anthropic.claude-opus-5-5`,
      `judge ${TERRA}`,
      'judge us.xai.grok-4.7',
      'writer us.anthropic.claude-opus-5-5',
    ]);
    assert.equal(profile.schemaVersion, 1);
    assert.equal(profile.measuredOn, TODAY);
    assert.match(
      profile.provenance,
      /from the spend ledger ledger\.jsonl: 60 settled calls/,
    );
    const subject = profile.entries[0];
    // 0.01 .. 0.20: mean 0.105, median 0.105, nearest-rank p90 the 18th value 0.18.
    assert.deepEqual(subject, {
      kind: 'subject',
      model: 'claude-sonnet-5-5',
      calls: 20,
      failed: 0,
      mean: 0.105,
      median: 0.105,
      p90: 0.18,
      cliReportsLow: false,
    });
    // The GPT entry is kept as it was, cliReportsLow included.
    assert.deepEqual(profile.entries[2], { ...current.entries[2] });
    const writer = profile.entries.at(-1);
    assert.deepEqual(
      [
        writer.kind,
        writer.model,
        writer.calls,
        writer.failed,
        writer.p90,
        writer.cliReportsLow,
      ],
      ['writer', 'new-writer', 21, 1, 0.19, false],
    );
    // The result is itself a valid profile.
    const out = path.join(dir, 'out.json');
    helpers.write(out, profile);
    assert.equal(loadProfile(out).entries.length, 6);
  });
});

test('rebuildProfile: a cliReportsLow model keeps its current entry; the p90 is never below the mean', () => {
  helpers.withTmp((dir) => {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    const cheap = (prefix, kind, model) =>
      Array.from({ length: MIN_CALLS - 1 }, (_, index) =>
        callRows(`${prefix}${index}`, { kind, model, usd: 0.001 }),
      ).flat();
    helpers.writeLedger(ledgerFile, [
      // The GPT judge is marked cliReportsLow: its reported and floor rows do not replace its entry.
      ...cheap('t', 'judge', TERRA),
      ...callRows('big', { kind: 'judge', model: TERRA, usd: 10 }),
      ...callRows('tf', {
        kind: 'judge',
        model: TERRA,
        usd: 0.5,
        source: 'floor',
      }),
      // One costly call lifts the mean above the nearest-rank p90.
      ...cheap('s', 'subject', 'claude-sonnet-5-5'),
      ...callRows('sbig', {
        kind: 'subject',
        model: 'claude-sonnet-5-5',
        usd: 10,
      }),
    ]);
    const current = defaultProfile();
    const { profile, rebuilt, kept } = rebuildProfile({
      ledgerFile,
      current,
      today: TODAY,
    });
    assert.deepEqual(rebuilt, ['subject claude-sonnet-5-5']);
    assert.ok(kept.includes(`judge ${TERRA}`));
    const terraNow = current.entries.find((item) => item.model === TERRA);
    const terra = profile.entries.find((item) => item.model === TERRA);
    assert.equal(terraNow.cliReportsLow, true);
    assert.deepEqual(terra, { ...terraNow });
    const subject = profile.entries.find(
      (item) => item.kind === 'subject' && item.model === 'claude-sonnet-5-5',
    );
    assert.equal(subject.calls, MIN_CALLS);
    assert.equal(subject.cliReportsLow, false);
    assert.ok(subject.p90 >= subject.mean, `${subject.p90} >= ${subject.mean}`);
    assert.equal(subject.p90, subject.mean);
  });
});

test('rebuildProfile: with no entry measured, the profile keeps its date and provenance', () => {
  helpers.withTmp((dir) => {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    helpers.writeLedger(
      ledgerFile,
      series('s', MIN_CALLS - 1, {
        kind: 'subject',
        model: 'claude-sonnet-5-5',
      }),
    );
    const current = defaultProfile();
    const { profile, rebuilt } = rebuildProfile({
      ledgerFile,
      current,
      today: '2999-12-31',
    });
    assert.deepEqual(rebuilt, []);
    assert.equal(profile.measuredOn, current.measuredOn);
    assert.equal(profile.provenance, current.provenance);
    assert.deepEqual(
      profile.entries,
      current.entries.map((entry) => ({ ...entry })),
    );
  });
});

test('bench.js cost-profile prints the profile, or writes it with --out; it takes no other flag', () => {
  helpers.withTmp((dir) => {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    helpers.writeLedger(
      ledgerFile,
      series('s', 20, { kind: 'subject', model: 'claude-sonnet-5-5' }),
    );
    const run = (...argv) => {
      const result = { out: '', err: '' };
      result.code = main(argv, {
        out: (text) => (result.out += text),
        err: (text) => (result.err += text),
      });
      return result;
    };
    const printed = run('cost-profile', '--ledger', ledgerFile);
    assert.equal(printed.code, 0, printed.err);
    const profile = JSON.parse(printed.out);
    assert.equal(profile.entries[0].calls, 20);
    assert.match(profile.measuredOn, /^\d{4}-\d{2}-\d{2}$/);

    const outFile = path.join(dir, 'profile.json');
    const written = run(
      'cost-profile',
      '--ledger',
      ledgerFile,
      '--out',
      outFile,
    );
    assert.equal(written.code, 0, written.err);
    assert.match(
      written.out,
      /^wrote .*profile\.json: 5 entries from .*ledger\.jsonl\n$/,
    );
    assert.deepEqual(helpers.readJson(outFile), profile);

    // A folder that does not exist cannot be written to: an I/O error (74), not a missing input (66).
    const missingFolder = path.join(dir, 'no-such-folder', 'profile.json');
    const unwritable = run(
      'cost-profile',
      '--ledger',
      ledgerFile,
      '--out',
      missingFolder,
    );
    assert.equal(unwritable.code, 74, unwritable.err);
    assert.match(
      unwritable.err,
      /^error: cannot write file: no such file or folder \(.*no-such-folder.*\)\n$/,
    );
    assert.equal(fs.existsSync(missingFolder), false);

    // The default ledger is bench/out/ledger.jsonl under --root.
    const root = path.join(dir, 'repo');
    helpers.writeLedger(
      path.join(root, 'bench', 'out', 'ledger.jsonl'),
      series('s', 20, { kind: 'subject', model: 'claude-sonnet-5-5' }),
    );
    assert.equal(
      JSON.parse(run('cost-profile', '--root', root).out).entries[0].calls,
      20,
    );

    for (const flag of [['--skills', 'x'], ['--max-usd', '1'], ['--json']]) {
      const refused = run('cost-profile', '--ledger', ledgerFile, ...flag);
      assert.equal(refused.code, 64, flag.join(' '));
      assert.match(
        refused.err,
        new RegExp(
          `cost-profile takes only --ledger, --out and --root, got ${flag[0]}`,
        ),
      );
    }
    // --ledger and --out belong to cost-profile only.
    const plan = run(
      'plan',
      '--skills',
      helpers.SKILL,
      '--root',
      helpers.fixtureRoot(),
      '--ledger',
      ledgerFile,
    );
    assert.equal(plan.code, 64);
    assert.match(
      plan.err,
      /--ledger is an option of cost-profile, not of plan/,
    );
  });
});

test('rebuildProfile: the floor is 20 calls, as the README says, and amounts are rounded to 5 decimals', () => {
  assert.equal(MIN_CALLS, 20);
  helpers.withTmp((dir) => {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    const current = defaultProfile();
    // 19 calls of a model that does not report low: kept. 20 thirds of a cent: rebuilt and rounded.
    helpers.writeLedger(ledgerFile, [
      ...series('g', 19, { kind: 'judge', model: 'us.xai.grok-4.7' }),
      ...Array.from({ length: 20 }, (_, index) =>
        callRows(`s${index}`, {
          kind: 'subject',
          model: 'claude-sonnet-5-5',
          usd: 1 / 3,
        }),
      ).flat(),
    ]);
    const { profile, rebuilt, kept } = rebuildProfile({
      ledgerFile,
      current,
      today: TODAY,
    });
    assert.deepEqual(rebuilt, ['subject claude-sonnet-5-5']);
    assert.ok(kept.includes('judge us.xai.grok-4.7'));
    const subject = profile.entries.find((entry) => entry.kind === 'subject');
    assert.deepEqual(
      [subject.mean, subject.median, subject.p90],
      [0.33333, 0.33333, 0.33333],
    );
  });
});

test('bench.js cost-profile: --out may not name the ledger or its lock, a corrupt ledger is a usage error, and no temp file is left', () => {
  helpers.withTmp((dir) => {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    helpers.writeLedger(
      ledgerFile,
      series('s', 20, { kind: 'subject', model: 'claude-sonnet-5-5' }),
    );
    const before = fs.readFileSync(ledgerFile, 'utf8');
    const run = (...argv) => {
      const result = { out: '', err: '' };
      result.code = main(argv, {
        out: (text) => (result.out += text),
        err: (text) => (result.err += text),
      });
      return result;
    };
    for (const target of [ledgerFile, `${ledgerFile}.lock`]) {
      const refused = run(
        'cost-profile',
        '--ledger',
        ledgerFile,
        '--out',
        target,
      );
      assert.equal(refused.code, 64, target);
      assert.match(
        refused.err,
        /--out cannot be the spend ledger or its lock file/,
      );
    }
    // Through a link to the ledger too.
    const link = path.join(dir, 'link.jsonl');
    fs.symlinkSync(ledgerFile, link);
    assert.equal(
      run('cost-profile', '--ledger', ledgerFile, '--out', link).code,
      64,
    );
    assert.equal(fs.readFileSync(ledgerFile, 'utf8'), before);

    const outFile = path.join(dir, 'profile.json');
    assert.equal(
      run('cost-profile', '--ledger', ledgerFile, '--out', outFile).code,
      0,
    );
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.includes('.tmp-')),
      [],
    );

    fs.appendFileSync(ledgerFile, 'not json\n');
    fs.appendFileSync(
      ledgerFile,
      `${JSON.stringify(callRows('x', { kind: 'subject', model: 'm', usd: 1 })[0])}\n`,
    );
    const corrupt = run('cost-profile', '--ledger', ledgerFile);
    assert.equal(corrupt.code, 64, corrupt.err);
    assert.match(
      corrupt.err,
      /^error: corrupt ledger line 41 in .*ledger\.jsonl: not valid JSON\n/,
    );
  });
});

test('bench.js cost-profile --out writes a temp file and renames it, so a failed write leaves the old profile and no temp file', (t) => {
  helpers.withTmp((dir) => {
    const ledgerFile = path.join(dir, 'ledger.jsonl');
    helpers.writeLedger(
      ledgerFile,
      series('s', 20, { kind: 'subject', model: 'claude-sonnet-5-5' }),
    );
    const outFile = path.join(dir, 'profile.json');
    fs.writeFileSync(outFile, 'old profile\n');
    const run = (...argv) => {
      const result = { out: '', err: '' };
      result.code = main(argv, {
        out: (text) => (result.out += text),
        err: (text) => (result.err += text),
      });
      return result;
    };
    t.mock.method(fs, 'renameSync', () => {
      const error = new Error('input/output error');
      Object.assign(error, { code: 'EIO', syscall: 'rename', path: outFile });
      throw error;
    });
    const failed = run(
      'cost-profile',
      '--ledger',
      ledgerFile,
      '--out',
      outFile,
    );
    assert.equal(failed.code, 74, failed.err);
    assert.equal(fs.readFileSync(outFile, 'utf8'), 'old profile\n');
    assert.deepEqual(
      fs.readdirSync(dir).filter((name) => name.includes('.tmp-')),
      [],
    );
  });
});
