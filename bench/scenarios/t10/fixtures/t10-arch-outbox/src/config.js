'use strict';
const defaults=require('../config/defaults.json');
function loadConfig(env=process.env){return {...defaults,port:Number(env.HARBORLINE_PORT||defaults.port)};}
module.exports={loadConfig};
