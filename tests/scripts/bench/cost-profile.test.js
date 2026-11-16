// SPDX-License-Identifier: Apache-2.0
// Tests for the measured cost profile (scripts/bench/lib/cost-profile.js): the committed profile, the checks that
// refuse a broken one, and the lookup order. Offline: files only.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_PROFILE_FILE,
  CostProfileError,
  loadProfile,
  defaultProfile,
  costFor,
  callCost,
} = require('../../../scripts/bench/lib/cost-profile');
const { rubricWriterModel } = require('../../../scripts/bench/lib/config');
const helpers = require('./helpers');

const CONFIG = helpers.exampleConfig();
const ESTIMATES = CONFIG.estimate_usd_per_call;
const entry = (overrides = {}) => ({
  kind: 'judge',
  model: 'm',
  calls: 30,
  failed: 0,
  mean: 0.1,
  median: 0.09,
  p90: 0.2,
  cliReportsLow: false,
  ...overrides,
});
const profileWith = (entries, overrides = {}) => ({
  schemaVersion: 1,
  measuredOn: '2026-01-15',
  unit: 'usd',
  provenance: 'test',
  entries,
  ...overrides,
});

test('the committed profile is bench/profiles/cost-observed.json, it loads, and it prices every default model', () => {
  assert.equal(
    DEFAULT_PROFILE_FILE,
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      'bench',
      'profiles',
      'cost-observed.json',
    ),
  );
  const profile = defaultProfile();
  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.file, DEFAULT_PROFILE_FILE);
  assert.equal(defaultProfile(), profile, 'read once per process');
  assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.entries[0]));
  const models = [
    ['subject', CONFIG.models.subject],
    ...Object.values(CONFIG.models.judges).map((model) => ['judge', model]),
    ['writer', rubricWriterModel(CONFIG)],
  ];
  for (const [kind, model] of models)
    assert.equal(
      costFor(profile, kind, model, ESTIMATES).source,
      'model',
      `${kind} ${model}`,
    );
  // The figures the README and plan quote.
  assert.deepEqual(
    profile.entries.map((item) => [
      item.kind,
      item.model,
      item.mean,
      item.p90,
      item.cliReportsLow,
    ]),
    [
      ['subject', 'claude-sonnet-5-5', 0.06693, 0.12123, false],
      ['judge', 'us.anthropic.claude-opus-5-5', 0.0478, 0.07183, false],
      ['judge', 'us.openai.gpt-6.1-terra', 0.01336, 0.02052, true],
      ['judge', 'us.xai.grok-4.7', 0.05061, 0.09822, false],
      ['writer', 'us.anthropic.claude-opus-5-5', 0.02586, 0.03746, false],
    ],
  );
  // It names no account and no local path.
  const text = fs.readFileSync(DEFAULT_PROFILE_FILE, 'utf8');
  assert.doesNotMatch(text, /\b\d{12}\b/);
  assert.doesNotMatch(text, /\/(home|Users|local)\//);
});

test('loadProfile refuses a broken profile with every problem and the file name; never a silent fallback', () => {
  helpers.withTmp((dir) => {
    const file = path.join(dir, 'profile.json');
    const refuses = (document, pattern) => {
      helpers.write(file, document);
      assert.throws(
        () => loadProfile(file),
        (error) =>
          error instanceof CostProfileError &&
          error.file === file &&
          error.message.startsWith(`${file}: not a usable cost profile:`) &&
          pattern.test(error.message),
        pattern.source,
      );
    };
    refuses([], /must be a JSON object/);
    refuses(
      profileWith([entry()], { schemaVersion: 2 }),
      /schemaVersion: must be 1, got 2/,
    );
    refuses(profileWith(null), /entries: must be an array/);
    refuses(profileWith(['x']), /entries\[0\]: must be an object/);
    refuses(
      profileWith([entry({ kind: 'rubric' })]),
      /entries\[0\]\.kind: must be one of subject, judge, writer, got "rubric"/,
    );
    refuses(
      profileWith([entry({ model: ' ' })]),
      /entries\[0\]\.model: must be a non-empty string/,
    );
    for (const field of ['mean', 'median', 'p90'])
      for (const value of [-0.1, Infinity, '0.1', null])
        refuses(
          profileWith([entry({ [field]: value })]),
          new RegExp(
            `entries\\[0\\]\\.${field}: must be a finite number, 0 or more`,
          ),
        );
    refuses(
      profileWith([entry({ mean: 0.3, p90: 0.2 })]),
      /entries\[0\]\.p90: must be at least the mean, got p90 0\.2 and mean 0\.3/,
    );
    refuses(
      profileWith([entry({ calls: 1.5 })]),
      /entries\[0\]\.calls: must be a whole number/,
    );
    refuses(
      profileWith([entry({ cliReportsLow: 'yes' })]),
      /entries\[0\]\.cliReportsLow: must be true or false/,
    );
    refuses(
      profileWith([entry(), entry()]),
      /entries\[1\]: a second entry for kind "judge" and model "m"/,
    );
    refuses(
      profileWith([entry()], { unit: 'eur' }),
      /unit: must be "usd", got "eur"/,
    );
    refuses(
      profileWith([entry()], { unit: undefined }),
      /unit: must be "usd", got undefined/,
    );
    refuses(
      profileWith([entry({ p95: 0.3 })]),
      /entries\[0\]\.p95: unknown field/,
    );
    refuses(
      profileWith([entry({ model: '*', cliReportsLow: true })]),
      /entries\[0\]\.cliReportsLow: not allowed on a "\*" entry/,
    );
    // Every problem is listed, not only the first.
    refuses(
      profileWith([entry({ kind: 'x', mean: -1 })], { schemaVersion: 0 }),
      /schemaVersion[\s\S]*\.kind[\s\S]*\.mean/,
    );
    // A file that cannot be read or parsed names the file too.
    fs.writeFileSync(file, '{ not json');
    assert.throws(
      () => loadProfile(file),
      (error) => error.message.includes(file),
    );
    assert.throws(
      () => loadProfile(path.join(dir, 'missing.json')),
      (error) => error.message.includes(path.join(dir, 'missing.json')),
    );
    // A valid one loads; p90 equal to the mean is allowed.
    helpers.write(file, profileWith([entry({ mean: 0.2, p90: 0.2 })]));
    assert.equal(loadProfile(file).entries[0].p90, 0.2);
  });
});

