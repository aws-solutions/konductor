'use strict';

const { slugify } = require('./slug');
const { capitalize, truncate, initials } = require('./strings');
const { cnt, longestWord } = require('./words');
const { parseLine, parseCsv } = require('./csv');
const { wrapText } = require('./wrap');

module.exports = {
  slugify,
  capitalize,
  truncate,
  initials,
  cnt,
  longestWord,
  parseLine,
  parseCsv,
  wrapText,
};
