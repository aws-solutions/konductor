import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function callCli(args) {
  const result = spawnSync(process.execPath, ['bin/lantern.js', ...args], {
    cwd: process.cwd(), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('the exported CLI module is available through its package subpath', async () => {
  const { run } = await import('lantern-kit/cli');
  let output = '';
  assert.equal(run(['ready'], { write(value) { output += value; } }), 0);
  assert.equal(output, '> ready\n');
});

test('the shell command combines prefix and upper flags', () => {
  assert.equal(callCli(['--prefix', '#', '--upper', 'ready']), '# READY\n');
});

test('the shell command prints the package version', () => {
  assert.equal(callCli(['--version']), '1.4.0\n');
});
