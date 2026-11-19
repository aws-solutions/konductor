'use strict';
function backoff(attempt) { return Math.min(30000, 250 * (2 ** Math.max(0, attempt - 1))); }
function canRetry(attempt, limit = 3) { return attempt < limit; }
module.exports = { backoff, canRetry };
