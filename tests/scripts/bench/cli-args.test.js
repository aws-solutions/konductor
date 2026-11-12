// SPDX-License-Identifier: Apache-2.0
// Tests for the shared command-line parsing (scripts/bench/lib/cli-args.js) used by bench.js, launch.js and job.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  UsageError,
  parseFlags,
  parseMaxUsd,
  parseMaxMinutes,
  parseSkillSelection,
  parseStartedAt,
} = require('../../../scripts/bench/lib/cli-args');

const FLAGS = {
  valueFlags: { '--skills': 'skills', '--run': 'run' },
  boolFlags: { '--dry-run': 'dryRun' },
  refusedFlags: { '--all': '--all is not available yet' },
};
const usageError = (pattern) => (error) =>
  error instanceof UsageError && pattern.test(error.message);

test('parseFlags: called without options, it takes no flags: no words give an empty result and any flag is unknown', () => {
  assert.deepEqual(parseFlags([]), {});
  assert.throws(
    () => parseFlags(['--run', 'a']),
    usageError(/unknown option --run/),
  );
  assert.throws(
    () => parseFlags(['--all']),
    usageError(/unknown option --all/),
  );
});

test('parseFlags: values in both forms and bare flags; a repeated flag is refused', () => {
  assert.deepEqual(
    parseFlags(['--skills', 'a,b', '--run=r1', '--dry-run'], FLAGS),
    { skills: 'a,b', run: 'r1', dryRun: true },
  );
  for (const args of [
    ['--run', 'a', '--run', 'b'],
    ['--run=a', '--run', 'a'],
    ['--dry-run', '--dry-run'],
  ])
    assert.throws(
      () => parseFlags(args, FLAGS),
      usageError(
        new RegExp(`${args[0].split('=')[0]} is given more than once`),
      ),
      args.join(' '),
    );
  assert.deepEqual(parseFlags(['--run=a=b'], FLAGS), { run: 'a=b' });
  assert.deepEqual(parseFlags([], FLAGS), {});
});

test('parseFlags: a missing value, a value on a bare flag, an unknown or refused flag are usage errors', () => {
  for (const [args, pattern] of [
    [['--skills'], /--skills needs a value/],
    [['--skills', '--dry-run'], /--skills needs a value/],
    [['--skills='], /--skills needs a value/],
    [['--dry-run=false'], /--dry-run does not take a value/],
    [['--nope'], /unknown option --nope/],
    [['stray'], /unknown option stray/],
    [['stray=1'], /unknown option stray=1/],
    [['--all'], /--all is not available yet/],
    [['--all=x'], /--all is not available yet/],
  ])
    assert.throws(
      () => parseFlags(args, FLAGS),
      usageError(pattern),
      args.join(' '),
    );
});

test('parseMaxUsd: plain decimals above 0 only', () => {
  assert.equal(parseMaxUsd('2.5'), 2.5);
  assert.equal(parseMaxUsd('25'), 25);
  for (const bad of [
    '0',
    '0.0',
    '0x10',
    '1e1',
    ' 5',
    '+5',
    '.5',
    '5.',
    '-1',
    'five',
    '',
  ])
    assert.throws(
      () => parseMaxUsd(bad),
      usageError(/--max-usd: must be a plain decimal/),
      bad,
    );
});

test('parseSkillSelection: split on commas, trimmed, empty parts and repeats dropped, order kept', () => {
  assert.deepEqual(parseSkillSelection(' b, a ,,b'), ['b', 'a']);
  assert.throws(
    () => parseSkillSelection(' , '),
    usageError(/at least one skill name/),
  );
});

test('parseMaxMinutes: a plain decimal above 0 and at most one week', () => {
  assert.equal(parseMaxMinutes('90'), 90);
  assert.equal(parseMaxMinutes('0.5'), 0.5);
  assert.equal(parseMaxMinutes('10080'), 10080);
  for (const bad of ['0', '0.0', '-5', '1e2', '0x10', ' 5', '5.', '10081', ''])
    assert.throws(
      () => parseMaxMinutes(bad),
      usageError(/--max-minutes: must be a plain decimal number above 0/),
      bad,
    );
});

test('parseStartedAt: a real UTC time, with an optional fraction of a second', () => {
  assert.equal(
    parseStartedAt('2026-11-12T15:30:00Z'),
    Date.parse('2026-11-12T15:30:00Z'),
  );
  assert.equal(
    parseStartedAt('2026-11-12T15:30:00.250Z'),
    Date.parse('2026-11-12T15:30:00.250Z'),
  );
  assert.equal(
    parseStartedAt('2026-11-12T15:30:00.123456789Z'),
    Date.parse('2026-11-12T15:30:00.123Z'),
    'up to nine digits of fraction are accepted',
  );
  assert.throws(
    () => parseStartedAt('2026-11-12T15:30:00.1234567890Z'),
    usageError(/--started-at: must be a UTC time/),
    'ten digits are not',
  );
  for (const bad of [
    '2026-11-12T15:30:00',
    '2026-11-12T15:30:00+01:00',
    '2026-02-30T10:00:00Z',
    '2026-11-12T24:00:00Z',
    '2026-11-12 15:30:00Z',
    '1794497450',
    'yesterday',
  ])
    assert.throws(
      () => parseStartedAt(bad),
      usageError(/--started-at: must be a UTC time/),
      bad,
    );
});
