// SPDX-License-Identifier: Apache-2.0
'use strict';

// Caches a test runner, type checker or linter writes as a side effect of running it. They are not part of the change, so
// the judge bundle, the quality pack's changed-file set and the artifact byte counts leave them out. Without this a run that
// ran the Python tests failed `chg-scoped` for the `.pytest_cache` and `__pycache__` files it left, and a run that never ran
// them did not. Directory names match at any depth; `node_modules` (and so `node_modules/.cache`) is skipped whole by the
// bundle walk already.
const EPHEMERAL_DIRS = new Set(['.pytest_cache', '__pycache__', '.mypy_cache', '.ruff_cache']);
const EPHEMERAL_FILE = /\.py[co]$/;

const isEphemeralDir = (name) => EPHEMERAL_DIRS.has(name);
const isEphemeralFile = (name) => EPHEMERAL_FILE.test(name);

module.exports = { EPHEMERAL_DIRS, EPHEMERAL_FILE, isEphemeralDir, isEphemeralFile };
