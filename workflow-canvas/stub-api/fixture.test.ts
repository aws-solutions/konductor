// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { FIXTURES } from './core/sample.ts';
import { stubWorkflow, StubWorkflowError } from './fixture.ts';

describe('stubWorkflow', () => {
  it('is hello when STUB_WORKFLOW is unset or empty', () => {
    expect(stubWorkflow({})).toBe('hello');
    expect(stubWorkflow({ STUB_WORKFLOW: '' })).toBe('hello');
  });

  it.each(Object.keys(FIXTURES))('reads STUB_WORKFLOW=%s', (name) => {
    expect(stubWorkflow({ STUB_WORKFLOW: name })).toBe(name);
  });

  it.each(['other', 'Hello', 'hello ', '__proto__', 'toString'])(
    'refuses STUB_WORKFLOW=%s, and lists the fixtures',
    (value) => {
      expect(() => stubWorkflow({ STUB_WORKFLOW: value })).toThrow(
        StubWorkflowError,
      );
      expect(() => stubWorkflow({ STUB_WORKFLOW: value })).toThrow(
        /hello, untrusted, blocked, busy/,
      );
    },
  );
});
