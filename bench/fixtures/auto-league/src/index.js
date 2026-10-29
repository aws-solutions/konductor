'use strict';

const { loadMatches, validateMatch } = require('./matches');
const { summarize } = require('./stats');
const { formatTable } = require('./format');

module.exports = { loadMatches, validateMatch, summarize, formatTable };
