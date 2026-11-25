#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Prepares scenario candidates from a Strands experiment file.
//   node bench/agenteval/agenteval.js generate-strands --context-file FILE --task-description TEXT --out FILE
//   node bench/agenteval/agenteval.js import-strands --experiment FILE --tools FILE --out DIR
// See bench/agenteval/README.md.

const { UsageError } = require('./lib/args.js');

/** Each command: its one-line summary for the top usage, and `load`, which returns its module ({ run, USAGE }). */
const COMMANDS = {
  'generate-strands': { summary: 'run strands-evals generate and record where the cases came from', load: () => require('./lib/generate-strands.js') },
  'import-strands': { summary: 'turn a Strands experiment file into reviewable scenario candidates', load: () => require('./lib/import-strands.js') },
};

const TOP_USAGE = `usage: agenteval.js <command> [options]

commands:
${Object.entries(COMMANDS).map(([name, { summary }]) => `  ${name.padEnd(16)}  ${summary}`).join('\n')}

Run "agenteval.js <command> --help" for the options of one command.
Exit codes: 0 ok, 1 error, 2 usage.`;

async function main(argv, { out = console.log, err = console.error } = {}) {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') { (cmd === undefined ? err : out)(TOP_USAGE); return cmd === undefined ? 2 : 0; }
  if (!Object.hasOwn(COMMANDS, cmd)) { err(`agenteval: unknown command ${cmd}\n\n${TOP_USAGE}`); return 2; }
  const command = COMMANDS[cmd].load();
  try {
    return await command.run(rest, { out, err });
  } catch (e) {
    if (e instanceof UsageError) { err(`agenteval ${cmd}: ${e.message}\n\n${command.USAGE}`); return 2; }
    err(`agenteval ${cmd}: ${e.message}`);
    return 1;
  }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });

module.exports = { main, COMMANDS, TOP_USAGE };
