'use strict';
function splitLines(text) { return String(text).split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line !== ''); }
module.exports = { splitLines };
