#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { exportTimesheet } = require('../src/export');
const { readEntries, writeEntries } = require('../src/store');

function valueAfter(args, flag, fallback) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function usage() {
  process.stderr.write('usage: timesheet <add|report|export> [options]\n');
}

function main(args) {
  const command = args[0];
  const file = path.resolve(valueAfter(args, '--file', 'data/entries.json'));
  if (command === 'export') {
    const format = valueAfter(args, '--format', 'json').toLowerCase();
    process.stdout.write(exportTimesheet(readEntries(file), { format }));
    return;
  }
  if (command === 'report') {
    const entries = readEntries(file);
    const total = entries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
    process.stdout.write(JSON.stringify({ entries: entries.length, minutes: total }) + '\n');
    return;
  }
  if (command === 'add') {
    const entries = readEntries(file);
    entries.push({
      id: valueAfter(args, '--id', 'entry-' + (entries.length + 1)),
      startedAt: valueAfter(args, '--started-at', new Date().toISOString()),
      endedAt: valueAfter(args, '--ended-at', new Date().toISOString()),
      minutes: Number(valueAfter(args, '--minutes', '0')),
      project: valueAfter(args, '--project', 'general'),
      description: valueAfter(args, '--description', ''),
      billable: valueAfter(args, '--billable', 'false') === 'true',
      tags: valueAfter(args, '--tags', '').split(',').filter(Boolean)
    });
    writeEntries(file, entries);
    return;
  }
  usage();
  process.exitCode = 2;
}

main(process.argv.slice(2));
