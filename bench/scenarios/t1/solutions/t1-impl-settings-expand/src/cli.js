'use strict';

const { loadSettings } = require('./loader');

function usage() {
  return 'Usage: layered-settings [--file PATH] [--no-expand] [--help]';
}

function parseArgs(argv) {
  const files = [];
  let expand = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--file') {
      if (!argv[i + 1]) throw new Error('--file needs a path');
      files.push(argv[++i]);
    } else if (argv[i] === '--no-expand') {
      expand = false;
    } else if (argv[i] === '--help') {
      return { help: true, files, expand };
    } else {
      throw new Error(`unknown option: ${argv[i]}`);
    }
  }
  return { files, expand };
}

function run(argv, io = { out: process.stdout, err: process.stderr, env: process.env }) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      io.out.write(`${usage()}\n`);
      return 0;
    }
    const settings = loadSettings({ files: args.files.length ? args.files : undefined, env: io.env, expand: args.expand });
    io.out.write(`${JSON.stringify(settings, null, 2)}\n`);
    return 0;
  } catch (error) {
    io.err.write(`settings: ${error.message}\n`);
    return 1;
  }
}

module.exports = { parseArgs, run };
