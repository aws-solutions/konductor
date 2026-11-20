#!/usr/bin/env node
'use strict';
const message = process.argv.slice(2).join(' ') || '';
const types = ['add', 'change', 'fix', 'docs', 'test', 'chore', 'release'];
const match = /^([a-z]+)\(([a-z][a-z0-9-]{1,11})\): (.+)$/.exec(message);
if (!match || !types.includes(match[1]) || match[3].length > 72) { console.error('use type(scope): subject, with an allowed type and a subject of 72 characters or fewer'); process.exit(1); }
console.log('commit message accepted');
