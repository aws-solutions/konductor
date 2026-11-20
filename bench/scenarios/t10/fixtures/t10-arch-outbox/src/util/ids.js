'use strict';
let sequence=0;
function nextId(prefix='ord') { sequence += 1; return prefix+'_'+Date.now().toString(36)+'_'+sequence.toString(36); }
module.exports={nextId};
