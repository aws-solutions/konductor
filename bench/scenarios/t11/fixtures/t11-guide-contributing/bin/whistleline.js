#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { parse, validate, format } = require('../src');
const file = process.argv[2];
if (!file) { console.error('usage: whistleline <cue-file>'); process.exitCode = 2; }
else { const entries = parse(fs.readFileSync(file, 'utf8')); const errors = validate(entries); if (errors.length) { for (const error of errors) console.error('line ' + error.line + ': ' + error.message); process.exitCode = 1; } else console.log(format(entries)); }
