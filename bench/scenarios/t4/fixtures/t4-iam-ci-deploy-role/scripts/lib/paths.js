'use strict';

const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const publicDir = path.join(root, 'public');
const apiDir = path.join(root, 'api');

module.exports = { root, publicDir, apiDir };
