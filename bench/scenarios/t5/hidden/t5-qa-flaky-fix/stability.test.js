const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = __dirname;
const testFiles = fs.readdirSync(repoRoot)
  .filter(name => name === 'test')
  .flatMap(() => fs.readdirSync(path.join(repoRoot, 'test')))
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => path.join('test', name));

function runSuite(environment, extraArgs = []) {
  const env = { ...process.env, ...environment };
  delete env.NODE_TEST_CONTEXT;
  const args = ['--test', '--test-timeout=5000', ...extraArgs, ...testFiles];
  try {
    execFileSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'pipe', timeout: 20000 });
  } catch (error) {
    const output = Buffer.concat([error.stdout || Buffer.alloc(0), error.stderr || Buffer.alloc(0)]).toString();
    // The child's summary lines would be read as this run's own summary by the bench's parser, so they are dropped.
    const failed = output.split('\n').filter(line => /^\s*\u2716/.test(line)).slice(0, 5).join('; ');
    throw new Error(`suite failed under ${JSON.stringify(environment)}: ${failed || error.message.slice(0, 200)}`);
  }
}

test('suite survives a near-midnight clock', () => {
  runSuite({ CHAOS: 'clock', NODE_OPTIONS: `--require=${path.join(repoRoot, 'chaos', 'preload.js')}` });
});

test('suite uses an explicit calendar zone', () => {
  runSuite({ TZ: 'Pacific/Honolulu' });
});

test('suite starts with isolated state', () => {
  runSuite({ CHAOS: 'state', NODE_OPTIONS: `--require=${path.join(repoRoot, 'chaos', 'preload.js')}` });
});

test('suite does not depend on a random draw', () => {
  runSuite({ CHAOS: 'random', CHAOS_SEED: '12345', NODE_OPTIONS: `--require=${path.join(repoRoot, 'chaos', 'preload.js')}` });
});

test('suite waits for timer work to finish', () => {
  runSuite({ CHAOS: 'timers', NODE_OPTIONS: `--require=${path.join(repoRoot, 'chaos', 'preload.js')}` });
});

test('suite passes in a clean child process', () => {
  runSuite({});
});
