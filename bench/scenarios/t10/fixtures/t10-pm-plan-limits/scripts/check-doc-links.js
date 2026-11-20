#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const text = fs.readFileSync(path.join('docs', 'architecture.md'), 'utf8');
if (!text.includes('src/repositories') || !text.includes('src/services')) process.exit(1);
console.log('architecture links ok');
