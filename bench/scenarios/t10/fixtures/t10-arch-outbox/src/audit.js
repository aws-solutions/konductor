'use strict';
function formatAudit(action,actor){return {action,actor:actor||'system',at:new Date().toISOString()};}
module.exports={formatAudit};
