'use strict';

const { read } = require('./conf');
const { value } = require('./config');

module.exports = {
  read,
  value,
  serviceTag(name) {
    return 'harborline:' + name;
  }
};
