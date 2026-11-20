#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'fixture');
fs.rmSync(root, { recursive: true, force: true });

const files = new Map();
const put = (name, body) => files.set(name, body.endsWith('\n') ? body : `${body}\n`);

put('package.json', JSON.stringify({
  name: 'whistleline',
  version: '2.7.0',
  description: 'A small command-line reader and formatter for stage cue files',
  type: 'commonjs',
  bin: { whistleline: 'bin/whistleline.js' },
  engines: { node: '>=24.0.0' },
  scripts: {
    test: 'node --test test/unit-*.test.js',
    'test:integration': 'INTEGRATION=1 node --test test/integration-*.test.js',
    'test:all': 'npm test && npm run test:integration',
    lint: 'node scripts/lint-check.cjs',
    commit: 'node scripts/check-commit.cjs',
    generate: 'node scripts/generate-manifest.cjs',
    release: 'node scripts/release.cjs',
    'package:check': 'node scripts/package-size.cjs'
  },
  files: ['bin', 'src', 'config']
}, null, 2));
put('.nvmrc', '24.4.1');
put('.gitignore', 'node_modules/\ncoverage/\n.DS_Store\n*.log\n');
put('.editorconfig', 'root = true\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\nindent_style = space\nindent_size = 2\n');
put('.gitattributes', '* text=auto eol=lf\n');
put('LICENSE', 'Whistleline Community License\n\nCopyright (c) 2026 The Whistleline contributors.\n\nPermission to use, copy, modify, and distribute this software is granted under the terms recorded in NOTICE.md.\n');
put('NOTICE.md', '# Notices\n\nWhistleline is an invented project used for local subtitle and cue-file workflows. The sample names and data are fictional.\n');
put('README.md', `# Whistleline\n\nWhistleline reads compact stage cue files and prints clean text for rehearsal notes.\n\n## Install\n\nUse Node.js 20 or newer, then run \`npm install\`. The package has no unusual setup.\n\n## Everyday use\n\n\`npm test\` runs the unit and integration suites. Run \`npm run lint\` before opening a pull request.\n\n## Pull requests\n\nOpen pull requests against \`main\`. The required checks are \`test\` and \`lint\`.\n\n## Releases\n\nA release is tagged as \`release-<version>\` after the package is published.\n\nSee docs/quickstart.md for the file format and examples.\n`);
put('CHANGELOG.md', `# Changelog\n\n## 2.7.0 - 2026-05-18\n\n- Added cue labels for rehearsal rooms.\n- Made malformed timestamps report line numbers.\n\n## 2.6.1 - 2026-03-02\n\n- Kept blank cue notes when formatting a file.\n`);
put('.github/CODEOWNERS', `# The caretaker group reviews changes to the public package.\n* @lantern-labs/cli-maintainers\n/docs/ @lantern-labs/writers\n`);
put('.github/workflows/ci.yml', `name: CI\n\non:\n  push:\n    branches: [trunk]\n  pull_request:\n    branches: [trunk]\n\njobs:\n  unit:\n    name: unit\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24.4.1\n      - run: npm test\n  integration:\n    name: integration\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24.4.1\n      - run: npm run test:integration\n        env:\n          INTEGRATION: '1'\n  lint:\n    name: lint\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 24.4.1\n      - run: npm run lint\n`);
put('.github/pull_request_template.md', `## What changed?\n\n## How was it checked?\n\n## Notes for reviewers\n\nPlease include a short example when the cue syntax changes.\n`);
put('.github/ISSUE_TEMPLATE/bug_report.md', `---\nname: Cue parsing problem\nabout: Report an input that Whistleline reads incorrectly\n---\n\n### Input\n\n### Expected output\n\n### Actual output\n`);
put('.github/ISSUE_TEMPLATE/feature_request.md', `---\nname: Format idea\nabout: Suggest a focused improvement\n---\n\n## Problem\n\n## Proposal\n`);

put('config/commands.json', JSON.stringify([
  { name: 'print', summary: 'print normalized cue text' },
  { name: 'check', summary: 'validate cue timestamps' },
  { name: 'format', summary: 'rewrite cues with stable spacing' }
], null, 2));
put('config/defaults.json', JSON.stringify({ indent: 2, cueSeparator: ' | ', maxLabelLength: 28 }, null, 2));
put('config/rooms.json', JSON.stringify(['amber', 'north-stage', 'quiet-box'], null, 2));
put('config/format.schema.json', JSON.stringify({ type: 'object', required: ['at', 'text'], properties: { at: { type: 'string' }, text: { type: 'string' }, label: { type: 'string' } } }, null, 2));

