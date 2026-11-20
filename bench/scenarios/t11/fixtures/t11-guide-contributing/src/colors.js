'use strict';
const colors = { red: (s) => `\x1b[31m${s}\x1b[39m`, dim: (s) => `\x1b[2m${s}\x1b[22m` };
module.exports = colors;
