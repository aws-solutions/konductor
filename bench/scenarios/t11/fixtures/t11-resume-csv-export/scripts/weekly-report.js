#!/usr/bin/env node
'use strict';
const { readEntries } = require('../src/store');
const { summarize } = require('../src/summary');
const entries = readEntries(process.argv[2] || 'data/entries.json');
process.stdout.write(JSON.stringify(summarize(entries), null, 2) + '\n');