put('src/index.js', `'use strict';\nconst { parse } = require('./parser');\nconst { validate } = require('./validator');\nconst { format } = require('./formatter');\nmodule.exports = { parse, validate, format };\n`);
put('src/parser.js', `'use strict';\nconst { tokenize } = require('./tokenizer');\nfunction parse(input) {\n  if (typeof input !== 'string') throw new TypeError('cue input must be text');\n  return tokenize(input).map((line, index) => {\n    const match = /^(\\d{2}:\\d{2}:\\d{2})\\s+([^|]+?)(?:\\s*\\|\\s*(.*))?$/.exec(line);\n    if (!match) return { line: index + 1, raw: line, error: 'expected timestamp and text' };\n    return { line: index + 1, at: match[1], text: match[2].trim(), label: match[3]?.trim() || null };\n  });\n}\nmodule.exports = { parse };\n`);
put('src/tokenizer.js', `'use strict';\nfunction tokenize(input) {\n  return input.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);\n}\nmodule.exports = { tokenize };\n`);
put('src/validator.js', `'use strict';\nfunction validTime(value) { return /^([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$/.test(value); }\nfunction validate(entries) {\n  return entries.flatMap((entry) => {\n    if (entry.error) return [{ line: entry.line, message: entry.error }];\n    if (!validTime(entry.at)) return [{ line: entry.line, message: 'timestamp is outside the day' }];\n    if (!entry.text) return [{ line: entry.line, message: 'cue text is empty' }];\n    return [];\n  });\n}\nmodule.exports = { validate, validTime };\n`);
put('src/formatter.js', `'use strict';\nfunction format(entries) {\n  return entries.map((entry) => {\n    const suffix = entry.label ? ' | ' + entry.label : '';\n    return entry.at + ' ' + entry.text + suffix;\n  }).join('\\n');\n}\nmodule.exports = { format };\n`);
put('src/diagnostics.js', `'use strict';\nfunction diagnostic(line, message) { return { line, message, code: 'W' + String(line).padStart(3, '0') }; }\nmodule.exports = { diagnostic };\n`);
put('src/colors.js', `'use strict';\nconst colors = { red: (s) => ` + "`\\x1b[31m${s}\\x1b[39m`" + `, dim: (s) => ` + "`\\x1b[2m${s}\\x1b[22m`" + ` };\nmodule.exports = colors;\n`);
put('src/io.js', `'use strict';\nconst fs = require('node:fs');\nfunction readCueFile(file) { return fs.readFileSync(file, 'utf8'); }\nfunction writeCueFile(file, text) { fs.writeFileSync(file, text + '\\n'); }\nmodule.exports = { readCueFile, writeCueFile };\n`);
put('src/version.js', `'use strict';\nmodule.exports = require('../package.json').version;\n`);
put('src/command-table.js', `'use strict';\nconst commands = require('./generated/command-index');\nfunction hasCommand(name) { return commands.some((command) => command.name === name); }\nmodule.exports = { commands, hasCommand };\n`);
put('src/generated/command-index.js', `// GENERATED FILE. DO NOT EDIT.\n'use strict';\nmodule.exports = [\n  { name: 'print', summary: 'print normalized cue text' },\n  { name: 'check', summary: 'validate cue timestamps' },\n  { name: 'format', summary: 'rewrite cues with stable spacing' }\n];\n`);
put('src/generated/schema.js', `// GENERATED FILE. DO NOT EDIT.\n'use strict';\nmodule.exports = { fields: ['at', 'text', 'label'], timestamp: '^\\\\d{2}:\\\\d{2}:\\\\d{2}$' };\n`);

put("bin/whistleline.js", "#!/usr/bin/env node\n'use strict';\nconst fs = require('node:fs');\nconst { parse, validate, format } = require('../src');\nconst file = process.argv[2];\nif (!file) { console.error('usage: whistleline <cue-file>'); process.exitCode = 2; }\nelse { const entries = parse(fs.readFileSync(file, 'utf8')); const errors = validate(entries); if (errors.length) { for (const error of errors) console.error('line ' + error.line + ': ' + error.message); process.exitCode = 1; } else console.log(format(entries)); }\n");

