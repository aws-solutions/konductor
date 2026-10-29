'use strict';

const { readIndex, referencedFiles, listFiles } = require('./store');
const { folderSizes } = require('./report');

module.exports = { readIndex, referencedFiles, listFiles, folderSizes };
