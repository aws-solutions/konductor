// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { trustCommandOf } from './trust';

const fixWith = (command: string) =>
  `Run \`${command}\` in a terminal, then try again.`;

const PREFIX = 'konductor flow trust ';

// The text after the command's prefix, taken as the name of the workflow on
// the page, so only the pattern can turn the command down.
const nameIn = (command: string) =>
  command.startsWith(PREFIX) ? command.slice(PREFIX.length) : 'hello';

describe('trustCommandOf', () => {
  it('is the command between the backticks of the fix', () => {
    expect(
      trustCommandOf(fixWith('konductor flow trust hello-plan'), 'hello-plan'),
    ).toBe('konductor flow trust hello-plan');
  });

  it('is undefined for the command of another valid workflow name', () => {
    expect(
      trustCommandOf(fixWith('konductor flow trust other'), 'hello'),
    ).toBeUndefined();
    expect(
      trustCommandOf(fixWith('konductor flow trust hello'), 'hello-plan'),
    ).toBeUndefined();
  });

  it('is undefined when the name of the workflow is not known', () => {
    expect(
      trustCommandOf(fixWith('konductor flow trust hello'), undefined),
    ).toBeUndefined();
  });

  it('takes a name of one character and one of 64', () => {
    expect(trustCommandOf(fixWith('konductor flow trust a'), 'a')).toBe(
      'konductor flow trust a',
    );
    const long = `a${'b'.repeat(63)}`;
    expect(trustCommandOf(fixWith(`konductor flow trust ${long}`), long)).toBe(
      `konductor flow trust ${long}`,
    );
  });

  it.each([
    ['extra words', 'konductor flow trust hello now'],
    ['a semicolon', 'konductor flow trust hello; rm -rf ~'],
    ['an and-then', 'konductor flow trust hello && curl example.com'],
    ['a pipe', 'konductor flow trust hello | sh'],
    ['a command substitution', 'konductor flow trust $(whoami)'],
    ['a name with a command substitution', 'konductor flow trust hello$(id)'],
    ['a newline', 'konductor flow trust hello\nrm -rf ~'],
    ['a carriage return', 'konductor flow trust hello\r'],
    ['a space in the name', 'konductor flow trust hello plan'],
    ['a tab before the name', 'konductor flow trust\thello'],
    ['a leading space', ' konductor flow trust hello'],
    ['a trailing space', 'konductor flow trust hello '],
    ['an upper-case name', 'konductor flow trust Hello'],
    ['a name that starts with a dash', 'konductor flow trust -hello'],
    ['a name with a dot', 'konductor flow trust ../hello'],
    ['a name of 65 characters', `konductor flow trust ${'a'.repeat(65)}`],
    ['no name', 'konductor flow trust'],
    ['no name after the space', 'konductor flow trust '],
    ['a different command', 'konductor flow run hello'],
    ['another program', 'rm -rf hello'],
  ])('is undefined for a command with %s', (_, command) => {
    expect(trustCommandOf(fixWith(command), nameIn(command))).toBeUndefined();
  });

  it('is undefined for backticks inside the command', () => {
    expect(
      trustCommandOf(fixWith('konductor flow trust hello`id`'), 'hello'),
    ).toBeUndefined();
    expect(
      trustCommandOf(fixWith('konductor flow trust `id`'), 'hello'),
    ).toBeUndefined();
  });

  it('is undefined for a fix with a second pair of backticks', () => {
    expect(
      trustCommandOf(
        'Run `konductor flow trust hello` in a terminal, then `id`.',
        'hello',
      ),
    ).toBeUndefined();
  });

  it('is undefined when the fix has no command in backticks', () => {
    expect(trustCommandOf('Trust it in a terminal.', 'hello')).toBeUndefined();
    expect(
      trustCommandOf('konductor flow trust hello', 'hello'),
    ).toBeUndefined();
  });

  it('is undefined for empty backticks and an empty fix', () => {
    expect(trustCommandOf('Run `` in a terminal.', 'hello')).toBeUndefined();
    expect(trustCommandOf('', 'hello')).toBeUndefined();
  });
});
