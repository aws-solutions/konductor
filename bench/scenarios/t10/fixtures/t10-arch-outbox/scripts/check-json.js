'use strict';
const fs=require('node:fs'); for(const f of ['config/defaults.json','config/plans.json','ops/deploy-rings.json','ops/flags.json'])JSON.parse(fs.readFileSync(f)); console.log('json ok');
