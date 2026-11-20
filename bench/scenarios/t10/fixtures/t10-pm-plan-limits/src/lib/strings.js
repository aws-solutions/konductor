'use strict';
function clean(value) { return typeof value === 'string' ? value.trim() : value; }
function sameText(a, b) { return clean(a).toLowerCase() === clean(b).toLowerCase(); }
module.exports = { clean, sameText };
