'use strict';
const { InputError } = require('./errors');
function required(value, name) {
  if (value === undefined || value === null || value === '') throw new InputError(`${name} is required`);
  return value;
}
function stageOf(event) { return event && event.stage ? event.stage : 'staging'; }
module.exports = { required, stageOf };
