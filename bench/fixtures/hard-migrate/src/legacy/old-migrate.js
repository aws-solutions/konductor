'use strict';

// The first migration script, from before the schema had a version field. Not used.
module.exports = function oldMigrate(line) {
  const r = JSON.parse(line);
  r.total = Math.round(r.total * 100);
  return JSON.stringify(r);
};
