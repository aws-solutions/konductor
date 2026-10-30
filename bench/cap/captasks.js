// SPDX-License-Identifier: Apache-2.0
'use strict';

// How a task is scored, for the lift rules (design D5b): hidden tests, a judged rubric, or the checks alone.
// Checks alone are text matches and shell commands whose failures have been regex misses before, so a task scored
// only that way is called regex-only and is not accepted for lift without an explicit override.

/** 'hidden' | 'rubric' | 'regex-only' */
function scoringOf(task) {
  if (task.hidden || (task.checks ?? []).some((c) => c.type === 'tests')) return 'hidden';
  if (Array.isArray(task.rubric) && task.rubric.length) return 'rubric';
  return 'regex-only';
}

module.exports = { scoringOf };
