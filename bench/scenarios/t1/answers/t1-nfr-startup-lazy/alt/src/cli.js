'use strict';

const { VERSION, COMMANDS, REPORT_HEADER } = require('./constants');

// config.js and output.js stay unloaded until a path needs them, so --help and --version
// start with only bin/, cli.js and constants.js.
const loadConfig = (file) => require('./config').loadConfig(file);
const out = (text) => process.stdout.write(`${text}\n`);
const err = (text) => process.stderr.write(`${text}\n`);

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
  try {
    // A config given on the command line is validated before anything else runs.
    const config = configFile ? loadConfig(configFile) : null;
    if (first === '--version' || first === '-v') {
      out(VERSION);
      return 0;
    }
    if (!first || first === '--help' || first === '-h') {
      out(HELP);
      return 0;
    }
    if (!COMMANDS.includes(first)) {
      err(`Unknown command: ${first}`);
      return 2;
    }
    const command = require(`./commands/${first}`);
    return command(rest.slice(1), config || loadConfig(), { reportHeader: REPORT_HEADER });
  } catch (error) {
    err(`atlas: ${error.message}`);
    return 1;
  }
}

module.exports = { run, parseArgs, HELP, COMMANDS };
