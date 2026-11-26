// SPDX-License-Identifier: Apache-2.0
'use strict';

// The read judge view (design 4 of the judge-view study): the judge gets a fresh copy of the run's deliverables and
// reads it with read-only tools. Built step by step; until the copy builder lands, prepare refuses.

module.exports = Object.freeze({
  id: 'read',
  needs: Object.freeze(['readTools']),
  callerNeeds: Object.freeze(['isolation']),
  modes: Object.freeze(['rubric']),
  prepare() { throw new Error('judge view "read": the copy builder is not built yet'); },
  call: (caller, req) => caller(req),
  audit: () => 'judge view "read": the read audit is not built yet',
  cacheParts: () => ['view:read'],
});
