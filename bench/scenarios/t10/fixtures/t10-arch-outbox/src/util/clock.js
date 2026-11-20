'use strict';
function nowIso(clock=Date) { return new Date(clock.now()).toISOString(); }
module.exports={nowIso};
