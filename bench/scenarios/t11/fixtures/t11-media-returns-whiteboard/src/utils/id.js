'use strict';
let sequence = 0;
function nextId(prefix = 'ret') { sequence += 1; return prefix + '-' + sequence.toString(36).padStart(3, '0'); }
module.exports = { nextId };
