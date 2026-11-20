'use strict';
function keepRecent(records, cutoff) { return records.filter((record) => record.createdAt >= cutoff); }
module.exports = { keepRecent };
