'use strict';
function diagnostic(line, message) { return { line, message, code: 'W' + String(line).padStart(3, '0') }; }
module.exports = { diagnostic };
