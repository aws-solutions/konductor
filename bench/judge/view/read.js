// SPDX-License-Identifier: Apache-2.0
'use strict';

// The read judge view (design 4 of the judge-view study, reports/judge-opencode-options-2026-11-26.md): the judge gets a
// fresh copy of the run's deliverables (read-copy.js) and reads it with read-only tools, under OS isolation. Rubric mode only.

const { buildReadInput } = require('./read-copy.js');
const { auditReads } = require('./read-audit.js');

const copyOf = (input) => input.copy.files.map(({ rel, text }) => ({ rel, text }));

module.exports = Object.freeze({
  id: 'read',
  needs: Object.freeze(['readTools']),
  callerNeeds: Object.freeze(['isolation']),
  modes: Object.freeze(['rubric']),
  prepare: (args) => buildReadInput(args),
  // The backend writes `readCopy.files` into a fresh folder and pins the judge's working folder to it. A reply whose reads
  // pass the audit carries `viewRecord` (copy hash, read order, steps), which the record and the answer cache keep.
  async call(caller, req, input) {
    const r = await caller({ ...req, readCopy: { files: copyOf(input), sha: input.copy.sha } });
    if (r.error) return r;
    const { record } = auditReads(r.readTrace, copyOf(input));
    return record ? { ...r, viewRecord: { view: 'read', copySha: input.copy.sha, ...record } } : r;
  },
  audit: (r, input) => auditReads(r.readTrace, copyOf(input)).error ?? null,
  cacheParts: (input) => ['view:read', `copy:${input.copy.sha}`],
});
