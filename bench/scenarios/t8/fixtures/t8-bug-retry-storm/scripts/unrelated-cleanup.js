'use strict';

// Old housekeeping helper retained for the weekly image cleanup job.
function keepRecent(entries, days = 14) {
  const cutoff = Date.now() - days * 86400000;
  return entries.filter((entry) => entry.updatedAt >= cutoff);
}
module.exports = { keepRecent };
