#!/usr/bin/env node
const { runCommand } = require('./commands');
runCommand(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
