'use strict';
function serializeRecord(record) { return JSON.stringify(record, null, 2) + '\n'; }
module.exports = { serializeRecord };
