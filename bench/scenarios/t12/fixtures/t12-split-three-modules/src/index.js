'use strict';

const { slugify } = require('./slugify.js');
const { toRoman, fromRoman } = require('./roman.js');
const { wordStats } = require('./word-stats.js');

module.exports = { slugify, toRoman, fromRoman, wordStats };
