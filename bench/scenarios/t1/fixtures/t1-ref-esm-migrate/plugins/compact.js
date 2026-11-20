'use strict';
module.exports = function compact(value) {
  return String(value).trim().replace(/\s+/g, ' ');
};
