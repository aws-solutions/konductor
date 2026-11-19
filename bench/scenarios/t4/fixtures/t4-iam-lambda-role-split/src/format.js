'use strict';
function isoDate(value) { return String(value).slice(0, 10); }
function jsonLine(value) { return JSON.stringify(value); }
module.exports = { isoDate, jsonLine };