test('costFor: the exact (kind, model) entry, then (kind, "*"), then estimate_usd_per_call with a p90 of 1.5 times it', () => {
  const profile = profileWith([
    entry({
      kind: 'judge',
      model: 'exact',
      mean: 0.1,
      p90: 0.2,
      cliReportsLow: true,
    }),
    entry({ kind: 'judge', model: '*', mean: 0.3, p90: 0.4 }),
    entry({ kind: 'subject', model: 'exact', mean: 0.5, p90: 0.6 }),
  ]);
  assert.deepEqual(costFor(profile, 'judge', 'exact', ESTIMATES), {
    mean: 0.1,
    p90: 0.2,
    source: 'model',
    cliReportsLow: true,
  });
  assert.deepEqual(costFor(profile, 'judge', 'other', ESTIMATES), {
    mean: 0.3,
    p90: 0.4,
    source: 'kind',
    cliReportsLow: false,
  });
  // The entry of another kind is not used.
  assert.deepEqual(costFor(profile, 'writer', 'exact', ESTIMATES), {
    mean: ESTIMATES.writer,
    p90: ESTIMATES.writer * 1.5,
    source: 'estimate',
    cliReportsLow: false,
  });
  assert.equal(
    costFor(profile, 'subject', 'other', ESTIMATES).p90,
    ESTIMATES.subject * 1.5,
  );
  assert.throws(
    () => costFor(profile, 'rubric', 'exact', ESTIMATES),
    /costFor: kind must be one of subject, judge, writer/,
  );
  assert.throws(
    () => costFor(profile, 'writer', 'exact', {}),
    /no profile entry for writer exact and estimate_usd_per_call\.writer is not a number/,
  );
});

test('callCost prices against the committed profile unless another is given, with the settings estimates as fallback', () => {
  assert.deepEqual(callCost(CONFIG, 'subject', CONFIG.models.subject), {
    mean: 0.06693,
    p90: 0.12123,
    source: 'model',
    cliReportsLow: false,
  });
  assert.equal(callCost(CONFIG, 'subject', 'no-history').source, 'estimate');
  assert.equal(
    callCost(CONFIG, 'subject', CONFIG.models.subject, profileWith([])).mean,
    ESTIMATES.subject,
  );
});

test('a broken committed profile stops plan with exit 64 and names the file', () => {
  helpers.withTmp((dir) => {
    // A copy of the benchmark code whose committed profile is broken; the real one is never touched.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    for (const part of [path.join('scripts', 'bench'), 'bench'])
      fs.cpSync(path.join(repoRoot, part), path.join(dir, part), {
        recursive: true,
        filter: (source) => !source.includes(`${path.sep}out`),
      });
    const brokenFile = path.join(
      dir,
      'bench',
      'profiles',
      'cost-observed.json',
    );
    helpers.write(brokenFile, profileWith([entry({ mean: -1 })]));
    const result = spawnSync(
      process.execPath,
      [
        path.join(dir, 'scripts', 'bench', 'bench.js'),
        'plan',
        '--skills',
        helpers.SKILL,
        '--root',
        helpers.fixtureRoot(),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 64, result.stderr);
    assert.match(result.stderr, /^error: /);
    assert.ok(result.stderr.includes(brokenFile), result.stderr);
    assert.match(result.stderr, /not a usable cost profile/);
  });
});
