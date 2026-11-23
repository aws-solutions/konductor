#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// The plugin kit's stand-in agent for the fake-run check (check.js): started with the harness's own command line,
// cwd, env and stdin in place of the real agent binary. It writes what it was given to a log file and prints the
// plugin's recorded stream, so the harness's parseResult reads a run that went through the real command path.
//   node replay-agent.js <recorded stream> <log file> <agent file> [agent args...]
const fs = require('node:fs');

const [stream, log, ...argv] = process.argv.slice(2);
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* no stdin given: the prompt is in argv */ }
fs.writeFileSync(log, JSON.stringify({ argv, stdin, cwd: process.cwd(), env: Object.keys(process.env).sort() }));
process.stdout.write(fs.readFileSync(stream, 'utf8'));
