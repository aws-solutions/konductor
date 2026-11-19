'use strict';
const banned = new Set(['<<<<<<<', '>>>>>>>']);
function acceptable(line) { return !banned.has(line.trim()); }
module.exports = { acceptable };
