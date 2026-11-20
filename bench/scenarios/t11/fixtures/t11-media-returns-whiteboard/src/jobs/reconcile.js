'use strict';
function reconcile(records, now = Date.now()) {
  return records.filter((record) => record.updatedAt && now - record.updatedAt > 86400000);
}
module.exports = { reconcile };
