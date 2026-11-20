'use strict';
module.exports = function verbose(value) {
  const text = String(value);
  return `${text} [${text.length}]`;
};
