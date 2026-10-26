// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { DiagnosticView } from '../../api/types';
import { draftOf } from './draft';
import { hasErrors, problemsFor, problemsOf } from './problems';

const DRAFT = draftOf([
  { name: 'write', agent: 'k-developer' },
  { name: 'write', agent: 'k-tpm' },
]);

function finding(path: string, message = 'Wrong.'): DiagnosticView {
  return { message, path, line: 1, severity: 'error' };
}

describe('problemsOf', () => {
  it('puts a finding about a stage by its place in the list on that stage', () => {
    const [problem] = problemsOf([finding('stages[1].name')], DRAFT);

    expect(problem).toEqual({
      message: 'Wrong.',
      stageId: 's2',
      field: 'name',
    });
  });

  it('puts a finding about a stage by its name on the first stage of that name', () => {
    const [problem] = problemsOf([finding('stages.write.agent')], DRAFT);

    expect(problem).toMatchObject({ stageId: 's1', field: 'agent' });
  });

  it.each([
    ['the whole text', ''],
    ['the intent', 'intent'],
    ['the list of stages', 'stages'],
    ['a stage without a field', 'stages[0]'],
    ['a stage that is not there', 'stages[7].name'],
    ['a name that no stage has', 'stages.gone.name'],
    ['a field the Designer does not edit', 'stages.write.mcp'],
  ])('leaves a finding about %s without a stage', (_, path) => {
    const [problem] = problemsOf([finding(path)], DRAFT);

    expect(problem).toEqual({ message: 'Wrong.' });
  });
});

describe('problemsFor', () => {
  it('lists the messages about one field of one stage', () => {
    const problems = problemsOf(
      [
        finding('stages[0].name', 'One.'),
        finding('stages[0].agent', 'Two.'),
        finding('stages[1].name', 'Three.'),
        finding('stages[0].name', 'Four.'),
      ],
      DRAFT,
    );

    expect(problemsFor(problems, 's1', 'name')).toEqual(['One.', 'Four.']);
    expect(problemsFor(problems, 's2', 'agent')).toEqual([]);
  });
});

describe('hasErrors', () => {
  it('is true only for a finding of severity error', () => {
    const warning: DiagnosticView = { ...finding('x'), severity: 'warning' };

    expect(hasErrors([warning])).toBe(false);
    expect(hasErrors([warning, finding('x')])).toBe(true);
    expect(hasErrors([])).toBe(false);
  });
});
