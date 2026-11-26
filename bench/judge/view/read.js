// SPDX-License-Identifier: Apache-2.0
'use strict';

// The read judge view (design 4 of the judge-view study, reports/judge-opencode-options-2026-11-26.md): the judge gets a
// fresh copy of the run's deliverables (read-copy.js) and reads it with read-only tools, under OS isolation. Rubric mode only.

const { buildReadInput } = require('./read-copy.js');

module.exports = Object.freeze({
  id: 'read',
  needs: Object.freeze(['readTools']),
  callerNeeds: Object.freeze(['isolation']),
  modes: Object.freeze(['rubric']),
  prepare: (args) => buildReadInput(args),
  // The backend writes `readCopy.files` into a fresh folder and pins the judge's working folder to it.
  call: (caller, req, input) => caller({ ...req, readCopy: { files: input.copy.files.map(({ rel, text }) => ({ rel, text })), sha: input.copy.sha } }),
  audit: () => 'judge view "read": the read audit is not built yet',
  cacheParts: (input) => ['view:read', `copy:${input.copy.sha}`],
});
