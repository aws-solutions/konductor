'use strict';
const statuses = new Set(['pending','authorized','captured','declined','refunded']);
function isStatus(value) { return statuses.has(value); }
function requireString(value, name) { if (typeof value !== 'string' || value.length === 0) { const e=new Error(name+' is required'); e.code='INVALID_INPUT'; throw e; } return value; }
module.exports={statuses,isStatus,requireString};
