'use strict';
function normalizeLine(line) { return line.replace(/[ \t]+$/g, ''); }
module.exports = { normalizeLine };
