// Makes or cleans an isolated kiro-cli HOME with the bench's own sandbox helpers.
//   node rc-home.js make <home> | clean <home>
const path = require('node:path');
const sb = require(path.join(process.env.BENCH_REPO, 'bench/runner/lib/sandbox.js'));
const [op, home] = process.argv.slice(2);
if (op === 'make') { sb.emptyKiroHome(home); sb.copyAuthDb(sb.defaultAuthDb(), home); }
else if (op === 'clean') sb.removeAuthCopy(home);
else process.exit(64);
