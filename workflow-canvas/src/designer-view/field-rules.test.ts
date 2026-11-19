// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  agentOptions,
  fieldError,
  fieldErrors,
  fieldHint,
  textOf,
  withValue,
  type StageFieldRule,
} from './field-rules';

const NAME = '^[a-z0-9][a-z0-9-]{0,63}$';

const nameRule: StageFieldRule = {
  key: 'name',
  type: 'name',
  required: true,
  max_length: 64,
  pattern: NAME,
  reserved: ['start', 'end', 'run', 'halt'],
};
const promptRule: StageFieldRule = {
  key: 'prompt',
  type: 'text',
  required: false,
  min_length: 1,
  max_length: 32768,
  excludes: ['prompt_file'],
};
const promptFileRule: StageFieldRule = {
  key: 'prompt_file',
  type: 'path',
  required: false,
  pattern: '^(?!/)[^\\\\]+$',
  excludes: ['prompt'],
};

describe('fieldError', () => {
  it('is undefined for a value that keeps every rule', () => {
    expect(fieldError(nameRule, { name: 'draft' })).toBeUndefined();
  });

  it('asks for a required key the stage does not have', () => {
    expect(fieldError(nameRule, {})).toBe('A stage needs this key.');
  });

  it('lets an optional key be left out', () => {
    expect(fieldError(promptRule, {})).toBeUndefined();
  });

  it('refuses a reserved value', () => {
    expect(fieldError(nameRule, { name: 'end' })).toBe('end is reserved.');
  });

  it('refuses a value shorter than the least length', () => {
    const rule = { ...promptRule, min_length: 3, excludes: [] };

    expect(fieldError(rule, { prompt: 'ab' })).toBe(
      'Use at least 3 characters.',
    );
    expect(fieldError(promptRule, { prompt: '' })).toBe(
      'Use at least 1 character.',
    );
  });

  it('refuses a value longer than the most length, counting code points', () => {
    const rule: StageFieldRule = {
      key: 'x',
      type: 'text',
      required: false,
      max_length: 2,
    };

    expect(fieldError(rule, { x: '😀😀' })).toBeUndefined();
    expect(fieldError(rule, { x: '😀😀😀' })).toBe('Use at most 2 characters.');
  });

  it('refuses a value that does not match the whole pattern, saying the form of its type', () => {
    expect(fieldError(nameRule, { name: 'Draft' })).toBe(
      'Use lower-case letters, digits and hyphens, starting with a letter or a digit.',
    );
    expect(fieldError(promptFileRule, { prompt_file: '/etc/x' })).toBe(
      'Use a relative path inside the project, with / between its parts.',
    );
    expect(
      fieldError(
        { key: 'x', type: 'colour', required: false, pattern: 'a+' },
        { x: 'ab' },
      ),
    ).toBe('The value is not of the form this key takes.');
  });

  it('matches the pattern against the whole value, even with no anchors', () => {
    const rule: StageFieldRule = {
      key: 'x',
      type: 'name',
      required: false,
      pattern: 'a|b',
    };

    expect(fieldError(rule, { x: 'b' })).toBeUndefined();
    expect(fieldError(rule, { x: 'ab' })).toBeDefined();
  });

  it('leaves a pattern that does not compile to the server', () => {
    const rule: StageFieldRule = {
      key: 'x',
      type: 'name',
      required: false,
      pattern: '(',
    };

    expect(fieldError(rule, { x: 'anything' })).toBeUndefined();
  });

  it('refuses both keys of an excludes pair, and neither alone', () => {
    const both = { prompt: 'Plan it.', prompt_file: 'prompts/plan.md' };

    expect(fieldError(promptRule, both)).toBe(
      'Use prompt or prompt_file, not both.',
    );
    expect(fieldError(promptFileRule, both)).toBe(
      'Use prompt_file or prompt, not both.',
    );
    expect(fieldError(promptRule, { prompt: 'Plan it.' })).toBeUndefined();
    expect(
      fieldError(promptFileRule, { prompt_file: 'prompts/plan.md' }),
    ).toBeUndefined();
  });

  it('reads only own keys, so a key named like a property of every object is not taken as set', () => {
    const rule: StageFieldRule = {
      key: 'constructor',
      type: 'constructor',
      required: true,
    };

    expect(fieldError(rule, {})).toBe('A stage needs this key.');
    expect(fieldError({ ...rule, pattern: 'a' }, { constructor: 'b' })).toBe(
      'The value is not of the form this key takes.',
    );
  });
});

describe('fieldErrors', () => {
  it('holds the error of each key that has one', () => {
    expect(
      fieldErrors([nameRule, promptRule, promptFileRule], {
        prompt: 'x',
        prompt_file: 'p.md',
      }),
    ).toEqual({
      name: 'A stage needs this key.',
      prompt: 'Use prompt or prompt_file, not both.',
      prompt_file: 'Use prompt_file or prompt, not both.',
    });
  });

  it('is empty when every key is fine', () => {
    expect(fieldErrors([nameRule, promptRule], { name: 'draft' })).toEqual({});
  });
});

describe('withValue', () => {
  it('sets a key, and drops it for an empty text, leaving the others', () => {
    const values = { name: 'draft', later_key: 'kept' };

    expect(withValue(values, 'prompt', 'Plan it.')).toEqual({
      ...values,
      prompt: 'Plan it.',
    });
    expect(withValue(values, 'name', '')).toEqual({ later_key: 'kept' });
    expect(values).toEqual({ name: 'draft', later_key: 'kept' });
  });
});

describe('textOf', () => {
  it('reads an own key only', () => {
    expect(textOf({ a: 'x' }, 'a')).toBe('x');
    expect(textOf({}, 'toString')).toBeUndefined();
  });
});

describe('fieldHint', () => {
  it('says whether the key is required, its lengths and the keys it excludes', () => {
    expect(fieldHint(nameRule)).toBe('Required. At most 64 characters.');
    expect(fieldHint(promptRule)).toBe(
      'Optional. At most 32768 characters. Not with prompt_file.',
    );
    expect(
      fieldHint({ key: 'x', type: 'text', required: false, min_length: 2 }),
    ).toBe('Optional. At least 2 characters.');
  });
});

describe('agentOptions', () => {
  const agents = [
    { id: 'k-architect', summary: 'Designs' },
    { id: 'k-developer', summary: 'Code' },
  ];

  it('is the list when the current agent is on it, or there is none', () => {
    expect(agentOptions(agents, 'k-developer')).toBe(agents);
    expect(agentOptions(agents, undefined)).toBe(agents);
  });

  it('puts a current agent that is not on the list first', () => {
    expect(agentOptions(agents, 'my-agent').map((agent) => agent.id)).toEqual([
      'my-agent',
      'k-architect',
      'k-developer',
    ]);
  });
});
