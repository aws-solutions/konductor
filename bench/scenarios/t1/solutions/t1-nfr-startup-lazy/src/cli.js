'use strict';

const { VERSION, COMMANDS, REPORT_HEADER } = require('./constants');
const lazyCommand = require('./lazy-command');

const HELP = `Atlas ${VERSION}
Usage: atlas <command> [file] [options]

Commands:
  check    check a file for content
  format   summarize formatted lines
  inspect  identify a JSON value
  stats    count lines and words
  report   print a short report
  list     list available commands

Options:
  --config <file>  use a configuration file
  --help           show this help
  --version        print the version`;

const commands = {
  check: lazyCommand(() => require('./commands/check')),
  format: lazyCommand(() => require('./commands/format')),
  inspect: lazyCommand(() => require('./commands/inspect')),
  stats: lazyCommand(() => require('./commands/stats')),
  report: lazyCommand(() => require('./commands/report')),
  list: lazyCommand(() => require('./commands/list'))
};

function parseArgs(args) {
  const rest = [];
  let configFile;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--config') configFile = args[++i];
    else rest.push(args[i]);
  }
  return { rest, configFile };
}

function run(args) {
  const { rest, configFile } = parseArgs(args);
  const first = rest[0];
  try {
    let config;
    if (configFile) {
      // A supplied configuration is checked even for metadata-only commands.
      config = require('./config').loadConfig(configFile);
    }
    if (first === '--version' || first === '-v') {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    if (!first || first === '--help' || first === '-h') {
      process.stdout.write(`${HELP}\n`);
      return 0;
    }
    if (!config) config = require('./config').loadConfig();
    const command = commands[first];
    if (!command) {
      process.stderr.write(`Unknown command: ${first}\n`);
      return 2;
    }
    return command(rest.slice(1), config, { reportHeader: REPORT_HEADER });
  } catch (error) {
    process.stderr.write(`atlas: ${error.message}\n`);
    return 1;
  }
}

module.exports = { run, parseArgs, HELP, COMMANDS };
