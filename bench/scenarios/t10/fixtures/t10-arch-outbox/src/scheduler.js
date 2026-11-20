'use strict';
function createScheduler(){let running=false; return {runOnce(job){if(running)return false; running=true; try{job();return true;}finally{running=false;}}};}
module.exports={createScheduler};
