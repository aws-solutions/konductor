// SPDX-License-Identifier: Apache-2.0
'use strict';

// The run readers (bench/core/load-run.js) bound to the harness of a result and the current rubric policy.
// shortcut: runtimeOf lives in the runner because the descriptors do; when the plugin registry is in bench/core (FW-7),
// core/load-run.js can read it there and this file goes.
const { makeRunLoader } = require('../../core/load-run.js');
const { runtimeOf } = require('./harness/runtime.js');
const { RUBRIC_POLICY } = require('../../judge/exclusion.js');

module.exports = makeRunLoader({ harnessOf: runtimeOf, rubricPolicy: RUBRIC_POLICY });
