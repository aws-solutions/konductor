'use strict';
function isNonEmptyString(value, max = Infinity) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max; }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
module.exports = { isNonEmptyString, isObject };
