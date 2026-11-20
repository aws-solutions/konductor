#!/usr/bin/env node
'use strict';
const { readEntries } = require('../src/store');
const entries = readEntries(process.argv[2] || 'data/entries.json');
if (!Array.isArray(entries)) throw new Error('ledger must be an array');
process.stdout.write('ledger ok: ' + entries.length + '\n');
