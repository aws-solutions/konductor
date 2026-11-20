'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname);
const guide = fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8');
const linesWithoutHistoricalNotes = guide.split(/\r?\n/).filter((line) => !/(?:old|outdated|no longer|previously|formerly|stale|wrong)/i.test(line)).join('\n');

function has(pattern, message) { assert.match(guide, pattern, message); }
function hasCurrent(pattern, message) { assert.match(linesWithoutHistoricalNotes, pattern, message); }

test('names the supported Node.js version', () => hasCurrent(/Node(?:\.js)?\s*24(?:\.4\.1)?\b/i, 'the guide should name Node.js 24'));
test('does not present the README Node version as current', () => assert.doesNotMatch(linesWithoutHistoricalNotes, /Node(?:\.js)?\s*20\b/i));
test('documents the unit test command and its scope', () => { has(/`npm test`/i); hasCurrent(/`npm test`[^\n]*(?:unit|library)[^\n]*/i, 'npm test should be described as the unit suite'); });
test('does not repeat the all-tests README claim', () => assert.doesNotMatch(linesWithoutHistoricalNotes, /`npm test`[^\n]*(?:all|every|unit and integration)[^\n]*/i));
test('documents the integration command and environment', () => hasCurrent(/`INTEGRATION=1\s+npm run test:integration`/i, 'integration requires its environment flag'));
test('documents the lint command', () => hasCurrent(/`npm run lint`/i, 'the lint command is missing'));
test('lists every allowed commit type', () => { for (const type of ['add', 'change', 'fix', 'docs', 'test', 'chore', 'release']) assert.match(guide, new RegExp('\\b' + type + '\\b', 'i'), `missing commit type ${type}`); });
test('requires a commit scope', () => hasCurrent(/scope[^\n]{0,80}(?:required|must|need)/i, 'the scope rule is missing'));
test('sets the commit subject limit', () => hasCurrent(/72\s*(?:characters|chars)/i));
test('names trunk as the pull request base', () => hasCurrent(/(?:pull requests?|PRs?)[^\n]{0,100}trunk|trunk[^\n]{0,100}(?:pull requests?|PRs?)/i));
test('does not present main as the pull request base', () => assert.doesNotMatch(linesWithoutHistoricalNotes, /(?:pull requests?|PRs?)[^\n]{0,100}\bmain\b|\bmain\b[^\n]{0,100}(?:pull requests?|PRs?)/i));
test('names all required CI jobs', () => { hasCurrent(/(?:required|must pass|blocking)[^\n]{0,120}(?:jobs?|checks?)/i, 'required CI jobs are not identified'); for (const job of ['unit', 'integration', 'lint']) assert.match(guide, new RegExp('\\b' + job + '\\b', 'i'), `missing CI job ${job}`); });
test('explains generated source ownership', () => { hasCurrent(/`src\/generated\//i); hasCurrent(/(?:do not edit|never edit|not edit)[^\n]{0,80}(?:generated|those files|it)/i); hasCurrent(/`npm run generate`/i); });
test('documents the release branch restriction', () => hasCurrent(/release[^\n]{0,100}\btrunk\b|\btrunk\b[^\n]{0,100}release/i));
test('documents the version tag format', () => hasCurrent(/`v<version>`|v<version>\s+(?:tag|tags)|(?:tag|tags)[^\n]{0,60}v<version>/i));
test('does not present the old release tag as current', () => assert.doesNotMatch(linesWithoutHistoricalNotes, /`release-<version>`|release-<version>/i));
test('names the package owner team', () => hasCurrent(/@lantern-labs\/cli-maintainers/));
test('only names executable package commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const name of guide.matchAll(/npm run ([a-z0-9:_-]+)/gi)) assert.ok(pkg.scripts[name[1]], `missing npm script ${name[1]}`);
  for (const file of guide.matchAll(/node scripts\/([a-z0-9._-]+)/gi)) assert.ok(fs.existsSync(path.join(root, 'scripts', file[1])), `missing script ${file[1]}`);
});
