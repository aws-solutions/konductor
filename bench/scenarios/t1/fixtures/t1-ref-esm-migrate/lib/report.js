'use strict';
const { format } = require('./format');
function report(values, options) {
  return values.map((value) => format(value, options)).join('\n');
}
module.exports = { report };
