'use strict';

const { up, down } = require('./migrate');
const { toV2 } = require('./schema');

module.exports = { up, down, toV2 };
