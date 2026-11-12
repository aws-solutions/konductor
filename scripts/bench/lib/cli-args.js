// SPDX-License-Identifier: Apache-2.0
/**
 * Command-line parsing shared by the benchmark's commands (bench.js, launch.js, job.js), so a flag means the same
 * thing and is refused the same way in each. A flag takes its value as `--flag value` or `--flag=value`. A flag that
 * takes no value refuses one (`--json=false` must not switch JSON on), and a flag that takes a value refuses an
 * empty value or another flag in its place. Every problem is a UsageError, which each command turns into exit 64.
 */
'use strict';

/** A bad command line: an unknown flag, a missing or malformed value. Exit 64 (EX_USAGE). */
class UsageError extends Error {}

/**
 * Reads `args` (the words after the command) into an options object. `valueFlags` and `boolFlags` map a flag to its
 * option name. `refusedFlags` maps a flag to the message that refuses it (a flag that is planned but not built).
 */
function parseFlags(
  args,
  { valueFlags = {}, boolFlags = {}, refusedFlags = {} } = {},
) {
  const options = {};
  // A flag given twice is refused: silently keeping the last value would hide a typo such as two --skills lists.
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const equalsIndex = args[i].startsWith('-') ? args[i].indexOf('=') : -1;
    const flag = equalsIndex > 0 ? args[i].slice(0, equalsIndex) : args[i];
    if (Object.hasOwn(refusedFlags, flag))
      throw new UsageError(refusedFlags[flag]);
    const known =
      Object.hasOwn(boolFlags, flag) || Object.hasOwn(valueFlags, flag);
    if (known && seen.has(flag))
      throw new UsageError(`${flag} is given more than once`);
    seen.add(flag);
    if (Object.hasOwn(boolFlags, flag)) {
      // `--json=false` must not switch JSON on, so a value on a flag that takes none is refused.
      if (equalsIndex > 0)
        throw new UsageError(`${flag} does not take a value`);
      options[boolFlags[flag]] = true;
    } else if (Object.hasOwn(valueFlags, flag)) {
      const value =
        equalsIndex > 0 ? args[i].slice(equalsIndex + 1) : args[++i];
      if (value === undefined || value === '' || value.startsWith('--'))
        throw new UsageError(`${flag} needs a value`);
      options[valueFlags[flag]] = value;
    } else {
      throw new UsageError(`unknown option ${flag}`);
    }
  }
  return options;
}

/** Digits with an optional fraction: "2.5" and "25". Not "0x10", "1e1", " 5 ", "+5", ".5" or "5.". */
const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

/** The value of --max-usd as a number. `Number()` alone would read hex, exponents and padded text. */
function parseMaxUsd(text) {
  const maxUsd = PLAIN_DECIMAL.test(text) ? Number(text) : NaN;
  if (!(Number.isFinite(maxUsd) && maxUsd > 0))
    throw new UsageError(
      `--max-usd: must be a plain decimal number above 0 such as 2.5, got ${JSON.stringify(text)}`,
    );
  return maxUsd;
}

/** The names in a --skills value: split on ",", trimmed, empty parts and repeats dropped, in the order given. */
function parseSkillSelection(skillList) {
  const names = [
    ...new Set(
      skillList
        .split(',')
        .map((skillName) => skillName.trim())
        .filter(Boolean),
    ),
  ];
  if (!names.length)
    throw new UsageError('--skills needs at least one skill name');
  return names;
}

module.exports = {
  UsageError,
  parseFlags,
  parseMaxUsd,
  parseSkillSelection,
};
