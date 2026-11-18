// SPDX-License-Identifier: Apache-2.0
'use strict';

// Readers of parsed flag values that several bench commands share. cli-flags.js says which flags a command takes;
// this file only reads their values.

const path = require('node:path');
const { BENCH_DIR } = require('./tasks.js');

const DEFAULT_REPO = path.resolve(BENCH_DIR, '..');

/** `v` as a string, or undefined when the flag was not given or was given with no value (the parser's `true`). */
const textFlag = (v) => (v === undefined || v === true ? undefined : String(v));

/**
 * The Konductor checkout a command works on, as an absolute path: `opts['repo-root']`, else `$BENCH_REPO_ROOT`, else
 * the checkout that holds this bench. An empty value counts as not given.
 */
const repoRootOf = (opts) => path.resolve(textFlag(opts['repo-root']) || process.env.BENCH_REPO_ROOT || DEFAULT_REPO);

module.exports = { textFlag, repoRootOf, DEFAULT_REPO };
