#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'fixture');
fs.mkdirSync(root, { recursive: true });
const files = {
  'package.json': `{
  "name": "minute-mason",
  "version": "1.4.0",
  "description": "A small file-backed time ledger for a quiet team",
  "main": "index.js",
  "bin": { "timesheet": "bin/timesheet.js" },
  "scripts": { "test": "node --test test/" },
  "engines": { "node": ">=24" },
  "license": "MIT"
}\n`,
  '.gitignore': `node_modules/\ncoverage/\n*.local.json\n.DS_Store\n`,
  '.editorconfig': `root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\n`,
  'LICENSE': `Copyright (c) 2025 Minute Mason contributors\n\nPermission is granted to use, copy, modify, and distribute this software for any purpose with or without fee.\n`,
  'index.js': `'use strict';\n\nconst { exportTimesheet } = require('./src/export');\nconst { readEntries, writeEntries } = require('./src/store');\nconst { minutesBetween } = require('./src/clock');\n\nmodule.exports = { exportTimesheet, readEntries, writeEntries, minutesBetween };\n`,
  'src/store.js': `'use strict';\n\nconst fs = require('node:fs');\nconst path = require('node:path');\n\nfunction readEntries(filePath) {\n  const resolved = path.resolve(filePath);\n  return JSON.parse(fs.readFileSync(resolved, 'utf8'));\n}\n\nfunction writeEntries(filePath, entries) {\n  const resolved = path.resolve(filePath);\n  fs.mkdirSync(path.dirname(resolved), { recursive: true });\n  fs.writeFileSync(resolved, JSON.stringify(entries, null, 2) + '\\n');\n}\n\nmodule.exports = { readEntries, writeEntries };\n`,
  'src/clock.js': `'use strict';\n\nfunction minutesBetween(start, end) {\n  const a = new Date(start);\n  const b = new Date(end);\n  return Math.round((b - a) / 60000);\n}\n\nfunction sameDay(first, second) {\n  return new Date(first).toDateString() === new Date(second).toDateString();\n}\n\nmodule.exports = { minutesBetween, sameDay };\n`,
  'src/summary.js': `'use strict';\n\nfunction summarize(entries) {\n  const result = new Map();\n  for (const entry of entries) {\n    const key = entry.project || 'unassigned';\n    result.set(key, (result.get(key) || 0) + Number(entry.minutes || 0));\n  }\n  return [...result].map(([project, minutes]) => ({ project, minutes }));\n}\n\nmodule.exports = { summarize };\n`,
  'src/labels.js': `'use strict';\n\nconst KNOWN_LABELS = new Set(['client', 'internal', 'planning', 'support']);\n\nfunction tidyLabels(labels) {\n  if (!Array.isArray(labels)) return [];\n  return labels.map(String).map(label => label.trim().toLowerCase()).filter(Boolean);\n}\n\nmodule.exports = { KNOWN_LABELS, tidyLabels };\n`,
  'src/settings.js': `'use strict';\n\nconst defaults = Object.freeze({ dataFile: 'data/entries.json', weekStartsOn: 'monday' });\n\nfunction settings(overrides = {}) {\n  return { ...defaults, ...overrides };\n}\n\nmodule.exports = { defaults, settings };\n`,
  'src/format.js': `'use strict';\n\nfunction pad(value) {\n  return String(value).padStart(2, '0');\n}\n\nfunction displayMinutes(minutes) {\n  const hours = Math.floor(minutes / 60);\n  const remainder = minutes % 60;\n  return hours ? hours + 'h ' + pad(remainder) + 'm' : remainder + 'm';\n}\n\nmodule.exports = { displayMinutes };\n`,
  'src/export.js': `'use strict';\n\nfunction exportTimesheet(entries, options = {}) {\n  const format = typeof options === 'string' ? options : options.format || 'json';\n  if (format === 'json') return JSON.stringify(entries, null, 2) + '\\n';\n  throw new Error('Unsupported export format: ' + format);\n}\n\nmodule.exports = { exportTimesheet };\n`,
  'bin/timesheet.js': `#!/usr/bin/env node\n'use strict';\n\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst { exportTimesheet } = require('../src/export');\nconst { readEntries, writeEntries } = require('../src/store');\n\nfunction valueAfter(args, flag, fallback) {\n  const index = args.indexOf(flag);\n  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;\n}\n\nfunction usage() {\n  process.stderr.write('usage: timesheet <add|report|export> [options]\\n');\n}\n\nfunction main(args) {\n  const command = args[0];\n  const file = path.resolve(valueAfter(args, '--file', 'data/entries.json'));\n  if (command === 'export') {\n    const format = valueAfter(args, '--format', 'json');\n    process.stdout.write(exportTimesheet(readEntries(file), { format }));\n    return;\n  }\n  if (command === 'report') {\n    const entries = readEntries(file);\n    const total = entries.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);\n    process.stdout.write(JSON.stringify({ entries: entries.length, minutes: total }) + '\\n');\n    return;\n  }\n  if (command === 'add') {\n    const entries = readEntries(file);\n    entries.push({\n      id: valueAfter(args, '--id', 'entry-' + (entries.length + 1)),\n      startedAt: valueAfter(args, '--started-at', new Date().toISOString()),\n      endedAt: valueAfter(args, '--ended-at', new Date().toISOString()),\n      minutes: Number(valueAfter(args, '--minutes', '0')),\n      project: valueAfter(args, '--project', 'general'),\n      description: valueAfter(args, '--description', ''),\n      billable: valueAfter(args, '--billable', 'false') === 'true',\n      tags: valueAfter(args, '--tags', '').split(',').filter(Boolean)\n    });\n    writeEntries(file, entries);\n    return;\n  }\n  usage();\n  process.exitCode = 2;\n}\n\nmain(process.argv.slice(2));\n`,
  'data/entries.json': `[
  {
    "id": "tm-201",
    "startedAt": "2025-04-02T09:15:00-04:00",
    "endedAt": "2025-04-02T10:45:00-04:00",
    "minutes": 90,
    "project": "Harbor map",
    "description": "review the second draft",
    "billable": true,
    "tags": ["client", "planning"]
  },
  {
    "id": "tm-202",
    "startedAt": "2025-04-03T13:00:00Z",
    "endedAt": "2025-04-03T14:10:00Z",
    "minutes": 70,
    "project": "Workshop",
    "description": "pair with Mina",
    "billable": false,
    "tags": ["internal"]
  }
]\n`,
  'data/archive.json': `[{"id":"tm-177","startedAt":"2025-03-28T08:00:00Z","endedAt":"2025-03-28T08:25:00Z","minutes":25,"project":"Harbor map","description":"inbox tidy","billable":true,"tags":[]}]\n`,
  'data/people.json': `[{"name":"Mina Vale","short":"MV"},{"name":"Oren Pike","short":"OP"}]\n`,
  'data/projects.json': `[{"code":"harbor","label":"Harbor map"},{"code":"workshop","label":"Workshop"},{"code":"care","label":"Customer care"}]\n`,
  'config/example.json': `{"dataFile":"data/entries.json","weekStartsOn":"monday"}\n`,
  'docs/commands.md': `# Commands\n\nThe executable accepts ` + "`add`" + `, ` + "`report`" + ` and ` + "`export`" + `. Use ` + "`--file`" + ` to select a JSON ledger.\n\n` + "`timesheet report --file data/entries.json`" + ` prints a compact count and minute total.\n`,
  'docs/data-format.md': `# Ledger format\n\nA ledger is a JSON array. Each entry has an id, two ISO timestamp strings, a minute count, a project, a description, a billable flag, and zero or more tags.\n`,
  'docs/decisions.md': `# Small decisions\n\n- Timestamps stay as supplied in the ledger.\n- Reports use minutes rather than decimal hours.\n- Tags remain an array in JSON.\n`,
  'docs/maintenance.md': `# Maintenance notes\n\nKeep the command line surface small. Prefer a plain Node built-in over a package when the job is local file handling.\n`,
  'docs/faq.md': `# FAQ\n\n## Where is data stored?\n\nThe default ledger lives at ` + "`data/entries.json`" + `. A different path can be supplied on each command.\n\n## Can a ledger be empty?\n\nYes. An empty array is a valid ledger.\n`,
  'docs/release.md': `# Release notes\n\nThe 1.4 line keeps the file format stable and makes reports easier to script.\n`,
  'docs/weekly-routine.md': `# Weekly routine\n\nAdd entries while work is fresh, run a report on Friday, and keep an archive copy before editing old rows.\n`,
  'CHANGELOG.md': `# Changelog\n\n## 1.4.0\n\n- Added the report command.\n- Clarified the ledger examples.\n\n## 1.3.0\n\n- Added file-backed entries.\n`,
  'README.md': `# Minute Mason\n\nMinute Mason is a small time ledger with JSON storage and a command line interface. It has no runtime dependencies and runs on Node 24.\n\n## Quick start\n\n` + "`node bin/timesheet.js report`" + `\n\nExport the ledger as JSON with ` + "`node bin/timesheet.js export --format json`" + `.\n\n## Layout\n\nSource code is in ` + "`src/`" + `, the executable is in ` + "`bin/`" + `, and sample ledgers are in ` + "`data/`" + `.\n`,
  'CONTRIBUTING.md': `# Contributing\n\nUse the built-in test runner. Keep changes focused and include a small fixture for a new data shape.\n`,
  'SECURITY.md': `# Security\n\nDo not put credentials or customer exports in this repository. Report suspected issues to the project maintainer.\n`,
  'NOTICE.txt': `Minute Mason is an invented project used for local demonstrations.\n`,
  'scripts/weekly-report.js': `#!/usr/bin/env node\n'use strict';\nconst { readEntries } = require('../src/store');\nconst { summarize } = require('../src/summary');\nconst entries = readEntries(process.argv[2] || 'data/entries.json');\nprocess.stdout.write(JSON.stringify(summarize(entries), null, 2) + '\\n');\n`,
  'scripts/check-ledger.js': `#!/usr/bin/env node\n'use strict';\nconst { readEntries } = require('../src/store');\nconst entries = readEntries(process.argv[2] || 'data/entries.json');\nif (!Array.isArray(entries)) throw new Error('ledger must be an array');\nprocess.stdout.write('ledger ok: ' + entries.length + '\\n');\n`,
  'test/package.json': `{"main":"index.js"}\n`,
  'test/index.js': `'use strict';\nconst fs = require('node:fs');\nfor (const name of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js'))) require('./' + name);\n`,
  'test/export-json.test.js': `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { exportTimesheet } = require('../src/export');\n\ntest('JSON export keeps the readable array shape', () => {\n  const entries = [{ id: 'one', minutes: 12 }];\n  assert.equal(exportTimesheet(entries), JSON.stringify(entries, null, 2) + '\\n');\n});\n`,
  'test/store.test.js': `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst os = require('node:os');\nconst path = require('node:path');\nconst { readEntries, writeEntries } = require('../src/store');\n\ntest('store writes and reads a temporary ledger', () => {\n  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-mason-'));\n  try {\n    const file = path.join(dir, 'nested', 'ledger.json');\n    const entries = [{ id: 'local', minutes: 8 }];\n    writeEntries(file, entries);\n    assert.deepEqual(readEntries(file), entries);\n  } finally {\n    fs.rmSync(dir, { recursive: true, force: true });\n  }\n});\n`,
  'test/clock.test.js': `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { minutesBetween } = require('../src/clock');\n\ntest('clock counts minutes across an hour', () => {\n  assert.equal(minutesBetween('2025-01-01T09:00:00Z', '2025-01-01T10:35:00Z'), 95);\n});\n`,
  'test/summary.test.js': `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { summarize } = require('../src/summary');\n\ntest('summary groups minutes by project', () => {\n  assert.deepEqual(summarize([{ project: 'A', minutes: 4 }, { project: 'A', minutes: 6 }, { project: 'B', minutes: 2 }]), [{ project: 'A', minutes: 10 }, { project: 'B', minutes: 2 }]);\n});\n`,
  'test/cli.test.js': `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { execFileSync } = require('node:child_process');\nconst path = require('node:path');\n\ntest('report command prints a count', () => {\n  const output = execFileSync(process.execPath, [path.join(__dirname, '..', 'bin', 'timesheet.js'), 'report'], { encoding: 'utf8' });\n  assert.match(output, /"entries":2/);\n});\n`,
  'test/labels.test.js': `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { tidyLabels } = require('../src/labels');\n\ntest('labels are lowercased and trimmed', () => {\n  assert.deepEqual(tidyLabels([' Client ', 'internal']), ['client', 'internal']);\n});\n`,
  '.github/workflows/ci.yml': `name: checks\n\non:\n  push:\n  pull_request:\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24\n      - run: node --test test/\n`,
  '.github/ISSUE_TEMPLATE/bug.yml': `name: Ledger issue\ndescription: A problem with a command or stored entry\nbody:\n  - type: textarea\n    id: details\n    attributes:\n      label: What happened?\n    validations:\n      required: true\n`,
  'config/paths.example': `# Paths used by local scripts\ndata=data/entries.json\narchive=data/archive.json\n`,
  'notes/office-hours.md': `# Office hours\n\nThe sample ledger is intentionally small. Use a temporary file for experiments.\n`,
  'docs/old-import.md': `# Older import sketch\n\nThis page describes a shelved newline-delimited import experiment. It is kept for historical context.\n`,
  'data/README.md': `# Sample data\n\nThese files are small examples for local commands, not customer records.\n`
};
for (const [name, text] of Object.entries(files)) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
}
fs.chmodSync(path.join(root, 'bin/timesheet.js'), 0o755);
fs.chmodSync(path.join(root, 'scripts/weekly-report.js'), 0o755);
fs.chmodSync(path.join(root, 'scripts/check-ledger.js'), 0o755);
console.log(`wrote ${Object.keys(files).length} project files`);
