'use strict';
const { parse } = require('./parser');
const { validate } = require('./validator');
const { format } = require('./formatter');
module.exports = { parse, validate, format };
