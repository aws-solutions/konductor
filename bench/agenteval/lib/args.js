// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small flag parser for the agenteval commands. Unknown flags, repeated flags, missing values and stray arguments are usage errors.

class UsageError extends Error {}

/**
 * @param {string[]} argv arguments after the command name
 * @param {{value?: string[], bool?: string[]}} spec flag names without the leading dashes
 * @returns {Record<string, string|true>}
 */
function parseFlags(argv, { value = [], bool = [] }) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument ${arg}`);
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (!value.includes(name) && !bool.includes(name)) throw new UsageError(`unknown flag --${name}`);
    if (name in opts) throw new UsageError(`--${name} given more than once`);
    if (bool.includes(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} does not take a value`);
      opts[name] = true;
      continue;
    }
    const next = inline !== undefined ? inline : argv[i + 1];
    if (next === undefined || (inline === undefined && next.startsWith('--'))) throw new UsageError(`--${name} needs a value`);
    if (inline === undefined) i++;
    opts[name] = next;
  }
  return opts;
}

function positiveInt(opts, name) {
  if (opts[name] === undefined) return undefined;
  const n = Number(opts[name]);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${name} must be a positive integer`);
  return n;
}

function unitInterval(opts, name) {
  if (opts[name] === undefined) return undefined;
  const n = Number(opts[name]);
  if (!(n > 0 && n <= 1)) throw new UsageError(`--${name} must be a number above 0 and at most 1`);
  return n;
}

module.exports = { UsageError, parseFlags, positiveInt, unitInterval };
