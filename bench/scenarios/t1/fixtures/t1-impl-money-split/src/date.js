"use strict";
function parseDate(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new TypeError("invalid date"); return date; }
function isoDate(value = new Date()) { return parseDate(value).toISOString().slice(0, 10); }
module.exports = { parseDate, isoDate };
