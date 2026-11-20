'use strict';
function tokenize(input) {
  return input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
module.exports = { tokenize };
