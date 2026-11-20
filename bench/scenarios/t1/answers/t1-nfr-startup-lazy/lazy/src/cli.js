'use strict';

const { VERSION, COMMANDS, REPORT_HEADER } = require('./constants');
const { loadConfig } = require('./config');
const output = require('./output');

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
  if (first === '--version' || first === '-v') {
    output.line(VERSION);
    return 0;
  }
  try {
    const config = loadConfig(configFile);
    if (!first || first === '--help' || first === '-h') {
      output.line(HELP);
      return 0;
    }
    const command = { check, format, inspect, stats, report, list }[first];
    if (!command) {
      output.error(`Unknown command: ${first}`);
      return 2;
    }
    return command(rest.slice(1), config, { reportHeader: REPORT_HEADER });
  } catch (error) {
    output.error(`atlas: ${error.message}`);
    return 1;
  }
}

module.exports = { run, parseArgs, HELP, COMMANDS };
