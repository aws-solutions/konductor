'use strict';
function wordsIn(text) { return String(text).trim() ? String(text).trim().split(/\s+/).length : 0; }
module.exports = { wordsIn };
