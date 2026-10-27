// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { DiagnosticView } from '../../api/types';
import { draftOf } from './draft';
import {
  errorsOf,
  hasErrors,
  joinMessages,
  listedOf,
  notesOf,
  problemsFor,
  problemsOf,
} from './problems';

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
      severity: 'error',
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

    expect(problem).toEqual({ message: 'Wrong.', severity: 'error' });
  });
});

describe('a stage name that two stages share', () => {
  const draft = draftOf([
    { name: 'review', agent: 'k-developer' },
    { name: 'review', agent: 'k-tpm' },
  ]);
  const duplicate = finding(
    'stages[1].name',
    'The stage name `review` is already used.',
  );

  it('marks the name field of the earlier stage too, not only that of the later one the server names', () => {
    const problems = problemsOf([duplicate], draft);

    expect(problemsFor(problems, 's2', 'name')).toHaveLength(1);
    expect(problemsFor(problems, 's1', 'name').map((p) => p.message)).toEqual([
      duplicate.message,
    ]);
  });

  it('is still one problem in a list, so the list says it once', () => {
    const problems = problemsOf([duplicate], draft);

    expect(listedOf(problems).map((p) => p.stageId)).toEqual(['s2']);
  });

  it('marks no other field of the earlier stage', () => {
    expect(problemsFor(problemsOf([duplicate], draft), 's1', 'agent')).toEqual(
      [],
    );
  });

  it('does not repeat a message on a stage that has a finding of its own', () => {
    const both = [
      finding('stages[0].name', 'Wrong.'),
      finding('stages[1].name', 'Wrong.'),
    ];

    const problems = problemsOf(both, draft);

    expect(problemsFor(problems, 's1', 'name')).toHaveLength(1);
    expect(problemsFor(problems, 's2', 'name')).toHaveLength(1);
  });

  it('joins the same message once when several stages repeat a name', () => {
    const three = draftOf([
      { name: 'review', agent: 'k-developer' },
      { name: 'review', agent: 'k-developer' },
      { name: 'review', agent: 'k-developer' },
    ]);
    const problems = problemsOf(
      [
        duplicate,
        finding('stages[2].name', 'The stage name `review` is already used.'),
      ],
      three,
    );

    expect(joinMessages(problemsFor(problems, 's1', 'name'))).toBe(
      duplicate.message,
    );
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

    expect(problemsFor(problems, 's1', 'name').map((p) => p.message)).toEqual([
      'One.',
      'Four.',
    ]);
    expect(problemsFor(problems, 's2', 'agent')).toEqual([]);
  });
});

describe('severity', () => {
  const warning: DiagnosticView = {
    ...finding('stages[0].name', 'Careful.'),
    severity: 'warning',
  };
  const note: DiagnosticView = {
    ...finding('stages[0].agent', 'FYI.'),
    severity: 'info',
  };
  const problems = problemsOf(
    [finding('stages[0].name'), warning, note],
    DRAFT,
  );

  it('stays on the problem of a finding', () => {
    expect(problems.map((p) => p.severity)).toEqual([
      'error',
      'warning',
      'info',
    ]);
  });

  it('splits the errors, which stop a save, from the notes, which do not', () => {
    expect(errorsOf(problems).map((p) => p.message)).toEqual(['Wrong.']);
    expect(notesOf(problems).map((p) => p.message)).toEqual([
      'Careful.',
      'FYI.',
    ]);
  });

  it('joins messages into one sentence, or says there are none', () => {
    expect(joinMessages(notesOf(problems))).toBe('Careful. FYI.');
    expect(joinMessages([])).toBeUndefined();
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
