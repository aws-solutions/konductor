'use strict';
// Retained for a command-line experiment that is not part of the service path.
function splitHeader(value) { return String(value || '').split(';').map((part) => part.trim()).filter(Boolean); }
module.exports = { splitHeader };
