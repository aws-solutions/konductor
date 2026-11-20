#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const commands = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'commands.json'), 'utf8'));
const output = path.join(__dirname, '..', 'src', 'generated', 'command-index.js');
const body = '// GENERATED FILE. DO NOT EDIT.\n\'use strict\';\nmodule.exports = ' + JSON.stringify(commands, null, 2) + ';\n';
fs.writeFileSync(output, body);
console.log('wrote ' + output);