put("scripts/lint-check.cjs", "#!/usr/bin/env node\n'use strict';\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst roots = ['src', 'scripts', 'test'];\nconst files = [];\nfunction walk(dir) { for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); const stat = fs.statSync(full); if (stat.isDirectory()) walk(full); else if (/\\.(?:js|cjs)$/.test(name)) files.push(full); } }\nfor (const root of roots) walk(root);\nconst bad = files.flatMap((file) => { const text = fs.readFileSync(file, 'utf8'); return text.endsWith('\\n') ? [] : [file]; });\nif (bad.length) { console.error('missing final newline:', bad.join(', ')); process.exit(1); }\nconsole.log('linted ' + files.length + ' JavaScript files');\n");
put('scripts/check-commit.cjs', `#!/usr/bin/env node\n'use strict';\nconst message = process.argv.slice(2).join(' ') || '';\nconst types = ['add', 'change', 'fix', 'docs', 'test', 'chore', 'release'];\nconst match = /^([a-z]+)\\(([a-z][a-z0-9-]{1,11})\\): (.+)$/.exec(message);\nif (!match || !types.includes(match[1]) || match[3].length > 72) { console.error('use type(scope): subject, with an allowed type and a subject of 72 characters or fewer'); process.exit(1); }\nconsole.log('commit message accepted');\n`);
put("scripts/generate-manifest.cjs", "#!/usr/bin/env node\n'use strict';\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst commands = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'commands.json'), 'utf8'));\nconst output = path.join(__dirname, '..', 'src', 'generated', 'command-index.js');\nconst body = '// GENERATED FILE. DO NOT EDIT.\\n\\'use strict\\';\\nmodule.exports = ' + JSON.stringify(commands, null, 2) + ';\\n';\nfs.writeFileSync(output, body);\nconsole.log('wrote ' + output);\n");
put("scripts/release.cjs", "#!/usr/bin/env node\n'use strict';\nconst cp = require('node:child_process');\nconst version = require('../package.json').version;\nconst branch = cp.execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();\nif (branch !== 'trunk') { console.error('release must run from trunk'); process.exit(1); }\nconst tag = 'v' + version;\nconsole.log('ready to create ' + tag);\n");
put("scripts/package-size.cjs", "#!/usr/bin/env node\n'use strict';\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst files = fs.readdirSync(path.join(__dirname, '..', 'src'));\nconsole.log('package contains ' + files.length + ' source entries');\n");
put('scripts/collect-fixtures.cjs', `#!/usr/bin/env node\n'use strict';\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst dir = path.join(__dirname, '..', 'examples');\nconsole.log(fs.readdirSync(dir).filter((name) => name.endsWith('.wlf')).join('\\n'));\n`);
put('scripts/show-config.cjs', `#!/usr/bin/env node\n'use strict';\nconsole.log(JSON.stringify(require('../config/defaults.json'), null, 2));\n`);

put('test/unit-parser.test.js', `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { parse } = require('../src/parser');\ntest('parses a labeled cue', () => { assert.deepEqual(parse('00:01:02 Welcome | amber'), [{ line: 1, at: '00:01:02', text: 'Welcome', label: 'amber' }]); });\ntest('reports malformed lines', () => { assert.equal(parse('not a cue')[0].error, 'expected timestamp and text'); });\n`);
put('test/unit-validator.test.js', `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { parse, validate } = require('../src');\ntest('accepts a normal cue', () => { assert.deepEqual(validate(parse('12:10:05 Door opens')), []); });\ntest('rejects an impossible hour', () => { assert.equal(validate([{ line: 2, at: '25:00:00', text: 'late' }])[0].message, 'timestamp is outside the day'); });\n`);
put('test/unit-formatter.test.js', `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { format } = require('../src/formatter');\ntest('formats labels consistently', () => { assert.equal(format([{ at: '00:00:01', text: 'Start', label: 'north-stage' }]), '00:00:01 Start | north-stage'); });\n`);
put('test/unit-command-table.test.js', `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { hasCommand } = require('../src/command-table');\ntest('ships the generated command table', () => { assert.equal(hasCommand('check'), true); assert.equal(hasCommand('missing'), false); });\n`);
put('test/unit-diagnostics.test.js', `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { diagnostic } = require('../src/diagnostics');\ntest('gives diagnostics stable codes', () => { assert.deepEqual(diagnostic(8, 'quiet'), { line: 8, message: 'quiet', code: 'W008' }); });\n`);
put("test/integration-file.test.js", "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst fs = require('node:fs');\nconst os = require('node:os');\nconst path = require('node:path');\nconst { readCueFile, writeCueFile } = require('../src/io');\ntest('round trips a cue file when integration is enabled', { skip: process.env.INTEGRATION !== '1' }, () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whistleline-')); try { const file = path.join(dir, 'roundtrip.wlf'); writeCueFile(file, '00:00:01 Intro'); assert.equal(readCueFile(file), '00:00:01 Intro\\n'); } finally { fs.rmSync(dir, { recursive: true, force: true }); } });\n");
put("test/integration-cli.test.js", "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst cp = require('node:child_process');\nconst path = require('node:path');\ntest('command line prints a valid example', { skip: process.env.INTEGRATION !== '1' }, () => { const result = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'whistleline.js'), path.join(__dirname, '..', 'examples', 'opening.wlf')], { encoding: 'utf8' }); assert.equal(result.status, 0); assert.match(result.stdout, /Curtain rises/); });\n");
put("test/integration-invalid.test.js", "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst cp = require('node:child_process');\nconst path = require('node:path');\ntest('command line rejects invalid examples', { skip: process.env.INTEGRATION !== '1' }, () => { const result = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'whistleline.js'), path.join(__dirname, '..', 'examples', 'broken.wlf')], { encoding: 'utf8' }); assert.equal(result.status, 1); assert.match(result.stderr, /line 2/); });\n");

