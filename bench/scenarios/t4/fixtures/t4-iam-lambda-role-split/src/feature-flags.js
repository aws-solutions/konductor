'use strict';
const flags = require('../config/features.json');
function enabled(name) { return flags[name] === true; }
module.exports = { enabled };
