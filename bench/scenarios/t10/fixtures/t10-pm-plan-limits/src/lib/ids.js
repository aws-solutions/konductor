'use strict';
let sequence = 0;
function makeId(prefix) { sequence += 1; return `${prefix}_${Date.now().toString(36)}_${sequence.toString(36)}`; }
function resetIds() { sequence = 0; }
module.exports = { makeId, resetIds };
