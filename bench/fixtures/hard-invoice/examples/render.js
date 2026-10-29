'use strict';

const { renderReport } = require('../src');
const invoice = require('./invoice.json');

process.stdout.write(renderReport(invoice));
