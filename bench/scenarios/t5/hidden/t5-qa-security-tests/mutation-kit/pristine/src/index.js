'use strict';

const { login } = require('./handlers/login');
const { getDocument, exportDocument, validateCreate } = require('./handlers/documents');
const { download } = require('./handlers/download');

module.exports = { login, getDocument, exportDocument, validateCreate, download };
