// SPDX-License-Identifier: Apache-2.0
'use strict';

// Reads over a judgments.json for the bash chains: which backend wrote it and how many records carry a judge error.
// Read only.

const { readJsonOrNull } = require('../../runner/lib/util.js');

const CRED_ERROR = /credential|expired|ExpiredToken|security token|UnrecognizedClient|InvalidClientTokenId|AccessDenied|not authorized/i;
const BUDGET_ERROR = /budget reached/;

const records = (j) => [...(j.rubric || []), ...(j.pairwise || []), ...(j.graded || [])];

/**
 * The backend that wrote a judgments file.
 * @param {string} file judgments.json
 * @returns {string|null} the backend ('kiro' when the field is absent), or null when the file is missing or unreadable
 */
function backend(file) {
  const j = readJsonOrNull(file);
  return j ? String(j.backend || 'kiro') : null;
}

/**
 * Judge error counts of a judgments file.
 * @param {string} file judgments.json
 * @returns {null|{errors:number, credErrors:number, budgetSkipped:number, notJudged:number, spentUsd:number|null}}
 *   null when the file is missing or unreadable
 */
function errorInfo(file) {
  const j = readJsonOrNull(file);
  if (!j) return null;
  const errs = records(j).filter((r) => r.judgeError);
  return {
    errors: errs.length,
    credErrors: errs.filter((r) => CRED_ERROR.test(String(r.judgeError))).length,
    budgetSkipped: errs.filter((r) => BUDGET_ERROR.test(String(r.judgeError))).length,
    notJudged: (j.notJudged || []).length,
    spentUsd: typeof j.spentUsd === 'number' ? j.spentUsd : null,
  };
}

module.exports = { backend, errorInfo, records };