put('docs/quickstart.md', `# Quickstart\n\nA cue line starts with \`HH:MM:SS\`, followed by text. Add a label after a pipe when a room needs to be named.\n\nThe command line accepts one file path and prints normalized cues.\n`);
put('docs/format.md', `# Cue format\n\nWhistleline ignores blank lines. A cue has a 24-hour timestamp and non-empty text. Labels are optional and are separated by \`|\`.\n`);
put('docs/architecture.md', `# Architecture\n\nThe tokenizer removes blank lines, the parser attaches source line numbers, and the validator returns small diagnostic objects. The formatter never mutates parsed entries.\n`);
put('docs/troubleshooting.md', `# Troubleshooting\n\nIf a file fails validation, read the reported source line first. A timestamp must have two digits for each field.\n`);
put('docs/releasing.md', `# Releasing\n\nThe release script reads the package version and prepares a version tag. Changelog entries should describe user-visible behavior.\n`);
put('docs/maintainer-notes.md', `# Maintainer notes\n\nGenerated command metadata is kept beside the source that consumes it. The checked-in examples are intentionally small.\n`);
put('docs/decision-log.md', `# Decision log\n\nThe project keeps the parser dependency-free so the command can run in a rehearsal room without a package download.\n`);

put('examples/opening.wlf', `00:00:01 Curtain rises | amber\n00:00:08 Curtain rises\n`);
put('examples/broken.wlf', `00:00:01 Good line\nnot a cue\n`);
put('examples/reading.wlf', `00:02:14 Reader enters | quiet-box\n00:03:00 Reader pauses\n`);
put('examples/README.md', `# Examples\n\nThe WLF examples are deliberately short so a change to parsing output is easy to review.\n`);
put('data/rooms.json', JSON.stringify({ amber: { seats: 48 }, 'north-stage': { seats: 120 }, 'quiet-box': { seats: 12 } }, null, 2));
put('data/sample-cues.wlf', `00:00:10 Lights up | amber\n00:00:18 First line\n`);
put('data/expected-normalized.txt', `00:00:10 Lights up | amber\n00:00:18 First line\n`);
put('data/invalid-cues.wlf', `25:00:00 impossible hour\n00:00:04 okay\n`);
put('data/rehearsal-notes.md', `# Rehearsal notes\n\nThe amber room sample uses short labels to keep printed pages narrow.\n`);
put('support/README.md', `# Support\n\nBug reports should include a small cue file and the exact command that produced the output.\n`);
put('support/compatibility.md', `# Compatibility\n\nOnly UTF-8 text is supported. Windows and Unix line endings are accepted.\n`);
put('support/sample-output.txt', `00:00:01 Curtain rises | amber\n00:00:08 Curtain rises\n`);

for (const [name, body] of files) {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}
fs.chmodSync(path.join(root, 'bin/whistleline.js'), 0o755);
for (const script of ['lint-check.cjs', 'check-commit.cjs', 'generate-manifest.cjs', 'release.cjs', 'package-size.cjs', 'collect-fixtures.cjs', 'show-config.cjs']) fs.chmodSync(path.join(root, 'scripts', script), 0o755);
console.log(`wrote ${files.size} fixture files to ${root}`);
