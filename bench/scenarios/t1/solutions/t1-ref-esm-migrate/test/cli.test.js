import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../cli.js';

function capture(args) {
  let output = '';
  run(args, { write(value) { output += value; } });
  return output;
}

test('cli accepts a prefix and upper-case flag', () => {
  assert.equal(capture(['--prefix', '#', '--upper', 'hello', 'world']), '# HELLO WORLD\n');
});

test('cli prints its version', () => {
  assert.equal(capture(['--version']), '1.4.0\n');
});
