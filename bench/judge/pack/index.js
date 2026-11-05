// SPDX-License-Identifier: Apache-2.0
'use strict';

// The quality pack: anchored criteria for dimensions the task rubrics do not measure, judged in a separate pass.
// Everything here is pure: no model call and no file write. Loading and linting (load), what the agent changed (changes),
// which criteria apply (gate), counted criteria (detect), and the judge prompt and scoring (ask).

module.exports = {
  ...require('./load.js'),
  ...require('./changes.js'),
  ...require('./gate.js'),
  ...require('./detect.js'),
  ...require('./ask.js'),
};
