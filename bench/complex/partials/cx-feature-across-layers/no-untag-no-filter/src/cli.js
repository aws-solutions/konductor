#!/usr/bin/env node
'use strict';

const { createStore } = require('./store');
const { createNotes } = require('./service');
const { UsageError, NotFoundError } = require('./errors');

const USAGE = 'usage: notes <add TEXT [--tag T].. | list [--tag T] | tag ID T | untag ID T | delete ID> [--json]';

function parseId(raw) {
  if (!/^[1-9][0-9]*$/.test(raw || '')) throw new UsageError(USAGE);
  return Number(raw);
}

function parseArgs(args) {
  const positional = [];
  const flags = { json: false, tags: [] };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--json') flags.json = true;
    else if (args[i] === '--tag') {
      if (i + 1 >= args.length) throw new UsageError(USAGE);
      i += 1;
      flags.tags.push(args[i]);
    } else if (args[i].startsWith('--')) throw new UsageError(`unknown option ${args[i]}`);
    else positional.push(args[i]);
  }
  return { positional, flags };
}

function formatNote(note) {
  const base = `${note.id}\t${note.text}`;
  return note.tags.length === 0 ? base : `${base}\t${note.tags.map((t) => `#${t}`).join(' ')}`;
}

function execute(argv, env) {
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  const notes = createNotes(createStore(env.NOTES_FILE || 'notes.json'));

  if (command === 'add') {
    if (positional.length !== 1) throw new UsageError(USAGE);
    return `added ${notes.add(positional[0], flags.tags).id}\n`;
  }
  if (command === 'list') {
    if (flags.tags.length > 1) throw new UsageError(USAGE);
    const all = notes.list({});
    if (flags.json) return `${JSON.stringify(all)}\n`;
    return all.length === 0 ? 'no notes\n' : `${all.map(formatNote).join('\n')}\n`;
  }
  if (command === 'tag') {
    if (positional.length !== 2) throw new UsageError(USAGE);
    const id = parseId(positional[0]);
    if (command === 'tag') return `tagged ${id} #${notes.addTag(id, positional[1])}\n`;
    return `untagged ${id} #${notes.removeTag(id, positional[1])}\n`;
  }
  if (command === 'delete') {
    if (positional.length !== 1) throw new UsageError(USAGE);
    const id = parseId(positional[0]);
    notes.remove(id);
    return `deleted ${id}\n`;
  }
  throw new UsageError(command ? `unknown command "${command}"` : USAGE);
}

function run(argv, env = process.env) {
  try {
    return { code: 0, stdout: execute(argv, env), stderr: '' };
  } catch (err) {
    if (err instanceof UsageError) return { code: 2, stdout: '', stderr: `error: ${err.message}\n` };
    if (err instanceof NotFoundError) return { code: 3, stdout: '', stderr: `error: ${err.message}\n` };
    return { code: 1, stdout: '', stderr: `error: ${err.message}\n` };
  }
}

if (require.main === module) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

module.exports = { run };
